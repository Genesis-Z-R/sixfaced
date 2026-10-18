import { useState, useEffect, useRef, useCallback, memo } from "react";
import { imgUrl, isAnimeContent } from "../utils/api";
import {
  PlayIcon,
  FilmIcon,
  TVIcon,
  BookOpenIcon,
  WatchedIcon,
  RatingShieldIcon,
  RatingLockIcon,
} from "./Icons";

const MediaCard = memo(function MediaCard({
  item,
  onClick,
  progress,
  watched,
  onMarkWatched,
  onMarkUnwatched,
  onRemoveBookmark,
  ageRating,
  restricted,
  rank,
}) {
  const title = item.title || item.name;
  const year = (item.release_date || item.first_air_date || item.year || "").slice(0, 4);
  const isTV = item.media_type === "tv";
  const isManga = item.media_type === "manga";
  const isManhwa = item.media_type === "manhwa";
  const isAnime = !isManga && !isManhwa && isAnimeContent(item);

  // Unreleased detection
  const rawDate = item.release_date || item.first_air_date;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isUnreleased = rawDate ? new Date(rawDate) > today : false;

  // Build watched key for TV cards from Continue Watching we get season/episode
  const watchedKey = isManga || isManhwa
    ? item.chapter != null
      ? `${item.media_type || "manga"}_${item.id}_c${item.chapter}`
      : `${item.media_type || "manga"}_${item.id}`
    : isTV
      ? item.season != null && item.episode != null
        ? `tv_${item.id}_s${item.season}e${item.episode}`
        : `tv_${item.id}`
      : `movie_${item.id}`;

  const isWatched = !!watched?.[watchedKey];

  // Context menu state
  const [menu, setMenu] = useState(null); // { x, y }
  const menuRef = useRef(null);

  // For TV series cards without a specific episode, watched marking is disabled
  const canMarkWatched = !isTV || (item.season != null && item.episode != null);
  const canOpenMenu = canMarkWatched || Boolean(onRemoveBookmark);

  const openMenu = useCallback(
    (e) => {
      if (!canOpenMenu) return;
      e.preventDefault();
      e.stopPropagation();
      setMenu({ x: e.clientX, y: e.clientY });
    },
    [canOpenMenu],
  );

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [menu]);

  const handleMarkWatched = (e) => {
    e.stopPropagation();
    onMarkWatched?.(watchedKey);
    setMenu(null);
  };
  const handleMarkUnwatched = (e) => {
    e.stopPropagation();
    onMarkUnwatched?.(watchedKey);
    setMenu(null);
  };

  return (
    <>
      <div
        className={`card${isWatched ? " ep-watched" : ""}${isUnreleased ? " card--unreleased" : ""}`}
        onClick={onClick}
        onContextMenu={isUnreleased ? undefined : openMenu}
      >
        <div className="card-poster">
          {item.poster_path || item.image ? (
            <img
              src={
                (item.poster_path || item.image).startsWith("http")
                  ? (item.poster_path || item.image)
                  : imgUrl(item.poster_path || item.image, "w342")
              }
              alt={title}
              loading="lazy"
              onError={(e) => {
                const rawUrl = item.poster_path || item.image;
                if (rawUrl?.includes("readdetectiveconan") && window.electron?.mangaPillImage && !e.target.dataset.proxied) {
                  e.target.dataset.proxied = "1";
                  window.electron.mangaPillImage({ url: rawUrl }).then((r) => {
                    if (r?.ok && r.dataUrl) e.target.src = r.dataUrl;
                  });
                } else if ((isManhwa || item.media_type === "manhwa") && window.electron?.manhwaImage && !e.target.dataset.proxied) {
                  e.target.dataset.proxied = "1";
                  window.electron.manhwaImage({ url: rawUrl, title: item.title || item.name }).then((r) => {
                    if (r?.ok && r.dataUrl) e.target.src = r.dataUrl;
                  });
                }
              }}
            />
          ) : (
            <div className="no-poster">
              {isTV ? <TVIcon /> : isManga || isManhwa ? <BookOpenIcon size={24} /> : <FilmIcon />}
              <span style={{ fontSize: 10, color: "var(--text3)" }}>
                No Image
              </span>
            </div>
          )}
          {ageRating && (
            <div
              className={`card-age-badge${restricted ? " card-age-badge--restricted" : ""}`}
            >
              {restricted ? (
                <RatingLockIcon size={9} />
              ) : (
                <RatingShieldIcon size={9} />
              )}
              {ageRating}
            </div>
          )}

          <div className="card-overlay">
            {isUnreleased ? (
              <div className="card-unreleased-overlay">
                <span className="card-unreleased-label">🔒 Unreleased</span>
              </div>
            ) : (
              <div className="card-play">
                <PlayIcon />
              </div>
            )}
          </div>
          {!isUnreleased && progress > 0 && !isWatched && (
            <div className="card-progress">
              <div
                className="card-progress-fill"
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
          )}
          {!isUnreleased && isWatched && (
            <div className="card-watched-badge">
              <WatchedIcon size={26} />
            </div>
          )}
          {rank != null && (
            <div className="card-rank-badge">
              <span className="card-rank-hash">#</span>
              <span className="card-rank-num">{rank}</span>
            </div>
          )}
        </div>
        <div className="card-info">
          <div className="card-title" title={title}>
            {title}
          </div>
          <div className="card-year">
            {isManhwa
              ? item.chapter != null ? `Ch. ${item.chapter}` : "Manhwa"
              : isManga
              ? item.chapter != null ? `Ch. ${item.chapter}` : "Manga"
              : isTV && item.season != null && item.episode != null
                ? `S${item.season}E${item.episode}${item.episodeName ? ` · ${item.episodeName}` : ""}`
                : `${year} · ${isTV ? "Series" : "Movie"}`}
          </div>
        </div>
        <span
          className={`card-badge${isUnreleased ? " card-badge--unreleased" : ""}${isManhwa ? " card-badge--manhwa" : isManga ? " card-badge--manga" : isAnime && !isUnreleased ? " card-badge--anime" : ""}`}
        >
          {isUnreleased ? "SOON" : isManhwa ? "MANHWA" : isManga ? "MANGA" : isAnime ? "ANIME" : isTV ? "TV" : "HD"}
        </span>
        {onRemoveBookmark && (
          <button
            className="library-unbookmark-btn"
            title="Remove bookmark"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveBookmark(item);
            }}
          >
            ✕
          </button>
        )}
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {canMarkWatched && (
            isWatched ? (
              <button className="context-menu-item" onClick={handleMarkUnwatched}>
                ↩ Mark as Unwatched
              </button>
            ) : (
              <button className="context-menu-item" onClick={handleMarkWatched}>
                ✓ Mark as Watched
              </button>
            )
          )}
          {onRemoveBookmark && (
            <button
              className="context-menu-item"
              style={{ color: "var(--red, #ef4444)" }}
              onClick={(e) => {
                e.stopPropagation();
                onRemoveBookmark(item);
                setMenu(null);
              }}
            >
              ✕ Remove Bookmark
            </button>
          )}
        </div>
      )}
    </>
  );
});
export default MediaCard;
