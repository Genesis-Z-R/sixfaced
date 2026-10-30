const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { probeStream, sanitizeHeaders } = require("../src/ipc/streamProbe");

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

test("sanitizeHeaders keeps only CDN-relevant headers", () => {
  const headers = sanitizeHeaders({
    Referer: "https://player.test/",
    Cookie: "a=b",
    "User-Agent": "UA",
    Origin: "https://player.test",
    Authorization: "Bearer x",
    "X-Other": "nope",
    "Content-Length": "10",
  });
  assert.deepStrictEqual(Object.keys(headers).sort(), [
    "authorization",
    "cookie",
    "origin",
    "referer",
    "user-agent",
  ]);
});

test("probeStream accepts an HLS manifest when the captured Referer is sent", async () => {
  const { server, url } = await listen((req, res) => {
    if (req.headers.referer !== "https://player.test/") {
      res.writeHead(403).end("forbidden");
      return;
    }
    res.writeHead(200, { "content-type": "application/vnd.apple.mpegurl" });
    res.end("#EXTM3U\n#EXT-X-VERSION:3\n");
  });
  try {
    const ok = await probeStream(`${url}/index.m3u8`, {
      referer: "https://player.test/",
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.kind, "hls");
  } finally {
    server.close();
  }
});

test("probeStream reports a forbidden link when the CDN rejects it", async () => {
  const { server, url } = await listen((req, res) => {
    res.writeHead(403).end("forbidden");
  });
  try {
    const res = await probeStream(`${url}/index.m3u8`, {});
    assert.equal(res.ok, false);
    assert.equal(res.code, "forbidden");
    assert.equal(res.status, 403);
    assert.match(res.message, /expired|rejected/i);
  } finally {
    server.close();
  }
});

test("probeStream detects an HTML bot-check page", async () => {
  const { server, url } = await listen((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!DOCTYPE html><html><body>Just a moment...</body></html>");
  });
  try {
    const res = await probeStream(`${url}/index.m3u8`, {});
    assert.equal(res.ok, false);
    assert.equal(res.code, "html");
  } finally {
    server.close();
  }
});

test("probeStream accepts a direct MP4 file", async () => {
  const { server, url } = await listen((req, res) => {
    const body = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from("ftypisom", "latin1"),
      Buffer.alloc(64, 0),
    ]);
    res.writeHead(206, { "content-type": "video/mp4" });
    res.end(body);
  });
  try {
    const res = await probeStream(`${url}/movie.mp4`, {});
    assert.equal(res.ok, true);
    assert.equal(res.kind, "file");
  } finally {
    server.close();
  }
});
