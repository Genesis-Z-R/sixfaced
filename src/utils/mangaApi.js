// ── MangaPill Unified Client for Streambert ─────────────────────────────────
// Connects the frontend UI directly to the high-speed MangaPill IPC backend.
// Replaces MangaDex entirely to eliminate 0-page licensing blocks, missing covers,
// and publisher DMCA takedown dead-ends.

// In-memory cache for fast tab and chapter switching
const _cache = new Map();

function getCached(key, ttl = 5 * 60 * 1000) {
  const item = _cache.get(key);
  if (item && Date.now() - item.ts < ttl) return item.val;
  return null;
}

function setCached(key, val) {
  _cache.set(key, { val, ts: Date.now() });
}

// ── Search Manga ─────────────────────────────────────────────────────────────
export async function searchManga(query) {
  if (!query || !query.trim()) return [];
  const cleanQ = query.trim();
  const cacheKey = "search:" + cleanQ.toLowerCase();
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (window.electron?.mangaPillSearch) {
    const res = await window.electron.mangaPillSearch({ query: cleanQ });
    if (res?.ok && Array.isArray(res.results)) {
      setCached(cacheKey, res.results);
      return res.results;
    }
  }
  return [];
}

// ── Popular / Spotlight Manga ────────────────────────────────────────────────
export async function getPopularManga(limit = 36) {
  const cacheKey = "popular:" + limit;
  const cached = getCached(cacheKey, 15 * 60 * 1000); // 15 min cache
  if (cached) return cached;

  if (window.electron?.mangaPillPopular) {
    const res = await window.electron.mangaPillPopular();
    if (res?.ok && Array.isArray(res.results)) {
      const results = res.results.slice(0, limit);
      setCached(cacheKey, results);
      return results;
    }
  }
  return [];
}

// ── Single Manga Details ─────────────────────────────────────────────────────
export async function getMangaDetails(mangaId, mangaTitle = null) {
  if (!mangaId && !mangaTitle) return null;
  const cacheKey = "details:" + (mangaId || mangaTitle);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (window.electron?.mangaPillDetails) {
    const res = await window.electron.mangaPillDetails({
      id: mangaId,
      title: mangaTitle,
    });
    if (res?.ok && res.details) {
      setCached(cacheKey, res.details);
      return res.details;
    }
  }

  // Graceful fallback
  return {
    id: mangaId,
    title: mangaTitle || "Manga Details",
    name: mangaTitle || "Manga Details",
    media_type: "manga",
    overview: `Read ${mangaTitle || "manga"} chapters on MangaPill`,
    provider: "mangapill",
  };
}

// ── Manga Chapters List ──────────────────────────────────────────────────────
export async function getMangaChapters(mangaId, sortOrder = "asc", mangaTitle = null) {
  if (!mangaId && !mangaTitle) return [];
  const cacheKey = `chapters:${mangaId || mangaTitle}:${sortOrder}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (window.electron?.mangaPillChapters) {
    const res = await window.electron.mangaPillChapters({
      id: mangaId,
      title: mangaTitle,
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
export async function getChapterPages(chapterId, mangaTitle = null, chapterNumber = null) {
  if (!chapterId && (!mangaTitle || chapterNumber == null)) {
    throw new Error("Missing chapter details");
  }

  // 1. Fetch by chapterId directly
  if (chapterId && window.electron?.mangaPillPages) {
    const res = await window.electron.mangaPillPages({ chapterId });
    if (res?.ok && Array.isArray(res.pages) && res.pages.length > 0) {
      return res.pages;
    }
  }

  // 2. Fallback: query MangaPill by mangaTitle + chapterNumber
  if (mangaTitle && chapterNumber != null && window.electron?.mangaPillFindChapter) {
    const res = await window.electron.mangaPillFindChapter({
      title: mangaTitle,
      chapterNumber,
    });
    if (res?.ok && Array.isArray(res.pages) && res.pages.length > 0) {
      return res.pages;
    }
  }

  throw new Error("No pages found for this chapter");
}
