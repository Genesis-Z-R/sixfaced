// ── Small LRU cache with TTL + byte budget ───────────────────────────────────
// Used for proxied image data URLs, which are large and would otherwise grow
// the main-process heap without bound.

class LruCache {
  constructor({ maxEntries = 200, maxBytes = 48 * 1024 * 1024, ttlMs = 60 * 60 * 1000 } = {}) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.ttlMs = ttlMs;
    this.bytes = 0;
    this.map = new Map();
  }

  _sizeOf(value) {
    if (typeof value === "string") return value.length * 2; // UTF-16 in memory
    if (value && typeof value.byteLength === "number") return value.byteLength;
    return 64;
  }

  _evict() {
    while (
      (this.map.size > this.maxEntries || this.bytes > this.maxBytes) &&
      this.map.size > 0
    ) {
      const oldestKey = this.map.keys().next().value;
      const oldest = this.map.get(oldestKey);
      this.bytes -= oldest ? oldest.size : 0;
      this.map.delete(oldestKey);
    }
  }

  get(key, ttlMs = this.ttlMs) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > ttlMs) {
      this.bytes -= entry.size;
      this.map.delete(key);
      return null;
    }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    const existing = this.map.get(key);
    if (existing) {
      this.bytes -= existing.size;
      this.map.delete(key);
    }
    const size = this._sizeOf(value);
    this.map.set(key, { value, ts: Date.now(), size });
    this.bytes += size;
    this._evict();
  }

  clear() {
    this.map.clear();
    this.bytes = 0;
  }
}

module.exports = { LruCache };
