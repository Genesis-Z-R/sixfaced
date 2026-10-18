import { useState, useEffect, useRef, useCallback } from "react";
import { getMangaChapters, getChapterPages } from "../utils/mangaApi";
import { getManhwaChapters, getManhwaChapterPages } from "../utils/manhwaApi";
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
  const isInitialScrollingRef = useRef(false);
  const saveHistoryTimer = useRef(null);

  const latestPageRef = useRef(initialPage || 1);
  const latestRatioRef = useRef(initialScrollRatio || 0);

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
  useEffect(() => {
    if (controlsVisible) {
      if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);
      hideControlsTimer.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3500);
    }
  }, [controlsVisible]);

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

  // ── Load pages whenever currentChapter changes ─────────────────────────────
  const currentChapterId = currentChapter?.id;
  const currentChapterNum = currentChapter?.chapter;

  useEffect(() => {
    if (!currentChapterId) return;
    let mounted = true;
    setLoadingPages(true);
    setError(null);

    const pageFetcher = isManhwa
      ? getManhwaChapterPages(currentChapterId, mangaTitle, currentChapterNum)
      : getChapterPages(currentChapterId, mangaTitle, currentChapterNum);

    pageFetcher
      .then((pageList) => {
        if (!mounted) return;
        setPages(pageList);
        setLoadingPages(false);
        const startPage =
          initialPage &&
          Number(initialPage) > 1 &&
          (!initialChapterNum ||
            String(initialChapterNum) === String(currentChapterNum))
            ? Math.min(Number(initialPage), pageList.length)
            : 1;

        const startRatio =
          initialScrollRatio &&
          Number(initialScrollRatio) > 0 &&
          (!initialChapterNum ||
            String(initialChapterNum) === String(currentChapterNum))
            ? Math.min(1, Math.max(0, Number(initialScrollRatio)))
            : 0;

        setCurrentPage(startPage);
        latestPageRef.current = startPage;
        latestRatioRef.current = startRatio;

        const needsScrollRestoration =
          (startPage > 1 || startRatio > 0) && viewMode === "vertical";

        if (scrollContainerRef.current) {
          if (needsScrollRestoration) {
            setIsRestoringPosition(true);
            isInitialScrollingRef.current = true;
            let attempts = 0;
            const tryScroll = () => {
              if (!mounted) return;
              const el = pageRefs.current[startPage - 1];
              const container = scrollContainerRef.current;
              if (el && container) {
                const elTop = el.offsetTop;
                const elHeight = el.clientHeight;
                const isLayoutReady = startPage === 1 ? elHeight > 0 : elTop > 0;
                if (isLayoutReady || attempts >= 10) {
                  const targetScroll = Math.max(0, elTop + startRatio * elHeight);
                  container.scrollTo({ top: targetScroll, behavior: "auto" });
                  requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                      if (mounted) {
                        setIsRestoringPosition(false);
                        setTimeout(() => {
                          isInitialScrollingRef.current = false;
                        }, 250);
                      }
                    });
                  });
                  return;
                }
              }
              attempts++;
              if (attempts < 20) {
                setTimeout(tryScroll, 60);
              } else {
                if (mounted) {
                  setIsRestoringPosition(false);
                  isInitialScrollingRef.current = false;
                }
              }
            };
            setTimeout(tryScroll, 40);
          } else {
            setIsRestoringPosition(false);
            isInitialScrollingRef.current = false;
            scrollContainerRef.current.scrollTop = 0;
          }
        }

        // Notify history & progress safely using refs (won't re-trigger this effect)
        onHistoryRef.current?.(manga, currentChapter, startPage, startRatio);
        onProgressRef.current?.(
          manga,
          currentChapter,
          startPage,
          pageList.length,
        );
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.message || "Failed to load chapter pages");
        setLoadingPages(false);
      });

    return () => {
      mounted = false;
    };
  }, [
    currentChapterId,
    currentChapterNum,
    mangaId,
    mangaTitle,
    initialPage,
    initialScrollRatio,
    initialChapterNum,
    isManhwa,
    viewMode,
  ]);

  // ── Detect page and exact scroll position in vertical mode ────────────────
  const handleScroll = useCallback(() => {
    // Hide controls immediately on scroll so page info is not distracting
    if (controlsVisible) {
      setControlsVisible(false);
    }
    if (hideControlsTimer.current) clearTimeout(hideControlsTimer.current);

    if (isInitialScrollingRef.current) return;
    if (viewMode !== "vertical" || !pages.length) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollTop = container.scrollTop;
    const viewHeight = container.clientHeight;
    const scrollHeight = container.scrollHeight;
    const midPoint = scrollTop + viewHeight / 2;

    let detectedPage = currentPage;
    let detectedRatio = 0;

    for (let i = 0; i < pageRefs.current.length; i++) {
      const el = pageRefs.current[i];
      if (!el) continue;
      const top = el.offsetTop;
      const bottom = top + el.clientHeight;
      if (midPoint >= top && midPoint <= bottom) {
        detectedPage = i + 1;
        const offsetInEl = Math.max(0, scrollTop - top);
        detectedRatio = el.clientHeight > 0 ? Math.min(1, offsetInEl / el.clientHeight) : 0;
        break;
      }
    }

    // Auto-mark completed when reached the bottom / last page
    if (scrollTop + viewHeight >= scrollHeight - 60) {
      detectedPage = pages.length;
      detectedRatio = 1;
    }

    latestPageRef.current = detectedPage;
    latestRatioRef.current = detectedRatio;

    if (detectedPage !== currentPage) {
      setCurrentPage(detectedPage);
    }

    // Report progress percentage
    onProgressRef.current?.(manga, currentChapter, detectedPage, pages.length);

    // Save exact position to history debounced
    if (saveHistoryTimer.current) clearTimeout(saveHistoryTimer.current);
    saveHistoryTimer.current = setTimeout(() => {
      onHistoryRef.current?.(manga, currentChapter, detectedPage, detectedRatio);
    }, 350);
  }, [
    viewMode,
    pages.length,
    currentPage,
    manga,
    currentChapter,
    controlsVisible,
  ]);

  // ── Save history on reader unmount ─────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (saveHistoryTimer.current) clearTimeout(saveHistoryTimer.current);
      if (currentChapter && manga) {
        onHistoryRef.current?.(
          manga,
          currentChapter,
          latestPageRef.current,
          latestRatioRef.current,
        );
      }
    };
  }, [manga, currentChapter]);

  // ── Chapter Navigation ────────────────────────────────────────────────────
  const currentIndex = chapters.findIndex((c) => c.id === currentChapter?.id);
  const prevChapter = currentIndex > 0 ? chapters[currentIndex - 1] : null;
  const nextChapter =
    currentIndex !== -1 && currentIndex < chapters.length - 1
      ? chapters[currentIndex + 1]
      : null;

  const goToChapter = (chap) => {
    if (!chap) return;
    setCurrentChapter(chap);
  };

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
  }, [currentPage, pages.length, nextChapter, manga, currentChapter]);

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
  }, [currentPage, prevChapter, manga, currentChapter]);

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
          if (viewMode === "paginated") {
            goToNextPage();
          } else if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollBy({ top: 300, behavior: "smooth" });
          }
          break;

        case "ArrowLeft":
        case "a":
        case "A":
          if (viewMode === "paginated") {
            goToPrevPage();
          } else if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollBy({ top: -300, behavior: "smooth" });
          }
          break;

        case " ":
        case "ArrowDown":
          if (viewMode === "vertical" && scrollContainerRef.current) {
            e.preventDefault();
            scrollContainerRef.current.scrollBy({ top: 400, behavior: "smooth" });
          } else if (viewMode === "paginated") {
            e.preventDefault();
            goToNextPage();
          }
          break;

        case "ArrowUp":
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
            onClose();
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
    onClose,
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
            onClick={onClose}
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
              onClick={() => setViewMode("vertical")}
              title="Continuous Vertical Scroll (Webtoon)"
            >
              Scroll
            </button>
            <button
              className={`manga-pill-btn${viewMode === "paginated" ? " active" : ""}`}
              onClick={() => setViewMode("paginated")}
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
            onClick={onClose}
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
          if (isInitialScrollingRef.current) {
            isInitialScrollingRef.current = false;
            setIsRestoringPosition(false);
          }
        }}
        onTouchMove={() => {
          if (isInitialScrollingRef.current) {
            isInitialScrollingRef.current = false;
            setIsRestoringPosition(false);
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
                    loading={idx < 4 || Math.abs(idx - (currentPage - 1)) <= 2 ? "eager" : "lazy"}
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
