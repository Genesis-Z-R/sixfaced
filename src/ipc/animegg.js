// ── AnimeGG resolver ─────────────────────────────────────────────────────────
// Independent anime source with sub AND dub. Flow:
//   search  → /search/?q=…           → /series/<slug>
//   episode → /<slug>-episode-<n>    → /embed/<id>  (dub + sub iframes)
//   embed   → {file:"/play/…/video.mp4", label:"1080p"} list
// The /play/ URL 302s to a CDN host that serves a normal MP4 (206 + ftyp),
// so it plays in the local player and downloads with yt-dlp.

const http = require("http");
const https = require("https");

const BASE = "https://www.animegg.org";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 20_000;
const CACHE_TTL = 10 * 60 * 1000;

const cache = new Map();
function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;
  const value = fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 120) cache.clear();
  return value;
}

function get(url, referer = BASE + "/", redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error("Invalid URL"));
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      reject(new Error("Unsupported protocol"));
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(
      parsed,
      {
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Referer: referer,
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          resolve(get(new URL(res.headers.location, url).toString(), referer, redirectsLeft - 1));
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          if (body.length < 4 * 1024 * 1024) body += c;
        });
        res.on("end", () => resolve({ status, url, body }));
        res.on("error", reject);
      },
    );
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("AnimeGG request timed out")));
    req.on("error", reject);
  });
}

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function scoreMatch(query, candidate) {
  const q = norm(query);
  const c = norm(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (c.startsWith(q) || q.startsWith(c)) return 80;
  if (c.includes(q) || q.includes(c)) return 60;
  const qWords = new Set(q.split(" "));
  const cWords = new Set(c.split(" "));
  let shared = 0;
  for (const w of qWords) if (cWords.has(w)) shared += 1;
  return Math.round((shared / Math.max(qWords.size, 1)) * 50);
}

async function searchSeries(title) {
  const res = await get(`${BASE}/search/?q=${encodeURIComponent(title)}`);
  if (res.status !== 200) throw new Error(`AnimeGG search HTTP ${res.status}`);
  const found = [];
  const re = /<a[^>]+href="\/series\/([^"#]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(res.body))) {
    const slug = m[1];
    const text = m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (!slug || found.some((f) => f.slug === slug)) continue;
    found.push({ slug, title: text || slug.replace(/-/g, " "), score: scoreMatch(title, text || slug) });
  }
  found.sort((a, b) => b.score - a.score);
  return found;
}

async function episodeEmbeds(slug, episode) {
  const res = await get(`${BASE}/${slug}-episode-${episode}`);
  if (res.status !== 200) throw new Error(`AnimeGG episode HTTP ${res.status}`);
  const html = res.body;
  const out = { sub: null, dub: null, all: [] };
  const re = /<iframe[^>]+src="\/embed\/(\d+)"/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    const before = html.slice(Math.max(0, m.index - 600), m.index);
    const labelIdx = before.lastIndexOf("DUBBED") >= 0 || /dubbed/i.test(before.slice(-200));
    const entry = { id, isDub: labelIdx };
    out.all.push(entry);
    if (entry.isDub && !out.dub) out.dub = id;
    else if (!entry.isDub && !out.sub) out.sub = id;
  }
  // Fallback: AnimeGG renders the dub iframe first.
  if (!out.dub && out.all.length > 1) out.dub = out.all[0].id;
  if (!out.sub && out.all.length) out.sub = out.all[out.all.length - 1].id;
  return out;
}

async function embedSources(embedId) {
  const res = await get(`${BASE}/embed/${embedId}`, `${BASE}/`);
  if (res.status !== 200) throw new Error(`AnimeGG embed HTTP ${res.status}`);
  const sources = [];
  const re = /\{file:\s*"([^"]+\.mp4[^"]*)",\s*label:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(res.body))) {
    const file = m[1].startsWith("http") ? m[1] : `${BASE}${m[1]}`;
    sources.push({ url: file, label: m[2] });
  }
  const rank = (label) => parseInt(String(label), 10) || 0;
  sources.sort((a, b) => rank(b.label) - rank(a.label));
  return sources;
}

/**
 * Resolves one episode to a direct MP4.
 * @returns {url, referer, resolution, isDirectMp4, sourceName} | null
 */
async function resolveAnimeGG({ title, episodeNumber, translationType }) {
  if (!title || episodeNumber == null) return null;
  const wantDub = translationType === "dub";

  const matches = await cached(`search:${norm(title)}`, () => searchSeries(title));
  if (!matches.length) return null;

  const episode = Math.max(1, parseInt(episodeNumber, 10) || 1);
  // Try the best title match first, then the runner-ups.
  for (const candidate of matches.slice(0, 3)) {
    try {
      const embeds = await cached(`eps:${candidate.slug}:${episode}`, () =>
        episodeEmbeds(candidate.slug, episode),
      );
      const embedId = (wantDub ? embeds.dub : null) || embeds.sub || embeds.dub;
      if (!embedId) continue;
      const sources = await cached(`src:${embedId}`, () => embedSources(embedId));
      if (!sources.length) continue;
      const best = sources[0];
      return {
        ok: true,
        url: best.url,
        referer: `${BASE}/`,
        resolution: best.label,
        isDirectMp4: true,
        sourceName: "AnimeGG",
        dub: wantDub && Boolean(embeds.dub),
      };
    } catch {
      continue;
    }
  }
  return null;
}

module.exports = { resolveAnimeGG, searchSeries, episodeEmbeds, embedSources };
