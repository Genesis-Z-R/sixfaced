// ── Korean Manhwa Unified Client for Streambert ──────────────────────────────
// Connects the frontend UI directly to the high-speed Manhwa IPC backend (Asura Scans + ComicK).
// Provides instant discovery, full English translations, and vertical continuous scroll webtoons.

const _cache = new Map();

function getCached(key, ttl = 5 * 60 * 1000) {
  const item = _cache.get(key);
  if (item && Date.now() - item.ts < ttl) return item.val;
  return null;
}

function setCached(key, val) {
  _cache.set(key, { val, ts: Date.now() });
}

// ── Search Manhwa ────────────────────────────────────────────────────────────
export async function searchManhwa(query) {
  if (!query || !query.trim()) return [];
  const cleanQ = query.trim();
  const cacheKey = "manhwa:search:" + cleanQ.toLowerCase();
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (window.electron?.manhwaSearch) {
    const res = await window.electron.manhwaSearch({ query: cleanQ });
    if (res?.ok && Array.isArray(res.results)) {
      const mapped = res.results.map((r) => ({
        ...r,
        poster_path: r.poster_path || r.image,
        image: r.image || r.poster_path,
        media_type: "manhwa",
      }));
      setCached(cacheKey, mapped);
      return mapped;
    }
  }
  return [];
}

// ── Popular / Trending Manhwa ────────────────────────────────────────────────
export async function getPopularManhwa(limit = 36) {
  const cacheKey = "manhwa:popular:" + limit;
  const cached = getCached(cacheKey, 15 * 60 * 1000);
  if (cached) return cached;

  if (window.electron?.manhwaPopular) {
    const res = await window.electron.manhwaPopular();
    if (res?.ok && Array.isArray(res.results)) {
      const mapped = res.results.slice(0, limit).map((r) => ({
        ...r,
        poster_path: r.poster_path || r.image,
        image: r.image || r.poster_path,
        media_type: "manhwa",
      }));
      setCached(cacheKey, mapped);
      return mapped;
    }
  }
  return [];
}

// ── Single Manhwa Details ────────────────────────────────────────────────────
export async function getManhwaDetails(manhwaId, manhwaTitle = null) {
  if (!manhwaId && !manhwaTitle) return null;
  const cacheKey = "manhwa:details:" + (manhwaId || manhwaTitle);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (window.electron?.manhwaDetails) {
    const res = await window.electron.manhwaDetails({
      id: manhwaId,
      title: manhwaTitle,
    });
    if (res?.ok && res.details) {
      const mapped = {
        ...res.details,
        poster_path: res.details.poster_path || res.details.image,
        image: res.details.image || res.details.poster_path,
        media_type: "manhwa",
      };
      setCached(cacheKey, mapped);
      return mapped;
    }
  }

  return {
    id: manhwaId,
    title: manhwaTitle || "Manhwa Details",
    name: manhwaTitle || "Manhwa Details",
    media_type: "manhwa",
    overview: `Read ${manhwaTitle || "manhwa"} chapters with continuous vertical scroll.`,
    provider: "asura",
  };
}

// ── Manhwa Chapters List ─────────────────────────────────────────────────────
export async function getManhwaChapters(manhwaId, sortOrder = "asc", manhwaTitle = null) {
  if (!manhwaId && !manhwaTitle) return [];
  const cacheKey = `manhwa:chapters:${manhwaId || manhwaTitle}:${sortOrder}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (window.electron?.manhwaChapters) {
    const res = await window.electron.manhwaChapters({
      id: manhwaId,
      title: manhwaTitle,
    });
    if (res?.ok && Array.isArray(res.chapters)) {
      const list =
        sortOrder === "desc"
          ? [...res.chapters].reverse()
          : [...res.chapters];
      setCached(cacheKey, list);
      return list;
    }
  }
  return [];
}

// ── Chapter Pages ────────────────────────────────────────────────────────────
export async function getManhwaChapterPages(chapterId, manhwaTitle = null, chapterNumber = null) {
  if (!chapterId && (!manhwaTitle || chapterNumber == null)) {
    throw new Error("Missing chapter details");
  }

  // 1. Fetch by chapterId directly
  if (chapterId && window.electron?.manhwaPages) {
    const res = await window.electron.manhwaPages({ chapterId });
    if (res?.ok && Array.isArray(res.pages) && res.pages.length > 0) {
      return res.pages;
    }
  }

  // 2. Fallback: query by manhwaTitle + chapterNumber
  if (manhwaTitle && chapterNumber != null && window.electron?.manhwaFindChapter) {
    const res = await window.electron.manhwaFindChapter({
      title: manhwaTitle,
      chapterNumber,
    });
    if (res?.ok && Array.isArray(res.pages) && res.pages.length > 0) {
      return res.pages;
    }
  }

  throw new Error("No pages found for this chapter");
}
