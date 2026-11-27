// ── Vidrift stream resolver ──────────────────────────────────────────────────
// Vidrift's embed page carries its own proxied HLS:
//   window.embedMeta.orionStreams = [{ url: "/api/orion/<hash>/master.m3u8" }]
// Cloudflare rejects plain Node/curl requests (TLS fingerprint + rate limits),
// but the app's Chromium session passes. So the page is loaded in a hidden
// window on a dedicated partition and the payload is read from the page
// itself. Returns a direct, downloadable HLS master URL.

const { BrowserWindow } = require("electron");

const BASE = "https://embed.vidrift.net";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const absolute = (p) =>
  !p ? null : /^https?:\/\//i.test(p) ? p : BASE + (p.startsWith("/") ? p : `/${p}`);

function pageUrlFor({ tmdbId, mediaType, season, episode }) {
  return mediaType === "tv"
    ? `${BASE}/embed/tv/${tmdbId}/${season || 1}/${episode || 1}`
    : `${BASE}/embed/movie/${tmdbId}`;
}

async function readFromWindow(win, timeoutMs = 14000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = await win.webContents
      .executeJavaScript(
        `(() => {
          try {
            const m = window.embedMeta;
            if (m && Array.isArray(m.orionStreams) && m.orionStreams.length) {
              const streams = m.orionStreams
                .filter((x) => x && x.url)
                .map((x) => ({
                  name: String(x.name || "").replace(/^Orion\s*·\s*/, "") || "Default",
                  url: x.url,
                  subs: x.subtitleListUrl || null,
                }));
              if (streams.length) return { url: streams[0].url, streams };
            }
          } catch (e) {}
          try {
            const html = document.documentElement ? document.documentElement.innerHTML : "";
            const m2 = html.match(/["'](\\/api\\/orion\\/[a-z0-9]+\\/(?:master|index)\\.m3u8)["']/i);
            if (m2) return { url: m2[1], subs: null };
          } catch (e) {}
          return null;
        })()`,
        true,
      )
      .catch(() => null);
    if (found?.url) return found;
    await wait(500);
  }
  return null;
}

/**
 * @returns {ok, url, referer, subs} for a direct Vidrift master.m3u8.
 */
async function resolveVidrift({ tmdbId, mediaType, season, episode }) {
  if (!tmdbId) return { ok: false, error: "Missing title id" };
  const page = pageUrlFor({ tmdbId, mediaType, season, episode });
  const hit = cache.get(page);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.value;

  let win = null;
  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      webPreferences: {
        partition: "persist:vidrift",
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.setUserAgent(UA);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.loadURL(page).catch(() => {});

    const found = await readFromWindow(win);
    if (!found?.url) {
      return { ok: false, error: "Vidrift did not expose a stream for this title" };
    }
    const streams = (found.streams || [{ name: "Default", url: found.url }]).map(
      (st) => ({ name: st.name, url: absolute(st.url), subs: st.subs ? absolute(st.subs) : null }),
    );
    const value = {
      ok: true,
      url: streams[0].url,
      streams,
      referer: `${BASE}/`,
      subtitleListUrl: streams[0].subs || null,
    };
    if (cache.size > 60) cache.clear();
    cache.set(page, { at: Date.now(), value });
    return value;
  } catch (error) {
    return { ok: false, error: error.message };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
  }
}

function register(ipcMain) {
  ipcMain.handle("resolve-vidrift", async (_, payload = {}) => {
    try {
      return await resolveVidrift(payload);
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { resolveVidrift, register };
