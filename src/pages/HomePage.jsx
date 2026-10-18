import { useState, useMemo } from "react";
import { imgUrl, isAnimeContent } from "../utils/api";
import {
  PlayIcon,
  FilmIcon,
  TVIcon,
  AnimeToriiIcon,
  BookOpenIcon,
  ManhwaScrollIcon,
  BookmarkIcon,
  SearchIcon,
  CloseIcon,
} from "../components/Icons";

export default function HomePage({
  onSelect,
  onNavigate,
  history = [],
  inProgress = [],
  progress = {},
  saved = [],
  watched = {},
  availableUpdates = [],
  onClearUpdates,
  onDismissUpdate,
  onCheckUpdates,
  isCheckingUpdates = false,
}) {
  const [updateFilter, setUpdateFilter] = useState("all"); // "all" | "tv" | "manga" | "manhwa"

  // ── Jump Back In: exactly the last 5 titles interacted with ─────────────────
  const jumpBackInItems = useMemo(() => {
    const pool = [...(history || []), ...(inProgress || [])];
    const seen = new Set();
    const result = [];

    for (const item of pool) {
      if (!item || !item.id) continue;
      const mType = item.media_type || (item.first_air_date ? "tv" : "movie");
      const key = `${mType}_${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const isManga = mType === "manga";
      const isManhwa = mType === "manhwa";
      const isTV = mType === "tv";
      const isAnime = !isManga && !isManhwa && (isAnimeContent(item) || item.isAnime);

      // Compute progress percentage
      const pk =
        isManga || isManhwa
          ? item.chapter != null
            ? `${mType}_${item.id}_c${item.chapter}`
            : `${mType}_${item.id}`
          : isTV
            ? item.season != null && item.episode != null
              ? `tv_${item.id}_s${item.season}e${item.episode}`
              : `tv_${item.id}`
            : `movie_${item.id}`;

      const pct = Math.min(Math.round(progress?.[pk] || 0), 100);

      let subtitle = "";
      if (isManhwa || isManga) {
        subtitle = item.chapter != null ? `Chapter ${item.chapter}${item.page ? ` · p.${item.page}` : ""}` : "Reading";
      } else if (isTV) {
        subtitle = item.season != null && item.episode != null ? `Season ${item.season} · Episode ${item.episode}` : "In Progress";
      } else {
        subtitle = pct > 0 ? `${pct}% completed` : "Watching";
      }

      let typeLabel = "Movie";
      let typeClass = "movie";
      if (isManhwa) {
        typeLabel = "Manhwa";
        typeClass = "manhwa";
      } else if (isManga) {
        typeLabel = "Manga";
        typeClass = "manga";
      } else if (isAnime) {
        typeLabel = "Anime";
        typeClass = "anime";
      } else if (isTV) {
        typeLabel = "Series";
        typeClass = "tv";
      }

      result.push({
        item,
        key,
        pct,
        subtitle,
        typeLabel,
        typeClass,
      });

      if (result.length >= 5) break;
    }

    return result;
  }, [history, inProgress, progress]);


  // ── Filtered Updates ───────────────────────────────────────────────────────
  const filteredUpdates = useMemo(() => {
    if (!availableUpdates || availableUpdates.length === 0) return [];
    if (updateFilter === "all") return availableUpdates;
    if (updateFilter === "tv") {
      return availableUpdates.filter(
        (u) => u.media_type === "tv" || u.media_type === "anime" || u.isAnime,
      );
    }
    return availableUpdates.filter((u) => u.media_type === updateFilter);
  }, [availableUpdates, updateFilter]);

  const tvUpdatesCount = useMemo(
    () =>
      availableUpdates.filter(
        (u) => u.media_type === "tv" || u.media_type === "anime" || u.isAnime,
      ).length,
    [availableUpdates],
  );
  const mangaUpdatesCount = useMemo(
    () => availableUpdates.filter((u) => u.media_type === "manga").length,
    [availableUpdates],
  );
  const manhwaUpdatesCount = useMemo(
    () => availableUpdates.filter((u) => u.media_type === "manhwa").length,
    [availableUpdates],
  );

  return (
    <div className="home-dashboard" style={{ padding: "32px 36px 60px 36px", maxWidth: 1400, margin: "0 auto" }}>
      {/* ── Top Header ─────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 32,
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 28,
              fontWeight: 800,
              margin: 0,
              color: "var(--text)",
              letterSpacing: "-0.5px",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span>Home & Updates</span>
            {availableUpdates.length > 0 && (
              <span
                style={{
                  fontSize: 12,
                  background: "var(--red)",
                  color: "#fff",
                  borderRadius: 20,
                  padding: "3px 10px",
                  fontWeight: 700,
                  letterSpacing: "0.5px",
                }}
              >
                {availableUpdates.length} NEW
              </span>
            )}
          </h1>
          <p style={{ margin: "6px 0 0 0", color: "var(--text3)", fontSize: 14 }}>
            Jump right back into your titles or catch up on latest episodes and chapters.
          </p>
        </div>

        {/* Global Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            className="btn btn-secondary"
            onClick={() => onCheckUpdates?.(true)}
            disabled={isCheckingUpdates}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              padding: "7px 14px",
              borderRadius: "var(--radius)",
            }}
            title="Scan bookmarked titles for new episodes or chapters"
          >
            {isCheckingUpdates && (
              <span
                style={{
                  display: "inline-block",
                  width: 12,
                  height: 12,
                  border: "2px solid var(--text3)",
                  borderTopColor: "var(--red)",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
            )}
            {isCheckingUpdates ? "Checking..." : "Check for Updates"}
          </button>

          {availableUpdates.length > 0 && (
            <button
              className="btn btn-secondary"
              onClick={onClearUpdates}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                padding: "7px 14px",
                borderRadius: "var(--radius)",
                borderColor: "rgba(229, 9, 20, 0.4)",
                color: "var(--text)",
              }}
              title="Clear all new release notifications"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* ── Section: Jump Back In (Last 5 Titles) ───────────────────────────── */}
      <div style={{ marginBottom: 44 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                margin: 0,
                color: "var(--text)",
                letterSpacing: "-0.2px",
              }}
            >
              Jump Back In
            </h2>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>
              Your last 5 interacted titles across all media
            </span>
          </div>
        </div>

        {jumpBackInItems.length === 0 ? (
          <div
            style={{
              padding: "36px 24px",
              background: "var(--surface)",
              borderRadius: "var(--radius)",
              border: "1px dashed var(--border)",
              textAlign: "center",
              color: "var(--text3)",
              fontSize: 14,
            }}
          >
            No recent titles yet. Pick a movie, show, manga, or manhwa to get started!
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))",
              gap: 16,
            }}
          >
            {jumpBackInItems.map(({ item, key, pct, subtitle, typeLabel, typeClass }) => {
              const title = item.title || item.name || "Untitled";
              const rawPoster = item.poster_path || item.image || item.cover;
              const posterSrc = rawPoster
                ? rawPoster.startsWith("http")
                  ? rawPoster
                  : imgUrl(rawPoster, "w342")
                : null;

              return (
                <div
                  key={key}
                  onClick={() => onSelect?.(item)}
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    overflow: "hidden",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    display: "flex",
                    flexDirection: "column",
                    position: "relative",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--red)";
                    e.currentTarget.style.transform = "translateY(-4px)";
                    e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.4)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  {/* Poster / Thumbnail */}
                  <div
                    style={{
                      height: 140,
                      background: "var(--surface2)",
                      position: "relative",
                      overflow: "hidden",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {posterSrc ? (
                      <img
                        src={posterSrc}
                        alt={title}
                        loading="lazy"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          transition: "transform 0.3s ease",
                        }}
                        onError={(e) => {
                          if (rawPoster?.includes("readdetectiveconan") && window.electron?.mangaPillImage && !e.target.dataset.proxied) {
                            e.target.dataset.proxied = "1";
                            window.electron.mangaPillImage({ url: rawPoster }).then((r) => {
                              if (r?.ok && r.dataUrl) e.target.src = r.dataUrl;
                            });
                          } else if (item.media_type === "manhwa" && window.electron?.manhwaImage && !e.target.dataset.proxied) {
                            e.target.dataset.proxied = "1";
                            window.electron.manhwaImage({ url: rawPoster, title }).then((r) => {
                              if (r?.ok && r.dataUrl) e.target.src = r.dataUrl;
                            });
                          }
                        }}
                      />
                    ) : (
                      <FilmIcon size={32} style={{ opacity: 0.3 }} />
                    )}

                    {/* Media Type Badge */}
                    <span
                      className={`card-badge card-badge--${typeClass}`}
                      style={{
                        position: "absolute",
                        top: 8,
                        left: 8,
                        fontSize: 9.5,
                        padding: "2px 6px",
                      }}
                    >
                      {typeLabel.toUpperCase()}
                    </span>

                    {/* Overlay Play Icon */}
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(0,0,0,0.35)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: 0,
                        transition: "opacity 0.2s ease",
                      }}
                      className="jump-hover-overlay"
                      onMouseEnter={(e) => (e.currentTarget.style.opacity = 1)}
                      onMouseLeave={(e) => (e.currentTarget.style.opacity = 0)}
                    >
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: "50%",
                          background: "var(--red)",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 2px 10px rgba(0,0,0,0.5)",
                        }}
                      >
                        <PlayIcon size={14} />
                      </div>
                    </div>

                    {/* Progress Bar */}
                    {pct > 0 && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: 3,
                          background: "rgba(255,255,255,0.2)",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${pct}%`,
                            background: "var(--red)",
                          }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Info details */}
                  <div style={{ padding: "10px 12px 12px" }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 13,
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={title}
                    >
                      {title}
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "var(--text3)",
                        marginTop: 3,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span>{subtitle}</span>
                      {pct > 0 && <span>{pct}%</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Section: Updates & New Releases ─────────────────────────────────── */}
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 18,
                fontWeight: 700,
                margin: 0,
                color: "var(--text)",
                letterSpacing: "-0.2px",
              }}
            >
              New Releases & Updates
            </h2>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>
              Fresh episodes and chapters detected for your saved bookmarks
            </span>
          </div>

          {/* Sub tabs */}
          {availableUpdates.length > 0 && (
            <div style={{ display: "flex", gap: 6, background: "var(--surface)", padding: 3, borderRadius: 8 }}>
              <button
                className={`btn btn-sm ${updateFilter === "all" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setUpdateFilter("all")}
                style={{ fontSize: 12, padding: "3px 10px", borderRadius: 6 }}
              >
                All ({availableUpdates.length})
              </button>
              {tvUpdatesCount > 0 && (
                <button
                  className={`btn btn-sm ${updateFilter === "tv" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setUpdateFilter("tv")}
                  style={{ fontSize: 12, padding: "3px 10px", borderRadius: 6 }}
                >
                  Series & Anime ({tvUpdatesCount})
                </button>
              )}
              {mangaUpdatesCount > 0 && (
                <button
                  className={`btn btn-sm ${updateFilter === "manga" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setUpdateFilter("manga")}
                  style={{ fontSize: 12, padding: "3px 10px", borderRadius: 6 }}
                >
                  Manga ({mangaUpdatesCount})
                </button>
              )}
              {manhwaUpdatesCount > 0 && (
                <button
                  className={`btn btn-sm ${updateFilter === "manhwa" ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setUpdateFilter("manhwa")}
                  style={{ fontSize: 12, padding: "3px 10px", borderRadius: 6 }}
                >
                  Manhwa ({manhwaUpdatesCount})
                </button>
              )}
            </div>
          )}
        </div>

        {availableUpdates.length === 0 ? (
          <div
            style={{
              padding: "44px 24px",
              background: "var(--surface)",
              borderRadius: "var(--radius)",
              border: "1px solid var(--border)",
              textAlign: "center",
              color: "var(--text2)",
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              You're all caught up!
            </div>
            <p style={{ margin: "6px auto 16px auto", color: "var(--text3)", fontSize: 13, maxWidth: 360 }}>
              No unread episodes or chapters found for your bookmarked titles right now.
            </p>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => onCheckUpdates?.(true)}
              disabled={isCheckingUpdates}
              style={{ padding: "6px 14px" }}
            >
              {isCheckingUpdates ? "Checking for updates..." : "Check Now"}
            </button>
          </div>
        ) : filteredUpdates.length === 0 ? (
          <div
            style={{
              padding: "30px 24px",
              background: "var(--surface)",
              borderRadius: "var(--radius)",
              border: "1px dashed var(--border)",
              textAlign: "center",
              color: "var(--text3)",
              fontSize: 13,
            }}
          >
            No updates in this category.
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
              gap: 14,
            }}
          >
            {filteredUpdates.map((entry) => {
              const targetItem = entry.item || entry.seriesItem || {
                id: entry.id,
                title: entry.title,
                media_type: entry.media_type,
                poster_path: entry.poster_path,
              };

              const rawPoster = entry.poster_path || targetItem.poster_path || targetItem.image;
              const posterSrc = rawPoster
                ? rawPoster.startsWith("http")
                  ? rawPoster
                  : imgUrl(rawPoster, "w185")
                : null;

              const isManga = entry.media_type === "manga";
              const isManhwa = entry.media_type === "manhwa";

              return (
                <div
                  key={`${entry.media_type}_${entry.id}`}
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius)",
                    padding: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    transition: "all 0.2s ease",
                    position: "relative",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--red)";
                    e.currentTarget.style.background = "var(--surface2)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.background = "var(--surface)";
                  }}
                >
                  {/* Poster Thumbnail */}
                  <div
                    style={{
                      width: 48,
                      height: 68,
                      borderRadius: 6,
                      background: "var(--surface3)",
                      overflow: "hidden",
                      flexShrink: 0,
                      position: "relative",
                    }}
                  >
                    {posterSrc ? (
                      <img
                        src={posterSrc}
                        alt={entry.title}
                        loading="lazy"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => {
                          if (rawPoster?.includes("readdetectiveconan") && window.electron?.mangaPillImage && !e.target.dataset.proxied) {
                            e.target.dataset.proxied = "1";
                            window.electron.mangaPillImage({ url: rawPoster }).then((r) => {
                              if (r?.ok && r.dataUrl) e.target.src = r.dataUrl;
                            });
                          } else if (isManhwa && window.electron?.manhwaImage && !e.target.dataset.proxied) {
                            e.target.dataset.proxied = "1";
                            window.electron.manhwaImage({ url: rawPoster, title: entry.title }).then((r) => {
                              if (r?.ok && r.dataUrl) e.target.src = r.dataUrl;
                            });
                          }
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          height: "100%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: 0.3,
                        }}
                      >
                        {isManga || isManhwa ? <BookOpenIcon size={20} /> : <TVIcon size={20} />}
                      </div>
                    )}
                  </div>

                  {/* Update Text Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 13.5,
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={entry.title}
                    >
                      {entry.title}
                    </div>

                    <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {entry.season != null && (
                        <span
                          style={{
                            fontSize: 11,
                            background: "var(--surface3)",
                            color: "var(--text2)",
                            padding: "1px 6px",
                            borderRadius: 4,
                            fontWeight: 600,
                          }}
                        >
                          Season {entry.season}
                        </span>
                      )}
                      {entry.episode != null && (
                        <span
                          style={{
                            fontSize: 11,
                            background: "rgba(229, 9, 20, 0.16)",
                            color: "var(--red)",
                            padding: "1px 6px",
                            borderRadius: 4,
                            fontWeight: 700,
                          }}
                        >
                          ✨ Ep. {entry.episode}
                        </span>
                      )}
                      {entry.chapter != null && (
                        <span
                          style={{
                            fontSize: 11,
                            background: "rgba(229, 9, 20, 0.16)",
                            color: "var(--red)",
                            padding: "1px 6px",
                            borderRadius: 4,
                            fontWeight: 700,
                          }}
                        >
                          ✨ Ch. {entry.chapter}
                        </span>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => onSelect?.(targetItem)}
                        style={{ fontSize: 11, padding: "2px 10px", borderRadius: 4 }}
                      >
                        {isManga || isManhwa ? "Read" : "Watch"} ▶
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDismissUpdate?.(entry.id, entry.media_type);
                        }}
                        style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, color: "var(--text3)" }}
                        title="Dismiss notification"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
