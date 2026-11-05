// ── Live subtitle toggle ─────────────────────────────────────────────────────
// Attaches a Wyzie / SubDL subtitle to the video that is currently playing
// inside the provider webview. The fetch happens in the main process (so the
// player frame's CORS rules don't apply) and comes back as WebVTT, which is
// the only format a <track> element can render.
//
// First click: search with the user's configured language, prefer a result in
// that language, attach it. Second click: detach.

import { useState, useCallback } from "react";
import { secureStorage, STORAGE_KEYS } from "../utils/storage";

export default function SubtitleToggleButton({
  webviewRef,
  tmdbId,
  mediaType = "movie",
  season = null,
  episode = null,
  lang = "",
}) {
  const [state, setState] = useState("idle"); // idle | loading | on
  const [note, setNote] = useState("");

  const getWcId = () => {
    const wv = webviewRef?.current;
    if (!wv) return null;
    try {
      return wv.getWebContentsId();
    } catch {
      return null;
    }
  };

  const toggle = useCallback(async () => {
    if (state === "loading") return;
    const wcId = getWcId();
    if (!wcId) return;

    if (state === "on") {
      await window.electron?.clearSubtitleTrack?.(wcId);
      setState("idle");
      setNote("");
      return;
    }

    setState("loading");
    setNote("Searching…");
    try {
      const [subdlApiKey, wyzieApiKey] = await Promise.all([
        secureStorage.get(STORAGE_KEYS.SUBDL_API_KEY).catch(() => ""),
        secureStorage.get(STORAGE_KEYS.WYZIE_API_KEY).catch(() => ""),
      ]);
      if (!subdlApiKey && !wyzieApiKey) {
        setState("idle");
        setNote("Add a Wyzie or SubDL key in Settings");
        return;
      }

      const res = await window.electron.searchSubtitles({
        tmdbId,
        mediaType,
        season,
        episode,
        languages: lang || "",
        subdlApiKey: subdlApiKey || "",
        wyzieApiKey: wyzieApiKey || "",
      });
      if (!res?.ok || !res.results?.length) {
        setState("idle");
        setNote(res?.error || "No subtitles found");
        return;
      }

      const wanted = (lang || "").toLowerCase();
      const pick =
        res.results.find(
          (r) => String(r.language || "").toLowerCase() === wanted,
        ) || res.results[0];

      let url = pick.direct_url || null;
      if (!url && pick.file_id) {
        const resolved = await window.electron.getSubtitleUrl({
          fileId: pick.file_id,
        });
        if (resolved?.ok) url = resolved.url;
      }
      if (!url) {
        setState("idle");
        setNote("Could not resolve that subtitle");
        return;
      }

      const vttRes = await window.electron.fetchSubtitleVtt({ url });
      if (!vttRes?.ok) {
        setState("idle");
        setNote(vttRes?.error || "Subtitle download failed");
        return;
      }

      const attached = await window.electron.attachSubtitleTrack({
        webContentsId: wcId,
        vtt: vttRes.vtt,
        label: pick.release || pick.language || "Subtitles",
        lang: (pick.language || lang || "en").toLowerCase(),
      });
      if (!attached?.ok) {
        setState("idle");
        setNote(attached?.error || "Could not attach subtitle");
        return;
      }

      setState("on");
      setNote("");
    } catch (e) {
      setState("idle");
      setNote(e?.message || "Subtitle error");
    }
  }, [state, webviewRef, tmdbId, mediaType, season, episode, lang]);

  const caption =
    state === "on"
      ? "Subtitles on — click to turn off"
      : state === "loading"
        ? "Loading subtitles…"
        : "Load subtitles for this video";

  return (
    <button
      className="player-overlay-btn"
      onClick={toggle}
      title={note || caption}
      aria-label={caption}
      style={{ position: "relative" }}
    >
      <span
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: ".02em",
          opacity: state === "on" ? 1 : 0.7,
        }}
      >
        CC
      </span>
      {state === "on" && (
        <span
          style={{
            position: "absolute",
            right: 5,
            bottom: 5,
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "#63cab7",
          }}
        />
      )}
    </button>
  );
}
