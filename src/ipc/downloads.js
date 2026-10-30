// ── IPC: Downloads ────────────────────────────────────────────────────────────
// Manages the download queue, spawns the downloader binary, tracks progress,
// and handles all download-related IPC handlers.

const { app, ipcMain, shell, dialog, session } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");
const os = require("os");
const { writeJsonAtomic, readJsonWithBackup, keepBackup } = require("./fsSafe");
const { isWithinAny, downloadRoots } = require("./pathSafety");
const { assertPublicHttpUrl } = require("./netGuard");
const { ensureTools } = require("./downloadTools");
const { probeStream, sanitizeHeaders } = require("./streamProbe");

const LOG_PREFIX = "sixfaced_dl_";
const LEGACY_LOG_PREFIX = "streambert_dl_";

// ── Download store ────────────────────────────────────────────────────────────

let downloads = [];
let _downloadsFile = null;
const downloadsFile = () =>
  _downloadsFile ||
  (_downloadsFile = path.join(app.getPath("userData"), "downloads.json"));

// Track running child processes by download id
const activeProcs = new Map();

// ── Trusted binary registry ───────────────────────────────────────────────────
// Maps session tokens (returned to the Renderer)
const trustedBinaryPaths = new Map(); // token (uuid) → absolute binary path

let _getMainWindow = () => null;

function sendProgress(update) {
  const mw = _getMainWindow();
  if (mw && !mw.isDestroyed()) {
    mw.webContents.send("download-progress", update);
  }
}

function sweepDownloaderLogs() {
  // Per-session debug logs are disposable; clear leftovers from previous runs.
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (
        !name.endsWith(".log") ||
        (!name.startsWith(LOG_PREFIX) && !name.startsWith(LEGACY_LOG_PREFIX))
      ) {
        continue;
      }
      try {
        fs.unlinkSync(path.join(os.tmpdir(), name));
      } catch {}
    }
  } catch {}
}

function loadDownloads() {
  const parsed = readJsonWithBackup(downloadsFile(), [], "downloads", {
    allowArray: true,
  });
  const list = Array.isArray(parsed) ? parsed : [];
  // Deduplicate: keep only the newest entry per (tmdbId, mediaType, season, episode)
  const seen = new Map();
  const sorted = list.sort(
    (a, b) =>
      (b.completedAt || b.startedAt || 0) - (a.completedAt || a.startedAt || 0),
  );
  for (const d of sorted) {
    if (!d || typeof d !== "object") continue;
    const key =
      d.tmdbId && d.mediaType
        ? `${d.tmdbId}|${d.mediaType}|${d.season ?? ""}|${d.episode ?? ""}`
        : d.id;
    if (key && !seen.has(key)) seen.set(key, d);
  }
  downloads = [...seen.values()].map((entry) => {
    if (isActiveStatus(entry.status)) {
      return {
        ...entry,
        status: "interrupted",
        lastMessage: "Interrupted — retry to resume",
      };
    }
    return entry;
  });
  sweepDownloaderLogs();
}

function saveDownloads() {
  try {
    const toSave = downloads.map((d) => {
      const copy = { ...d };
      delete copy._canceled;
      delete copy._interrupted;
      delete copy._ffmpegTotalSecs;
      return copy;
    });
    keepBackup(downloadsFile(), { allowArray: true });
    writeJsonAtomic(downloadsFile(), toSave);
  } catch {}
}

function cleanupTempFiles(downloadPath) {
  if (!downloadPath) return;
  const TEMP_PATTERNS = [
    /\.part$/,
    /\.part\.\d+$/,
    /\.part\.tmp$/,
    /\.tmp$/,
    /\.ytdl$/,
    /\.part-Frag\d+$/,
  ];
  try {
    const entries = fs.readdirSync(downloadPath);
    for (const entry of entries) {
      if (TEMP_PATTERNS.some((p) => p.test(entry))) {
        try {
          fs.unlinkSync(path.join(downloadPath, entry));
        } catch {}
      }
    }
  } catch {}
}

