// ── Provider chrome: compact + next-episode gating ───────────────────────────
// Some embed providers (vidfast in particular) render a very large title card,
// an oversized centre play button and chunky control icons on top of the video.
// They also show a "Next Episode" button permanently, even for movies and even
// at the very start of an episode.
//
// The providers use Material UI with per-build emotion hashes (`.mui-1a2b3c`),
// so class selectors would break on their next deploy. Instead this script tags
// the relevant nodes structurally — the overlay next to <video>, its first
// text-only child (the title card), the largest <button> (centre CTA), the
// remaining icon buttons, and the button whose label reads "Next Episode" — and
// styles them through stable `data-sb-*` attributes that we own.
//
// Everything is best-effort: if a provider changes its markup the script simply
// tags nothing and the page looks untouched.

export const COMPACT_CHROME_SOURCES = ["vidfast"];

// How close to the end of an episode the provider's "Next Episode" button is
// allowed to appear, in seconds.
export const NEXT_EPISODE_THRESHOLD_SEC = 90;

export function buildPlayerChromeScript({
  hasNextEpisode = false,
  nextThresholdSec = NEXT_EPISODE_THRESHOLD_SEC,
} = {}) {
  const config = JSON.stringify({ hasNextEpisode, nextThresholdSec });

  return `
(function () {
  var CFG = ${config};

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
    '[data-sb-icon]{width:18px !important;height:18px !important;min-width:0 !important;min-height:0 !important;}',
    '[data-sb-next="off"]{display:none !important;}'
  ].join('\\n');

  function ensureStyle() {
    if (document.getElementById('__sb-compact-style')) return;
    var s = document.createElement('style');
    s.id = '__sb-compact-style';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  // Show the provider's next-episode button only when there really is a next
  // episode and the current one is nearly over.
  function syncNextButton() {
    var btn = document.querySelector('[data-sb-next]');
    if (!btn) return;
    var v = document.querySelector('video');
    var show = false;
    if (v && CFG.hasNextEpisode) {
      var duration = v.duration;
      var remaining = duration - v.currentTime;
      show =
        isFinite(duration) &&
        duration > 0 &&
        isFinite(remaining) &&
        remaining > 0 &&
        remaining <= CFG.nextThresholdSec;
    }
    btn.setAttribute('data-sb-next', show ? 'on' : 'off');
  }

  var wiredVideo = null;
  function wireVideo() {
    var v = document.querySelector('video');
    if (!v || v === wiredVideo) return;
    wiredVideo = v;
    var handler = function () { syncNextButton(); };
    v.addEventListener('timeupdate', handler);
    v.addEventListener('loadedmetadata', handler);
    v.addEventListener('durationchange', handler);
    handler();
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

    // "Next Episode" button — tagged so we can gate its visibility.
    if (!overlay.querySelector('[data-sb-next]')) {
      var all = overlay.querySelectorAll('button');
      for (var n = 0; n < all.length; n++) {
        var label = (all[n].textContent || '').trim();
        if (/next\\s*episode/i.test(label)) {
          all[n].setAttribute('data-sb-next', 'off');
          break;
        }
      }
    }

    // Remaining icon buttons: shrink the glyphs, leave the CTA's own icon alone
    // (it is already scaled with its button).
    var cta = overlay.querySelector('[data-sb-cta]');
    var icons = overlay.querySelectorAll('button svg');
    for (var m = 0; m < icons.length; m++) {
      if (cta && cta.contains(icons[m])) continue;
      icons[m].setAttribute('data-sb-icon', '');
    }

    wireVideo();
    syncNextButton();
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
}
