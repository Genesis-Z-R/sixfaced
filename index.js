// -- Sixfaced main process entry point ---------------------------------------
// Responsible for: window creation, session setup, ad-blocking, scheduled
// backup trigger, and app lifecycle. All heavy IPC logic lives in src/ipc/.

const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  webContents,
  Notification,
} = require("electron");
const path = require("path");
const fs = require("fs");

// -- RAM / performance flags ---------------------------------------------------
app.commandLine.appendSwitch(
  "js-flags",
  "--max-old-space-size=256 --expose-gc",
);
app.commandLine.appendSwitch(
  "disable-features",
  "HardwareMediaKeyHandling,MediaSessionService,UseSandboxedXdgPortal",
);
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// Run the network stack in the browser process → one less utility process
app.commandLine.appendSwitch("enable-features", "NetworkServiceInProcess2");
// NOTE: enable-low-end-device-mode removed, it cuts the GPU texture tile budget
// and causes visible seams/stripes/dots on large images.

// Cap disk cache and limit renderer processes (prevents RAM growth on multi-page navigation)
app.commandLine.appendSwitch("disk-cache-size", String(80 * 1024 * 1024));
app.commandLine.appendSwitch("renderer-process-limit", "3");

// -- Startup benchmark ---------------------------------------------------------
const _t0 = Date.now();
const _bench = (label) =>
  console.log(`[boot] ${label}: +${Date.now() - _t0}ms`);

// -- Sub-modules ---------------------------------------------------------------
const blockStats = require("./src/ipc/blockStats");
const storageIpc = require("./src/ipc/storage");
const downloadsIpc = require("./src/ipc/downloads");
const subtitlesIpc = require("./src/ipc/subtitles");
const allmangaIpc = require("./src/ipc/allmanga");
const mangaIpc = require("./src/ipc/manga");
const manhwaIpc = require("./src/ipc/manhwa");
const playerIpc = require("./src/ipc/player");

// -- Ad/tracker block list -----------------------------------------------------
const BLOCKED_HOSTS = [
  "*://www.google-analytics.com/*",
  "*://analytics.google.com/*",
  "*://googletagmanager.com/*",
  "*://www.googletagmanager.com/*",
  "*://googletagservices.com/*",
  "*://doubleclick.net/*",
  "*://*.doubleclick.net/*",
  "*://adservice.google.com/*",
  "*://adservice.google.de/*",
  "*://pagead2.googlesyndication.com/*",
  "*://stats.g.doubleclick.net/*",
  "*://yt3.ggpht.com/ytc/*",
  "*://fonts.googleapis.com/*",
  "*://fonts.gstatic.com/*",
  "*://googleapis.com/*",
  "*://gstatic.com/*",
  "*://cdn.adx1.com/*",
  "*://intelligenceadx.com/*",
  "*://adsco.re/*",
  "*://mc.yandex.com/*",
  "*://mc.yandex.ru/*",
  "*://bvtpk.com/*",
  "*://my.rtmark.net/*",
  "*://b7510.com/*",
  "*://gt.unbrownunflat.com/*",
  "*://im.malocacomals.com/*",
  "*://nf.sixmossin.com/*",
  "*://realizationnewestfangs.com/*",
  "*://acscdn.com/*",
  "*://lt.taloseempest.com/*",
  "*://pl26708123.profitableratecpm.com/*",
  "*://preferencenail.com/*",
  "*://protrafficinspector.com/*",
  "*://s10.histats.com/*",
  "*://weirdopt.com/*",
  "*://*.cloudflareinsights.com/*",
  "*://kettledroopingcontinuation.com/*",
  "*://wayfarerorthodox.com/*",
  "*://woxaglasuy.net/*",
  "*://adeptspiritual.com/*",
  "*://www.calculating-laugh.com/*",
  "*://amavhxdlofklxjg.xyz/*",
  "*://7jtjubf8p5kq7x3z2.u3qleufcm6vure326ktfpbj.cfd/*",
  "*://5mq.get64t9vqg8pnbex1y463o.rest/*",
  "*://usrpubtrk.com/*",
  "*://adexchangeclear.com/*",
  "*://rzjzjnavztycv.online/*",
  "*://hameltnoummos.com/*",
];

