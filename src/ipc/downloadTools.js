// ── Managed download tools ───────────────────────────────────────────────────
// yt-dlp does the transfer (HLS, concurrent fragments, resumable parts) and
// ffmpeg remuxes. We prefer tools already installed on the system and only
// download pinned, checksum-verified binaries when they are missing.

const { app } = require("electron");
const fs = require("fs");
const path = require("path");
const https = require("https");
const zlib = require("zlib");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const YTDLP_VERSION = "2026.10.26";
const FFMPEG_VERSION = "b6.1.1";
const MAX_REDIRECTS = 5;

const ytDlpAsset = (file, sha256) => ({
  url: `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/${file}`,
  sha256,
});

const ffmpegAsset = (file, sha256, sha256Binary) => ({
  url: `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_VERSION}/${file}.gz`,
  sha256,
  sha256Binary,
  gzip: true,
});

const TOOLS = {
  ytDlp: {
    version: YTDLP_VERSION,
    assets: {
      // yt-dlp_macos is a universal2 build
      "darwin-arm64": ytDlpAsset("yt-dlp_macos", "0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa"),
      "darwin-x64": ytDlpAsset("yt-dlp_macos", "0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa"),
      "win32-x64": ytDlpAsset("yt-dlp.exe", "f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d"),
      "linux-x64": ytDlpAsset("yt-dlp_linux", "767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795"),
    },
    binary: { darwin: "yt-dlp", win32: "yt-dlp.exe", linux: "yt-dlp" },
  },
  ffprobe: {
    version: FFMPEG_VERSION,
    assets: {
      "darwin-arm64": ffmpegAsset("ffprobe-darwin-arm64", "d986a8ec7b030899fe66a8a288ed809a3543338705a3ce178cfb85869c5d80be", "bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64"),
      "darwin-x64": ffmpegAsset("ffprobe-darwin-x64", "d4da574d6e2e197bd259b47d69cf262df9e312af24ad960444f6d806d3d4c186", "fa3add0ce901f7241abe0dfc0155d958fc834aca3f8ce61f87cc712ae669c1e0"),
      "win32-x64": ffmpegAsset("ffprobe-win32-x64", "f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d", "3a7e2dc003dc2cd1472827e4c7c4f056ae1ae0ae7c5bbc580c99b49827351ba4"),
      "linux-x64": ffmpegAsset("ffprobe-linux-x64", "25d9b6ccb05e3d9de9e04e31e2506d8dd7f9f0418981965ac6df12e8d3afd067", "4f231a1960d83e403d08f7971e271707bec278a9ae18e21b8b5b03186668450d"),
    },
    binary: { darwin: "ffprobe", win32: "ffprobe.exe", linux: "ffprobe" },
  },
  ffmpeg: {
    version: FFMPEG_VERSION,
    assets: {
      "darwin-arm64": ffmpegAsset("ffmpeg-darwin-arm64", "8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa", "a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584"),
      "darwin-x64": ffmpegAsset("ffmpeg-darwin-x64", "929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106", "ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894"),
      "win32-x64": ffmpegAsset("ffmpeg-win32-x64", "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77", "04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00"),
      "linux-x64": ffmpegAsset("ffmpeg-linux-x64", "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa", "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99"),
    },
    binary: { darwin: "ffmpeg", win32: "ffmpeg.exe", linux: "ffmpeg" },
  },
};

let _cache = null;
let _inflight = null;
const _progressListeners = new Set();

function emitProgress(progress) {
  for (const listener of _progressListeners) {
    try {
      listener(progress);
    } catch {}
  }
}

function platformKey() {
  return `${process.platform}-${process.arch}`;
}

