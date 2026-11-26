// ── IPC: Manga / Manhwa chapter downloads ────────────────────────────────────
// Saves every page image of a chapter as
//   <downloadPath>/<Title>/Chapter 012/001.jpg
// Images are fetched in the main process so provider hotlink protection and
// CORS never apply, and so a chapter can be saved while it is open in the
// reader.

const { app, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const https = require("https");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const MAX_REDIRECTS = 4;
const MAX_BYTES = 30 * 1024 * 1024;
const TIMEOUT_MS = 25_000;
const CONCURRENCY = 4;

// Provider CDNs reject hotlinked images unless the matching Referer is sent.
const REFERERS = [
  [/(^|\.)mangapill\.com$/i, "https://mangapill.com/"],
  [/(^|\.)asuracomic\.net$/i, "https://asuracomic.net/"],
  [/(^|\.)asurascans\.com$/i, "https://asuracomic.net/"],
  [/(^|\.)comick\.io$/i, "https://comick.io/"],
  [/(^|\.)comick\.app$/i, "https://comick.io/"],
];

function refererFor(url) {
  try {
    const host = new URL(url).hostname;
    const hit = REFERERS.find(([re]) => re.test(host));
    return hit ? hit[1] : "https://mangapill.com/";
  } catch {
    return "https://mangapill.com/";
  }
}

function safeSegment(value, fallback) {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return cleaned || fallback;
}

function extFor(contentType, url) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("png")) return ".png";
  if (type.includes("webp")) return ".webp";
  if (type.includes("gif")) return ".gif";
  if (type.includes("avif")) return ".avif";
  if (type.includes("jpeg") || type.includes("jpg")) return ".jpg";
  try {
    const fromUrl = path.extname(new URL(url).pathname).toLowerCase();
    if (/^\.(jpe?g|png|webp|gif|avif)$/.test(fromUrl)) return fromUrl;
  } catch {}
  return ".jpg";
}

function fetchImage(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error("Invalid page URL"));
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      reject(new Error("Unsupported page URL"));
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.get(
      parsed,
      {
        headers: {
          "User-Agent": UA,
          Referer: refererFor(url),
          Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (
          status >= 300 &&
          status < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          resolve(fetchImage(next, redirectsLeft - 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`HTTP ${status}`));
          return;
        }
        const type = res.headers["content-type"] || "";
        if (type && !/^image\//i.test(type)) {
          res.resume();
          reject(new Error(`Not an image (${type})`));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            req.destroy(new Error("Image too large"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({ buffer: Buffer.concat(chunks), contentType: type }),
        );
        res.on("error", reject);
      },
    );
    req.setTimeout(TIMEOUT_MS, () =>
      req.destroy(new Error("Timed out fetching the page")),
    );
    req.on("error", reject);
  });
}

/** Runs `task` over `items` with a small concurrency limit. */
async function mapLimit(items, limit, task) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++;
      await task(items[current], current);
    }
  });
  await Promise.all(workers);
}

// ── Minimal ZIP writer (CBZ is a plain zip of images) ────────────────────────
// Page images are already compressed, so "stored" entries are used.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function writeZip(entries, target) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + data.length;
  }
  const centralSize = centralParts.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(target, Buffer.concat([...localParts, ...centralParts, end]));
}

function register({ addChapterDownload } = {}) {
  ipcMain.handle("download-chapter", async (_, payload = {}) => {
    let tmpDir = null;
    try {
      const { pages, title, chapterLabel, downloadPath, meta } = payload;
      const urls = Array.isArray(pages)
        ? pages.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u))
        : [];
      if (!urls.length) return { ok: false, error: "No pages to download" };

      const root = downloadPath || path.join(app.getPath("downloads"), "Sixfaced");
      const safeTitle = safeSegment(title, "Manga");
      const safeChapter = safeSegment(chapterLabel, "Chapter");
      const bookDir = path.join(root, safeTitle);
      fs.mkdirSync(bookDir, { recursive: true });
      const target = path.join(bookDir, `${safeTitle} - ${safeChapter}.cbz`);

      if (fs.existsSync(target)) {
        return {
          ok: true,
          path: target,
          downloaded: 0,
          skipped: urls.length,
          failed: 0,
          total: urls.length,
          alreadyExists: true,
          entry: null,
        };
      }

      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sixfaced_ch_"));
      const width = String(urls.length).length < 3 ? 3 : String(urls.length).length;
      let downloaded = 0;
      const failures = [];

      await mapLimit(urls, CONCURRENCY, async (url, i) => {
        const number = String(i + 1).padStart(width, "0");
        try {
          const { buffer, contentType } = await fetchImage(url);
          fs.writeFileSync(
            path.join(tmpDir, number + extFor(contentType, url)),
            buffer,
          );
          downloaded += 1;
        } catch (error) {
          failures.push(`${number}: ${error.message}`);
        }
      });

      if (!downloaded) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = null;
        return {
          ok: false,
          error: `Could not download any page (${failures[0] || "unknown error"})`,
        };
      }

      const zipEntries = fs
        .readdirSync(tmpDir)
        .sort()
        .map((name) => ({ name, data: fs.readFileSync(path.join(tmpDir, name)) }));
      writeZip(zipEntries, target);
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;

      const size = fs.statSync(target).size;
      const entry = addChapterDownload?.({
        title: safeTitle,
        chapterLabel: safeChapter,
        filePath: target,
        size,
        pageCount: zipEntries.length,
        meta: meta || {},
      });

      return {
        ok: true,
        path: target,
        downloaded,
        skipped: 0,
        failed: failures.length,
        total: urls.length,
        size,
        entry: entry || null,
      };
    } catch (e) {
      if (tmpDir) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
      }
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { register };