function isHostBlocked(url) {
  try {
    const host = new URL(url).hostname;
    return BLOCKED_HOSTS.some((pat) => {
      const hostPat = pat.replace(/^\*:\/\//, "").split("/")[0];
      return hostPat.startsWith("*.")
        ? host.endsWith(hostPat.slice(1))
        : host === hostPat || host === hostPat.replace(/^\*\./, "");
    });
  } catch {
    return false;
  }
}

// Keep the application name stable across dev and packaged builds: it defines
// the userData folder, and therefore where the library lives.
app.setName("Sixfaced");

// -- Module-level state --------------------------------------------------------
let mainWindow = null;
let closeResponsePending = false;
const getMainWindow = () => mainWindow;

const playerWcIds = new Set();
let sessionsConfigured = false;

function setupSession(playerSession, trailerSession) {
  // Register player preload script to neutralize anti-sandbox & popup probes
  try {
    const playerPreloadPath = path.join(__dirname, "player-preload.js");
    if (fs.existsSync(playerPreloadPath)) {
      if (typeof playerSession.registerPreloadScript === "function") {
        playerSession.registerPreloadScript({
          filePath: playerPreloadPath,
          type: "frame",
        });
      } else if (typeof playerSession.setPreloads === "function") {
        playerSession.setPreloads([playerPreloadPath]);
      }
    }
  } catch (err) {
    console.warn("[Player Preload] Failed to register:", err);
  }

  const stripHeaders = (details, callback) => {
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      const lower = key.toLowerCase();
      if (lower === "x-frame-options" || lower === "content-security-policy")
        delete headers[key];
    }
    callback({ responseHeaders: headers });
  };

  const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  playerSession.setUserAgent(UA);
  trailerSession.setUserAgent(UA);

  playerSession.webRequest.onHeadersReceived(
    { urls: ["*://*/*"] },
    stripHeaders,
  );
  trailerSession.webRequest.onHeadersReceived(
    { urls: ["*://*/*"] },
    stripHeaders,
  );

  // Trailer: block ads only (no media intercept needed)
  trailerSession.webRequest.onBeforeRequest({ urls: BLOCKED_HOSTS }, (_, cb) =>
    cb({ cancel: true }),
  );

  // Player session: block ads + intercept m3u8/vtt URLs for renderer
  const MEDIA_URLS = [
    "*://*/*.m3u8*",
    "*://*/*.m3u8",
    "*://*/*.vtt*",
    "*://*/*.vtt",
  ];
  playerSession.webRequest.onBeforeRequest(
    { urls: [...BLOCKED_HOSTS, ...MEDIA_URLS] },
    (details, callback) => {
      const { url } = details;
      const isMedia = url.includes(".m3u8") || url.includes(".vtt");
      if (!isMedia) {
        blockStats.recordBlockedRequest(url);
        callback({ cancel: true });
        return;
      }
      // Media URL: check if it also happens to be on a blocked domain
      if (isHostBlocked(url)) {
        blockStats.recordBlockedRequest(url);
        callback({ cancel: true });
        return;
      }
      // Pass through + notify renderer
      const mw = getMainWindow();
      if (mw && !mw.isDestroyed()) {
        if (url.includes(".m3u8")) {
          mw.webContents.send("m3u8-found", url);
        } else if (url.includes(".vtt")) {
          const { extractSubtitleLang } = require("./src/ipc/subtitles");
          mw.webContents.send("subtitle-found", {
            url,
            lang: extractSubtitleLang(url),
          });
        }
      }
      callback({});
    },
  );

  // YouTube consent cookie → suppress consent gate in both sessions
  const ytCookie = {
    url: "https://www.youtube.com",
    name: "SOCS",
    value: "CAI",
    path: "/",
    secure: true,
    httpOnly: false,
    sameSite: "no_restriction",
    expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365 * 2,
  };
  for (const domain of [".youtube.com", ".youtube-nocookie.com"]) {
    const cookie = { ...ytCookie, domain };
    trailerSession.cookies.set(cookie).catch(() => {});
    playerSession.cookies.set(cookie).catch(() => {});
  }
}

