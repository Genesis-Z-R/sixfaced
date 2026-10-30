// ── Stream preflight ─────────────────────────────────────────────────────────
// Verifies a captured manifest is actually fetchable with the headers the
// player used, before we queue a download that would 403 minutes later.

const http = require("http");
const https = require("https");

const MAX_REDIRECTS = 5;
const MAX_BYTES = 4096;
const TIMEOUT_MS = 12_000;

const ALLOWED_HEADERS = new Set([
  "referer",
  "origin",
  "cookie",
  "user-agent",
  "authorization",
]);

/** Keeps only the headers a media CDN may care about. */
function sanitizeHeaders(headers) {
  const out = {};
  if (!headers || typeof headers !== "object") return out;
  for (const [key, value] of Object.entries(headers)) {
    const name = String(key).toLowerCase();
    if (!ALLOWED_HEADERS.has(name)) continue;
    if (value == null) continue;
    out[name] = String(value).slice(0, 8192);
  }
  return out;
}

function isHtml(body) {
  const head = body.replace(/^\uFEFF/, "").trimStart().slice(0, 200).toLowerCase();
  return (
    head.startsWith("<!doctype html") ||
    head.startsWith("<html") ||
    head.startsWith("<head") ||
    head.startsWith("<body")
  );
}

function kindOf(body) {
  const text = body.replace(/^\uFEFF/, "").trimStart();
  if (text.startsWith("#EXTM3U")) return "hls";
  if (text.startsWith("<MPD") || text.includes("<MPD ")) return "dash";
  // ISO-BMFF (mp4) has 'ftyp' at offset 4
  if (body.length > 12 && body.slice(4, 8).toString("latin1") === "ftyp") {
    return "file";
  }
  return null;
}

function request(url, headers, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error("Invalid stream URL"));
      return;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      reject(new Error("Unsupported stream protocol"));
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      parsed,
      {
        method: "GET",
        headers: {
          ...headers,
          Range: `bytes=0-${MAX_BYTES - 1}`,
          Accept: "*/*",
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
          resolve(request(next, headers, redirectsLeft - 1));
          return;
        }

        let body = "";
        let size = 0;
        res.setEncoding("latin1");
        res.on("data", (chunk) => {
          if (size >= MAX_BYTES) return;
          body += chunk.slice(0, MAX_BYTES - size);
          size += chunk.length;
          if (size >= MAX_BYTES) res.destroy();
        });
        const finish = () =>
          resolve({
            status,
            contentType: String(res.headers["content-type"] || ""),
            body,
            finalUrl: url,
          });
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", (err) => reject(err));
      },
    );
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error("Stream host timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Fetches the first bytes of a stream URL with the captured headers.
 * Returns `{ ok, code, status, kind, message }`.
 */
async function probeStream(url, rawHeaders) {
  const headers = sanitizeHeaders(rawHeaders);
  let res;
  try {
    res = await request(url, headers);
  } catch (error) {
    return {
      ok: false,
      code: "network",
      status: 0,
      message: `Could not reach the stream host: ${error.message}`,
    };
  }

  const { status, body } = res;
  const kind = kindOf(body);

  if (status === 401 || status === 403) {
    return {
      ok: false,
      code: "forbidden",
      status,
      message: `The stream link was rejected by the CDN (HTTP ${status}). It has expired or requires a fresh player session — reopen the episode and try again.`,
    };
  }
  if (status === 404 || status === 410) {
    return {
      ok: false,
      code: "expired",
      status,
      message: `The stream link has expired (HTTP ${status}). Reopen the episode and capture a fresh link.`,
    };
  }
  if (status < 200 || status >= 300) {
    return {
      ok: false,
      code: "http",
      status,
      message: `The stream host returned HTTP ${status}.`,
    };
  }
  if (isHtml(body)) {
    return {
      ok: false,
      code: "html",
      status,
      message:
        "The source returned a web page instead of a stream (bot check or expired link).",
    };
  }
  if (!kind) {
    return {
      ok: false,
      code: "unknown",
      status,
      message: "The response is not a recognised HLS/DASH/MP4 stream.",
    };
  }

  return { ok: true, code: "ok", status, kind, message: "" };
}

module.exports = { probeStream, sanitizeHeaders };
