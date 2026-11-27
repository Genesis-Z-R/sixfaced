// ── Miruro (anime, sub + dub) ────────────────────────────────────────────────
// Miruro is AniList-keyed: https://www.miruro.bz/watch/<anilistId>.
// Their old /api/secure/pipe endpoint is gone (404) and the site is now an SPA
// that plays through their own player, which a browser session passes but a
// Node request does not (Cloudflare). So instead of resolving a stream, this
// resolver maps the title to an AniList id and returns the watch page: the
// app's webview plays it, the existing capture sees the HLS, and the download
// pipeline works on the captured URL. Their player also owns sub/dub.

const https = require("https");

const BASE = "https://www.miruro.bz";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const CACHE_TTL = 30 * 60 * 1000;
const cache = new Map();

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function graphql(query, variables) {
  const body = JSON.stringify({ query, variables });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: "graphql.anilist.co",
        path: "/",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          "User-Agent": UA,
          Accept: "application/json",
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`AniList HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("AniList returned invalid JSON"));
          }
        });
      },
    );
    req.setTimeout(15000, () => req.destroy(new Error("AniList timed out")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

const SEARCH_QUERY = `query ($search: String) {
  Page(perPage: 5) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      format
      title { romaji english }
    }
  }
}`;

function score(query, media) {
  const q = norm(query);
  const names = [media.title?.english, media.title?.romaji].filter(Boolean);
  let best = 0;
  for (const name of names) {
    const n = norm(name);
    if (!n) continue;
    if (n === q) best = Math.max(best, 100);
    else if (n.startsWith(q) || q.startsWith(n)) best = Math.max(best, 85);
    else if (n.includes(q) || q.includes(n)) best = Math.max(best, 70);
  }
  return best;
}

async function anilistIdForTitle(title) {
  const key = norm(title);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.id;

  const data = await graphql(SEARCH_QUERY, { search: title });
  const media = data?.data?.Page?.media || [];
  let best = null;
  for (const m of media) {
    const s = score(title, m);
    if (!best || s > best.score) best = { id: m.id, score: s, format: m.format };
  }
  if (!best) return null;
  // Accept a looser match for films/series alike; AniList SEARCH_MATCH is good.
  cache.set(key, { at: Date.now(), id: best.id });
  return best.id;
}

/**
 * Returns a Miruro *watch page* URL (not a direct stream): the SPA resolves the
 * stream itself in a browser session, where Cloudflare and dub selection work.
 */
async function resolveMiruro({ title, episodeNumber }) {
  if (!title) return null;
  const id = await anilistIdForTitle(title).catch(() => null);
  if (!id) return null;
  const ep = Math.max(1, parseInt(episodeNumber, 10) || 1);
  return {
    ok: true,
    url: `${BASE}/watch/${id}?ep=${ep}`,
    referer: `${BASE}/`,
    sourceName: "Miruro",
    anilistId: id,
    pageSource: true,
  };
}

module.exports = { resolveMiruro, anilistIdForTitle };
