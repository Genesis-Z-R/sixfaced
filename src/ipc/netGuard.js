// ── Network target guard ─────────────────────────────────────────────────────
// The main process proxies images and video streams on behalf of the renderer
// and a local player page. Without validation those endpoints are an SSRF
// primitive: they could reach loopback services, the LAN, or cloud metadata.
// Everything fetched by the main process must resolve to a public address.

const dns = require("dns").promises;
const net = require("net");

const LOOKUP_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const lookupCache = new Map();

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) {
    const value = ip.toLowerCase();
    if (value === "::" || value === "::1") return true;
    if (value.startsWith("fc") || value.startsWith("fd")) return true; // ULA
    if (value.startsWith("fe80")) return true; // link-local
    if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
    return false;
  }
  return true;
}

function isLocalHostname(hostname) {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa")
  );
}

function remember(host, ok) {
  if (lookupCache.size >= MAX_CACHE_ENTRIES) {
    lookupCache.clear();
  }
  lookupCache.set(host, { ok, ts: Date.now() });
}

/**
 * Validates an http(s) URL and verifies that its host resolves only to public
 * addresses. Returns the parsed URL. Throws on anything unsafe.
 */
async function assertPublicHttpUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw));
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!host || isLocalHostname(host)) throw new Error("Blocked host");

  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("Blocked private address");
    return parsed;
  }

  const cached = lookupCache.get(host);
  if (cached && Date.now() - cached.ts < LOOKUP_TTL_MS) {
    if (!cached.ok) throw new Error("Blocked host");
    return parsed;
  }

  let addresses = [];
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("Host could not be resolved");
  }
  const blocked =
    addresses.length === 0 ||
    addresses.some((entry) => isPrivateAddress(entry.address));
  remember(host, !blocked);
  if (blocked) throw new Error("Blocked private address");
  return parsed;
}

module.exports = { assertPublicHttpUrl, isPrivateAddress, isLocalHostname };
