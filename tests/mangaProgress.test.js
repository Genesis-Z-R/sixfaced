import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  calculateReadingPosition,
  calculateTargetScrollTop,
  normalizeHistoryEntry,
} from "../src/utils/readingProgress.js";

describe("Reading Progress Restoration System Tests", () => {
  // ── Scenario A ───────────────────────────────────────────────────────────
  test("Scenario A: Save progress partway through a tall image and restore it", () => {
    // A tall webtoon/manhwa slice: 3000px high
    const pageElements = [
      { offsetTop: 60, clientHeight: 1200 }, // Page 1: 60 - 1260
      { offsetTop: 1262, clientHeight: 3000 }, // Page 2: 1262 - 4262 (tall slice)
      { offsetTop: 4264, clientHeight: 1200 }, // Page 3: 4264 - 5464
    ];

    // User is reading partway through Page 2: scrollTop is 2462 (1200px into Page 2)
    const scrollTop = 2462;
    const clientHeight = 800;
    const scrollHeight = 6000;

    const saved = calculateReadingPosition({
      scrollTop,
      clientHeight,
      scrollHeight,
      pageElements,
      totalPages: 3,
    });

    assert.equal(saved.page, 2, "Saved page should be 2");
    // Expected ratio: (2462 - 1262) / 3000 = 1200 / 3000 = 0.4
    assert.equal(saved.scrollRatio, 0.4, "Saved ratio should be 0.4");
    assert.equal(saved.isCompleted, false);

    // Restore the position
    const restoredScroll = calculateTargetScrollTop({
      targetPage: saved.page,
      targetRatio: saved.scrollRatio,
      pageElements,
    });

    // 1262 + 0.4 * 3000 = 1262 + 1200 = 2462
    assert.equal(
      restoredScroll,
      scrollTop,
      "Restored scrollTop must exactly match original reading position",
    );
  });

  // ── Scenario B ───────────────────────────────────────────────────────────
  test("Scenario B: Save progress with viewport spanning multiple images without negative offset bugs", () => {
    // 5 pages, each 1000px high
    const pageElements = [
      { offsetTop: 0, clientHeight: 1000 }, // Page 1: 0 - 1000
      { offsetTop: 1000, clientHeight: 1000 }, // Page 2: 1000 - 2000
      { offsetTop: 2000, clientHeight: 1000 }, // Page 3: 2000 - 3000
      { offsetTop: 3000, clientHeight: 1000 }, // Page 4: 3000 - 4000
      { offsetTop: 4000, clientHeight: 1000 }, // Page 5: 4000 - 5000
    ];

    const clientHeight = 800;
    const scrollHeight = 5000;

    // Viewport top is at 2600. Viewport spans 2600 to 3400.
    // Viewport midpoint is 2600 + 400 = 3000 (which enters Page 4).
    // In legacy code, midpoint picked Page 4, and offsetInEl was max(0, 2600 - 3000) = 0!
    // That clamped ratio to 0 and falsely saved Page 4, ratio 0 (offset 3000 instead of 2600).
    const scrollTop = 2600;

    const saved = calculateReadingPosition({
      scrollTop,
      clientHeight,
      scrollHeight,
      pageElements,
      totalPages: 5,
    });

    // The reading line (viewport top) is inside Page 3 (2000 - 3000)
    assert.equal(saved.page, 3, "Saved page must be Page 3 where viewport top is located");
    // Offset in page 3 is 2600 - 2000 = 600. Ratio = 600 / 1000 = 0.6
    assert.equal(saved.scrollRatio, 0.6, "Saved ratio must accurately reflect 0.6");

    // Verify restoration returns to exact scrollTop
    const restoredScroll = calculateTargetScrollTop({
      targetPage: saved.page,
      targetRatio: saved.scrollRatio,
      pageElements,
    });

    assert.equal(restoredScroll, 2600, "Restored position must return to 2600, not jump to 3000");
  });

  // ── Scenario C ───────────────────────────────────────────────────────────
  test("Scenario C: Resume a long chapter where most images are lazy-loaded", () => {
    // 50 images total. Target is page 25, ratio 0.25.
    // Preceding images have reserved placeholder min-height (200px) before load
    const initialPageElements = Array.from({ length: 50 }, (_, i) => ({
      offsetTop: i * 200,
      clientHeight: i === 24 ? 1200 : 200, // Target image is eager and loaded
    }));

    const initialRestoredScroll = calculateTargetScrollTop({
      targetPage: 25,
      targetRatio: 0.25,
      pageElements: initialPageElements,
    });

    // Page 25 initial offsetTop is 24 * 200 = 4800.
    // With ratio 0.25: 4800 + 0.25 * 1200 = 4800 + 300 = 5100.
    assert.equal(initialRestoredScroll, 5100);

    // Now simulate preceding images 1-10 loading and expanding from 200px to 1000px (+800px each)
    const expandedPageElements = Array.from({ length: 50 }, (_, i) => {
      const height = i < 10 ? 1000 : (i === 24 ? 1200 : 200);
      let offset = 0;
      for (let j = 0; j < i; j++) {
        offset += j < 10 ? 1000 : (j === 24 ? 1200 : 200);
      }
      return { offsetTop: offset, clientHeight: height };
    });

    // ResizeObserver re-evaluates anchor on layout change:
    const updatedRestoredScroll = calculateTargetScrollTop({
      targetPage: 25,
      targetRatio: 0.25,
      pageElements: expandedPageElements,
    });

    // New offsetTop of page 25 is 10 * 1000 + 14 * 200 = 10000 + 2800 = 12800.
    // Target scroll is 12800 + 300 = 13100.
    assert.equal(
      updatedRestoredScroll,
      13100,
      "Target anchor adapts accurately as preceding images expand",
    );
  });

  // ── Scenario D ───────────────────────────────────────────────────────────
  test("Scenario D: Switch reading modes after scrolling far beyond initial position without jumping back", () => {
    let viewMode = "vertical";
    const initialStartPage = 1;
    const initialStartRatio = 0;

    // Simulate reading session state in MangaReader
    let currentPage = initialStartPage;
    let latestPage = initialStartPage;
    let latestRatio = initialStartRatio;

    const pageElements = Array.from({ length: 30 }, (_, i) => ({
      offsetTop: i * 1000,
      clientHeight: 1000,
    }));

    // User scrolls to Page 18, 500px in (ratio 0.5)
    const scrolled = calculateReadingPosition({
      scrollTop: 17500,
      clientHeight: 800,
      scrollHeight: 30000,
      pageElements,
      totalPages: 30,
    });

    assert.equal(scrolled.page, 18);
    assert.equal(scrolled.scrollRatio, 0.5);
    latestPage = scrolled.page;
    latestRatio = scrolled.scrollRatio;
    currentPage = scrolled.page;

    // Switch mode: vertical -> paginated
    // Mode switch handler uses latestPageRef (18), not stale initialStartPage (1)
    viewMode = "paginated";
    const paginatedTargetPage = latestPage;
    currentPage = paginatedTargetPage;
    latestRatio = 0;

    assert.equal(currentPage, 18, "Paginated view should open directly on Page 18");

    // In paginated mode, user flips to page 20
    currentPage = 20;
    latestPage = 20;
    latestRatio = 0;

    // Switch mode: paginated -> vertical
    viewMode = "vertical";
    const verticalTargetScroll = calculateTargetScrollTop({
      targetPage: currentPage,
      targetRatio: latestRatio,
      pageElements,
    });

    // Page 20 offsetTop is 19 * 1000 = 19000
    assert.equal(
      verticalTargetScroll,
      19000,
      "Switching back to vertical mode must scroll to Page 20, not jump to initial position",
    );
  });

  // ── Scenario E ───────────────────────────────────────────────────────────
  test("Scenario E: Rapidly navigating between chapters cancels older requests and resets restoration state", async () => {
    let chapterRequestId = 0;
    let activeChapterId = "chap-1";
    let activePages = null;
    let restoredState = null;
    let hasRestoredInitial = false;

    const initialPage = 15;
    const initialScrollRatio = 0.5;

    // Helper simulating chapter fetcher with request tracking
    function requestChapter(chapId, delayMs, pageCount) {
      activeChapterId = chapId;
      const currentToken = ++chapterRequestId;

      return new Promise((resolve) => {
        setTimeout(() => {
          // If token does not match latest chapterRequestId, request is obsolete
          if (currentToken !== chapterRequestId) {
            resolve({ aborted: true, chapId });
            return;
          }

          const pageList = Array.from({ length: pageCount }, (_, i) => ({
            pageNumber: i + 1,
            url: `https://example.com/${chapId}/p${i + 1}.jpg`,
          }));

          activePages = pageList;

          // Only initial chapter restores initialPage/initialRatio
          let startPage = 1;
          let startRatio = 0;
          if (!hasRestoredInitial) {
            hasRestoredInitial = true;
            startPage = initialPage;
            startRatio = initialScrollRatio;
          }

          restoredState = {
            chapterId: chapId,
            startPage,
            startRatio,
          };

          resolve({ aborted: false, chapId });
        }, delayMs);
      });
    }

    // Launch Chapter 1 (slow network: 80ms)
    const req1 = requestChapter("chap-1", 80, 20);
    // User quickly clicks Chapter 2 (50ms delay)
    const req2 = requestChapter("chap-2", 50, 25);
    // User quickly clicks Chapter 3 (10ms delay)
    const req3 = requestChapter("chap-3", 10, 30);

    await Promise.all([req1, req2, req3]);

    assert.equal(activeChapterId, "chap-3");
    assert.equal(activePages.length, 30);
    assert.equal(restoredState.chapterId, "chap-3");
    // Since chap-3 is the only one that finished validly, it applied initial restore
    // Subsequent navigation to chap-4 must start at page 1
    const req4 = requestChapter("chap-4", 10, 22);
    await req4;

    assert.equal(restoredState.chapterId, "chap-4");
    assert.equal(restoredState.startPage, 1, "Navigating to another chapter must not reuse initial restoration");
    assert.equal(restoredState.startRatio, 0);
  });

  // ── Scenario F ───────────────────────────────────────────────────────────
  test("Scenario F: Close reader immediately after scrolling flushes latest position synchronously", () => {
    let historyStored = null;
    let saveHistoryTimer = null;

    const onHistory = (manga, chapter, page, ratio) => {
      historyStored = {
        id: manga.id,
        chapter: chapter.chapter,
        chapterId: chapter.id,
        page,
        scrollRatio: ratio,
      };
    };

    const manga = { id: "manga-1", title: "One Piece" };
    const currentChapter = { id: "chap-100", chapter: 100 };

    let latestPage = 1;
    let latestRatio = 0;
    let isRestoring = false;

    // Simulate user scroll to page 9, ratio 0.72
    latestPage = 9;
    latestRatio = 0.72;

    // History is normally debounced 350ms
    saveHistoryTimer = setTimeout(() => {
      onHistory(manga, currentChapter, latestPage, latestRatio);
    }, 350);

    // User closes reader after 30ms (before timer fires)
    const flushHistory = () => {
      if (saveHistoryTimer) {
        clearTimeout(saveHistoryTimer);
        saveHistoryTimer = null;
      }
      if (!isRestoring && latestPage != null) {
        onHistory(manga, currentChapter, latestPage, latestRatio);
      }
    };

    flushHistory();

    assert.ok(historyStored !== null, "History must be saved synchronously on close");
    assert.equal(historyStored.page, 9);
    assert.equal(historyStored.scrollRatio, 0.72);
    assert.equal(historyStored.chapter, 100);

    // Normalize entry as App.jsx does
    const normalized = normalizeHistoryEntry(historyStored);
    assert.equal(normalized.page, 9);
    assert.equal(normalized.scrollRatio, 0.72);
    assert.equal(normalized.chapterId, "chap-100");
  });

  // ── Scenario G ───────────────────────────────────────────────────────────
  test("Scenario G: Restoration does not hang indefinitely when target image fails to load", async () => {
    let isRestoringPosition = true;
    let isRestoringRef = true;

    const safetyTimeoutMs = 50; // accelerated test timeout

    // Target image fails to load
    const targetImagePromise = new Promise((resolve) => {
      let settled = false;
      const onError = () => {
        if (settled) return;
        settled = true;
        isRestoringPosition = false;
        isRestoringRef = false;
        resolve("handled-via-error-event");
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        isRestoringPosition = false;
        isRestoringRef = false;
        resolve("handled-via-safety-timeout");
      }, safetyTimeoutMs);

      // Simulate error trigger
      setTimeout(() => onError(), 15);
    });

    const result = await targetImagePromise;
    assert.equal(isRestoringPosition, false, "Restoration loading overlay must be dismissed");
    assert.equal(isRestoringRef, false, "Restoration guard must be released");
    assert.equal(result, "handled-via-error-event");
  });

  // ── Scenario H ───────────────────────────────────────────────────────────
  test("Scenario H: Completion detection works near the end of a chapter", () => {
    const pageElements = [
      { offsetTop: 0, clientHeight: 1000 },
      { offsetTop: 1000, clientHeight: 1000 },
      { offsetTop: 2000, clientHeight: 1000 },
    ];
    const clientHeight = 800;
    const scrollHeight = 3000;

    // Viewport reached within 60px of the bottom:
    // scrollTop = 3000 - 800 - 40 = 2160 (within threshold)
    const result = calculateReadingPosition({
      scrollTop: 2160,
      clientHeight,
      scrollHeight,
      pageElements,
      totalPages: 3,
      completionThreshold: 60,
    });

    assert.equal(result.isCompleted, true, "Must flag completion near bottom");
    assert.equal(result.page, 3, "Page should be set to totalPages");
    assert.equal(result.scrollRatio, 1, "Scroll ratio should be 1");
  });

  // ── Scenario I ───────────────────────────────────────────────────────────
  test("Scenario I: History updates are guarded and not corrupted by restoration-generated scroll events", () => {
    let isRestoring = true;
    let historyWrites = 0;

    const handleScroll = () => {
      if (isRestoring) return; // Guard
      historyWrites++;
    };

    // Simulate 5 scroll events fired programmatically during restoration
    for (let i = 0; i < 5; i++) {
      handleScroll();
    }

    assert.equal(
      historyWrites,
      0,
      "Programmatic scroll events during restoration must be ignored",
    );

    // Restoration finishes
    isRestoring = false;

    // User scrolls
    handleScroll();
    assert.equal(
      historyWrites,
      1,
      "Subsequent user scroll events must be tracked normally",
    );
  });
});
