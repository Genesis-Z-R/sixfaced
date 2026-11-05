// ── Compact player chrome ─────────────────────────────────────────────────────
// Some embed providers (vidfast in particular) render a very large title card,
// an oversized centre play button and chunky control icons on top of the video.
// They are distracting next to Sixfaced's own UI, so we scale them down inside
// the player webview.
//
// The providers use Material UI with per-build emotion hashes (`.mui-1a2b3c`),
// so class selectors would break on their next deploy. Instead this script
// tags the relevant nodes structurally — the overlay that sits next to <video>,
// its first text-only child (the title card), the largest <button> (the centre
// CTA) and the remaining icon buttons — and styles them via stable
// `data-sb-*` attributes that we own.
//
// Everything is best-effort: if a provider changes its markup the script simply
// tags nothing and the page looks untouched.

export const COMPACT_CHROME_SOURCES = ["vidfast"];

export const PLAYER_CHROME_SCRIPT = `
(function () {
  if (window.__sbCompactInit) {
    try { window.__sbCompact(); } catch (e) {}
    return;
  }
  window.__sbCompactInit = true;

  var CSS = [
    '[data-sb-title]{transform:scale(.85);transform-origin:left top;opacity:.6;transition:opacity .2s ease;pointer-events:none;}',
    '[data-sb-title] > *{font-size:13px !important;line-height:1.35 !important;letter-spacing:.01em !important;}',
    '[data-sb-title] > *:first-child{font-size:9px !important;text-transform:uppercase;letter-spacing:.12em !important;opacity:.6;}',
    '[data-sb-cta]{transform:scale(.6);opacity:.32;transition:transform .18s ease,opacity .18s ease;}',
    '[data-sb-cta]:hover{transform:scale(.85);opacity:.9;}',
    '[data-sb-icon]{width:18px !important;height:18px !important;min-width:0 !important;min-height:0 !important;}'
  ].join('\\n');

  function ensureStyle() {
    if (document.getElementById('__sb-compact-style')) return;
    var s = document.createElement('style');
    s.id = '__sb-compact-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  window.__sbCompact = function () {
    ensureStyle();
    var video = document.querySelector('video');
    if (!video || !video.parentElement) return;

    var root = video.parentElement;
    var overlay = null;
    for (var i = 0; i < root.children.length; i++) {
      var c = root.children[i];
      if (c !== video && c.tagName === 'DIV') { overlay = c; break; }
    }
    if (!overlay) return;

    // Title card: first overlay child that holds text but no iconography.
    var title = overlay.querySelector('[data-sb-title]');
    if (!title) {
      for (var j = 0; j < overlay.children.length; j++) {
        var el = overlay.children[j];
        var text = (el.textContent || '').trim();
        if (text.length > 2 && !el.querySelector('svg') && !el.querySelector('button')) {
          el.setAttribute('data-sb-title', '');
          break;
        }
      }
    }

    // Centre CTA: the largest button in the overlay, if it is genuinely big.
    if (!overlay.querySelector('[data-sb-cta]')) {
      var best = null, bestArea = 0;
      var btns = overlay.querySelectorAll('button');
      for (var k = 0; k < btns.length; k++) {
        var r = btns[k].getBoundingClientRect();
        var area = r.width * r.height;
        if (area > bestArea) { bestArea = area; best = btns[k]; }
      }
      if (best && bestArea > 6000) best.setAttribute('data-sb-cta', '');
    }

    // Remaining icon buttons: shrink the glyphs, leave the CTA's own icon alone
    // (it is already scaled with its button).
    var cta = overlay.querySelector('[data-sb-cta]');
    var icons = overlay.querySelectorAll('button svg');
    for (var m = 0; m < icons.length; m++) {
      if (cta && cta.contains(icons[m])) continue;
      icons[m].setAttribute('data-sb-icon', '');
    }
  };

  try { window.__sbCompact(); } catch (e) {}

  var pending = null;
  var observer = new MutationObserver(function () {
    if (pending) return;
    pending = setTimeout(function () {
      pending = null;
      try { window.__sbCompact(); } catch (e) {}
    }, 250);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
`;
