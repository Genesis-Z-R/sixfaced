// ── Local embed wrapper ──────────────────────────────────────────────────────
// 2embed's player page self-redirects when it is the top window:
//   if (window == window.top) location.replace("https://www.2embed.skin/")
// which is why the app showed its "copy the embed link" page instead of a
// player. Serving the page ourselves (minus that check, with a <base> so its
// relative assets still resolve) lets the real player boot inside the webview,
// where the download capture sees its HLS traffic.

const { ipcMain } = require("electron");
const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT_START = 47821;
const PORT_TRIES = 12;
const MAX_REDIRECTS = 4;
const MAX_BYTES = 4 * 1024 * 1024;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

let _port = null;
let _server = null;

function fetchText(target, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(target);
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
          Referer: parsed.origin + "/",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
          res.resume();
          resolve(fetchText(new URL(res.headers.location, target).toString(), redirectsLeft - 1));
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new Error(`Upstream HTTP ${status}`));
          return;
        }
        let size = 0;
        const chunks = [];
        res.on("data", (c) => {
          size += c.length;
          if (size <= MAX_BYTES) chunks.push(c);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      },
    );
    req.setTimeout(20000, () => req.destroy(new Error("Upstream timed out")));
    req.on("error", reject);
  });
}

/** Removes the "only play when embedded" redirect and pins relative URLs. */
function rewrite(html, pageUrl) {
  let out = html;
  // Strip the top-window redirect (the reason the player never boots).
  out = out.replace(
    /<script[^>]*>[\s\S]*?window\.location\.(?:replace|href)[\s\S]*?<\/script>/gi,
    "",
  );
  const base = `<base href="${pageUrl}">`;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1>${base}`);
  } else {
    out = base + out;
  }
  return out;
}

function startServer() {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const tryPort = (port) => {
      const srv = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url, `http://127.0.0.1:${port}`);
          if (url.pathname !== "/embed") {
            res.writeHead(404).end("not found");
            return;
          }
          const target = url.searchParams.get("u");
          if (!target || !/^https?:\/\//i.test(target)) {
            res.writeHead(400).end("missing url");
            return;
          }
          const html = await fetchText(target);
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(rewrite(html, target));
        } catch (err) {
          res.writeHead(502, { "Content-Type": "text/plain" }).end(`wrap failed: ${err.message}`);
        }
      });
      srv.once("error", (err) => {
        if (err.code === "EADDRINUSE" && attempt < PORT_TRIES) {
          attempt += 1;
          tryPort(port + 1);
        } else {
          reject(err);
        }
      });
      srv.listen(port, "127.0.0.1", () => resolve(srv));
    };
    tryPort(PORT_START);
  });
}

async function ensureServer() {
  if (_server && _port) return _port;
  _server = await startServer();
  _port = _server.address().port;
  return _port;
}

function register() {
  ipcMain.handle("get-embed-wrapper", async (_, { url }) => {
    try {
      if (!url || !/^https?:\/\//i.test(url)) return { ok: false, error: "Missing url" };
      const port = await ensureServer();
      return {
        ok: true,
        url: `http://127.0.0.1:${port}/embed?u=${encodeURIComponent(url)}`,
      };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
}

module.exports = { register };
