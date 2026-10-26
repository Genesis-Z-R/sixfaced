import { useState, useRef, useEffect } from "react";
import { imgUrl } from "../utils/api";
import { useSeasonalEvent } from "../components/seasonalEvents.jsx";
import {
  SixfacedLogo,
  HomeIcon,
  SearchIcon,
  HistoryIcon,
  BookOpenIcon,
  FilmIcon,
  TVIcon,
  AnimeToriiIcon,
  SettingsIcon,
  DownloadsQueueIcon,
  QuitIcon,
  BackIcon,
  HelpIcon,
  ManhwaScrollIcon,
  BellIcon,
} from "./Icons";

export default function Sidebar({
  page,
  onNavigate,
  onSearch,
  savedList,
  activeDownloads,
  onReorderSaved,
  onRemoveSaved,
  canGoBack,
  onBack,
  onShowShortcuts,
  updateCount = 0,
  onToggleUpdates,
  isUpdatesOpen = false,
}) {
  const [dragOver, setDragOver] = useState(null);
  const dragItem = useRef(null);
  const dragNode = useRef(null);
  const seasonalEvent = useSeasonalEvent();

  const [tooltip, setTooltip] = useState(null); // { title, y }
  const [contextMenu, setContextMenu] = useState(null); // { item, x, y }

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, []);

  const handleContextMenu = (e, item) => {
    e.preventDefault();
    e.stopPropagation();
    setTooltip(null);
    setContextMenu({ item, x: e.clientX, y: e.clientY });
  };

  const handleDragStart = (e, index) => {
    dragItem.current = index;
    dragNode.current = e.currentTarget;
    setTimeout(() => {
      if (dragNode.current) dragNode.current.style.opacity = "0.4";
    }, 0);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    if (dragNode.current) dragNode.current.style.opacity = "1";
    dragItem.current = null;
    dragNode.current = null;
    setDragOver(null);
  };

  const handleDragEnter = (e, index) => {
    if (dragItem.current === index) return;
    setDragOver(index);
  };

  const handleDrop = (e, dropIndex) => {
    e.preventDefault();
    const fromIndex = dragItem.current;
    if (fromIndex === null || fromIndex === dropIndex) return;

    const newList = [...savedList];
    const [moved] = newList.splice(fromIndex, 1);
    newList.splice(dropIndex, 0, moved);

    const newOrder = newList.map((item) => `${item.media_type}_${item.id}`);
    onReorderSaved(newOrder);
    setDragOver(null);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleMouseEnter = (e, title) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ title, y: rect.top + rect.height / 2 });
  };

  const handleMouseLeave = () => {
    setTooltip(null);
  };

  return (
    <div className="sidebar">
      <div
        className="sidebar-logo"
        onClick={() => onNavigate("home")}
        title="Sixfaced"
        style={{ position: "relative" }}
      >
        <SixfacedLogo />
        {seasonalEvent && seasonalEvent.render()}
      </div>

      {canGoBack && (
        <SideBtn onClick={onBack} icon={<BackIcon />} label="Back (Ctrl+Z)" />
      )}

      <SideBtn
        active={page === "home"}
        onClick={() => onNavigate("home")}
        icon={<HomeIcon />}
        label="Home"
        badge={updateCount > 0 ? updateCount : null}
      />
      <SideBtn onClick={onSearch} icon={<SearchIcon />} label="Search  (⌘F)" />
      <SideBtn
        active={page === "movies"}
        onClick={() => onNavigate("movies")}
        icon={<FilmIcon />}
        label="Movies"
      />
      <SideBtn
        active={page === "series"}
        onClick={() => onNavigate("series")}
        icon={<TVIcon />}
        label="Series"
      />
      <SideBtn
        active={page === "anime"}
        onClick={() => onNavigate("anime")}
        icon={<AnimeToriiIcon />}
        label="Anime"
      />
      <SideBtn
        active={page === "manga"}
        onClick={() => onNavigate("manga")}
        icon={<BookOpenIcon />}
        label="Manga"
      />
      <SideBtn
        active={page === "manhwa"}
        onClick={() => onNavigate("manhwa")}
        icon={<ManhwaScrollIcon />}
        label="Manhwa"
      />
      <SideBtn
        active={page === "downloads"}
        onClick={() => onNavigate("downloads")}
        icon={<DownloadsQueueIcon />}
        label="Downloads"
        badge={activeDownloads > 0 ? activeDownloads : null}
      />

      <div className="sidebar-sep" />

      <div className="sidebar-saved">
        {savedList.map((item, index) => {
          const key = `${item.media_type}_${item.id}`;
          const title = item.title || item.name;
          const posterSrc = item.poster_path
            ? item.poster_path.startsWith("http")
              ? item.poster_path
              : imgUrl(item.poster_path, "w200")
            : null;
          return (
            <div
              key={key}
              className={`saved-thumb${dragOver === index ? " drag-over" : ""}`}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragEnd={handleDragEnd}
              onDragEnter={(e) => handleDragEnter(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              onClick={() =>
                onNavigate(
                  item.media_type === "manhwa"
                    ? "manhwa"
                    : item.media_type === "manga"
                    ? "manga"
                    : item.media_type === "tv"
                      ? "tv"
                      : "movie",
                  item,
                )
              }
              onContextMenu={(e) => handleContextMenu(e, item)}
              onMouseEnter={(e) => handleMouseEnter(e, title)}
              onMouseLeave={handleMouseLeave}
              style={{ cursor: "grab", position: "relative" }}
            >
              {posterSrc ? (
                <img src={posterSrc} alt={title} />
              ) : (
                <div className="no-img">
                  {item.media_type === "manhwa" ? (
                    <ManhwaScrollIcon size={20} />
                  ) : item.media_type === "manga" ? (
                    <BookOpenIcon size={20} />
                  ) : (
                    <FilmIcon />
                  )}
                </div>
              )}
              {dragOver === index && (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 3,
                    background: "var(--accent, #e50914)",
                    borderRadius: 2,
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {tooltip && (
        <div className="saved-thumb-tooltip" style={{ top: tooltip.y }}>
          {tooltip.title}
        </div>
      )}

      {contextMenu && (
        <div
          className="sidebar-context-menu"
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            zIndex: 9999,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="sidebar-context-menu-item"
            onClick={() => {
              onRemoveSaved && onRemoveSaved(contextMenu.item);
              setContextMenu(null);
            }}
          >
            Remove
          </div>
        </div>
      )}

      <div className="sidebar-bottom">
        <SideBtn
          onClick={onShowShortcuts}
          icon={<HelpIcon />}
          label="Help & Shortcuts (?)"
        />
        <SideBtn
          active={page === "settings"}
          onClick={() => onNavigate("settings")}
          icon={<SettingsIcon />}
          label="Settings"
        />
        <button
          className="sidebar-btn"
          onClick={() => window.electron?.quitApp?.()}
          title="Quit App"
          style={{ color: "#e53e3e", marginTop: 4 }}
        >
          <QuitIcon />
          <span className="tooltip">Quit App</span>
        </button>
      </div>
    </div>
  );
}

function SideBtn({ active, onClick, icon, label, badge }) {
  return (
    <button
      className={`sidebar-btn ${active ? "active" : ""}`}
      onClick={onClick}
      style={{ position: "relative" }}
    >
      {icon}
      <span className="tooltip">{label}</span>
      {badge && (
        <span
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            minWidth: 16,
            height: 16,
            borderRadius: 8,
            background: "var(--red)",
            color: "white",
            fontSize: 10,
            fontWeight: 700,
            lineHeight: "16px",
            textAlign: "center",
            padding: "0 4px",
          }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
