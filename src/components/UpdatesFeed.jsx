import { useEffect, useRef, useState } from "react";
import { imgUrl } from "../utils/api";

const FALLBACK = null;

function PosterImg({ item, title }) {
  const raw = item?.image || item?.poster_path || item?.poster || item?.cover;
  const initial = raw
    ? String(raw).startsWith("http")
      ? String(raw)
      : imgUrl(raw, "w342")
    : FALLBACK;
  const [src, setSrc] = useState(initial);
  const [failed, setFailed] = useState(!initial);
  const triedRef = useRef(false);

  useEffect(() => {
    const next = raw
      ? String(raw).startsWith("http")
        ? String(raw)
        : imgUrl(raw, "w342")
      : FALLBACK;
    setSrc(next);
    setFailed(!next);
    triedRef.current = false;
  }, [raw]);

  const handleError = async () => {
    if (triedRef.current || !raw) {
      setFailed(true);
      return;
    }
    triedRef.current = true;

    // MangaPill / Asura / ComicK covers reject direct hotlinks; the main
    // process can refetch them with the right Referer and return a data URL.
    const url = String(raw);
    const isManhwa = item?.media_type === "manhwa" || /asura|comick/i.test(url);
    try {
      if (url.includes("readdetectiveconan") && window.electron?.mangaPillImage) {
        const res = await window.electron.mangaPillImage({ url });
        if (res?.ok && res.dataUrl) {
          setSrc(res.dataUrl);
          return;
        }
      } else if (isManhwa && window.electron?.manhwaImage) {
        const res = await window.electron.manhwaImage({
          url,
          title: item?.title || item?.name,
        });
        if (res?.ok && res.dataUrl) {
          setSrc(res.dataUrl);
          return;
        }
      }
    } catch {}
    setFailed(true);
  };

  if (failed || !src) {
    return (
      <span className="update-poster-fallback">
        {String(title || "?").slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    <img src={src} alt="" loading="lazy" onError={handleError} />
  );
}

function Row({ row, onOpen }) {
  const isLoading = row.status === "loading" || row.status === "queued";
  const isError = row.status === "error";

  const activate = () => {
    if (!isLoading && onOpen) onOpen(row.item);
  };

  return (
    <div
      className={`update-row${row.status === "new" ? " has-new" : ""}`}
      role="button"
      tabIndex={0}
      onClick={activate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      }}
    >
      <div className="update-poster">
        <PosterImg item={row.item} title={row.title} />
      </div>

      <div className="update-main">
        <div className="update-top">
          <span className="update-title" title={row.title}>
            {row.title}
          </span>

          {row.status === "new" && !row.newSeason && row.newCount > 0 && (
            <span className="update-badge new">+{row.newCount} NEW</span>
          )}
          {row.status === "new" && row.newSeason && (
            <span className="update-badge new">NEW SEASON</span>
          )}
          {row.status === "new" && row.newSeason === false && !row.newCount && (
            <span className="update-badge new">NEW</span>
          )}
          {row.status === "not_started" && (
            <span className="update-chip">NOT STARTED</span>
          )}
          {row.status === "up_to_date" && (
            <span className="update-chip muted">UP TO DATE</span>
          )}
          {isError && <span className="update-chip error">COULDN&apos;T CHECK</span>}
        </div>

        <div className="update-positions">
          {isLoading ? (
            <span className="update-muted">Checking the latest release…</span>
          ) : isError ? (
            <span className="update-muted">{row.error || "Try refreshing."}</span>
          ) : (
            <>
              {row.currentLabel && (
                <span className="update-pos">{row.currentLabel}</span>
              )}
              {row.currentLabel && row.latestLabel && (
                <span className="update-arrow">→</span>
              )}
              {row.latestLabel && (
                <span className="update-pos latest">{row.latestLabel}</span>
              )}
            </>
          )}
        </div>

        {row.status !== "up_to_date" &&
          typeof row.progressPct === "number" &&
          row.progressPct > 0 && (
            <div
              className="update-progress"
              title={`${row.progressPct}% of this chapter`}
            >
              <span style={{ width: `${Math.min(100, row.progressPct)}%` }} />
            </div>
          )}

        {!isLoading && !isError && row.actions?.length > 0 && (
          <div
            className="update-actions"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {row.actions.map((action) => (
              <button
                key={action.label}
                className={`btn btn-sm ${
                  action.variant === "primary" ? "btn-primary" : "btn-secondary"
                }`}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function UpdatesFeed({
  rows = [],
  total = 0,
  newCount = 0,
  loading = false,
  onRefresh,
  onOpen,
  emptyTitle = "Nothing bookmarked yet",
  emptyBody = "Bookmark a title and it will show up here with your progress.",
  EmptyIcon = null,
}) {
  const hasRows = rows.length > 0;

  return (
    <div className="updates-feed">
      <div className="updates-summary">
        <span className="updates-summary-text">
          {loading && !hasRows
            ? "Checking your bookmarks…"
            : `${total} bookmarked${
                newCount > 0 ? ` · ${newCount} with new chapters` : ""
              }`}
        </span>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onRefresh}
          disabled={loading}
        >
          {loading ? "Checking…" : "Refresh"}
        </button>
      </div>

      {!hasRows ? (
        <div className="empty-state" style={{ padding: "70px 0" }}>
          {EmptyIcon ? <EmptyIcon size={44} style={{ opacity: 0.3 }} /> : null}
          <h3>{emptyTitle}</h3>
          <p>{emptyBody}</p>
        </div>
      ) : (
        <div className="updates-list">
          {rows.map((row) => (
            <Row key={row.key} row={row} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
