import { useCallback, useEffect, useRef, useState } from "react";

// Small fetch queue for the Updates tabs: bounded concurrency, 10-minute
// in-memory cache, and in-flight de-duplication. Rows render immediately and
// fill in as each provider answers.

const CACHE_TTL_MS = 10 * 60 * 1000;
const CONCURRENCY = 4;

const cache = new Map(); // key -> { ts, data }
const inflight = new Map(); // key -> Promise

const keyOf = (item) =>
  `${item?.media_type || "media"}:${item?.id ?? item?.title ?? ""}`;

export function clearUpdatesCache(items) {
  if (!items) {
    cache.clear();
    return;
  }
  for (const item of items) cache.delete(keyOf(item));
}

export function useUpdatesFeed(items, load, enabled) {
  const [state, setState] = useState({});
  const [version, setVersion] = useState(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const loadRef = useRef(load);
  loadRef.current = load;

  const queueKey = (items || []).map(keyOf).join("|");

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const queue = (itemsRef.current || []).slice();
    let active = 0;

    const put = (key, value) => {
      if (cancelled) return;
      setState((prev) => ({ ...prev, [key]: value }));
    };

    // Seed from cache synchronously so revisiting the tab is instant.
    setState((prev) => {
      const next = { ...prev };
      for (const item of itemsRef.current || []) {
        const key = keyOf(item);
        const hit = cache.get(key);
        if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
          next[key] = { status: "ready", data: hit.data };
        } else if (!next[key] || next[key].status === "ready") {
          next[key] = { status: "queued" };
        }
      }
      return next;
    });

    const pump = () => {
      if (cancelled) return;
      while (active < CONCURRENCY && queue.length) {
        const item = queue.shift();
        const key = keyOf(item);
        const hit = cache.get(key);
        if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
          put(key, { status: "ready", data: hit.data });
          continue;
        }

        active += 1;
        put(key, { status: "loading" });

        let promise = inflight.get(key);
        if (!promise) {
          promise = Promise.resolve()
            .then(() => loadRef.current(item))
            .then((data) => {
              cache.set(key, { ts: Date.now(), data });
              return data;
            });
          inflight.set(key, promise);
          promise.finally(() => inflight.delete(key)).catch(() => {});
        }

        promise
          .then((data) => put(key, { status: "ready", data }))
          .catch((error) =>
            put(key, {
              status: "error",
              error: error?.message || "Could not load updates",
            }),
          )
          .finally(() => {
            active -= 1;
            pump();
          });
      }
    };

    pump();
    return () => {
      cancelled = true;
    };
  }, [queueKey, enabled, version]);

  const refresh = useCallback(() => {
    clearUpdatesCache(itemsRef.current);
    setState({});
    setVersion((v) => v + 1);
  }, []);

  return { state, refresh };
}
