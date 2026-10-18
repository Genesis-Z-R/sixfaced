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

try {
  const { webFrame } = require("electron");
  if (webFrame && typeof webFrame.executeJavaScriptInIsolatedWorld === "function") {
    // Inject into Main World (worldId: 0) so page scripts see the mock window.open
    webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: BYPASS_SCRIPT }]);
  }
} catch (e) {}

// Also append inline script to documentElement if available to guarantee main world execution
try {
  const injectNow = () => {
    try {
      const parent = document.head || document.documentElement;
      if (parent) {
        const s = document.createElement("script");
        s.textContent = BYPASS_SCRIPT;
        parent.appendChild(s);
        s.remove();
      }
    } catch (e) {}
  };
  if (document.documentElement) {
    injectNow();
  } else {
    document.addEventListener("DOMContentLoaded", injectNow, { once: true });
  }
} catch (e) {}
