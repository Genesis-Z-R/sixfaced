import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isWithin, isWithinAny } = require("../src/ipc/pathSafety.js");
const { isPrivateAddress, isLocalHostname, assertPublicHttpUrl } = require("../src/ipc/netGuard.js");
const { LruCache } = require("../src/ipc/lruCache.js");

const root = path.join(os.tmpdir(), "streambert-test-root");

describe("path containment", () => {
  test("accepts a child of the root", () => {
    assert.equal(isWithin(root, path.join(root, "movie.mp4")), true);
  });

  test("accepts the root itself", () => {
    assert.equal(isWithin(root, root), true);
  });

  test("rejects parent traversal", () => {
    assert.equal(isWithin(root, path.join(root, "..", "other", "file.mp4")), false);
  });

  test("rejects a sibling prefix attack", () => {
    assert.equal(isWithin(root, `${root}-evil/file.mp4`), false);
  });

  test("any-roots variant", () => {
    assert.equal(isWithinAny(["/nope", root], path.join(root, "a.srt")), true);
    assert.equal(isWithinAny(["/nope"], path.join(root, "a.srt")), false);
  });
});

describe("network guard", () => {
  test("private IPv4 ranges are blocked", () => {
    for (const ip of [
      "127.0.0.1",
      "127.9.9.9",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.254",
      "192.168.1.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
    ]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
  });

  test("public IPv4 addresses are allowed", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "93.184.216.34"]) {
      assert.equal(isPrivateAddress(ip), false, ip);
    }
  });

  test("loopback and ULA IPv6 are blocked", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1"]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
  });

  test("local hostnames are blocked", () => {
    for (const host of ["localhost", "foo.localhost", "printer.local", "db.internal"]) {
      assert.equal(isLocalHostname(host), true, host);
    }
    assert.equal(isLocalHostname("example.com"), false);
  });

  test("non-http(s) and private literals are rejected", async () => {
    await assert.rejects(() => assertPublicHttpUrl("file:///etc/passwd"));
    await assert.rejects(() => assertPublicHttpUrl("http://127.0.0.1:8080/"));
    await assert.rejects(() => assertPublicHttpUrl("http://localhost/"));
    await assert.rejects(() => assertPublicHttpUrl("http://[::1]/"));
  });
});

describe("lru cache", () => {
  test("evicts least recently used entries", () => {
    const cache = new LruCache({ maxEntries: 2, maxBytes: 1_000_000, ttlMs: 10_000 });
    cache.set("a", "1");
    cache.set("b", "2");
    cache.get("a"); // refresh a
    cache.set("c", "3");
    assert.equal(cache.get("b"), null);
    assert.equal(cache.get("a"), "1");
  });

  test("enforces the byte budget", () => {
    const cache = new LruCache({ maxEntries: 100, maxBytes: 100, ttlMs: 10_000 });
    cache.set("big", "x".repeat(120));
    assert.equal(cache.get("big"), null);
  });

  test("expires entries past their ttl", () => {
    const cache = new LruCache({ maxEntries: 10, maxBytes: 1000, ttlMs: 1 });
    cache.set("a", "1");
    return new Promise((resolve) =>
      setTimeout(() => {
        assert.equal(cache.get("a"), null);
        resolve();
      }, 5),
    );
  });
});