function binDir() {
  const dir = path.join(app.getPath("userData"), "bin");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isExecutable(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    if (process.platform === "win32") return true;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function which(name) {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(cmd, [name], { encoding: "utf8" });
    if (result.status === 0) {
      const first = String(result.stdout || "").trim().split(/\r?\n/)[0];
      if (first && isExecutable(first)) return first;
    }
  } catch {}
  return null;
}

function systemTool(name) {
  const fromPath = which(name);
  if (fromPath) return fromPath;
  const candidates =
    process.platform === "darwin"
      ? [`/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]
      : process.platform === "linux"
        ? [`/usr/bin/${name}`, `/usr/local/bin/${name}`]
        : [];
  for (const candidate of candidates) {
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function download(url, onProgress) {
  return new Promise((resolve, reject) => {
    let redirects = 0;
    const request = (target) => {
      let parsed;
      try {
        parsed = new URL(target);
      } catch {
        reject(new Error("Invalid download URL"));
        return;
      }
      if (parsed.protocol !== "https:") {
        reject(new Error("Downloads must use HTTPS"));
        return;
      }
      https
        .get(
          target,
          { headers: { "User-Agent": "Sixfaced/1.0", Accept: "application/octet-stream" } },
          (res) => {
            if (
              res.statusCode >= 300 &&
              res.statusCode < 400 &&
              res.headers.location &&
              redirects < MAX_REDIRECTS
            ) {
              redirects += 1;
              res.resume();
              request(new URL(res.headers.location, target).toString());
              return;
            }
            if (res.statusCode !== 200) {
              res.resume();
              reject(new Error(`Download failed (HTTP ${res.statusCode})`));
              return;
            }
            const total = Number(res.headers["content-length"] || 0);
            const chunks = [];
            let received = 0;
            res.on("data", (chunk) => {
              received += chunk.length;
              chunks.push(chunk);
              onProgress?.({ received, total });
            });
            res.on("end", () => resolve({ buffer: Buffer.concat(chunks), total }));
            res.on("error", reject);
          },
        )
        .on("error", reject);
    };
    request(url);
  });
}

async function ensureTool(name, onProgress) {
  const spec = TOOLS[name];
  const key = platformKey();
  const asset = spec.assets[key];
  if (!asset) {
    throw new Error(`No ${name} build for ${key}`);
  }

  // 1. A working system installation is preferred.
  const system = systemTool(name === "ytDlp" ? (process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp") : (process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"));
  if (system) {
    return { path: system, source: "system", version: "system" };
  }

  // 2. A previously downloaded, intact copy.
  const dir = binDir();
  const dest = path.join(dir, spec.binary[process.platform] || spec.binary.linux);
  if (isExecutable(dest)) {
    const digest = await sha256File(dest);
    if (digest === (asset.sha256Binary || asset.sha256)) {
      return { path: dest, source: "managed", version: spec.version };
    }
  }

  // 3. Fetch the pinned binary.
  onProgress?.({ tool: name, phase: "downloading", received: 0, total: 0 });
  const { buffer } = await download(asset.url, (p) =>
    onProgress?.({ tool: name, phase: "downloading", ...p }),
  );
  onProgress?.({ tool: name, phase: "verifying", received: 0, total: 0 });

  const digest = crypto.createHash("sha256").update(buffer).digest("hex");
  if (digest !== asset.sha256) {
    throw new Error(`${name} download failed checksum verification`);
  }

  let data = buffer;
  if (asset.gzip) data = zlib.gunzipSync(buffer);

  if (asset.sha256Binary) {
    const binaryDigest = crypto.createHash("sha256").update(data).digest("hex");
    if (binaryDigest !== asset.sha256Binary) {
      throw new Error(`${name} binary failed checksum verification`);
    }
  }

  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, data, { mode: 0o755 });
  fs.renameSync(tmp, dest);
  if (process.platform !== "win32") fs.chmodSync(dest, 0o755);

  onProgress?.({ tool: name, phase: "ready", received: 0, total: 0 });
  return { path: dest, source: "managed", version: spec.version };
}

/**
 * Ensures both tools exist. Returns `{ ytDlp, ffmpeg, ffmpegDir }`.
 * Always verifies managed binaries against the pinned checksum.
 */
function ensureTools(onProgress) {
  if (onProgress) _progressListeners.add(onProgress);
  const release = () => {
    if (onProgress) _progressListeners.delete(onProgress);
  };

  if (_cache) {
    release();
    return Promise.resolve(_cache);
  }
  if (_inflight) return _inflight.finally(release);

  _inflight = (async () => {
    const ytDlp = await ensureTool("ytDlp", emitProgress);
    const ffmpeg = await ensureTool("ffmpeg", emitProgress);
    // ffprobe is optional: downloads work without it, but metadata warnings
    // and format checks are cleaner when it is present.
    let ffprobe = null;
    try {
      ffprobe = await ensureTool("ffprobe", emitProgress);
    } catch {}
    _cache = {
      ytDlp: ytDlp.path,
      ffmpeg: ffmpeg.path,
      ffmpegDir: path.dirname(ffmpeg.path),
      ffprobe: ffprobe ? ffprobe.path : null,
      source: ytDlp.source === "system" && ffmpeg.source === "system" ? "system" : "managed",
      versions: { ytDlp: ytDlp.version, ffmpeg: ffmpeg.version },
    };
    return _cache;
  })();

  return _inflight.finally(() => {
    _inflight = null;
    release();
  });
}

/** Non-destructive status check for the Settings screen / first launch. */
function toolsStatus() {
  const key = platformKey();
  return {
    platform: key,
    supported: Boolean(TOOLS.ytDlp.assets[key] && TOOLS.ffmpeg.assets[key]),
    ytDlp: systemTool(process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp") || null,
    ffmpeg: systemTool(process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg") || null,
    managedVersion: { ytDlp: YTDLP_VERSION, ffmpeg: FFMPEG_VERSION },
  };
}

module.exports = { ensureTools, toolsStatus, TOOLS };
