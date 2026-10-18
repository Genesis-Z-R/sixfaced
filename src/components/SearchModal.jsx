import { useState, useEffect, useRef, useCallback } from "react";
import { tmdbFetch, imgUrl, isAnimeContent } from "../utils/api";
import { searchManga } from "../utils/mangaApi";
import { searchManhwa } from "../utils/manhwaApi";
import { SearchIcon, CloseIcon } from "./Icons";
import { storage } from "../utils/storage";

const HISTORY_KEY = "searchHistory";
const MAX_HISTORY = 12;

function loadHistory() {
  return storage.get(HISTORY_KEY) || [];
}

function saveHistory(history) {
  storage.set(HISTORY_KEY, history);
}

export default function SearchModal({ apiKey, onSelect, onClose, offline }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState(loadHistory);
  const inputRef = useRef();

  useEffect(() => {
    const tid = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(tid);
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let mounted = true;
    const timer = setTimeout(async () => {
       setLoading(true);
       try {
         const [tmdbData, mangaData, manhwaData] = await Promise.all([
           tmdbFetch(
             `/search/multi?query=${encodeURIComponent(query)}&page=1`,
             apiKey,
           ).catch(() => ({ results: [] })),
           searchManga(query, 5).catch(() => []),
           searchManhwa(query, 5).catch(() => []),
         ]);

         if (mounted) {
           const tmdbResults = (tmdbData.results || [])
             .filter((r) => r.media_type !== "person")
             .slice(0, 10);
           setResults([...tmdbResults, ...(mangaData || []), ...(manhwaData || [])]);
         }
       } catch {}
       if (mounted) setLoading(false);
     }, 380);
     return () => {
       mounted = false;
       clearTimeout(timer);
     };
   }, [query, apiKey]);

  const addToHistory = useCallback((term) => {
    const trimmed = term.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const next = [trimmed, ...prev.filter((h) => h !== trimmed)].slice(
        0,
        MAX_HISTORY,
      );
      saveHistory(next);
      return next;
    });
  }, []);

  const removeFromHistory = useCallback((e, term) => {
    e.stopPropagation();
    setHistory((prev) => {
      const next = prev.filter((h) => h !== term);
      saveHistory(next);
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    saveHistory([]);
  }, []);

  const handleSelect = (r) => {
    const trimmed = query.trim();
    if (trimmed) {
      const next = [trimmed, ...history.filter((h) => h !== trimmed)].slice(
        0,
        MAX_HISTORY,
      );
      saveHistory(next);
      setHistory(next);
    }
    const isManga = r.media_type === "manga";
    const isManhwa = r.media_type === "manhwa";
    const isAnime = !isManga && !isManhwa && (isAnimeContent(r) || r.isAnime === true);
    onSelect(isAnime ? { ...r, isAnime: true } : r);
    onClose();
  };

  const handleHistoryClick = useCallback((term) => {
    setQuery(term);
    inputRef.current?.focus();
  }, []);

  const handleKey = (e) => {
    if (e.key === "Escape") onClose();
    if (e.key === "Enter" && query.trim()) addToHistory(query);
  };

  const showHistory = !query && history.length > 0;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="search-box">
        <div className="search-input-wrap">
          <SearchIcon />
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search movies and series..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
          />
          {query ? (
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => setQuery("")}
            >
              <CloseIcon />
            </button>
          ) : (
            <button className="btn btn-ghost btn-icon" onClick={onClose}>
              <CloseIcon />
            </button>
          )}
        </div>

        <div className="search-results">
          {offline && (
            <div
              style={{
                padding: "12px 20px",
                background: "rgba(255,165,0,0.1)",
                borderBottom: "1px solid var(--border)",
                fontSize: 13,
                color: "#ff9800",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              🌐 No internet, search is unavailable offline.
            </div>
          )}

          {!offline && loading && (
            <div className="loader">
              <div className="spinner" />
            </div>
          )}

          {!loading && query && results.length === 0 && (
            <div className="search-empty">No results for "{query}"</div>
          )}

          {!loading &&
            results.map((r) => {
              const isManga = r.media_type === "manga";
              const isManhwa = r.media_type === "manhwa";
              const isAnime = !isManga && !isManhwa && (isAnimeContent(r) || r.isAnime);
              const isTV = r.media_type === "tv";
              const posterSrc = r.poster_path
                ? r.poster_path.startsWith("http")
                  ? r.poster_path
                  : imgUrl(r.poster_path, "w92")
                : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='58'%3E%3Crect fill='%23222' width='40' height='58'/%3E%3C/svg%3E";

              const typeBadgeLabel = isManhwa
                ? "Manhwa"
                : isManga
                ? "Manga"
                : isAnime
                  ? "Anime"
                  : isTV
                    ? "Series"
                    : "Movie";

              const typeClass = isManhwa
                ? "type-manhwa"
                : isManga
                ? "type-manga"
                : isAnime
                  ? "type-anime"
                  : isTV
                    ? "type-tv"
                    : "type-movie";

              return (
                <div
                  key={`${r.media_type || "media"}_${r.id}`}
                  className="search-result"
                  onClick={() => handleSelect(r)}
                >
                  <img src={posterSrc} alt="" />
                  <div className="search-result-info">
                    <div className="search-result-title">{r.title || r.name}</div>
                    <div className="search-result-meta">
                      {(r.release_date || r.first_air_date || r.year || "").slice(0, 4)}
                      {r.vote_average ? ` · ★ ${Number(r.vote_average).toFixed(1)}` : ""}
                    </div>
                  </div>
                  <span className={`search-result-type ${typeClass}`}>
                    {typeBadgeLabel}
                  </span>
                </div>
              );
            })}

          {showHistory && (
            <div className="search-history">
              <div className="search-history-header">
                <span className="search-history-label">Recent searches</span>
                <button className="search-history-clear" onClick={clearHistory}>
                  Clear all
                </button>
              </div>
              {history.map((term) => (
                <div
                  key={term}
                  className="search-history-item"
                  onClick={() => handleHistoryClick(term)}
                >
                  <span className="search-history-icon">
                    <SearchIcon />
                  </span>
                  <span className="search-history-term">{term}</span>
                  <button
                    className="search-history-remove"
                    onClick={(e) => removeFromHistory(e, term)}
                    title="Remove"
                  >
                    <CloseIcon />
                  </button>
                </div>
              ))}
            </div>
          )}

          {!query && history.length === 0 && (
            <div className="search-hint">
              Search for movies and series &nbsp;·&nbsp; <kbd>ESC</kbd> to close
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
