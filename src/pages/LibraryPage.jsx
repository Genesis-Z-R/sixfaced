import { useCallback, useMemo, useState, useEffect } from "react";
import MediaCard from "../components/MediaCard";
import { imgUrl, isAnimeContent } from "../utils/api";
import {
  EyeIcon,
  WatchedIcon,
  FilmIcon,
  BookOpenIcon,
  TVIcon,
  BookmarkIcon,
  SearchIcon,
  CloseIcon,
} from "../components/Icons";
import { useRatings, getRatingForItem } from "../utils/useRatings";
import { isRestricted } from "../utils/ageRating";
import { storage, STORAGE_KEYS } from "../utils/storage";

const CATEGORIES = [
  { id: "movies_series", label: "Movies & Series", icon: FilmIcon },
  { id: "anime", label: "Anime", icon: TVIcon },
  { id: "manga", label: "Manga", icon: BookOpenIcon },
];

const SUB_TABS = [
  { id: "all", label: "All" },
  { id: "in_progress", label: "In Progress" },
  { id: "bookmarks", label: "Bookmarks" },
  { id: "history", label: "History" },
];

export default function LibraryPage({
  history = [],
  inProgress = [],
  saved = [],
  progress = {},
  onSelect,
  watched = {},
  onMarkWatched,
  onMarkUnwatched,
  onRemoveHistory,
  onRemoveSaved,
}) {
  const [activeCategory, setActiveCategory] = useState("movies_series");
  const [activeSubTab, setActiveSubTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const allItems = useMemo(
    () => [...inProgress, ...saved],
    [inProgress, saved],
  );
  const { ratingsMap, ageLimitSetting } = useRatings(allItems);

  const [sort, setSort] = useState(
    () => storage.get(STORAGE_KEYS.LIBRARY_SORT) || "manual",
  );

  useEffect(() => {
    const handler = (e) => setSort(e.detail);
    window.addEventListener("streambert:library-sort-changed", handler);
    return () =>
      window.removeEventListener("streambert:library-sort-changed", handler);
  }, []);

  const sortLabels = {
    manual: "Custom order",
    title: "A-Z",
    rating: "Top rated",
    year: "Newest first",
  };

  const getRating = useCallback(
    (item) => getRatingForItem(item, ratingsMap),
    [ratingsMap],
  );

  const itemRestricted = useCallback(
    (item) => isRestricted(getRating(item).minAge, ageLimitSetting),
    [getRating, ageLimitSetting],
  );

  // ── Categorisation Helper ──────────────────────────────────────────────────
  const isItemInCategory = useCallback((item, catId) => {
    if (!item) return false;
    const isManga = item.media_type === "manga";
    const isAnime = !isManga && (isAnimeContent(item) || item.isAnime === true);

    if (catId === "manga") return isManga;
    if (catId === "anime") return isAnime;
    if (catId === "movies_series") return !isManga && !isAnime;
    return true;
  }, []);

  // ── Filter by Category ─────────────────────────────────────────────────────
  const catInProgress = useMemo(
    () => inProgress.filter((item) => isItemInCategory(item, activeCategory)),
    [inProgress, isItemInCategory, activeCategory],
  );

  const catSaved = useMemo(
    () => saved.filter((item) => isItemInCategory(item, activeCategory)),
    [saved, isItemInCategory, activeCategory],
  );

  const catHistory = useMemo(
    () => history.filter((item) => isItemInCategory(item, activeCategory)),
    [history, isItemInCategory, activeCategory],
  );

  // ── Counts for category tabs ──────────────────────────────────────────────
  const categoryCounts = useMemo(() => {
    const counts = { movies_series: 0, anime: 0, manga: 0 };
    for (const cat of ["movies_series", "anime", "manga"]) {
      const p = inProgress.filter((i) => isItemInCategory(i, cat)).length;
      const s = saved.filter((i) => isItemInCategory(i, cat)).length;
      const h = history.filter((i) => isItemInCategory(i, cat)).length;
      counts[cat] = p + s + h;
    }
    return counts;
  }, [inProgress, saved, history, isItemInCategory]);

  // ── Optional Search Filter ────────────────────────────────────────────────
  const matchesSearch = useCallback(
    (item) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const title = (item.title || item.name || "").toLowerCase();
      return title.includes(q);
    },
    [searchQuery],
  );

  const filteredInProgress = useMemo(
    () => catInProgress.filter(matchesSearch),
    [catInProgress, matchesSearch],
  );
  const filteredSaved = useMemo(
    () => catSaved.filter(matchesSearch),
    [catSaved, matchesSearch],
  );
  const filteredHistory = useMemo(
    () => catHistory.filter(matchesSearch),
    [catHistory, matchesSearch],
  );

  const totalFilteredCount =
    filteredInProgress.length + filteredSaved.length + filteredHistory.length;

  return (
    <div className="fade-in library-page">
      <div className="library-header">
        <div className="library-title-row">
          <div>
            <div className="library-title">My Library</div>
            <div className="library-sub">
              Your categorized watchlist, bookmarks, reading list, and history.
            </div>
          </div>

          {/* Search within library */}
          <div className="library-search-box">
            <SearchIcon />
            <input
              type="text"
              placeholder="Filter library..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="library-search-input"
            />
            {searchQuery && (
              <button
                className="btn btn-ghost btn-icon library-search-clear"
                onClick={() => setSearchQuery("")}
              >
                <CloseIcon />
              </button>
            )}
          </div>
        </div>

        {/* ── Top Level Category Tabs (Movies/Series, Anime, Manga) ────────── */}
        <div className="library-category-tabs">
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            const isActive = activeCategory === cat.id;
            const count = categoryCounts[cat.id];
            return (
              <button
                key={cat.id}
                className={`library-category-tab${isActive ? " active" : ""}`}
                onClick={() => {
                  setActiveCategory(cat.id);
                  setActiveSubTab("all");
                }}
              >
                <Icon size={18} />
                <span>{cat.label}</span>
                {count > 0 && <span className="category-badge">{count}</span>}
              </button>
            );
          })}
        </div>

        {/* ── Sub-Tabs (All, In Progress, Bookmarks, History) ──────────────── */}
        <div className="library-sub-tabs">
          <div className="library-sub-tabs-left">
            {SUB_TABS.map((tab) => {
              const isActive = activeSubTab === tab.id;
              let tabCount = 0;
              if (tab.id === "in_progress") tabCount = catInProgress.length;
              else if (tab.id === "bookmarks") tabCount = catSaved.length;
              else if (tab.id === "history") tabCount = catHistory.length;

              return (
                <button
                  key={tab.id}
                  className={`library-sub-tab${isActive ? " active" : ""}`}
                  onClick={() => setActiveSubTab(tab.id)}
                >
                  <span>
                    {tab.id === "in_progress" && activeCategory === "manga"
                      ? "Currently Reading"
                      : tab.id === "in_progress"
                        ? "Currently Watching"
                        : tab.label}
                  </span>
                  {tabCount > 0 && (
                    <span className="sub-tab-count">({tabCount})</span>
                  )}
                </button>
              );
            })}
          </div>

          {activeSubTab === "bookmarks" && sort !== "manual" && (
            <div className="library-sort-indicator">
              Sort: {sortLabels[sort]}
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION: Currently Watching / Currently Reading ─────────────── */}
      {(activeSubTab === "all" || activeSubTab === "in_progress") &&
        filteredInProgress.length > 0 && (
          <div className="library-section">
            <div className="library-section-title">
              {activeCategory === "manga"
                ? `Continue Reading (${filteredInProgress.length})`
                : `Continue Watching (${filteredInProgress.length})`}
            </div>
            <div className="cards-grid">
              {filteredInProgress.map((item) => {
                const pk =
                  item.media_type === "manga"
                    ? item.chapter != null
                      ? `manga_${item.id}_c${item.chapter}`
                      : `manga_${item.id}`
                    : item.media_type === "movie"
                      ? `movie_${item.id}`
                      : `tv_${item.id}_s${item.season}e${item.episode}`;
                const r = getRating(item);
                const restr = itemRestricted(item);
                return (
                  <MediaCard
                    key={pk}
                    item={item}
                    onClick={() => onSelect(item)}
                    progress={progress[pk] || 0}
                    watched={watched}
                    onMarkWatched={onMarkWatched}
                    onMarkUnwatched={onMarkUnwatched}
                    ageRating={r.cert}
                    restricted={restr}
                  />
                );
              })}
            </div>
          </div>
        )}

      {/* ── SECTION: Bookmarks ("Watch Later" / "Plan to Read") ─────────── */}
      {(activeSubTab === "all" || activeSubTab === "bookmarks") &&
        filteredSaved.length > 0 && (
          <div className="library-section">
            <div className="library-section-title">
              {activeCategory === "manga"
                ? `Bookmarked Manga (${filteredSaved.length})`
                : `Bookmarks (${filteredSaved.length})`}
              {activeSubTab === "all" && sort !== "manual" && (
                <span className="library-sort-badge">
                  {sortLabels[sort]}
                </span>
              )}
            </div>
            <div className="cards-grid">
              {filteredSaved.map((item) => {
                const r = getRating(item);
                const restr = itemRestricted(item);
                return (
                  <div
                    key={`${item.media_type}_${item.id}`}
                    style={{ position: "relative" }}
                    className="library-card-wrap"
                  >
                    <MediaCard
                      item={item}
                      onClick={() => onSelect(item)}
                      watched={watched}
                      onMarkWatched={onMarkWatched}
                      onMarkUnwatched={onMarkUnwatched}
                      ageRating={r.cert}
                      restricted={restr}
                      onRemoveBookmark={onRemoveSaved}
                    />
                    {onRemoveSaved && (
                      <button
                        className="library-unbookmark-btn"
                        title="Remove bookmark"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveSaved(item);
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {/* ── SECTION: History ────────────────────────────────────────────── */}
      {(activeSubTab === "all" || activeSubTab === "history") &&
        filteredHistory.length > 0 && (
          <div className="library-section">
            <div className="library-section-title">
              {activeCategory === "manga"
                ? `Reading History (${filteredHistory.length})`
                : `Watch History (${filteredHistory.length})`}
            </div>
            <div className="history-rows">
              {filteredHistory.map((item) => {
                const pk =
                  item.media_type === "manga"
                    ? item.chapter != null
                      ? `manga_${item.id}_c${item.chapter}`
                      : `manga_${item.id}`
                    : item.media_type === "movie"
                      ? `movie_${item.id}`
                      : `tv_${item.id}_s${item.season}e${item.episode}`;
                const isWatched = !!watched?.[pk];
                const poster = item.poster_path
                  ? item.poster_path.startsWith("http")
                    ? item.poster_path
                    : imgUrl(item.poster_path, "w92")
                  : null;

                return (
                  <div
                    key={`${pk}_${item.watchedAt || item.addedAt || Math.random()}`}
                    className="history-row"
                    onClick={() => onSelect(item)}
                  >
                    <div className="history-thumb">
                      {poster ? (
                        <img src={poster} alt="" />
                      ) : (
                        <div
                          style={{
                            width: "100%",
                            height: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "var(--surface3)",
                          }}
                        >
                          {item.media_type === "manga" ? (
                            <BookOpenIcon size={16} />
                          ) : (
                            <FilmIcon />
                          )}
                        </div>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        {item.title || item.name}
                        {isWatched && <WatchedIcon size={16} />}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
                        {item.media_type === "manga" && item.chapter != null && (
                          <>
                            {`Chapter ${item.chapter}`}
                            {item.page ? ` · Page ${item.page}` : ""}
                            {" · "}
                          </>
                        )}
                        {item.media_type === "tv" &&
                          item.season != null &&
                          item.episode != null && (
                            <>
                              {`S${item.season}E${item.episode}`}
                              {item.episodeName ? ` · ${item.episodeName}` : ""}
                              {" · "}
                            </>
                          )}
                        {item.watchedAt
                          ? new Date(item.watchedAt).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })
                          : ""}
                      </div>
                    </div>
                    <span
                      className={`search-result-type ${
                        item.media_type === "manga"
                          ? "type-manga"
                          : item.media_type === "tv"
                            ? "type-tv"
                            : "type-movie"
                      }`}
                    >
                      {item.media_type === "manga"
                        ? "Manga"
                        : item.media_type === "tv"
                          ? "Series"
                          : "Movie"}
                    </span>
                    {onRemoveHistory && (
                      <button
                        className="history-remove-btn"
                        title="Remove from history"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveHistory(item);
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {/* ── Empty State ─────────────────────────────────────────────────── */}
      {totalFilteredCount === 0 && (
        <div className="empty-state" style={{ padding: "80px 20px" }}>
          {activeCategory === "manga" ? (
            <BookOpenIcon size={48} style={{ opacity: 0.4, marginBottom: 12 }} />
          ) : (
            <EyeIcon />
          )}
          <h3>
            {searchQuery
              ? `No matches for "${searchQuery}" in ${
                  activeCategory === "manga"
                    ? "Manga"
                    : activeCategory === "anime"
                      ? "Anime"
                      : "Movies & Series"
                }`
              : activeSubTab === "bookmarks"
                ? `No bookmarked ${
                    activeCategory === "manga"
                      ? "manga"
                      : activeCategory === "anime"
                        ? "anime"
                        : "movies or series"
                  } yet`
                : activeSubTab === "in_progress"
                  ? `Nothing currently ${
                      activeCategory === "manga" ? "being read" : "in progress"
                    }`
                  : `Nothing in ${
                      activeCategory === "manga"
                        ? "Manga"
                        : activeCategory === "anime"
                          ? "Anime"
                          : "Movies & Series"
                    } yet`}
          </h3>
          <p>
            {activeSubTab === "bookmarks"
              ? "Click the bookmark icon on any title to save it for later."
              : activeCategory === "manga"
                ? "Browse the Manga tab to discover and read titles."
                : "Start watching and your progress, bookmarks, and history will appear here."}
          </p>
        </div>
      )}
    </div>
  );
}