function killAllDownloads() {
  for (const [id, proc] of activeProcs.entries()) {
    try {
      proc.kill("SIGKILL");
    } catch {}
    const idx = downloads.findIndex((d) => d.id === id);
    if (idx !== -1) {
      downloads[idx].status = "error";
      downloads[idx].lastMessage = "Cancelled on exit";
    }
    activeProcs.delete(id);
  }
  const folders = new Set(downloads.map((d) => d.downloadPath).filter(Boolean));
  for (const folder of folders) cleanupTempFiles(folder);
  saveDownloads();
}

// ── Subtitle file downloader (used during run-download completion) ─────────────

async function downloadSubtitleFile(url, destPath) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return false;
  }

  // file: sources are only produced by the app's own temp subtitle extraction.
  if (parsedUrl.protocol === "file:") {
    try {
      const source = decodeURIComponent(parsedUrl.pathname);
      const tmpRoot = os.tmpdir();
      const inTmp = isWithinAny([tmpRoot], source);
      const base = path.basename(source);
      const looksLikeOurs =
        base.startsWith("sixfaced_sub_") || base.startsWith("streambert_sub_");
      if (!inTmp || !looksLikeOurs) return false;
      fs.copyFileSync(source, destPath);
      return true;
    } catch {
      return false;
    }
  }

  try {
    await assertPublicHttpUrl(url);
  } catch {
    return false;
  }

  return new Promise((resolve) => {
    let settled = false;
    let file = null;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const cleanup = () => {
      try {
        if (file) file.destroy();
      } catch {}
      try {
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      } catch {}
      finish(false);
    };

    try {
      const lib = parsedUrl.protocol === "https:" ? https : http;
      const req = lib.get(
        url,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0",
            Referer: parsedUrl.origin,
            Accept: "*/*",
          },
        },
        (res) => {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            const loc = res.headers.location.startsWith("http")
              ? res.headers.location
              : parsedUrl.origin + res.headers.location;
            res.resume();
            downloadSubtitleFile(loc, destPath).then(finish);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            finish(false);
            return;
          }
          file = fs.createWriteStream(destPath);
          res.pipe(file);
          file.on("finish", () => {
            file.close(() => finish(true));
          });
          file.on("error", cleanup);
          res.on("error", cleanup);
        },
      );
      req.on("error", cleanup);
      req.setTimeout(20000, () => {
        req.destroy();
        cleanup();
      });
    } catch {
      cleanup();
    }
  });
}

// ── Download scheduler ───────────────────────────────────────────────────────
// At most MAX_CONCURRENT yt-dlp processes run at once; the rest wait in a
// persisted queue. Entries survive a restart and can be retried/resumed.
const MAX_CONCURRENT = 2;
let activeJobs = 0;
const jobQueue = [];

function isActiveStatus(status) {
  return status === "queued" || status === "downloading" || status === "processing";
}

function schedule() {
  while (activeJobs < MAX_CONCURRENT && jobQueue.length) {
    const id = jobQueue.shift();
    const entry = downloads.find((d) => d.id === id);
    if (!entry || entry.status !== "queued") continue;
    startJob(entry).catch((error) => {
      activeJobs = Math.max(0, activeJobs - 1);
      entry.status = "error";
      entry.completedAt = Date.now();
      entry.lastMessage = `Download failed: ${error.message}`;
      saveDownloads();
      sendProgress({ id: entry.id, status: "error", lastMessage: entry.lastMessage });
      schedule();
    });
  }
}

function logPathFor(id) {
  const dir = path.join(app.getPath("userData"), "logs", "downloads");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return path.join(dir, `${id}.log`);
}