function attachPlayerKeyboardHandling(wc, targetWindow) {
  if (!wc || wc.isDestroyed()) return;
  let lastKeyTime = 0;
  const MIN_REPEAT_INTERVAL = 80;

  wc.on("before-input-event", async (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.control || input.meta || input.alt) return;

    let action = null;
    let value = null;
    const code = input.code;
    const key = input.key;

    if (code === "Space" || key === "k" || key === "K") {
      action = "toggle-play";
    } else if (code === "ArrowLeft" || key === "j" || key === "J") {
      action = "seek";
      value = -10;
    } else if (code === "ArrowRight" || key === "l" || key === "L") {
      action = "seek";
      value = 10;
    } else if (code === "ArrowUp") {
      action = "volume";
      value = 0.1;
    } else if (code === "ArrowDown") {
      action = "volume";
      value = -0.1;
    } else if (key === "m" || key === "M") {
      action = "toggle-mute";
    } else if (key === "f" || key === "F") {
      action = "fullscreen";
    } else if (key >= "0" && key <= "9" && !input.isAutoRepeat) {
      action = "seek-percent";
      value = parseInt(key, 10) / 10;
    }

    if (!action) return;

    const now = Date.now();
    if (input.isAutoRepeat && now - lastKeyTime < MIN_REPEAT_INTERVAL) {
      event.preventDefault();
      return;
    }

    // Check if an input field is focused in this webContents
    try {
      const frame = wc.focusedFrame || wc.mainFrame;
      if (frame && !frame.isDestroyed()) {
        const isInput = await frame.executeJavaScript(`
          (() => {
            const el = document.activeElement;
            return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
          })()
        `);
        if (isInput) return;
      }
    } catch {}

    event.preventDefault();
    lastKeyTime = now;

    try {
      const result = await playerIpc.executeVideoControl(wc, action, value);
      const toast = playerIpc.formatPlayerToast(result, action, value);
      if (toast && targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send("player-toast", toast);
      }
    } catch {}
  });
}

/**
 * One-time profile migration from the old "streambert" app name.
 * Copies only the data that matters (library, history, settings, downloads),
 * never the HTTP/GPU caches.
 */
function migrateLegacyProfile() {
  try {
    const newDir = app.getPath("userData");
    const oldDir = path.join(path.dirname(newDir), "streambert");
    if (path.resolve(newDir) === path.resolve(oldDir)) return;

    const marker = path.join(newDir, ".migrated-from-streambert");
    if (fs.existsSync(marker)) return;

    const hasExistingData = [
      "Local Storage",
      "IndexedDB",
      "secure-store.json",
      "downloads.json",
    ].some((name) => fs.existsSync(path.join(newDir, name)));
    if (hasExistingData) {
      fs.writeFileSync(marker, `existing profile ${new Date().toISOString()}`);
      return;
    }
    if (!fs.existsSync(oldDir)) return;

    fs.mkdirSync(newDir, { recursive: true });
    const entries = [
      "Local Storage",
      "Session Storage",
      "IndexedDB",
      "secure-store.json",
      "downloads.json",
      "blockStats.json",
      "scheduled-backup-settings.json",
    ];
    for (const entry of entries) {
      const from = path.join(oldDir, entry);
      const to = path.join(newDir, entry);
      if (!fs.existsSync(from)) continue;
      fs.cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
    }
    fs.writeFileSync(marker, new Date().toISOString());
    console.log("[profile] migrated data from the Streambert profile");
  } catch (error) {
    console.warn("[profile] migration skipped:", error.message);
  }
}

