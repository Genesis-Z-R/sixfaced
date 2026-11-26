// Preload script for player webviews (persist:player partition)
// Neutralizes anti-sandbox/popup probe checks from video embed providers like Vidrift.

const BYPASS_SCRIPT = `
(() => {
  try {
    if (window.__sb_bypass_installed) return;
    window.__sb_bypass_installed = true;

    function createMockWindow(targetUrl) {
      return {
        blur() {},
        focus() {},
        close() { this.closed = true; },
        closed: false,
        location: {
          href: targetUrl || "",
          replace() {},
          assign() {},
        },
        document: {
          write() {},
          close() {},
        },
        opener: window,
        name: "",
      };
    }

    try {
      window.open = function(url, target, features) {
        return createMockWindow(url);
      };
    } catch(e) {}

    try {
      if (typeof window.embedMeta === "object" && window.embedMeta !== null) {
        window.embedMeta.gateProbe = false;
        window.embedMeta.gateTrusted = true;
      } else {
        Object.defineProperty(window, "embedMeta", {
          configurable: true,
          enumerable: true,
          get() {
            return this._sb_embedMeta || { gateProbe: false, gateTrusted: true };
          },
          set(v) {
            if (v && typeof v === "object") {
              v.gateProbe = false;
              v.gateTrusted = true;
            }
            this._sb_embedMeta = v;
          },
        });
      }
    } catch(e) {}
  } catch(e) {}
})();
`;

// Media-URL sniffer: some providers build the manifest URL in JS (fetch/XHR),
// so the webRequest patterns never see it. Report manifests the page requests
// from the main world so downloads can still be offered.
const MEDIA_SNIFF_SCRIPT = `
(() => {
  try {
    if (window.__sb_media_sniffer) return;
    window.__sb_media_sniffer = true;
    const RE = /\\.m3u8|\\.mpd|format=m3u8|type=m3u8/i;
    const seen = new Set();
    const report = (url) => {
      try {
        if (!url || typeof url !== "string") return;
        if (!/^https?:/i.test(url)) return;
        if (!RE.test(url)) return;
        if (seen.has(url)) return;
        seen.add(url);
        if (seen.size > 300) seen.clear();
        window.postMessage({ __sbMedia: url }, "*");
      } catch (e) {}
    };
    try {
      const origFetch = window.fetch;
      if (origFetch) {
        window.fetch = function (input) {
          try {
            report(typeof input === "string" ? input : input && input.url);
          } catch (e) {}
          return origFetch.apply(this, arguments);
        };
      }
    } catch (e) {}
    try {
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (method, url) {
        try { report(url); } catch (e) {}
        return origOpen.apply(this, arguments);
      };
    } catch (e) {}
  } catch (e) {}
})();
`;

try {
  const { webFrame } = require("electron");
  if (webFrame && typeof webFrame.executeJavaScriptInIsolatedWorld === "function") {
    // Inject into Main World (worldId: 0) so page scripts see the mock window.open
    webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: BYPASS_SCRIPT }]);
    webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: MEDIA_SNIFF_SCRIPT }]);
  }
} catch (e) {}

// Main-world reports arrive as window messages; forward manifests to the app.
try {
  const { ipcRenderer } = require("electron");
  window.addEventListener("message", (event) => {
    const url = event && event.data && event.data.__sbMedia;
    if (typeof url === "string" && url) {
      try {
        ipcRenderer.send("player-media-url", url);
      } catch (e) {}
    }
  });
} catch (e) {}

// Also append inline script to documentElement if available to guarantee main world execution
try {
  const injectNow = () => {
    try {
      const parent = document.head || document.documentElement;
      if (parent) {
        for (const code of [BYPASS_SCRIPT, MEDIA_SNIFF_SCRIPT]) {
          const s = document.createElement("script");
          s.textContent = code;
          parent.appendChild(s);
          s.remove();
        }
      }
    } catch (e) {}
  };
  if (document.documentElement) {
    injectNow();
  } else {
    document.addEventListener("DOMContentLoaded", injectNow, { once: true });
  }
} catch (e) {}
