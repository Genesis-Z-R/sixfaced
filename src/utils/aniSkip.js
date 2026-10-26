// AniSkip API v2 https://api.aniskip.com/api-docs
// Uses MyAnimeList IDs (not AniList IDs).
// Response: { found, results: [{ interval: { startTime, endTime }, skipType: "op"|"ed"|... }] }

const ANISKIP_API = "https://api.aniskip.com/v2";
const CACHE_KEY = "streambert_aniskipCache";
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days

const MAX_CACHE_ENTRIES = 500;

function getCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    // Enforce the TTL and cap on read: entries are otherwise only overwritten.
    const now = Date.now();
    const keys = Object.keys(parsed);
    for (const key of keys) {
      const entry = parsed[key];
      if (!entry || typeof entry !== "object" || now >= entry.expiresAt) {
        delete parsed[key];
      }
    }
    const remaining = Object.keys(parsed);
    if (remaining.length > MAX_CACHE_ENTRIES) {
      remaining
        .sort((a, b) => (parsed[a]?.expiresAt || 0) - (parsed[b]?.expiresAt || 0))
        .slice(0, remaining.length - MAX_CACHE_ENTRIES)
        .forEach((key) => delete parsed[key]);
    }
    return parsed;
  } catch {
    return {};
  }
}

function setCache(cache) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {}
}

export function clearAniSkipCache() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
}

/**
 * Fetch intro/outro timings for an episode, with 7-day localStorage cache.
 * @param {number} malId  MyAnimeList ID (anilistData.idMal)
 * @param {number} episodeNumber
 * @returns {{ intro?: { startTime, endTime }, outro?: { startTime, endTime } } | null}
 */
export async function fetchAniSkipTimings(malId, episodeNumber) {
  if (!malId || !episodeNumber) return null;

  const cacheKey = `${malId}_${episodeNumber}`;
  const cache = getCache();
  const hit = cache[cacheKey];
  if (hit && Date.now() < hit.expiresAt) return hit.data;

  try {
    const res = await fetch(
      `${ANISKIP_API}/skip-times/${malId}/${episodeNumber}` +
        `?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&episodeLength=0`,
      { signal: AbortSignal.timeout(8000) },
    );

    // 404 = no data for this episode, cache as null
    if (res.status === 404) {
      cache[cacheKey] = { data: null, expiresAt: Date.now() + CACHE_TTL };
      setCache(cache);
      return null;
    }
    if (!res.ok) return null;

    const data = await res.json();
    if (!data.found || !data.results?.length) {
      cache[cacheKey] = { data: null, expiresAt: Date.now() + CACHE_TTL };
      setCache(cache);
      return null;
    }

    const result = {};
    for (const entry of data.results) {
      const { skipType, interval } = entry;
      // op / mixed-op → intro,  ed / mixed-ed → outro
      if (skipType === "op" || skipType === "mixed-op") {
        result.intro = {
          startTime: interval.startTime,
          endTime: interval.endTime,
        };
      } else if (skipType === "ed" || skipType === "mixed-ed") {
        result.outro = {
          startTime: interval.startTime,
          endTime: interval.endTime,
        };
      }
    }

    const timings = Object.keys(result).length > 0 ? result : null;
    cache[cacheKey] = { data: timings, expiresAt: Date.now() + CACHE_TTL };
    setCache(cache);
    return timings;
  } catch {
    return null;
  }
}