function createWindow() {
  storageIpc.applySecretMigrationIfNeeded();
  downloadsIpc.loadDownloads();
  blockStats.loadBlockStats();

  if (!sessionsConfigured) {
    sessionsConfigured = true;
    const playerSession = session.fromPartition("persist:player");
    const trailerSession = session.fromPartition("persist:trailer");
    setupSession(playerSession, trailerSession);
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0a0a0a",
    icon:
      process.platform === "linux"
        ? path.join(__dirname, "public/sized/256x256.png")
        : undefined,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    frame: process.platform !== "win32",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: true,
      spellcheck: false,
      // Caps the renderer's V8 heap + exposes gc() for manual GC hints after navigation
      additionalArguments: ["--js-flags=--max-old-space-size=256 --expose-gc"],
    },
  });

  // Force long-lived disk caching for TMDB images in the default session.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ["*://image.tmdb.org/*"] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      headers["cache-control"] = ["public, max-age=604800, immutable"]; // 7 days
      delete headers["pragma"];
      delete headers["expires"];
      callback({ responseHeaders: headers });
    },
  );

  // Bypass MangaPill, ComicK, and Asura Scans CDN hotlink protection (HTTP 403 / CORS)
  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        "*://*.readdetectiveconan.com/*",
        "*://*.mangapill.com/*",
        "*://*.asurascans.com/*",
        "*://*.comicknew.pictures/*",
        "*://*.comick.pictures/*",
      ],
    },
    (details, callback) => {
      const requestHeaders = { ...details.requestHeaders };
      if (details.url.includes("readdetectiveconan") || details.url.includes("mangapill")) {
        requestHeaders["Referer"] = "https://mangapill.com/";
        requestHeaders["Origin"] = "https://mangapill.com";
      } else if (details.url.includes("comick")) {
        requestHeaders["Referer"] = "https://comick.art/";
        requestHeaders["Origin"] = "https://comick.art";
      } else if (details.url.includes("asurascans")) {
        requestHeaders["Referer"] = "https://asurascans.com/";
        requestHeaders["Origin"] = "https://asurascans.com";
      }
      requestHeaders["User-Agent"] =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      callback({ requestHeaders });
    },
  );

  session.defaultSession.webRequest.onHeadersReceived(
    {
      urls: [
        "*://*.readdetectiveconan.com/*",
        "*://*.mangapill.com/*",
        "*://*.asurascans.com/*",
        "*://*.comicknew.pictures/*",
        "*://*.comick.pictures/*",
      ],
    },
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      responseHeaders["Access-Control-Allow-Origin"] = ["*"];
      callback({ responseHeaders });
    },
  );

  // -- Lazy session setup ----------------------------------------------------
  // Player/trailer sessions are configured on the first webview attach or
  // when the pop-out window opens, whichever comes first.

  // Sanitize anything the renderer tries to attach. The app never sets a
  // preload or Node integration on its own webviews, so strip both: a
  // renderer compromise must not be able to mint a privileged guest.
  mainWindow.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    const src = params && params.src;
    if (src && src !== "about:blank") {
      try {
        const parsed = new URL(src);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          event.preventDefault();
        }
      } catch {
        event.preventDefault();
      }
    }
  });

  // Block popups from webviews, intercept fullscreen, lazy-init sessions
  mainWindow.webContents.on("did-attach-webview", (_, wc) => {
    if (!sessionsConfigured) {
      sessionsConfigured = true;
      const playerSession = session.fromPartition("persist:player");
      const trailerSession = session.fromPartition("persist:trailer");
      setupSession(playerSession, trailerSession);
    }

    // Track player webviews for cleanup on player-stopped and attach keyboard handling
    try {
      if (wc.session === session.fromPartition("persist:player")) {
        playerWcIds.add(wc.id);
        wc.once("destroyed", () => playerWcIds.delete(wc.id));
        attachPlayerKeyboardHandling(wc, mainWindow);

        const checkEpisodeUrl = (targetUrl) => {
          if (!targetUrl || typeof targetUrl !== "string") return;
          try {
            // Match e.g. /embed/tv/:id/:season/:episode or /tv/:id/:season/:episode
            let m = targetUrl.match(/(?:embed\/tv|tv)\/[^\/?#\s]+\/(\d+)\/(\d+)/i);
            if (m) {
              const season = parseInt(m[1], 10);
              const episode = parseInt(m[2], 10);
              if (!isNaN(episode) && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("player-episode-detected", { season, episode, url: targetUrl });
              }
              return;
            }
            // Match /s(\d+)[/-]?e(\d+)/ or /season[/-](\d+)[/-]episode[/-](\d+)/
            m = targetUrl.match(/(?:season[/-]|s)(\d+)[/-]?(?:episode[/-]|e)(\d+)/i);
            if (m) {
              const season = parseInt(m[1], 10);
              const episode = parseInt(m[2], 10);
              if (!isNaN(episode) && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("player-episode-detected", { season, episode, url: targetUrl });
              }
              return;
            }
            // Match query params ?season=X&episode=Y or ?s=X&e=Y
            const u = new URL(targetUrl);
            const s = u.searchParams.get("season") || u.searchParams.get("s");
            const e =
              u.searchParams.get("episode") ||
              u.searchParams.get("ep") ||
              (s ? u.searchParams.get("e") : null);
            if (e) {
              const episode = parseInt(e, 10);
              const season = s ? parseInt(s, 10) : null;
              if (!isNaN(episode) && mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("player-episode-detected", { season, episode, url: targetUrl });
              }
            }
          } catch {}
        };

        wc.on("did-navigate", (_, navUrl) => checkEpisodeUrl(navUrl));
        wc.on("did-navigate-in-page", (_, navUrl) => checkEpisodeUrl(navUrl));
      }
    } catch {}

    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (event, navigationUrl) => {
      try {
        const parsed = new URL(navigationUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          event.preventDefault();
          return;
        }
        if (isHostBlocked(navigationUrl)) {
          event.preventDefault();
          blockStats.recordBlockedRequest(navigationUrl);
        }
      } catch {
        event.preventDefault();
      }
    });

    const injectAntiSandboxBypass = () => {
      wc.executeJavaScript(`
        (() => {
          try {
            if (window.__sb_bypass_installed) return;
            window.__sb_bypass_installed = true;
            function createMockWindow(targetUrl) {
              return {
                blur() {},
                focus() {},
                close() { this.closed = true; },
                closed: false,
                location: { href: targetUrl || '', replace() {}, assign() {} },
                document: { write() {}, close() {} },
                opener: window,
                name: '',
              };
            }
            try {
              window.open = function(url) {
                return createMockWindow(url);
              };
            } catch(e) {}
            try {
              if (typeof window.embedMeta === 'object' && window.embedMeta !== null) {
                window.embedMeta.gateProbe = false;
                window.embedMeta.gateTrusted = true;
              } else {
                Object.defineProperty(window, 'embedMeta', {
                  configurable: true,
                  enumerable: true,
                  get() { return this._sb_embedMeta || { gateProbe: false, gateTrusted: true }; },
                  set(v) {
                    if (v && typeof v === 'object') {
                      v.gateProbe = false;
                      v.gateTrusted = true;
                    }
                    this._sb_embedMeta = v;
                  }
                });
              }
            } catch(e) {}
          } catch(e) {}
        })();
      `).catch(() => {});
    };

    wc.on("dom-ready", injectAntiSandboxBypass);
    wc.on("did-finish-load", injectAntiSandboxBypass);
    wc.on("did-frame-finish-load", injectAntiSandboxBypass);

    wc.on("enter-html-full-screen", () =>
      mainWindow.webContents.send("webview-enter-fullscreen"),
    );
    wc.on("leave-html-full-screen", () =>
      mainWindow.webContents.send("webview-leave-fullscreen"),
    );
  });

  // Forward renderer errors and warnings directly to terminal
  mainWindow.webContents.on(
    "console-message",
    (_, level, message, line, sourceId) => {
      // level 2 = error, 1 = warning
      if (level === 2) {
        const loc = sourceId ? ` (${path.basename(sourceId)}:${line})` : "";
        console.error(`\x1b[31m[Renderer Error]\x1b[0m ${message}${loc}`);
      } else if (level === 1) {
        console.warn(`\x1b[33m[Renderer Warn]\x1b[0m ${message}`);
      }
    },
  );

  mainWindow.webContents.on("render-process-gone", (_, details) => {
    console.error(`\x1b[31m[Renderer Process Crashed]\x1b[0m`, details);
  });

  mainWindow.loadFile(path.join(__dirname, "dist/index.html"));

  // Trigger scheduled backup after load
  mainWindow.webContents.once("did-finish-load", () => {
    _bench("renderer loaded");
    const sbSettings = storageIpc.loadScheduledBackupSettings();
    if (storageIpc.shouldRunScheduledBackup(sbSettings)) {
      mainWindow.webContents.send("scheduled-backup-requested");
    }
  });

  // Intercept close if downloads are active
  mainWindow.on("close", (e) => {
    const running = downloadsIpc
      .getDownloads()
      .filter(
        (d) =>
          d.status === "downloading" ||
          d.status === "queued" ||
          d.status === "processing",
      );
    if (running.length === 0) return;
    e.preventDefault();
    if (closeResponsePending) return;
    closeResponsePending = true;
    mainWindow.webContents.send("confirm-close", { count: running.length });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    app.quit();
  });
}

