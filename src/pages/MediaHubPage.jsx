import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import MediaCard from "../components/MediaCard";
import {
  fetchTop30Movies,
  fetchTop30Series,
  fetchTop30Anime,
  searchHubMedia,
  isAnimeContent,
} from "../utils/api";
import {
  SearchIcon,
  CloseIcon,
  FilmIcon,
  TVIcon,
  AnimeToriiIcon,
  BookmarkIcon,
  WatchedIcon,
  PlayIcon,
} from "../components/Icons";
import { useRatings, getRatingForItem } from "../utils/useRatings";
import { isRestricted } from "../utils/ageRating";

const HUB_CONFIG = {
  movies: {
    id: "movies",
    title: "Movies",
    tagline: "Blockbuster cinema, timeless classics, and your movie watchlist.",
    searchPlaceholder: "Search movies by title, actor, or genre...",
    icon: FilmIcon,
    top30Badge: "TMDB Top 30 Movies",
    fetchTop30: fetchTop30Movies,
    matcher: (item) =>
      item &&
      item.media_type !== "manga" &&
      item.isAnime !== true &&
      !isAnimeContent(item) &&
      (item.media_type === "movie" || (!item.media_type && !item.first_air_date)),
  },
  series: {
    id: "series",
    title: "Series",
    tagline: "Binge-worthy television, seasonal releases, and episodic storytelling.",
    searchPlaceholder: "Search TV shows and series by title or genre...",
    icon: TVIcon,
    top30Badge: "TMDB Top 30 TV Series",
    fetchTop30: fetchTop30Series,
    matcher: (item) =>
      item &&
      item.media_type !== "manga" &&
      item.isAnime !== true &&
      !isAnimeContent(item) &&
      (item.media_type === "tv" || (!item.media_type && !!item.first_air_date)),
  },
  anime: {
    id: "anime",
    title: "Anime",
    tagline: "Top rated Japanese animation, shonen masterpieces, and seasonal anime.",
    searchPlaceholder: "Search anime by Romaji, English, or Japanese title...",
    icon: AnimeToriiIcon,
    top30Badge: "Top 30 Japanese Anime",
    fetchTop30: fetchTop30Anime,
    matcher: (item) =>
      item &&
      item.media_type !== "manga" &&
      (isAnimeContent(item) || item.isAnime === true),
  },
};

const SUB_TABS = [
  { id: "spotlight", label: "Top 30" },
  { id: "in_progress", label: "In Progress" },
  { id: "bookmarks", label: "Bookmarks" },
  { id: "history", label: "History" },
];

