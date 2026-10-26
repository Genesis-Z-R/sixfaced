/**
 * Pure functions for reading-progress calculation, scroll restoration,
 * and history normalization across Manga & Manhwa reading modes.
 */

/**
 * Calculates current reading position (page index and scroll ratio)
 * from container scroll metrics and page element dimensions.
 *
 * Anchored to the viewport's top reading line, ensuring that
 * page index and scroll ratio describe the exact same position consistently
 * without negative offsets or premature clamping.
 *
 * @param {Object} params
 * @param {number} params.scrollTop - Current scroll top of scroll container
 * @param {number} params.clientHeight - Viewport client height
 * @param {number} params.scrollHeight - Total scrollable height
 * @param {Array<{ offsetTop: number, clientHeight: number }>} params.pageElements - Dimensions of each page element
 * @param {number} params.totalPages - Total number of pages in chapter
 * @param {number} [params.completionThreshold=60] - Pixels from bottom to trigger chapter completion
 * @returns {{ page: number, scrollRatio: number, isCompleted: boolean }}
 */
export function calculateReadingPosition({
  scrollTop = 0,
  clientHeight = 0,
  scrollHeight = 0,
  pageElements = [],
  totalPages = 0,
  completionThreshold = 60,
}) {
  if (!totalPages || totalPages <= 0) {
    return { page: 1, scrollRatio: 0, isCompleted: false };
  }

  // Chapter completion check: reached within threshold of container bottom
  if (
    scrollHeight > 0 &&
    clientHeight > 0 &&
    scrollTop + clientHeight >= scrollHeight - completionThreshold
  ) {
    return {
      page: totalPages,
      scrollRatio: 1,
      isCompleted: true,
    };
  }

  if (!pageElements || pageElements.length === 0) {
    return { page: 1, scrollRatio: 0, isCompleted: false };
  }

  const firstEl = pageElements[0];
  const firstTop = firstEl ? firstEl.offsetTop : 0;

  // Viewport top is above or at first image (e.g. within top padding)
  if (scrollTop <= firstTop) {
    return { page: 1, scrollRatio: 0, isCompleted: false };
  }

  // Find the page whose top is at or above the reading line. Walking to the
  // nearest *preceding* page (rather than requiring scrollTop to fall inside
  // an element) matters because wrappers are separated by a small margin:
  // a scroll position inside that gap must not be reported as the last page.
  let index = -1;
  for (let i = 0; i < pageElements.length; i++) {
    const el = pageElements[i];
    if (!el) continue;
    if (scrollTop >= el.offsetTop) index = i;
    else break; // offsets increase with page order
  }
  if (index === -1) index = 0;

  const current = pageElements[index];
  if (!current) {
    // Refs are not attached yet (first render / images not mounted). Do not
    // claim the end of the chapter; report a neutral position instead.
    return { page: 1, scrollRatio: 0, isCompleted: false };
  }

  const height = current.clientHeight || 0;
  const offsetInPage = scrollTop - current.offsetTop;
  const ratio = height > 0 ? Math.min(1, Math.max(0, offsetInPage / height)) : 0;

  return {
    page: index + 1,
    scrollRatio: Math.round(ratio * 1000) / 1000,
    isCompleted: false,
  };
}

/**
 * Calculates the exact container scrollTop required to restore a saved
 * page and scroll ratio.
 *
 * Inverse of calculateReadingPosition.
 *
 * @param {Object} params
 * @param {number} params.targetPage - 1-indexed target page
 * @param {number} params.targetRatio - 0-1 ratio within target page
 * @param {Array<{ offsetTop: number, clientHeight: number }>} params.pageElements
 * @returns {number} The desired container scrollTop
 */
export function calculateTargetScrollTop({
  targetPage = 1,
  targetRatio = 0,
  pageElements = [],
}) {
  if (targetPage <= 1 && (!targetRatio || targetRatio <= 0)) {
    return 0;
  }

  const idx = Math.max(0, targetPage - 1);
  const el = pageElements[idx];
  if (!el) return 0;

  const elTop = typeof el.offsetTop === "number" ? el.offsetTop : 0;
  const elHeight = typeof el.clientHeight === "number" ? el.clientHeight : 0;
  const clampedRatio = Math.min(1, Math.max(0, Number(targetRatio) || 0));

  return Math.max(0, Math.round(elTop + clampedRatio * elHeight));
}

/**
 * Normalizes a reading history entry, preserving legacy compatibility
 * and validating numeric ranges.
 *
 * @param {Object} entry
 * @returns {Object} Cleaned entry with validated page and scrollRatio
 */
export function normalizeHistoryEntry(entry) {
  if (!entry || typeof entry !== "object") return null;

  const rawPage = Number(entry.page);
  const page = !isNaN(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const rawRatio = Number(entry.scrollRatio);
  const scrollRatio =
    !isNaN(rawRatio) && rawRatio >= 0
      ? Math.min(1, Math.max(0, Math.round(rawRatio * 1000) / 1000))
      : 0;

  return {
    ...entry,
    chapter: entry.chapter != null ? String(entry.chapter) : null,
    chapterId: entry.chapterId != null ? String(entry.chapterId) : null,
    page,
    scrollRatio,
  };
}