// -- Register all IPC modules --------------------------------------------------
storageIpc.register();
downloadsIpc.register(getMainWindow);
subtitlesIpc.register({
  getDownloads: downloadsIpc.getDownloads,
  saveDownloads: downloadsIpc.saveDownloads,
});
allmangaIpc.register();
mangaIpc.register();
manhwaIpc.register();
playerIpc.register(getMainWindow, {
  writeSecretMigration: storageIpc.writeSecretMigration,
});
blockStats.init(getMainWindow);

// Registered once: re-creating the window must not stack close handlers.
ipcMain.on("close-response", (_, confirmed) => {
  closeResponsePending = false;
  if (confirmed && mainWindow && !mainWindow.isDestroyed()) {
    downloadsIpc.interruptActiveForQuit();
    downloadsIpc.killAllDownloads();
    mainWindow.destroy();
  }
});

// get-block-stats lives with its data
ipcMain.handle("get-block-stats", () => blockStats.getBlockStats());

// -- Player memory cleanup ---------------------------------------------
// Called by MoviePage / TVPage on component unmount.
// Destroys the player webview WebContents by tracked ID, then flushes caches and GCs.
ipcMain.on("player-stopped", () => {
  // Step 1: Mute + destroy all tracked player WebContents by ID.
  for (const id of playerWcIds) {
    try {
      const wc = webContents.fromId(id);
      if (wc && !wc.isDestroyed()) {
        try {
          wc.setAudioMuted(true);
        } catch {}
        wc.destroy();
      }
    } catch {}
  }
  playerWcIds.clear();

  // Step 2: Flush HTTP + shader caches from the player session.
  try {
    const ps = session.fromPartition("persist:player");
    ps.clearCache().catch(() => {});
    ps.clearStorageData({ storages: ["shadercache", "cachestorage"] }).catch(
      () => {},
    );
  } catch {}

  // Step 3: GC hints
  if (typeof global.gc === "function") global.gc();
  const mw = mainWindow;
  if (mw && !mw.isDestroyed()) {
    mw.webContents
      .executeJavaScript("if(typeof gc==='function') gc();")
      .catch(() => {});
  }
});

