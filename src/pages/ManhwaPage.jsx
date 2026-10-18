import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import MediaCard from "../components/MediaCard";
import MangaReader from "../components/MangaReader";
import {
  searchManhwa,
  getPopularManhwa,
  getManhwaDetails,
  getManhwaChapters,
} from "../utils/manhwaApi";
import {
  SearchIcon,
  CloseIcon,
  ManhwaScrollIcon,
  BookmarkIcon,
  BookmarkFillIcon,
  PlayIcon,
  BackIcon,
} from "../components/Icons";

export default function ManhwaPage({
  onBookmark,
  isBookmarked,
  onProgress,
  onHistory,
  progress = {},
  saved = {},
  inProgress = [],
  history = [],
  initialManhwa = null,
  onBack,
  watched = {},
}) {
  const [activeTab, setActiveTab] = useState("spotlight");
  const [popular, setPopular] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [loadingPopular, setLoadingPopular] = useState(true);

  // Selected manhwa for modal view
  const [selectedManhwa, setSelectedManhwa] = useState(initialManhwa || null);
  const [details, setDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [chapters, setChapters] = useState([]);
  const [chapterSort, setChapterSort] = useState("asc"); // "asc" | "desc"
  const [chapterFilter, setChapterFilter] = useState("");

  // Reader state
  const [readingChapter, setReadingChapter] = useState(null);

  // Resume progress tracking for selected title
  const lastRead = useMemo(() => {
    if (!selectedManhwa) return null;
    return (
      history.find(
        (h) =>
          h &&
          String(h.id) === String(selectedManhwa.id) &&
          (h.media_type === "manhwa" || !h.media_type),
      ) || null
    );
  }, [selectedManhwa, history]);

  const resumeInfo = useMemo(() => {
    if (!chapters.length) return null;
    if (!lastRead) {
      return { chapter: chapters[0], page: 1, isNext: false, pct: 0 };
    }

    // Sort ascending to determine sequential order
    const sorted = [...chapters].sort(
      (a, b) => (parseFloat(a.chapter) || 0) - (parseFloat(b.chapter) || 0),
    );
    const idx = sorted.findIndex(
      (c) =>
        String(c.chapter) === String(lastRead.chapter) ||
        (lastRead.chapterId && c.id === lastRead.chapterId),
    );

    if (idx === -1) {
      return { chapter: chapters[0], page: 1, isNext: false, pct: 0 };
    }

    const currentChap = sorted[idx];
    const pk = `manhwa_${selectedManhwa?.id}_c${currentChap.chapter}`;
    const manhwaPk = `manhwa_${selectedManhwa?.id}`;
    const pct = progress[pk] || progress[manhwaPk] || 0;
    const isCompleted = pct >= 100 || !!watched?.[pk];

    // If current chapter was completed, advance to next chapter
    if (isCompleted && idx < sorted.length - 1) {
      const nextChap = sorted[idx + 1];
      const nextPk = `manhwa_${selectedManhwa?.id}_c${nextChap.chapter}`;
      return {
        chapter: nextChap,
        page: 1,
        isNext: true,
        pct: progress[nextPk] || 0,
      };
    }

    return {
      chapter: currentChap,
      page: Number(lastRead.page) || 1,
      scrollRatio: Number(lastRead.scrollRatio) || 0,
      isNext: false,
      pct,
    };
  }, [chapters, lastRead, selectedManhwa, progress, watched]);

  const searchTimer = useRef(null);
  const searchInputRef = useRef(null);

  // ── Load Popular on mount ──────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    setLoadingPopular(true);
    getPopularManhwa(30)
      .then((list) => {
        if (!mounted) return;
        setPopular(list);
        setLoadingPopular(false);
      })
      .catch(() => {
        if (!mounted) return;
        setLoadingPopular(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // ── Debounced Search ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);

    searchTimer.current = setTimeout(() => {
      searchManhwa(query, 28)
        .then((res) => {
          setSearchResults(res);
          setSearching(false);
        })
        .catch(() => {
          setSearchResults([]);
          setSearching(false);
        });
    }, 380);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  // ── Fetch Details & Chapters when a manhwa is selected ──────────────────────
  const handleSelectManhwa = useCallback(
    (manhwa) => {
      setSelectedManhwa(manhwa);
      setDetails(null);
      setChapters([]);
      setLoadingDetails(true);

      Promise.all([
        getManhwaDetails(manhwa.id, manhwa.title || manhwa.name).catch(() => manhwa),
        getManhwaChapters(manhwa.id, "asc", manhwa.title || manhwa.name).catch(() => []),
      ]).then(([det, chaps]) => {
        setDetails(det);
        setChapters(chaps);
        setLoadingDetails(false);
      });
    },
    [],
  );

  useEffect(() => {
    if (initialManhwa) {
      handleSelectManhwa(initialManhwa);
    }
  }, [initialManhwa, handleSelectManhwa]);

  // Filter & sort chapters in details modal
  const filteredChapters = chapters
    .filter((c) => {
      if (!chapterFilter.trim()) return true;
      const q = chapterFilter.toLowerCase();
      return (
        String(c.chapter).toLowerCase().includes(q) ||
        (c.title || "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      const na = parseFloat(a.chapter) || 0;
      const nb = parseFloat(b.chapter) || 0;
      return chapterSort === "desc" ? nb - na : na - nb;
    });

  // Filter collections
  const manhwaInProgress = inProgress.filter((i) => i && i.media_type === "manhwa");
  const manhwaSaved = (Array.isArray(saved) ? saved : Object.values(saved)).filter(
    (i) => i && i.media_type === "manhwa",
  );
  const manhwaHistory = history.filter((i) => i && i.media_type === "manhwa");

  const SUB_TABS = [
    { id: "spotlight", label: "Top Manhwa" },
    { id: "in_progress", label: "In Progress" },
    { id: "bookmarks", label: "Bookmarks" },
    { id: "history", label: "History" },
  ];

  return (
    <div className="fade-in hub-page manga-page">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="hub-header">
        <div className="hub-title-wrap">
          <h1 className="hub-title">Manhwa</h1>
          <p className="hub-tagline">
            Discover, bookmark, and read full-color Korean webtoons and manhwa in high definition.
          </p>
        </div>

        {/* Search bar */}
        <div className="hub-search-bar">
          <SearchIcon />
          <input
            ref={searchInputRef}
            type="text"
            className="hub-search-input"
            placeholder="Search manhwa by title, author, or genre..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="btn btn-ghost btn-icon hub-search-clear"
              onClick={() => {
                setQuery("");
                setSearchResults([]);
              }}
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>

      {/* ── Sub-Tabs Navigation (Hidden while searching) ──────────────────── */}
      {!query.trim() && (
        <div className="hub-tabs-bar">
          <div className="hub-tabs-list">
            {SUB_TABS.map((tab) => {
              let count = null;
              if (tab.id === "in_progress") count = manhwaInProgress.length;
              if (tab.id === "bookmarks") count = manhwaSaved.length;
              if (tab.id === "history") count = manhwaHistory.length;
              if (tab.id === "spotlight") count = popular.length || 20;

              return (
                <button
                  key={tab.id}
                  className={`hub-tab-btn ${activeTab === tab.id ? "active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span>{tab.label}</span>
                  {count !== null && count > 0 && (
                    <span className="hub-tab-count">{count}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Search Results or Popular Grid ───────────────────────────────── */}
      <div className="hub-content manga-content-area">
        {searching && (
          <div className="loader" style={{ padding: "60px 0" }}>
            <div className="spinner" />
          </div>
        )}

        {/* When search has query */}
        {!searching && query.trim() && (
          <div className="hub-section">
            <div className="hub-section-header">
              <span className="hub-section-title">
                Search Results for "{query}" ({searchResults.length})
              </span>
            </div>
            {searchResults.length === 0 ? (
              <div className="empty-state" style={{ padding: "60px 0" }}>
                <ManhwaScrollIcon size={44} style={{ opacity: 0.3 }} />
                <h3>No manhwa found</h3>
                <p>Try searching for a different title or keyword.</p>
              </div>
            ) : (
              <div className="cards-grid">
                {searchResults.map((item) => (
                  <MediaCard
                    key={`manhwa_${item.id}`}
                    item={item}
                    onClick={() => handleSelectManhwa(item)}
                    progress={progress[`manhwa_${item.id}`] || 0}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab Views (When NOT searching) */}
        {!query.trim() && (
          <>
            {/* 1. Top Manhwa Tab */}
            {activeTab === "spotlight" && (
              <div className="hub-section">
                <div className="hub-section-header">
                  <span className="hub-section-title">Top Manhwa</span>
                  <span className="hub-section-badge">Trending Webtoons</span>
                </div>
                {loadingPopular ? (
                  <div className="loader" style={{ padding: "60px 0" }}>
                    <div className="spinner" />
                  </div>
                ) : (
                  <div className="cards-grid">
                    {popular.map((item, index) => (
                      <MediaCard
                        key={`manhwa_top_${item.id}`}
                        item={item}
                        rank={index + 1}
                        onClick={() => handleSelectManhwa(item)}
                        progress={progress[`manhwa_${item.id}`] || 0}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 2. In Progress Tab */}
            {activeTab === "in_progress" && (
              <div className="hub-section">
                <div className="hub-section-header">
                  <span className="hub-section-title">In Progress</span>
                  <span className="hub-section-badge">
                    {manhwaInProgress.length} Titles
                  </span>
                </div>
                {manhwaInProgress.length === 0 ? (
                  <div className="empty-state" style={{ padding: "80px 0" }}>
                    <ManhwaScrollIcon size={44} style={{ opacity: 0.3 }} />
                    <h3>No manhwa currently in progress</h3>
                    <p>
                      Start reading any title from Top Manhwa or search to pick
                      up right where you left off.
                    </p>
                  </div>
                ) : (
                  <div className="cards-grid">
                    {manhwaInProgress.map((item) => (
                      <MediaCard
                        key={`manhwa_inprog_${item.id}`}
                        item={item}
                        onClick={() => handleSelectManhwa(item)}
                        progress={progress[`manhwa_${item.id}`] || 0}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 3. Bookmarks Tab */}
            {activeTab === "bookmarks" && (
              <div className="hub-section">
                <div className="hub-section-header">
                  <span className="hub-section-title">Bookmarks</span>
                  <span className="hub-section-badge">
                    {manhwaSaved.length} Saved
                  </span>
                </div>
                {manhwaSaved.length === 0 ? (
                  <div className="empty-state" style={{ padding: "80px 0" }}>
                    <BookmarkIcon size={44} style={{ opacity: 0.3 }} />
                    <h3>No bookmarked manhwa</h3>
                    <p>
                      Bookmark any manhwa to save it to your personal library for
                      quick access.
                    </p>
                  </div>
                ) : (
                  <div className="cards-grid">
                    {manhwaSaved.map((item) => (
                      <MediaCard
                        key={`manhwa_saved_${item.id}`}
                        item={item}
                        onClick={() => handleSelectManhwa(item)}
                        progress={progress[`manhwa_${item.id}`] || 0}
                        onRemoveBookmark={onBookmark}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 4. History Tab */}
            {activeTab === "history" && (
              <div className="hub-section">
                <div className="hub-section-header">
                  <span className="hub-section-title">History</span>
                  <span className="hub-section-badge">
                    {manhwaHistory.length} Titles
                  </span>
                </div>
                {manhwaHistory.length === 0 ? (
                  <div className="empty-state" style={{ padding: "80px 0" }}>
                    <ManhwaScrollIcon size={44} style={{ opacity: 0.3 }} />
                    <h3>No reading history yet</h3>
                    <p>
                      Chapters you read will automatically be recorded here so you
                      never lose track.
                    </p>
                  </div>
                ) : (
                  <div className="cards-grid">
                    {manhwaHistory.map((item) => (
                      <MediaCard
                        key={`manhwa_hist_${item.id}_${item.watchedAt || item.chapter || ""}`}
                        item={item}
                        onClick={() => handleSelectManhwa(item)}
                        progress={progress[`manhwa_${item.id}`] || 0}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Manhwa Details Modal ─────────────────────────────────────────── */}
      {selectedManhwa && (
        <div
          className="modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedManhwa(null);
          }}
        >
          <div className="manga-details-modal">
            <button
              className="btn btn-ghost btn-icon manga-modal-close"
              onClick={() => setSelectedManhwa(null)}
            >
              <CloseIcon />
            </button>

            {loadingDetails && !details ? (
              <div className="loader" style={{ padding: "80px 0" }}>
                <div className="spinner" />
              </div>
            ) : (
              <>
                <div className="manga-details-hero">
                  <div className="manga-details-poster-wrap">
                    {selectedManhwa.poster_path || selectedManhwa.image ? (
                      <img
                        src={selectedManhwa.poster_path || selectedManhwa.image}
                        alt={selectedManhwa.title}
                        className="manga-details-poster"
                        onError={(e) => {
                          const posterUrl = selectedManhwa.poster_path || selectedManhwa.image;
                          if (window.electron?.manhwaImage && !e.target.dataset.proxied) {
                            e.target.dataset.proxied = "1";
                            window.electron
                              .manhwaImage({
                                url: posterUrl,
                                title: selectedManhwa.title || selectedManhwa.name,
                              })
                              .then((r) => {
                                if (r?.ok && r.dataUrl) e.target.src = r.dataUrl;
                              });
                          }
                        }}
                      />
                    ) : (
                      <div className="no-poster">
                        <ManhwaScrollIcon size={44} />
                      </div>
                    )}
                  </div>

                  <div className="manga-details-info">
                    <div className="manga-details-badge" style={{ background: "#0284c7", color: "#e0f2fe", borderColor: "rgba(56, 189, 248, 0.4)" }}>
                      MANHWA
                    </div>
                    <h2 className="manga-details-title">
                      {selectedManhwa.title || selectedManhwa.name}
                    </h2>

                    <div className="manga-details-meta">
                      {details?.author && (
                        <span>
                          <strong>Author:</strong> {details.author}
                        </span>
                      )}
                      {details?.status && (
                        <span className="manga-status-pill">
                          {details.status.toUpperCase()}
                        </span>
                      )}
                      {selectedManhwa.year && (
                        <span>Year: {selectedManhwa.year}</span>
                      )}
                      <span>{chapters.length} Chapters</span>
                    </div>

                    {/* Genres */}
                    {selectedManhwa.genres?.length > 0 && (
                      <div className="manga-genres-row">
                        {selectedManhwa.genres.slice(0, 6).map((g) => (
                          <span key={g} className="manga-genre-tag">
                            {g}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Synopsis */}
                    <p className="manga-details-synopsis">
                      {details?.overview || selectedManhwa.overview || "No synopsis available."}
                    </p>

                    {/* Actions: Start Reading & Bookmark */}
                    <div className="manga-details-actions">
                      {chapters.length > 0 && (
                        <button
                          className="btn btn-primary manga-start-read-btn"
                          onClick={() => {
                            setReadingChapter(resumeInfo?.chapter || chapters[0]);
                          }}
                        >
                          <PlayIcon />{" "}
                          {!lastRead
                            ? `Start Reading Ch. ${chapters[0].chapter}`
                            : resumeInfo?.isNext
                              ? `Read Next: Ch. ${resumeInfo.chapter.chapter}`
                              : `Continue Ch. ${resumeInfo?.chapter.chapter}${resumeInfo?.pct > 0 ? ` (${resumeInfo.pct}%)` : ""}`}
                        </button>
                      )}

                      {onBookmark && (
                        <button
                          className="btn btn-secondary manga-bookmark-btn"
                          onClick={() => onBookmark(selectedManhwa)}
                        >
                          {isBookmarked(selectedManhwa) ? (
                            <>
                              <BookmarkFillIcon /> Bookmarked
                            </>
                          ) : (
                            <>
                              <BookmarkIcon /> Bookmark for Later
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Chapters Section */}
                <div className="manga-chapters-section">
                  <div className="manga-chapters-header">
                    <div className="manga-chapters-title">
                      Chapters ({chapters.length})
                    </div>
                    <div className="manga-chapters-controls">
                      <input
                        type="text"
                        placeholder="Search chapter..."
                        value={chapterFilter}
                        onChange={(e) => setChapterFilter(e.target.value)}
                        className="manga-chapter-filter"
                      />
                      <button
                        className="btn btn-ghost manga-sort-toggle"
                        onClick={() =>
                          setChapterSort((s) => (s === "asc" ? "desc" : "asc"))
                        }
                        title={`Sort order: ${chapterSort === "asc" ? "Ascending (1 to N)" : "Descending (N to 1)"}`}
                      >
                        {chapterSort === "asc" ? "Oldest First ⬆" : "Newest First ⬇"}
                      </button>
                    </div>
                  </div>

                  <div className="manga-chapters-list">
                    {filteredChapters.map((c) => {
                      const isCurrent =
                        lastRead &&
                        (String(c.chapter) === String(lastRead.chapter) ||
                          (lastRead.chapterId && c.id === lastRead.chapterId));
                      return (
                        <div
                          key={c.id}
                          className={`manga-chapter-row${isCurrent ? " manga-chapter-row--current" : ""}`}
                          style={
                            isCurrent
                              ? {
                                  borderColor: "rgba(229, 9, 20, 0.6)",
                                  background: "rgba(229, 9, 20, 0.12)",
                                }
                              : undefined
                          }
                          onClick={() => setReadingChapter(c)}
                        >
                          <div className="manga-chapter-number">
                            Chapter {c.chapter}
                          </div>
                          <div className="manga-chapter-title">
                            {c.title ? c.title : `Chapter ${c.chapter}`}
                            {isCurrent && (
                              <span
                                style={{
                                  marginLeft: 8,
                                  fontSize: 10,
                                  padding: "2px 6px",
                                  background: "var(--red)",
                                  color: "#fff",
                                  borderRadius: 4,
                                  fontWeight: 700,
                                  letterSpacing: "0.5px",
                                }}
                              >
                                CURRENT{resumeInfo?.chapter?.id === c.id && resumeInfo.pct > 0 ? ` · ${resumeInfo.pct}%` : ""}
                              </span>
                            )}
                          </div>
                          {c.pages > 0 && (
                            <div className="manga-chapter-pages-count">
                              {c.pages} pages
                            </div>
                          )}
                          <button className="btn btn-primary btn-sm manga-read-row-btn">
                            {isCurrent ? "Continue" : "Read"}
                          </button>
                        </div>
                      );
                    })}
                    {filteredChapters.length === 0 && (
                      <div className="manga-no-chapters">
                        No chapters match "{chapterFilter}"
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Manhwa Reader Fullscreen Overlay ─────────────────────────────── */}
      {readingChapter && selectedManhwa && (
        <MangaReader
          manga={selectedManhwa}
          initialChapter={readingChapter}
          initialPage={
            lastRead &&
            (String(lastRead.chapter) === String(readingChapter.chapter) ||
              (lastRead.chapterId && lastRead.chapterId === readingChapter.id)) &&
            !resumeInfo?.isNext
              ? Math.max(1, Number(lastRead.page) || 1)
              : 1
          }
          initialScrollRatio={
            lastRead &&
            (String(lastRead.chapter) === String(readingChapter.chapter) ||
              (lastRead.chapterId && lastRead.chapterId === readingChapter.id)) &&
            !resumeInfo?.isNext
              ? Number(lastRead.scrollRatio) || 0
              : 0
          }
          onClose={() => setReadingChapter(null)}
          onProgress={onProgress}
          onHistory={onHistory}
          onBookmark={() => onBookmark?.(selectedManhwa)}
          isBookmarked={isBookmarked ? isBookmarked(selectedManhwa) : false}
        />
      )}
    </div>
  );
}
