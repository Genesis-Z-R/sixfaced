// ── IPC: source tester ───────────────────────────────────────────────────────
// Loads every candidate embed in a hidden window (real Chromium, player-ish
// session) and reports which one actually requests an HLS/DASH manifest and
// can reach a playing state. Used by the "Test all sources" button.

const { app, BrowserWindow, ipcMain, session } = require("electron");
const { probeStream } = require("./streamProbe");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const PARTITION = "persist:srctest";
const MANIFEST_RE = /\.m3u8|\.mpd|format=m3u8|type=m3u8/i;

let running = false;

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function originOf(url) {
  try {
    return new URL(url).origin + "/";
  } catch {
    return null;
  }
}

async function testOne(source, waitMs) {
  const ses = session.fromPartition(PARTITION);
  const manifests = [];
  const httpStatus = {};
  const listener = (details) => {
    if (details.resourceType === "mainFrame" || details.resourceType === "subFrame") return;
    if (MANIFEST_RE.test(details.url || "")) manifests.push(details.url);
  };
  const headerListener = (details) => {
    if (details.resourceType === "mainFrame") httpStatus.main = details.statusCode;
  };

  ses.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, (details, cb) => {
    listener(details);
    cb({});
  });
  ses.webRequest.onHeadersReceived({ urls: ["*://*/*"] }, (details, cb) => {
    headerListener(details);
    cb({});
  });

  let win = null;
  let played = null;
  try {
    win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 720,
      webPreferences: {
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    win.webContents.setUserAgent(UA);
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const ses2 = win.webContents.session;
    try {
      ses2.setUserAgent(UA);
    } catch {}
    win.loadURL(source.url).catch(() => {});
    await wait(waitMs);
    const info = await win.webContents
      .executeJavaScript(
        `(() => {
          const v = document.querySelector("video");
          const ifr = [...document.querySelectorAll("iframe")].map(f => f.src).filter(Boolean).slice(0, 3);
          return JSON.stringify({
            hasVideo: !!v,
            readyState: v ? v.readyState : -1,
            paused: v ? v.paused : null,
            src: v ? String(v.currentSrc || v.src || "").slice(0, 160) : "",
            error: v && v.error ? v.error.code : null,
            iframes: ifr,
            title: document.title,
          });
        })()`,
        true,
      )
      .catch(() => null);
    played = info ? JSON.parse(info) : null;
  } catch (e) {
    played = { error: String(e.message || e) };
  } finally {
    try {
      ses.webRequest.onBeforeRequest(null);
      ses.webRequest.onHeadersReceived(null);
    } catch {}
    if (win && !win.isDestroyed()) win.destroy();
  }

  const unique = [...new Set(manifests)];
  let probe = null;
  if (unique.length) {
    probe = await probeStream(unique[0], {
      referer: originOf(source.url) || undefined,
      "user-agent": UA,
    }).catch((e) => ({ ok: false, message: e.message }));
  }

  return {
    id: source.id,
    label: source.label,
    url: source.url,
    pageStatus: httpStatus.main || null,
    manifests: unique.slice(0, 3),
    played,
    probeOk: probe ? probe.ok : null,
    probeMessage: probe ? probe.message || "" : "",
  };
}

function register() {
  ipcMain.handle("test-video-sources", async (_, payload = {}) => {
    if (running) return { ok: false, error: "A source test is already running" };
    const sources = Array.isArray(payload.sources) ? payload.sources.slice(0, 10) : [];
    if (!sources.length) return { ok: false, error: "No sources to test" };
    const waitMs = Math.min(20000, Math.max(4000, Number(payload.waitMs) || 11000));
    running = true;
    try {
      const results = [];
      for (const source of sources) {
        results.push(await testOne(source, waitMs));
      }
      return { ok: true, results };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      running = false;
    }
  });
}

module.exports = { register };