// -- Desktop notifications -----------------------------------------------------
// Called from the renderer whenever it wants a native OS notification.
ipcMain.handle(
  "show-notification",
  (_event, { title, body, silent = false }) => {
    try {
      if (!Notification.isSupported()) return;
      const n = new Notification({
        title: String(title),
        body: String(body),
        silent,
      });
      n.show();
    } catch {}
  },
);

// -- Picture-in-Picture / Pop-Out window --------------------------------------
// Opens the player URL in a small always-on-top BrowserWindow (full site UI,
// with subtitles and controls). The Main Window closes the stream to avoid duplication.
let pipWindow = null;
const getPipWindow = () => pipWindow;

ipcMain.handle("open-pip-window", (_, { url, title }) => {
  if (!url || url === "about:blank") return { ok: false, reason: "no-url" };
  // Only web content may be loaded into the popout; never file:// or javascript:.
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, reason: "invalid-scheme" };
    }
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  // Guarantee tracker/ad blocking is active in persist:player before any load
  if (!sessionsConfigured) {
    sessionsConfigured = true;
    const playerSession = session.fromPartition("persist:player");
    const trailerSession = session.fromPartition("persist:trailer");
    setupSession(playerSession, trailerSession);
  }

  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.loadURL(url);
    pipWindow.focus();
    return { ok: true };
  }

  pipWindow = new BrowserWindow({
    width: 640,
    height: 360,
    minWidth: 320,
    minHeight: 180,
    alwaysOnTop: true,
    title: title ? `${title} - Pop-out` : "Pop-out Player",
    backgroundColor: "#000000",
    // Same custom title bar as the main window
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    frame: process.platform !== "win32",
    webPreferences: {
      partition: "persist:player",
      nodeIntegration: false,
      contextIsolation: true,
      // Injects the custom title bar and wires window-control IPC
      preload: path.join(__dirname, "popout-preload.js"),
    },
  });

  // Block all popup windows from the streaming site and any nested frames
  pipWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  attachPlayerKeyboardHandling(pipWindow.webContents, getMainWindow());

  // If the site uses <webview> elements (unlikely but safe), block there too
  pipWindow.webContents.on("did-attach-webview", (_, wc) => {
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    attachPlayerKeyboardHandling(wc, getMainWindow());
  });

  pipWindow.loadURL(url);

  // Push maximize state into the popout renderer so the title bar icon updates
  pipWindow.on("maximize", () => {
    if (!pipWindow.isDestroyed())
      pipWindow.webContents.send("popout-window-maximized", true);
  });
  pipWindow.on("unmaximize", () => {
    if (!pipWindow.isDestroyed())
      pipWindow.webContents.send("popout-window-maximized", false);
  });

  const notifyMain = (channel) => {
    const mw = getMainWindow();
    if (mw && !mw.isDestroyed()) mw.webContents.send(channel);
  };

  pipWindow.on("closed", () => {
    pipWindow = null;
    notifyMain("pip-window-closed");
  });

  notifyMain("pip-window-opened");
  return { ok: true };
});

