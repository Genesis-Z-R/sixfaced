import { useState, useEffect, useRef, useCallback } from "react";
import { getMangaChapters, getChapterPages } from "../utils/mangaApi";
import { getManhwaChapters, getManhwaChapterPages } from "../utils/manhwaApi";
import {
  calculateReadingPosition,
  calculateTargetScrollTop,
} from "../utils/readingProgress";
import {
  CloseIcon,
  BookmarkIcon,
  BookmarkFillIcon,
  BackIcon,
} from "./Icons";

export default function MangaReader({
  manga,
  initialChapter = null,
  initialPage = 1,
  initialScrollRatio = 0,
  onClose,
  onProgress,
  onHistory,
  onBookmark,
  isBookmarked = false,
}) {
  const isManhwa = manga?.media_type === "manhwa";
  const [chapters, setChapters] = useState([]);
  const [currentChapter, setCurrentChapter] = useState(null);
  const [pages, setPages] = useState([]);
  const [currentPage, setCurrentPage] = useState(initialPage || 1);
  const [loading, setLoading] = useState(true);
  const [loadingPages, setLoadingPages] = useState(false);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState("vertical"); // "vertical" | "paginated"
  const [fitMode, setFitMode] = useState("width"); // "width" | "height" | "original"
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isRestoringPosition, setIsRestoringPosition] = useState(false);

  const containerRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const pageRefs = useRef([]);
  const hideControlsTimer = useRef(null);
  const isRestoringRef = useRef(false);
  const restorationCleanupRef = useRef(null);
  const saveHistoryTimer = useRef(null);
  const chapterRequestIdRef = useRef(0);
  const hasRestoredInitialRef = useRef(false);
  const streamRef = useRef(null);
  const scrollRafRef = useRef(0);
  const hasFlushedRef = useRef(false);

  const latestPageRef = useRef(initialPage || 1);
  const latestRatioRef = useRef(initialScrollRatio || 0);

  const currentChapterRef = useRef(currentChapter);
  currentChapterRef.current = currentChapter;
  const mangaRef = useRef(manga);
  mangaRef.current = manga;

  // Keep latest callbacks in refs so calling them doesn't trigger effect re-runs
  const onHistoryRef = useRef(onHistory);
  onHistoryRef.current = onHistory;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;

  // Stable primitives for dependencies
  const mangaId = manga?.id;
  const mangaTitle = manga?.title || manga?.name;
  const initialChapterId = initialChapter?.id;
  const initialChapterNum = initialChapter?.chapter;

  // ── Auto-hide overlay controls on inactivity ──────────────────────────────
  const resetControlsTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
    hideControlsTimer.current = setTimeout(() => {
      setControlsVisible(false);
    }, 3500);
  }, []);

  useEffect(() => {
    if (controlsVisible) {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
      hideControlsTimer.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3500);
    }
  }, [controlsVisible]);

  // ── Synchronously flush pending history update ─────────────────────────────
  const flushHistory = useCallback(() => {
    if (saveHistoryTimer.current) {
      clearTimeout(saveHistoryTimer.current);
      saveHistoryTimer.current = null;
    }
    const chap = currentChapterRef.current;
    const m = mangaRef.current;
    if (chap && m && !isRestoringRef.current && latestPageRef.current != null) {
      onHistoryRef.current?.(
        m,
        chap,
        latestPageRef.current,
        latestRatioRef.current,
      );
    }
  }, []);

  // ── Cancel any ongoing restoration cleanly ────────────────────────────────
  const cancelRestoration = useCallback(() => {
    if (restorationCleanupRef.current) {
      restorationCleanupRef.current();
      restorationCleanupRef.current = null;
    }
    isRestoringRef.current = false;
    setIsRestoringPosition(false);
  }, []);

  // ── Close reader handler with guaranteed history flush ────────────────────
  const handleClose = useCallback(() => {
    cancelRestoration();
    flushHistory();
    hasFlushedRef.current = true;
    onClose?.();
  }, [cancelRestoration, flushHistory, onClose]);

  // ── Flush history on unmount ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (restorationCleanupRef.current) {
        restorationCleanupRef.current();
        restorationCleanupRef.current = null;
      }
      if (saveHistoryTimer.current) clearTimeout(saveHistoryTimer.current);
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
      // handleClose already flushed; avoid a second write with the same values.
      if (!hasFlushedRef.current) {
        const chap = currentChapterRef.current;
        const m = mangaRef.current;
        if (chap && m && !isRestoringRef.current && latestPageRef.current != null) {
          onHistoryRef.current?.(
            m,
            chap,
            latestPageRef.current,
            latestRatioRef.current,
          );
        }
      }
    };
  }, []);

  // ── Load chapter list for this manga ──────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    const fetcher = isManhwa
      ? getManhwaChapters(mangaId, "asc", mangaTitle)
      : getMangaChapters(mangaId, "asc", mangaTitle);

    fetcher
      .then((chapList) => {
        if (!mounted) return;
        setChapters(chapList);
        // Find target chapter
        let target = null;
        if (initialChapterId || initialChapterNum != null) {
          target =
            chapList.find(
              (c) =>
                c.id === initialChapterId ||
                String(c.chapter) === String(initialChapterNum),
            ) || chapList[0];
        } else {
          target = chapList[0];
        }
        setCurrentChapter(target);
        setLoading(false);
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.message || "Failed to load chapters");
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [mangaId, mangaTitle, initialChapterId, initialChapterNum, isManhwa]);

  // ── Execute scroll restoration for vertical view ──────────────────────────
  const restoreVerticalPosition = useCallback(
    (targetPage, targetRatio) => {
      cancelRestoration();

      // If restoring page 1 with ratio 0, scroll to top immediately
      if (targetPage <= 1 && (!targetRatio || targetRatio <= 0)) {
        setIsRestoringPosition(false);
        isRestoringRef.current = false;
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = 0;
        }
        return;
      }

      setIsRestoringPosition(true);
      isRestoringRef.current = true;

      let cancelled = false;
      let observer = null;
      let safetyTimer = null;
      let settleTimer = null;
      let settleDeadline = null;

      const performScroll = () => {
        if (cancelled || !scrollContainerRef.current) return;
        const pageElements = pageRefs.current.map((el) =>
          el ? { offsetTop: el.offsetTop, clientHeight: el.clientHeight } : null,
        );
        const targetScroll = calculateTargetScrollTop({
          targetPage,
          targetRatio,
          pageElements,
        });
        scrollContainerRef.current.scrollTop = targetScroll;
      };

      // Release the restoration guard only after the layout has been quiet for
      // a moment: eager images above the target can still expand after the
      // target itself has loaded, which would otherwise be saved as a user
      // scroll and corrupt the stored position.
      const scheduleSettle = () => {
        if (cancelled) return;
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          if (cancelled) return;
          isRestoringRef.current = false;
          if (observer) {
            observer.disconnect();
            observer = null;
          }
          if (settleDeadline) {
            clearTimeout(settleDeadline);
            settleDeadline = null;
          }
        }, 220);
      };

      const finishRestoration = () => {
        if (cancelled) return;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (cancelled) return;
            performScroll();
            setIsRestoringPosition(false);
            scheduleSettle();
            // Hard ceiling: a pathological layout must not lock the reader.
            settleDeadline = setTimeout(() => {
              if (cancelled) return;
              isRestoringRef.current = false;
              if (observer) {
                observer.disconnect();
                observer = null;
              }
            }, 2500);
          });
        });
      };

      // Initial layout pass
      requestAnimationFrame(() => {
        if (cancelled) return;
        performScroll();

        // Observe the *content* wrapper: its height changes when images load,
        // unlike the scroll container, whose box never changes.
        if (typeof ResizeObserver !== "undefined" && streamRef.current) {
          observer = new ResizeObserver(() => {
            if (!cancelled && isRestoringRef.current) {
              performScroll();
              scheduleSettle();
            }
          });
          observer.observe(streamRef.current);
        }

        // Check target image readiness
        const targetEl = pageRefs.current[targetPage - 1];
        const targetImg = targetEl?.querySelector("img");

        if (!targetImg || targetImg.complete) {
          finishRestoration();
        } else {
          const onTargetReady = () => {
            targetImg.removeEventListener("load", onTargetReady);
            targetImg.removeEventListener("error", onTargetReady);
            if (safetyTimer) clearTimeout(safetyTimer);
            finishRestoration();
          };

          targetImg.addEventListener("load", onTargetReady, { once: true });
          targetImg.addEventListener("error", onTargetReady, { once: true });

          // Safety timeout so reader never gets stuck if image fails or hangs
          safetyTimer = setTimeout(onTargetReady, 800);
        }
      });

      restorationCleanupRef.current = () => {
        cancelled = true;
        if (safetyTimer) clearTimeout(safetyTimer);
        if (settleTimer) clearTimeout(settleTimer);
        if (settleDeadline) clearTimeout(settleDeadline);
        if (observer) observer.disconnect();
      };
    },
    [cancelRestoration],
  );

  // ── Load pages whenever currentChapter changes ─────────────────────────────
  const currentChapterId = currentChapter?.id;
  const currentChapterNum = currentChapter?.chapter;

  useEffect(() => {
    if (!currentChapterId) return;

    // goToChapter() already flushed the previous chapter *before* switching.
    // Flushing here would attribute the old page to the new chapter.
    cancelRestoration();

    const requestId = ++chapterRequestIdRef.current;
    setLoadingPages(true);
    setError(null);

    const pageFetcher = isManhwa
      ? getManhwaChapterPages(currentChapterId, mangaTitle, currentChapterNum)
      : getChapterPages(currentChapterId, mangaTitle, currentChapterNum);

    pageFetcher
      .then((pageList) => {
        // Discard stale response if chapter switched in-flight
        if (chapterRequestIdRef.current !== requestId) return;

        setPages(pageList);
        setLoadingPages(false);

        // Determine start page and ratio
        let startPage = 1;
        let startRatio = 0;

        if (!hasRestoredInitialRef.current) {
          hasRestoredInitialRef.current = true;
          const isInitialChap =
            (!initialChapterNum && !initialChapterId) ||
            String(initialChapterNum) === String(currentChapterNum) ||
            initialChapterId === currentChapterId;

          if (isInitialChap) {
            startPage =
              initialPage && Number(initialPage) > 1
                ? Math.min(Number(initialPage), pageList.length)
                : 1;
            startRatio =
              initialScrollRatio && Number(initialScrollRatio) > 0
                ? Math.min(1, Math.max(0, Number(initialScrollRatio)))
                : 0;
          }
        }

        setCurrentPage(startPage);
        latestPageRef.current = startPage;
        latestRatioRef.current = startRatio;

        if (viewMode === "vertical") {
          restoreVerticalPosition(startPage, startRatio);
        } else {
          setIsRestoringPosition(false);
          isRestoringRef.current = false;
        }

        // Notify parent of progress
        onProgressRef.current?.(
          mangaRef.current,
          currentChapter,
          startPage,
          pageList.length,
        );
      })
      .catch((err) => {
        if (chapterRequestIdRef.current !== requestId) return;
        setError(err.message || "Failed to load chapter pages");
        setLoadingPages(false);
      });

    return () => {
      // Discard in-flight responses
      if (chapterRequestIdRef.current === requestId) {
        chapterRequestIdRef.current++;
      }
    };
  }, [
    currentChapterId,
    currentChapterNum,
    mangaId,
    mangaTitle,
    isManhwa,
    // Note: initialPage, initialScrollRatio, viewMode deliberately omitted
    // to prevent unwanted re-fetch and position reset when viewMode changes or history saves!
  ]);

  // ── Switch reading mode preserving reading position ────────────────────────
  const handleSwitchViewMode = useCallback(
    (newMode) => {
      if (newMode === viewMode) return;
      cancelRestoration();
      flushHistory();

      if (newMode === "paginated") {
        const target = latestPageRef.current || currentPage || 1;
        setCurrentPage(target);
        latestRatioRef.current = 0;
        setViewMode("paginated");
        onHistoryRef.current?.(manga, currentChapter, target, 0);
      } else {
        const target = currentPage || 1;
        setViewMode("vertical");
        latestPageRef.current = target;
        latestRatioRef.current = 0;
        requestAnimationFrame(() => {
          restoreVerticalPosition(target, 0);
        });
      }
    },
    [
      viewMode,
      currentPage,
      manga,
      currentChapter,
      cancelRestoration,
      flushHistory,
      restoreVerticalPosition,
    ],
  );

  // ── Detect page and exact scroll position in vertical mode ────────────────
  const handleScroll = useCallback(() => {
    if (controlsVisible) {
      setControlsVisible(false);
    }
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);

    // Guard: ignore programmatic scroll events during restoration
    if (isRestoringRef.current) return;
    if (viewMode !== "vertical" || !pages.length) return;
    // One layout read per frame, not per scroll event.
    if (scrollRafRef.current) return;

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const container = scrollContainerRef.current;
      const chap = currentChapterRef.current;
      const book = mangaRef.current;
      if (!container || !chap || !book) return;

      const pageElements = pageRefs.current.map((el) =>
        el ? { offsetTop: el.offsetTop, clientHeight: el.clientHeight } : null,
      );

      const { page: detectedPage, scrollRatio: detectedRatio } =
        calculateReadingPosition({
          scrollTop: container.scrollTop,
          clientHeight: container.clientHeight,
          scrollHeight: container.scrollHeight,
          pageElements,
          totalPages: pages.length,
          completionThreshold: 60,
        });

      latestPageRef.current = detectedPage;
      latestRatioRef.current = detectedRatio;

      if (detectedPage !== currentPage) {
        setCurrentPage(detectedPage);
      }

      onProgressRef.current?.(book, chap, detectedPage, pages.length);

      // Save the exact position, debounced.
      if (saveHistoryTimer.current) clearTimeout(saveHistoryTimer.current);
      saveHistoryTimer.current = setTimeout(() => {
        onHistoryRef.current?.(book, chap, detectedPage, detectedRatio);
      }, 350);
    });
  }, [viewMode, pages.length, currentPage, controlsVisible]);

  // ── Chapter Navigation ────────────────────────────────────────────────────
  const currentIndex = chapters.findIndex((c) => c.id === currentChapter?.id);
  const prevChapter = currentIndex > 0 ? chapters[currentIndex - 1] : null;
  const nextChapter =
    currentIndex !== -1 && currentIndex < chapters.length - 1
      ? chapters[currentIndex + 1]
      : null;

  const goToChapter = useCallback(
    (chap) => {
      if (!chap || chap.id === currentChapter?.id) return;
      flushHistory();
      setCurrentChapter(chap);
    },
    [currentChapter?.id, flushHistory],
  );

  // ── Page Navigation (Paginated Mode) ──────────────────────────────────────
  const goToNextPage = useCallback(() => {
    if (currentPage < pages.length) {
      const next = currentPage + 1;
      setCurrentPage(next);
      latestPageRef.current = next;
      latestRatioRef.current = 0;
      onHistoryRef.current?.(manga, currentChapter, next, 0);
      onProgressRef.current?.(manga, currentChapter, next, pages.length);
    } else if (nextChapter) {
      goToChapter(nextChapter);
    }
  }, [currentPage, pages.length, nextChapter, manga, currentChapter, goToChapter]);

  const goToPrevPage = useCallback(() => {
    if (currentPage > 1) {
      const prev = currentPage - 1;
      setCurrentPage(prev);
      latestPageRef.current = prev;
      latestRatioRef.current = 0;
      onHistoryRef.current?.(manga, currentChapter, prev, 0);
      onProgressRef.current?.(manga, currentChapter, prev, pages.length);
    } else if (prevChapter) {
      goToChapter(prevChapter);
    }
  }, [currentPage, prevChapter, manga, currentChapter, goToChapter]);

  // ── Fullscreen toggle ─────────────────────────────────────────────────────
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // ── Keyboard controls ─────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger if focusing an input/select
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;

      resetControlsTimer();

      switch (e.key) {
        case "ArrowRight":
        case "d":
        case "D":
          cancelRestoration();
          if (viewMode === "paginated") {
            goToNextPage();
          } else if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollBy({ top: 300, behavior: "smooth" });
          }
          break;

        case "ArrowLeft":
        case "a":
        case "A":
          cancelRestoration();
          if (viewMode === "paginated") {
            goToPrevPage();
          } else if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollBy({ top: -300, behavior: "smooth" });
          }
          break;

        case " ":
        case "ArrowDown":
          cancelRestoration();
          if (viewMode === "vertical" && scrollContainerRef.current) {
            e.preventDefault();
            scrollContainerRef.current.scrollBy({ top: 400, behavior: "smooth" });
          } else if (viewMode === "paginated") {
            e.preventDefault();
            goToNextPage();
          }
          break;

        case "ArrowUp":
          cancelRestoration();
          if (viewMode === "vertical" && scrollContainerRef.current) {
            e.preventDefault();
            scrollContainerRef.current.scrollBy({ top: -400, behavior: "smooth" });
          } else if (viewMode === "paginated") {
            e.preventDefault();
            goToPrevPage();
          }
          break;

        case "[":
          if (prevChapter) goToChapter(prevChapter);
          break;

        case "]":
          if (nextChapter) goToChapter(nextChapter);
          break;

        case "f":
        case "F":
          toggleFullscreen();
          break;

        case "Escape":
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
            setIsFullscreen(false);
          } else {
            handleClose();
          }
          break;

        default:
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    viewMode,
    goToNextPage,
    goToPrevPage,
    prevChapter,
    nextChapter,
    handleClose,
    resetControlsTimer,
    cancelRestoration,
    goToChapter,
  ]);

  return (
    <div
      ref={containerRef}
      className={`manga-reader-overlay${controlsVisible ? " controls-visible" : ""}`}
      onClick={(e) => {
        if (
          e.target.closest(
            "button, input, select, a, .manga-reader-topbar, .manga-reader-bottombar",
          )
        )
          return;
        setControlsVisible((v) => !v);
      }}
    >
      {/* ── Top Bar Controls ──────────────────────────────────────────────── */}
      <div className={`manga-reader-topbar${controlsVisible ? " visible" : ""}`}>
        <div className="manga-reader-topbar-left">
          <button
            className="btn btn-ghost btn-icon manga-reader-close-btn"
            onClick={handleClose}
            title="Close reader (Esc)"
          >
            <BackIcon />
          </button>
          <div className="manga-reader-title-box">
            <span className="manga-reader-title">{manga.title || manga.name}</span>
            <span className="manga-reader-chapter-label">
              {currentChapter
                ? `Chapter ${currentChapter.chapter}${currentChapter.title ? ` · ${currentChapter.title}` : ""}`
                : "Loading chapter..."}
            </span>
          </div>
        </div>

        <div className="manga-reader-topbar-center">
          {/* Chapter Selector Dropdown */}
          <button
            className="btn btn-ghost manga-reader-step-btn"
            disabled={!prevChapter}
            onClick={() => goToChapter(prevChapter)}
            title="Previous Chapter ([)"
          >
            ◀ Prev
          </button>

          <select
            className="manga-chapter-select"
            value={currentChapter?.id || ""}
            onChange={(e) => {
              const selected = chapters.find((c) => c.id === e.target.value);
              if (selected) goToChapter(selected);
            }}
          >
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                Chapter {c.chapter} {c.title ? `· ${c.title}` : ""}
              </option>
            ))}
          </select>

          <button
            className="btn btn-ghost manga-reader-step-btn"
            disabled={!nextChapter}
            onClick={() => goToChapter(nextChapter)}
            title="Next Chapter (])"
          >
            Next ▶
          </button>
        </div>

        <div className="manga-reader-topbar-right">
          {/* View Mode Toggle: Vertical Webtoon vs Paginated Flip */}
          <div className="manga-pill-toggle">
            <button
              className={`manga-pill-btn${viewMode === "vertical" ? " active" : ""}`}
              onClick={() => handleSwitchViewMode("vertical")}
              title="Continuous Vertical Scroll (Webtoon)"
            >
              Scroll
            </button>
            <button
              className={`manga-pill-btn${viewMode === "paginated" ? " active" : ""}`}
              onClick={() => handleSwitchViewMode("paginated")}
              title="Single Page Flip (A/D or Arrows)"
            >
              Flip
            </button>
          </div>

          {/* Bookmark Button */}
          {onBookmark && (
            <button
              className="btn btn-ghost btn-icon"
              onClick={onBookmark}
              title={isBookmarked ? "Remove Bookmark" : "Bookmark Manga"}
            >
              {isBookmarked ? <BookmarkFillIcon /> : <BookmarkIcon />}
            </button>
          )}

          {/* Fullscreen Button */}
          <button
            className="btn btn-ghost btn-icon"
            onClick={toggleFullscreen}
            title="Toggle Fullscreen (F)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>

          <button
            className="btn btn-ghost btn-icon"
            onClick={handleClose}
            title="Close (Esc)"
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      {/* ── Main Content Viewport ─────────────────────────────────────────── */}
      <div
        ref={scrollContainerRef}
        className={`manga-reader-body ${viewMode}-mode`}
        onScroll={handleScroll}
        onWheel={() => {
          if (isRestoringRef.current) {
            cancelRestoration();
          }
        }}
        onTouchMove={() => {
          if (isRestoringRef.current) {
            cancelRestoration();
          }
        }}
      >
        {loading || loadingPages ? (
          <div className="manga-reader-loading">
            <div className="spinner" />
            <div style={{ marginTop: 16, color: "var(--text3)", fontSize: 14 }}>
              {loading ? "Fetching chapter directory..." : `Loading Chapter ${currentChapter?.chapter || ""} pages...`}
            </div>
          </div>
        ) : error ? (
          <div className="manga-reader-error">
            <p>⚠️ {error}</p>
            <button
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              onClick={() => {
                if (currentChapter) {
                  setLoadingPages(true);
                  setError(null);
                  const retryFetcher = isManhwa
                    ? getManhwaChapterPages(currentChapter.id, manga.title || manga.name, currentChapter.chapter)
                    : getChapterPages(currentChapter.id, manga.title || manga.name, currentChapter.chapter);
                  retryFetcher
                    .then((pageList) => {
                      setPages(pageList);
                      setLoadingPages(false);
                    })
                    .catch((e) => {
                      setError(e.message || "Failed to load chapter pages");
                      setLoadingPages(false);
                    });
                }
              }}
            >
              Retry Chapter
            </button>
          </div>
        ) : viewMode === "vertical" ? (
          /* ── Vertical Continuous Webtoon Scroll ─────────────────────────── */
          <>
            {isRestoringPosition && (
              <div
                className="manga-reader-loading"
                style={{
                  position: "fixed",
                  inset: 0,
                  zIndex: 515,
                  background: "#080808",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  pointerEvents: "none",
                }}
              >
                <div className="spinner" />
                <div style={{ marginTop: 16, color: "var(--text3)", fontSize: 14 }}>
                  Resuming to your saved position...
                </div>
              </div>
            )}
            <div
              ref={streamRef}
              className="manga-vertical-stream"
              style={{
                opacity: isRestoringPosition ? 0 : 1,
                transition: isRestoringPosition ? "none" : "opacity 0.22s ease",
              }}
            >
              {pages.map((p, idx) => (
                <div
                  key={p.pageNumber}
                  ref={(el) => (pageRefs.current[idx] = el)}
                  className={`manga-page-wrap fit-${fitMode}`}
                >
                  <img
                    src={p.url}
                    alt={`Page ${p.pageNumber}`}
                    loading={
                      idx < 4 || Math.abs(idx - (currentPage - 1)) <= 2 ? "eager" : "lazy"
                    }
                    onError={(e) => {
                      if (isManhwa && window.electron?.manhwaImage && !e.target.dataset.proxied) {
                        e.target.dataset.proxied = "1";
                        window.electron.manhwaImage({ url: p.url }).then((r) => {
                          if (r?.ok && r.dataUrl) e.target.src = r.dataUrl;
                        });
                      } else if (window.electron?.mangaPillImage && !e.target.dataset.proxied) {
                        e.target.dataset.proxied = "1";
                        window.electron.mangaPillImage({ url: p.url }).then((r) => {
                          if (r?.ok && r.dataUrl) e.target.src = r.dataUrl;
                        });
                      } else if (p.fallbackUrl && e.target.src !== p.fallbackUrl) {
                        e.target.src = p.fallbackUrl;
                      }
                    }}
                    className="manga-page-img"
                  />
                  <span className="manga-page-indicator">{p.pageNumber}</span>
                </div>
              ))}

              {/* Next Chapter footer action */}
              {nextChapter && (
                <div className="manga-end-chapter-box">
                  <h3>End of Chapter {currentChapter.chapter}</h3>
                  <p>Up next: Chapter {nextChapter.chapter} {nextChapter.title ? `· ${nextChapter.title}` : ""}</p>
                  <button
                    className="btn btn-primary manga-next-chapter-btn"
                    onClick={() => goToChapter(nextChapter)}
                  >
                    Read Chapter {nextChapter.chapter} ▶
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          /* ── Horizontal Single Page Flip ────────────────────────────────── */
          <div className="manga-paginated-view">
            {/* Click zones for page flipping */}
            <div
              className="manga-flip-zone left"
              onClick={goToPrevPage}
              title="Previous Page (A / ←)"
            />
            <div
              className="manga-flip-zone right"
              onClick={goToNextPage}
              title="Next Page (D / →)"
            />

            {pages[currentPage - 1] && (
              <div className="manga-single-page-wrap">
                <img
                  src={pages[currentPage - 1].url}
                  alt={`Page ${currentPage}`}
                  className="manga-single-page-img"
                  onError={(e) => {
                    const pageObj = pages[currentPage - 1];
                    if (isManhwa && window.electron?.manhwaImage && !e.target.dataset.proxied) {
                      e.target.dataset.proxied = "1";
                      window.electron.manhwaImage({ url: pageObj.url }).then((r) => {
                        if (r?.ok && r.dataUrl) e.target.src = r.dataUrl;
                      });
                    } else if (window.electron?.mangaPillImage && !e.target.dataset.proxied) {
                      e.target.dataset.proxied = "1";
                      window.electron.mangaPillImage({ url: pageObj.url }).then((r) => {
                        if (r?.ok && r.dataUrl) e.target.src = r.dataUrl;
                      });
                    } else if (pageObj?.fallbackUrl && e.target.src !== pageObj.fallbackUrl) {
                      e.target.src = pageObj.fallbackUrl;
                    }
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bottom Floating Page Counter / Scrubber ───────────────────────── */}
      {!loading && !loadingPages && pages.length > 0 && (
        <div className={`manga-reader-bottombar${controlsVisible ? " visible" : ""}`}>
          <button
            className="btn btn-ghost btn-icon manga-nav-arrow"
            onClick={goToPrevPage}
            disabled={currentPage <= 1 && !prevChapter}
            title="Previous (←)"
          >
            ◀
          </button>

          <span className="manga-page-fraction">
            Page {currentPage} of {pages.length}
          </span>

          <input
            type="range"
            min="1"
            max={pages.length}
            value={currentPage}
            onChange={(e) => {
              const target = parseInt(e.target.value);
              setCurrentPage(target);
              latestPageRef.current = target;
              latestRatioRef.current = 0;
              onHistoryRef.current?.(manga, currentChapter, target, 0);
              onProgressRef.current?.(manga, currentChapter, target, pages.length);
              if (viewMode === "vertical" && pageRefs.current[target - 1]) {
                pageRefs.current[target - 1].scrollIntoView({ behavior: "smooth" });
              }
            }}
            className="manga-page-scrubber"
          />

          <button
            className="btn btn-ghost btn-icon manga-nav-arrow"
            onClick={goToNextPage}
            disabled={currentPage >= pages.length && !nextChapter}
            title="Next (→)"
          >
            ▶
          </button>
        </div>
      )}
    </div>
  );
}