async function startJob(entry) {
  const id = entry.id;
  const { name, m3u8Url, downloadPath } = entry;
  activeJobs += 1;
  entry.status = "downloading";
  entry.startedAt = entry.startedAt || Date.now();
  entry.completedAt = null;
  entry.progress = 0;
  entry.speed = "";
  entry.size = "";
  entry.lastMessage = "Preparing downloader…";
  entry._canceled = false;
  entry.logPath = logPathFor(id);
  try {
    fs.writeFileSync(
      entry.logPath,
      `Sixfaced Download Log\nName: ${name}\nURL: ${m3u8Url}\nStarted: ${new Date().toISOString()}\n${"─".repeat(60)}\n`,
      "utf8",
    );
  } catch {}
  saveDownloads();
  sendProgress({ id, status: "downloading", lastMessage: entry.lastMessage, progress: 0 });

  const finish = (status, message) => {
    activeProcs.delete(id);
    activeJobs = Math.max(0, activeJobs - 1);
    const current = downloads.find((d) => d.id === id);
    if (current) {
      current.status = status;
      current.completedAt = Date.now();
      current.lastMessage = message;
      if (status === "completed") {
        current.progress = 100;
      }
    }
    saveDownloads();
    sendProgress({
      id,
      status,
      lastMessage: message,
      progress: current?.progress,
      filePath: current?.filePath,
      size: current?.size,
    });
    schedule();
  };

  let tools;
  try {
    tools = await ensureTools((p) => {
      const current = downloads.find((d) => d.id === id);
      if (!current) return;
      const pct =
        p.total > 0 ? ` ${Math.round((p.received / p.total) * 100)}%` : "";
      current.lastMessage = `Preparing downloader…${pct}`;
      sendProgress({ id, lastMessage: current.lastMessage, status: "downloading" });
    });
  } catch (error) {
    finish("error", `Downloader setup failed: ${error.message}`);
    return;
  }

  if (entry._canceled) {
    finish("canceled", "Canceled");
    return;
  }

  // A queued job may have waited long enough for the token to expire.
  const capturedAt = entry.capturedAt || 0;
  if (capturedAt && Date.now() - capturedAt > 8 * 60 * 1000) {
    const fresh = await probeStream(entry.m3u8Url, entry.headers || {});
    if (!fresh.ok) {
      finish("error", fresh.message);
      return;
    }
  }

  entry.lastMessage = "Starting download…";
  sendProgress({ id, lastMessage: entry.lastMessage, status: "downloading" });

  const safeName =
    (name || "download")
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "download";
  const captured = entry.headers || {};
  let referer = captured.referer || "https://www.google.com/";
  try {
    if (!captured.referer) referer = new URL(m3u8Url).origin + "/";
  } catch {}
  const origin = captured.origin || null;
  const cookie = captured.cookie || null;
  const authorization = captured.authorization || null;
  const userAgent =
    captured["user-agent"] ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

  const args = [
    "--no-playlist",
    "--no-colors",
    "--newline",
    "--progress",
    "--concurrent-fragments",
    "8",
    "--retries",
    "10",
    "--fragment-retries",
    "10",
    "--socket-timeout",
    "20",
    "--progress-template",
    "download:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.downloaded_bytes)s",
    "--print",
    "after_move:__SIXFACED_FILE__%(filepath)s",
    "--ffmpeg-location",
    tools.ffmpegDir,
    "--merge-output-format",
    "mp4",
    "-f",
    "bv*+ba/b",
    "--add-header",
    `Referer:${referer}`,
    ...(origin ? ["--add-header", `Origin:${origin}`] : []),
    ...(cookie ? ["--add-header", `Cookie:${cookie}`] : []),
    ...(authorization ? ["--add-header", `Authorization:${authorization}`] : []),
    "--user-agent",
    userAgent,
    "-o",
    path.join(downloadPath, `${safeName}.%(ext)s`),
    m3u8Url,
  ];

  let proc;
  try {
    proc = spawn(tools.ytDlp, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
  } catch (error) {
    finish("error", `Failed to start downloader: ${error.message}`);
    return;
  }
  activeProcs.set(id, proc);

  let buf = "";
  let stderrBuf = "";
  let closed = false;

  const appendLog = (line) => {
    try {
      fs.appendFileSync(entry.logPath, line + "\n", "utf8");
    } catch {}
  };

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const current = downloads.find((d) => d.id === id);
    if (!current) return;
    const update = {};

    const progressLine = trimmed.startsWith("download:")
      ? trimmed.slice("download:".length)
      : trimmed;
    const progressMatch = progressLine.match(/^([\d.]+)%\s*\|([^|]*)\|([^|]*)\|/);
    if (progressMatch) {
      const [, pctRaw, speedRaw, etaRaw] = progressMatch;
      const pct = parseFloat(pctRaw);
      const speed = (speedRaw || "").trim();
      const eta = (etaRaw || "").trim();
      if (Number.isFinite(pct)) update.progress = Math.min(99, Math.max(0, Math.round(pct)));
      if (speed && speed !== "Unknown") update.speed = speed;
      update.lastMessage = `Downloading…${Number.isFinite(pct) ? ` ${pct.toFixed(1)}%` : ""}${
        eta && eta !== "Unknown" ? ` · ETA ${eta}` : ""
      }`;
      Object.assign(current, update);
      sendProgress({ id, ...update, status: current.status });
      return;
    }

    if (trimmed.startsWith("__SIXFACED_FILE__")) {
      const finalPath = trimmed.slice("__SIXFACED_FILE__".length).trim();
      if (finalPath) {
        current.filePath = finalPath;
        current.progress = 99;
        current.lastMessage = "Finalizing…";
        sendProgress({ id, filePath: finalPath, progress: 99, lastMessage: "Finalizing…" });
      }
      return;
    }

    const destMatch = trimmed.match(/^\[download\] Destination:\s+(.+)/);
    if (destMatch) {
      current.filePath = destMatch[1].trim();
      current.lastMessage = "Downloading…";
      sendProgress({ id, filePath: current.filePath, lastMessage: current.lastMessage });
      return;
    }

    const mergeMatch = trimmed.match(/\[Merger\] Merging formats into "(.+)"/);
    if (mergeMatch) {
      current.filePath = mergeMatch[1].trim();
      current.progress = 99;
      current.lastMessage = "Merging audio and video…";
      sendProgress({ id, filePath: current.filePath, progress: 99, lastMessage: current.lastMessage });
      return;
    }

    if (/Retrying|timed?\s*out/i.test(trimmed) && trimmed.length < 200) {
      current.lastMessage = trimmed;
      sendProgress({ id, lastMessage: current.lastMessage });
    }
  };

  proc.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r\n|\r|\n/);
    buf = lines.pop();
    lines.forEach((line) => {
      appendLog(line);
      handleLine(line);
    });
  });
  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderrBuf += text;
    text.split(/\r\n|\r|\n/).forEach((line) => {
      appendLog(line);
      handleLine(line);
    });
  });

  proc.on("error", (error) => {
    if (closed) return;
    closed = true;
    const message =
      error.code === "EACCES"
        ? "Permission denied while launching the downloader"
        : error.code === "ENOENT"
          ? "The managed downloader binary is missing — retry to re-download it"
          : `Failed to start downloader: ${error.message}`;
    finish("error", message);
  });

  proc.on("close", (code) => {
    if (closed) return;
    closed = true;
    if (buf.trim()) handleLine(buf.trim());

    const current = downloads.find((d) => d.id === id);
    if (!current) {
      activeProcs.delete(id);
      activeJobs = Math.max(0, activeJobs - 1);
      schedule();
      return;
    }

    if (current._interrupted) {
      finish("interrupted", "Interrupted — retry to resume");
      return;
    }

    if (current._canceled) {
      try {
        if (current.logPath) fs.unlinkSync(current.logPath);
      } catch {}
      finish("canceled", "Canceled");
      return;
    }

    if (code !== 0) {
      try {
        fs.appendFileSync(
          current.logPath,
          `${"─".repeat(60)}\nFailed: exit code ${code}\nFinished: ${new Date().toISOString()}\n`,
          "utf8",
        );
      } catch {}
      const errorLine =
        stderrBuf
          .split(/\r\n|\r|\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .reverse()
          .find((l) => /error|failed|unable|cannot|denied/i.test(l)) || "";
      finish("error", (errorLine || `Download failed (exit ${code})`).slice(0, 300));
      return;
    }

    // Success: resolve the output path if yt-dlp did not print it.
    if (!current.filePath) {
      try {
        const exts = [".mp4", ".mkv", ".webm", ".m4v", ".ts"];
        const match = fs
          .readdirSync(downloadPath)
          .filter((f) => exts.some((e) => f.toLowerCase().endsWith(e)))
          .map((f) => ({ f, mtime: fs.statSync(path.join(downloadPath, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime)[0];
        if (match) current.filePath = path.join(downloadPath, match.f);
      } catch {}
    }

    if (current.filePath) {
      try {
        const ext = path.extname(current.filePath) || ".mp4";
        const newPath = path.join(downloadPath, safeName + ext);
        if (newPath !== current.filePath && !fs.existsSync(newPath)) {
          fs.renameSync(current.filePath, newPath);
          current.filePath = newPath;
        }
      } catch {}
      try {
        const bytes = fs.statSync(current.filePath).size;
        current.size =
          bytes > 1e9
            ? (bytes / 1e9).toFixed(2) + " GB"
            : bytes > 1e6
              ? (bytes / 1e6).toFixed(1) + " MB"
              : bytes > 1e3
                ? (bytes / 1e3).toFixed(1) + " KB"
                : bytes + " B";
      } catch {}
    }

    // Attach subtitles (best effort, never blocks completion reporting).
    if (current.subtitles?.length > 0 && current.filePath) {
      const videoBase = current.filePath.replace(/\.[^.]+$/, "");
      const langCounter = {};
      const KNOWN_SUB_EXTS = [".vtt", ".srt", ".ass", ".ssa", ".sub", ".idx"];
      const subPromises = current.subtitles.map(({ url, lang, name: subName, file_id }) => {
        const urlClean = url.split("?")[0].split("#")[0];
        const urlExt = path.extname(urlClean).toLowerCase().replace(/[^a-z0-9.]/g, "");
        const nameExt = subName
          ? path.extname(subName).toLowerCase().replace(/[^a-z0-9.]/g, "")
          : "";
        const subExt = KNOWN_SUB_EXTS.includes(urlExt)
          ? urlExt
          : KNOWN_SUB_EXTS.includes(nameExt)
            ? nameExt
            : ".srt";
        const safeLang = (lang || "unknown").replace(/[^a-z0-9_-]/gi, "");
        const lIdx = langCounter[safeLang] ?? 0;
        langCounter[safeLang] = lIdx + 1;
        const suffix = lIdx > 0 ? `.${lIdx}` : "";
        const subDestPath = `${videoBase}.${safeLang}${suffix}${subExt}`;
        return downloadSubtitleFile(url, subDestPath).then((ok) =>
          ok
            ? { lang: lang || "unknown", path: subDestPath, file_id: file_id || null }
            : null,
        );
      });
      Promise.all(subPromises).then((results) => {
        const i2 = downloads.findIndex((d) => d.id === id);
        if (i2 !== -1) {
          downloads[i2].subtitlePaths = results.filter(Boolean);
          saveDownloads();
          sendProgress({ id, subtitlePaths: downloads[i2].subtitlePaths });
        }
      });
    }

    try {
      if (current.logPath) fs.unlinkSync(current.logPath);
    } catch {}
    current.logPath = null;
    finish("completed", "Completed");
  });
}

/** Marks running jobs as interrupted before the process tree is killed. */
function interruptActiveForQuit() {
  let changed = false;
  for (const entry of downloads) {
    if (isActiveStatus(entry.status)) {
      entry.status = "interrupted";
      entry.lastMessage = "Interrupted — retry to resume";
      entry._interrupted = true;
      changed = true;
    }
  }
  if (changed) saveDownloads();
}

// ── IPC registration ──────────────────────────────────────────────────────────

function register(getMainWindow) {
  _getMainWindow = getMainWindow;

  // ── downloader binary detection ──────────────────────────────────────────
  // The downloader is managed by the app now: system tools when present,
  // otherwise pinned binaries fetched into userData/bin.
  ipcMain.handle("check-downloader", () => ({
    exists: true,
    token: "managed",
    managed: true,
  }));

  ipcMain.handle("get-default-download-path", () => {
    const dir = path.join(app.getPath("downloads"), "Sixfaced");
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {}
    return dir;
  });

  // ── start download (enqueue) ──────────────────────────────────────────────
  ipcMain.handle("run-download", async (_, payload = {}) => {
    try {
      const {
        m3u8Url,
        name,
        downloadPath,
        mediaId,
        mediaType,
        season,
        episode,
        posterPath,
        tmdbId,
        subtitles,
        headers,
        capturedAt,
        pageUrl,
      } = payload;

      if (!m3u8Url || !downloadPath) {
        return { ok: false, error: "Missing stream URL or download folder" };
      }
      try {
        fs.mkdirSync(downloadPath, { recursive: true });
      } catch {}

      const isActive = (status) =>
        status === "queued" || status === "downloading" || status === "processing";

      const sameEpisodeActive = downloads.some(
        (d) =>
          isActive(d.status) &&
          d.tmdbId === (tmdbId || mediaId) &&
          d.mediaType === mediaType &&
          String(d.season ?? "") === String(season ?? "") &&
          String(d.episode ?? "") === String(episode ?? ""),
      );
      if (sameEpisodeActive) {
        return {
          ok: false,
          error: "This episode is already queued or downloading",
        };
      }

      // Fail fast with a real reason instead of queueing a dead link.
      const safeHeaders = sanitizeHeaders(headers);
      const probe = await probeStream(m3u8Url, safeHeaders);
      if (!probe.ok) {
        return { ok: false, error: probe.message, code: probe.code };
      }

      const id = crypto.randomUUID();
      const entry = {
        id,
        name: name || "download",
        m3u8Url,
        downloadPath,
        filePath: null,
        status: "queued",
        progress: 0,
        speed: "",
        size: "",
        totalFragments: 0,
        completedFragments: 0,
        lastMessage: "Queued",
        startedAt: Date.now(),
        completedAt: null,
        mediaId: mediaId || null,
        mediaType: mediaType || null,
        season: season || null,
        episode: episode || null,
        posterPath: posterPath || null,
        tmdbId: tmdbId || mediaId || null,
        subtitles: Array.isArray(subtitles) ? subtitles : [],
        subtitlePaths: [],
        logPath: null,
        headers: safeHeaders,
        capturedAt: capturedAt || Date.now(),
        pageUrl: pageUrl || null,
        httpStatus: probe.status,
        streamKind: probe.kind,
      };

      downloads.push(entry);

      // Drop stale finished entries for the same episode, never live ones.
      downloads = downloads.filter(
        (d) =>
          d.id === id ||
          !(
            d.tmdbId &&
            d.tmdbId === entry.tmdbId &&
            d.mediaType === entry.mediaType &&
            String(d.season ?? "") === String(entry.season ?? "") &&
            String(d.episode ?? "") === String(entry.episode ?? "") &&
            !isActive(d.status)
          ),
      );

      jobQueue.push(id);
      saveDownloads();
      sendProgress({ id, status: "queued", progress: 0, lastMessage: "Queued" });
      schedule();
      return { ok: true, id };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("cancel-download", (_, id) => {
    try {
      const entry = downloads.find((d) => d.id === id);
      if (!entry) return { ok: false, error: "Unknown download" };

      const queueIndex = jobQueue.indexOf(id);
      if (queueIndex !== -1) jobQueue.splice(queueIndex, 1);

      if (activeProcs.has(id)) {
        entry._canceled = true;
        entry.lastMessage = "Canceling…";
        sendProgress({ id, lastMessage: "Canceling…" });
        const proc = activeProcs.get(id);
        try {
          proc.kill("SIGTERM");
        } catch {}
        setTimeout(() => {
          try {
            if (activeProcs.get(id) === proc) proc.kill("SIGKILL");
          } catch {}
        }, 4000);
      } else if (entry.status === "downloading") {
        // Still provisioning tools; startJob() will finalize as canceled.
        entry._canceled = true;
        entry.lastMessage = "Canceling…";
        sendProgress({ id, lastMessage: "Canceling…" });
      } else if (isActiveStatus(entry.status) || entry.status === "interrupted") {
        entry.status = "canceled";
        entry.completedAt = Date.now();
        entry.lastMessage = "Canceled";
        saveDownloads();
        sendProgress({ id, status: "canceled", lastMessage: "Canceled" });
        schedule();
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("retry-download", (_, id) => {
    try {
      const entry = downloads.find((d) => d.id === id);
      if (!entry) return { ok: false, error: "Unknown download" };
      if (isActiveStatus(entry.status)) {
        return { ok: false, error: "Download is already active" };
      }
      if (entry.status === "completed") {
        return { ok: false, error: "Download already completed" };
      }
      entry.status = "queued";
      entry.progress = 0;
      entry.speed = "";
      entry.size = "";
      entry.lastMessage = "Queued";
      entry.completedAt = null;
      entry.filePath = null;
      entry.subtitlePaths = [];
      entry._canceled = false;
      entry._interrupted = false;
      entry.logPath = logPathFor(id);
      if (!jobQueue.includes(id)) jobQueue.push(id);
      saveDownloads();
      sendProgress({ id, status: "queued", progress: 0, lastMessage: "Queued" });
      schedule();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("get-downloads", () => downloads);

  ipcMain.handle("delete-download", (_, { id, filePath }) => {
    try {
      const dlEntry = downloads.find((d) => d.id === id);
      if (!dlEntry) return { ok: false, error: "Unknown download" };
      const queueIndex = jobQueue.indexOf(id);
      if (queueIndex !== -1) jobQueue.splice(queueIndex, 1);
      if (activeProcs.has(id)) {
        try {
          activeProcs.get(id).kill("SIGKILL");
        } catch {}
        activeProcs.delete(id);
      }
      // Never unlink a renderer-supplied path outside this entry's folders.
      if (filePath) {
        const roots = downloadRoots([dlEntry]);
        if (!isWithinAny(roots, filePath)) {
          return { ok: false, error: "Refusing to delete outside download folder" };
        }
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {}
      }
      for (const sp of dlEntry.subtitlePaths || []) {
        try {
          if (sp?.path && fs.existsSync(sp.path)) fs.unlinkSync(sp.path);
        } catch {}
      }
      if (dlEntry.logPath) {
        try {
          if (fs.existsSync(dlEntry.logPath)) fs.unlinkSync(dlEntry.logPath);
        } catch {}
      }
      const dlPath = dlEntry.downloadPath;
      if (dlPath) cleanupTempFiles(dlPath);
      downloads = downloads.filter((d) => d.id !== id);
      saveDownloads();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("delete-all-downloads", async () => {
    try {
      // Kill every running downloader first, otherwise the children keep
      // writing to files that are about to disappear.
      jobQueue.length = 0;
      for (const [id, proc] of activeProcs) {
        try {
          proc.kill("SIGKILL");
        } catch {}
        activeProcs.delete(id);
      }
      let deleted = 0,
        errors = 0;
      for (const dl of downloads) {
        if (dl.filePath) {
          try {
            if (fs.existsSync(dl.filePath)) {
              fs.unlinkSync(dl.filePath);
              deleted++;
            }
          } catch {
            errors++;
          }
        }
        for (const sp of dl.subtitlePaths || []) {
          try {
            if (sp?.path && fs.existsSync(sp.path)) fs.unlinkSync(sp.path);
          } catch {}
        }
        if (dl.logPath) {
          try {
            if (fs.existsSync(dl.logPath)) fs.unlinkSync(dl.logPath);
          } catch {}
        }
      }
      downloads = [];
      trustedBinaryPaths.clear();
      saveDownloads();
      return { ok: true, deleted, errors };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("get-downloads-size", async () => {
    let bytes = 0;
    await Promise.all(
      downloads.map(async (dl) => {
        if (!dl.filePath) return;
        try {
          const stat = await fs.promises.stat(dl.filePath);
          if (stat.isFile()) bytes += stat.size;
        } catch {}
      }),
    );
    return { bytes };
  });

  ipcMain.handle("show-in-folder", (_, filePath) => {
    if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
    else shell.openPath(path.dirname(filePath || ""));
  });

  ipcMain.handle("file-exists", (_, filePath) => {
    try {
      return fs.existsSync(filePath);
    } catch {
      return false;
    }
  });

  ipcMain.handle("pick-folder", async () => {
    const mw = getMainWindow();
    if (!mw) return null;
    const result = await dialog.showOpenDialog(mw, {
      properties: ["openDirectory"],
      title: "Select Folder",
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("open-external", (_, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        shell.openExternal(url);
      }
    } catch {}
  });
  ipcMain.handle("open-path", (_, filePath) => {
    // If the path points to a file (e.g. an .asar archive or an executable),
    // open its containing folder instead so the OS file manager actually shows something
    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        shell.openPath(filePath);
      } else {
        shell.showItemInFolder(filePath);
      }
    } catch {
      // Path doesn't exist or stat failed
      shell.openPath(filePath);
    }
  });
  ipcMain.handle("get-install-path", () => {
    if (process.env.APPIMAGE) {
      return path.dirname(process.env.APPIMAGE);
    }

    if (app.isPackaged) {
      return path.dirname(process.execPath);
    }

    return app.getAppPath();
  });

  ipcMain.handle("scan-directory", (_, folderPath) => {
    try {
      if (!folderPath || !fs.existsSync(folderPath)) return [];
      const VIDEO_EXTS = [
        ".mp4",
        ".mkv",
        ".webm",
        ".avi",
        ".mov",
        ".m4v",
        ".ts",
      ];
      const results = [];
      const scanDir = (dir, depth = 0) => {
        if (depth > 3) return;
        let entries;
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath, depth + 1);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (VIDEO_EXTS.includes(ext)) {
              let size = "";
              try {
                const bytes = fs.statSync(fullPath).size;
                size =
                  bytes > 1e9
                    ? (bytes / 1e9).toFixed(2) + " GB"
                    : bytes > 1e6
                      ? (bytes / 1e6).toFixed(1) + " MB"
                      : bytes > 1e3
                        ? (bytes / 1e3).toFixed(1) + " KB"
                        : bytes + " B";
              } catch {}
              results.push({
                filePath: fullPath,
                name: path.basename(entry.name, ext),
                size,
                ext,
              });
            }
          }
        }
      };
      scanDir(folderPath);
      return results;
    } catch {
      return [];
    }
  });

  ipcMain.handle("clear-app-cache", async () => {
    try {
      const sessions = [
        session.defaultSession,
        session.fromPartition("persist:player"),
        session.fromPartition("persist:trailer"),
      ];
      await Promise.all(sessions.map((s) => s.clearCache()));
      await Promise.all(
        sessions.map((s) =>
          s.clearStorageData({
            storages: ["shadercache", "serviceworkers", "cachestorage"],
          }),
        ),
      );
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("clear-watch-data", async () => {
    try {
      const vs = session.fromPartition("persist:player");
      await vs.clearStorageData();
      await vs.clearCache();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle("get-cache-size", async () => {
    try {
      const sessions = [
        session.defaultSession,
        session.fromPartition("persist:player"),
        session.fromPartition("persist:trailer"),
      ];
      const sizes = await Promise.all(sessions.map((s) => s.getCacheSize()));
      return { bytes: sizes.reduce((a, b) => a + b, 0) };
    } catch {
      return { bytes: 0 };
    }
  });

  ipcMain.handle("reset-app", async () => {
    try {
      const sessions = [
        session.defaultSession,
        session.fromPartition("persist:player"),
        session.fromPartition("persist:trailer"),
      ];
      await Promise.all(sessions.map((s) => s.clearStorageData()));
      await Promise.all(sessions.map((s) => s.clearCache()));
      const dlFile = downloadsFile();
      if (fs.existsSync(dlFile)) fs.unlinkSync(dlFile);
      downloads = [];
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = {
  register,
  loadDownloads,
  saveDownloads,
  killAllDownloads,
  getDownloads: () => downloads,
  interruptActiveForQuit,
};