ipcMain.handle("close-pip-window", () => {
  if (pipWindow && !pipWindow.isDestroyed()) pipWindow.close();
});

ipcMain.handle("get-pip-webcontents-id", () => {
  if (pipWindow && !pipWindow.isDestroyed()) return pipWindow.webContents.id;
  return null;
});

// -- Popout window controls (used by popout-preload.js title bar buttons) -----
ipcMain.handle("popout-window-minimize", () => {
  if (pipWindow && !pipWindow.isDestroyed()) pipWindow.minimize();
});
ipcMain.handle("popout-window-toggle-maximize", () => {
  if (!pipWindow || pipWindow.isDestroyed()) return;
  if (pipWindow.isMaximized()) pipWindow.unmaximize();
  else pipWindow.maximize();
});
ipcMain.handle("popout-window-close", () => {
  if (pipWindow && !pipWindow.isDestroyed()) pipWindow.close();
});
ipcMain.handle("popout-window-is-maximized", () => {
  return pipWindow && !pipWindow.isDestroyed()
    ? pipWindow.isMaximized()
    : false;
});

// -- Single-instance lock ------------------------------------------------------
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    _bench("app ready");
    try {
      // "automatic" keeps DoH when available but falls back to the system
      // resolver; "secure" fails hard on networks that block DoH (captive
      // portals, VPNs, corporate proxies) and breaks every request.
      app.configureHostResolver({
        secureDnsMode: "automatic",
        secureDnsServers: [
          "https://cloudflare-dns.com/dns-query",
          "https://dns.google/dns-query",
        ],
      });
    } catch (e) {
      console.warn("[dns] failed to configure host resolver:", e);
    }
    migrateLegacyProfile();
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    blockStats.flush();
    // Do not leave yt-dlp children running when the app exits.
    try {
      downloadsIpc.interruptActiveForQuit();
      downloadsIpc.killAllDownloads();
    } catch {}
  });
  app.on("activate", () => {
    if (mainWindow === null) createWindow();
  });
}

process.on("uncaughtException", (err) => {
  console.error("\x1b[31m[Main Process Uncaught Exception]\x1b[0m", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("\x1b[31m[Main Process Unhandled Rejection]\x1b[0m", reason);
});