export default function MediaHubPage({
  medium = "movies",
  apiKey,
  inProgress = [],
  saved = [],
  history = [],
  progress = {},
  watched = {},
  onSelect,
  onBookmark,
  isBookmarked,
  onMarkWatched,
  onMarkUnwatched,
  onRemoveHistory,
  offline = false,
  onRetry,
}) {
  const config = HUB_CONFIG[medium] || HUB_CONFIG.movies;

  const [activeTab, setActiveTab] = useState("spotlight");
  const [top30, setTop30] = useState([]);
  const [loadingTop30, setLoadingTop30] = useState(true);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef(null);
  const searchTimerRef = useRef(null);

  // Filter medium-specific collections
  const mediumInProgress = useMemo(
    () => inProgress.filter(config.matcher),
    [inProgress, config],
  );

  const mediumSaved = useMemo(
    () => saved.filter(config.matcher),
    [saved, config],
  );

  const mediumHistory = useMemo(
    () => history.filter(config.matcher),
    [history, config],
  );

  // Ratings for age filtering / indicators
  const allCards = useMemo(
    () => [...top30, ...mediumInProgress, ...mediumSaved, ...searchResults],
    [top30, mediumInProgress, mediumSaved, searchResults],
  );
  const { ratingsMap, ageLimitSetting } = useRatings(allCards);

  const getRating = useCallback(
    (item) => getRatingForItem(item, ratingsMap),
    [ratingsMap],
  );

  const isItemRestricted = useCallback(
    (item) => isRestricted(getRating(item).minAge, ageLimitSetting),
    [getRating, ageLimitSetting],
  );

  // ── Load Top 30 Spotlight on mount or medium change ────────────────────────
  useEffect(() => {
    let mounted = true;
    setLoadingTop30(true);
    setSearchQuery("");
    setSearchResults([]);

    config
      .fetchTop30(apiKey)
      .then((items) => {
        if (!mounted) return;
        setTop30(items);
        setLoadingTop30(false);
      })
      .catch(() => {
        if (!mounted) return;
        setTop30([]);
        setLoadingTop30(false);
      });

    return () => {
      mounted = false;
    };
  }, [medium, apiKey, config]);

  // ── Debounced Search ───────────────────────────────────────────────────────
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    searchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchHubMedia(q, medium, apiKey);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, medium, apiKey]);

  // Quick helper to build progress key for cards
  const getProgressVal = (item) => {
    if (!item) return 0;
    if (item.media_type === "movie") return progress[`movie_${item.id}`] || 0;
    if (item.season != null && item.episode != null) {
      return progress[`tv_${item.id}_s${item.season}e${item.episode}`] || 0;
    }
    return progress[`tv_${item.id}`] || 0;
  };

  return (
    <div className="fade-in hub-page">
      {/* ── Hub Header ────────────────────────────────────────────────────── */}
      <div className="hub-header">
        <div className="hub-title-wrap">
          <h1 className="hub-title">{config.title}</h1>
          <p className="hub-tagline">{config.tagline}</p>
        </div>

        {/* Medium-specific fast search bar */}
        <div className="hub-search-bar">
          <SearchIcon />
          <input
            ref={searchInputRef}
            type="text"
            className="hub-search-input"
            placeholder={config.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="btn btn-ghost btn-icon hub-search-clear"
              onClick={() => {
                setSearchQuery("");
                setSearchResults([]);
              }}
              title="Clear search"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>

      {/* ── Sub-Tabs Navigation (Hidden while searching) ──────────────────── */}
      {!searchQuery.trim() && (
        <div className="hub-tabs-bar">
          <div className="hub-tabs-list">
            {SUB_TABS.map((tab) => {
              let count = null;
              if (tab.id === "in_progress") count = mediumInProgress.length;
              if (tab.id === "bookmarks") count = mediumSaved.length;
              if (tab.id === "history") count = mediumHistory.length;
              if (tab.id === "spotlight") count = top30.length || 30;

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

      {/* ── Content View ──────────────────────────────────────────────────── */}
      <div className="hub-content">
        {/* Offline indicator */}
        {offline && (
          <div className="offline-banner">
            <span>📡 Offline mode — live discovery may be unavailable.</span>
            {onRetry && (
              <button className="btn btn-secondary btn-sm" onClick={onRetry}>
                Retry
              </button>
            )}
          </div>
        )}

        {/* Searching Loader */}
        {searching && (
          <div className="loader" style={{ padding: "60px 0" }}>
            <div className="spinner" />
          </div>
        )}

        {/* ── Search Results Active ───────────────────────────────────────── */}
        {!searching && searchQuery.trim() && (
          <div className="hub-section">
            <div className="hub-section-header">
              <span className="hub-section-title">
                Search Results for "{searchQuery}" ({searchResults.length})
              </span>
            </div>
            {searchResults.length === 0 ? (
              <div className="empty-state" style={{ padding: "60px 0" }}>
                <SearchIcon size={44} style={{ opacity: 0.3 }} />
                <h3>No {config.title.toLowerCase()} found</h3>
                <p>Try searching with another keyword, title, or spelling.</p>
              </div>
            ) : (
              <div className="cards-grid">
                {searchResults.map((item) => (
                  <MediaCard
                    key={`${item.media_type || "media"}_${item.id}`}
                    item={item}
                    onClick={() => onSelect(item)}
                    progress={getProgressVal(item)}
                    watched={watched}
                    onMarkWatched={onMarkWatched}
                    onMarkUnwatched={onMarkUnwatched}
                    ageRating={getRating(item).badge}
                    restricted={isItemRestricted(item)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Tab Views (When NOT searching) ───────────────────────────── */}
        {!searchQuery.trim() && (
          <>
            {/* 1. Top 30 Tab */}
            {activeTab === "spotlight" && (
              <div className="hub-section">
                <div className="hub-section-header">
                  <span className="hub-section-title">Top 30</span>
                  <span className="hub-section-badge">{config.top30Badge}</span>
                </div>

                {loadingTop30 ? (
                  <div className="loader" style={{ padding: "60px 0" }}>
                    <div className="spinner" />
                  </div>
                ) : (
                  <div className="cards-grid">
                    {top30.map((item, index) => (
                      <MediaCard
                        key={`top30_${item.media_type || "media"}_${item.id}`}
                        item={item}
                        rank={index + 1}
                        onClick={() => onSelect(item)}
                        progress={getProgressVal(item)}
                        watched={watched}
                        onMarkWatched={onMarkWatched}
                        onMarkUnwatched={onMarkUnwatched}
                        ageRating={getRating(item).badge}
                        restricted={isItemRestricted(item)}
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
                    {mediumInProgress.length} Titles
                  </span>
                </div>
                {mediumInProgress.length === 0 ? (
                  <div className="empty-state" style={{ padding: "80px 0" }}>
                    <PlayIcon size={44} style={{ opacity: 0.3 }} />
                    <h3>No {config.title.toLowerCase()} currently in progress</h3>
                    <p>
                      Start watching any title from Top 30 or search to pick up
                      right where you left off.
                    </p>
                  </div>
                ) : (
                  <div className="cards-grid">
                    {mediumInProgress.map((item) => (
                      <MediaCard
                        key={`inprogress_${item.media_type || "media"}_${item.id}`}
                        item={item}
                        onClick={() => onSelect(item)}
                        progress={getProgressVal(item)}
                        watched={watched}
                        onMarkWatched={onMarkWatched}
                        onMarkUnwatched={onMarkUnwatched}
                        ageRating={getRating(item).badge}
                        restricted={isItemRestricted(item)}
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
                    {mediumSaved.length} Saved
                  </span>
                </div>
                {mediumSaved.length === 0 ? (
                  <div className="empty-state" style={{ padding: "80px 0" }}>
                    <BookmarkIcon size={44} style={{ opacity: 0.3 }} />
                    <h3>No bookmarked {config.title.toLowerCase()}</h3>
                    <p>Click the bookmark icon on any title to save it for later.</p>
                  </div>
                ) : (
                  <div className="cards-grid">
                    {mediumSaved.map((item) => (
                      <MediaCard
                        key={`saved_${item.media_type || "media"}_${item.id}`}
                        item={item}
                        onClick={() => onSelect(item)}
                        progress={getProgressVal(item)}
                        watched={watched}
                        onMarkWatched={onMarkWatched}
                        onMarkUnwatched={onMarkUnwatched}
                        ageRating={getRating(item).badge}
                        restricted={isItemRestricted(item)}
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
                    {mediumHistory.length} Titles
                  </span>
                </div>
                {mediumHistory.length === 0 ? (
                  <div className="empty-state" style={{ padding: "80px 0" }}>
                    <WatchedIcon size={44} style={{ opacity: 0.3 }} />
                    <h3>No watch history yet</h3>
                    <p>
                      Titles you watch in {config.title} will be recorded here
                      automatically.
                    </p>
                  </div>
                ) : (
                  <div className="cards-grid">
                    {mediumHistory.map((item) => (
                      <MediaCard
                        key={`history_${item.media_type || "media"}_${item.id}_${item.watchedAt || ""}`}
                        item={item}
                        onClick={() => onSelect(item)}
                        progress={getProgressVal(item)}
                        watched={watched}
                        onMarkWatched={onMarkWatched}
                        onMarkUnwatched={onMarkUnwatched}
                        ageRating={getRating(item).badge}
                        restricted={isItemRestricted(item)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
