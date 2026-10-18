import { useState, useEffect, useRef, useCallback } from "react";

/**
 * Hook to provide instantaneous, responsive keyboard controls for in-app video playback.
 * Captures keys both from the host window and via electron events from the webview.
 */
export function usePlayerKeyboardControls({
  playing,
  webviewRef,
  pipWebContentsIdRef,
}) {
  const [playerToast, setPlayerToast] = useState(null);
  const toastTimeoutRef = useRef(null);
  const lastKeyTimeRef = useRef(0);

  const showPlayerToast = useCallback((msg) => {
    if (!msg) return;
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setPlayerToast(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setPlayerToast(null);
    }, 1100);
  }, []);

  // Listen for toasts sent from Electron's guest webview before-input-event listener
  useEffect(() => {
    if (!window.electron?.onPlayerToast) return;
    const handler = window.electron.onPlayerToast((msg) => {
      showPlayerToast(msg);
    });
    return () => {
      window.electron?.offPlayerToast?.(handler);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
  }, [showPlayerToast]);

  // Host-level keydown handler (when focus is on the main app window)
  useEffect(() => {
    if (!playing) return;

    const MIN_REPEAT_INTERVAL = 80;

    const handleKeyDown = (e) => {
      // Don't intercept when user is typing in any text input
      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        return;
      }

      // Allow standard system shortcuts (Cmd/Ctrl + R, Cmd/Ctrl + Z, etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      const now = Date.now();
      if (e.repeat && now - lastKeyTimeRef.current < MIN_REPEAT_INTERVAL) {
        return;
      }

      let action = null;
      let value = null;
      const code = e.code;
      const key = e.key;

      if (code === "Space" || key === "k" || key === "K") {
        action = "toggle-play";
      } else if (code === "ArrowLeft" || key === "j" || key === "J") {
        action = "seek";
        value = -10;
      } else if (code === "ArrowRight" || key === "l" || key === "L") {
        action = "seek";
        value = 10;
      } else if (code === "ArrowUp") {
        action = "volume";
        value = 0.1;
      } else if (code === "ArrowDown") {
        action = "volume";
        value = -0.1;
      } else if (key === "m" || key === "M") {
        action = "toggle-mute";
      } else if (key === "f" || key === "F") {
        action = "fullscreen";
      } else if (key >= "0" && key <= "9" && !e.repeat) {
        action = "seek-percent";
        value = parseInt(key, 10) / 10;
      }

      if (!action) return;

      e.preventDefault();
      lastKeyTimeRef.current = now;

      // Determine target webContents ID
      let targetWcId = pipWebContentsIdRef?.current ?? null;
      if (!targetWcId && webviewRef?.current) {
        try {
          if (typeof webviewRef.current.getWebContentsId === "function") {
            targetWcId = webviewRef.current.getWebContentsId();
          }
        } catch {}
      }

      if (targetWcId && window.electron?.controlVideo) {
        window.electron
          .controlVideo(targetWcId, action, value)
          .then((res) => {
            if (res?.toast) {
              showPlayerToast(res.toast);
            }
          })
          .catch(() => {});
      } else if (webviewRef?.current) {
        // Direct webview JS execution fallback
        const wv = webviewRef.current;
        try {
          wv.executeJavaScript(`
            (() => {
              if (window.__streambertPlayer) {
                switch ('${action}') {
                  case 'toggle-play': window.__streambertPlayer.togglePlay(); break;
                  case 'seek': window.__streambertPlayer.seek(${Number(value) || 0}); break;
                  case 'volume': window.__streambertPlayer.changeVolume(${Number(value) || 0}); break;
                  case 'toggle-mute': window.__streambertPlayer.toggleMute(); break;
                  case 'fullscreen': window.__streambertPlayer.toggleFullscreen(); break;
                  case 'seek-percent': window.__streambertPlayer.seekPercent(${Number(value) || 0}); break;
                }
              }
            })()
          `).catch(() => {});
        } catch {}
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [playing, webviewRef, pipWebContentsIdRef, showPlayerToast]);

  return { playerToast, showPlayerToast };
}
