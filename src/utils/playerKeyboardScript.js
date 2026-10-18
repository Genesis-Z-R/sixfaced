// Unified in-player keyboard and skip controls script injected into player webviews
export const PLAYER_CONTROLS_SCRIPT = `
(function() {
  if (window.__playerControlsInjected) return;
  window.__playerControlsInjected = true;

  // Outline reset for clean focus
  var style = document.createElement('style');
  style.id = '__sb-player-style';
  style.innerHTML = [
    '*:focus, *:focus-visible { outline: none !important; box-shadow: none !important; }',
    'video:focus, video:focus-visible { outline: none !important; box-shadow: none !important; }',
    '@keyframes sbHudPop { 0% { transform: translate(-50%, -50%) scale(0.9); opacity: 0; } 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; } }'
  ].join('\\n');
  document.head.appendChild(style);

  var toastEl = null;
  var toastTimer = null;
  function showHudToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = '__sb-hud-toast';
      toastEl.style.cssText = [
        'position: fixed', 'top: 50%', 'left: 50%',
        'transform: translate(-50%, -50%)',
        'background: rgba(0, 0, 0, 0.82)', 'color: #ffffff',
        'border: 1px solid rgba(255, 255, 255, 0.2)',
        'padding: 12px 24px', 'border-radius: 12px',
        'font: 600 16px system-ui, -apple-system, sans-serif',
        'letter-spacing: 0.5px',
        'z-index: 2147483647', 'pointer-events: none',
        'opacity: 0', 'transition: opacity 0.15s ease, transform 0.15s ease',
        'box-shadow: 0 12px 36px rgba(0,0,0,0.7)',
        'backdrop-filter: blur(10px)',
        '-webkit-backdrop-filter: blur(10px)',
        'display: flex', 'align-items: center', 'gap: 8px'
      ].join(';');
      document.documentElement.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    toastEl.style.transform = 'translate(-50%, -50%) scale(1)';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() {
      if (toastEl) {
        toastEl.style.opacity = '0';
        toastEl.style.transform = 'translate(-50%, -50%) scale(0.95)';
      }
    }, 900);
  }

  // Floating skip buttons
  var BACK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.53"/><text x="13.5" y="15.5" text-anchor="middle" font-size="6.5" fill="currentColor" stroke="none" font-weight="800" font-family="system-ui,sans-serif">15</text></svg>';
  var FWD_SVG  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px"><polyline points="23 4 23 10 17 10"/> <path d="M20.49 15a9 9 0 1 1-.49-4.53"/><text x="10.5" y="15.5" text-anchor="middle" font-size="6.5" fill="currentColor" stroke="none" font-weight="800" font-family="system-ui,sans-serif">15</text></svg>';

  var wrap = document.createElement('div');
  wrap.id = '__skip-ui';
  wrap.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'bottom:0',
    'pointer-events:none', 'z-index:2147483646',
    'opacity:0', 'transition:opacity 0.25s ease'
  ].join(';');

  function makeBtn(seconds, svg, label, side) {
    var btn = document.createElement('button');
    btn.innerHTML = svg + '<span style="font-size:11px;font-family:system-ui,sans-serif">' + label + '</span>';
    btn.setAttribute('tabindex', '-1');
    btn.title = label;
    btn.style.cssText = [
      'pointer-events:auto', 'background:rgba(0,0,0,0.72)',
      'border:1px solid rgba(255,255,255,0.18)', 'border-radius:8px',
      'color:white', 'cursor:pointer', 'padding:10px 18px',
      'display:flex', 'align-items:center', 'gap:7px',
      'backdrop-filter:blur(6px)', '-webkit-backdrop-filter:blur(6px)',
      'transition:background 0.15s', 'font-size:12px'
    ].join(';');
    btn.style.position = 'absolute';
    btn.style.top = '50%';
    btn.style.transform = 'translateY(-50%)';
    if (side === 'left') btn.style.left = '24px';
    else btn.style.right = '24px';

    btn.onmouseenter = function() { btn.style.background = 'rgba(229,9,20,0.85)'; btn.style.borderColor = '#e5091466'; };
    btn.onmouseleave = function() { btn.style.background = 'rgba(0,0,0,0.72)'; btn.style.borderColor = 'rgba(255,255,255,0.18)'; };
    btn.onclick = function(e) {
      e.stopPropagation();
      seek(seconds);
      showSkipUi();
    };
    return btn;
  }

  wrap.appendChild(makeBtn(-15, BACK_SVG, '-15s', 'left'));
  wrap.appendChild(makeBtn(15,  FWD_SVG,  '+15s', 'right'));
  document.documentElement.appendChild(wrap);

  var idleTimer = null;
  function showSkipUi() {
    wrap.style.opacity = '1';
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function() { wrap.style.opacity = '0'; }, 2200);
  }
  document.addEventListener('mousemove', showSkipUi, true);

  function getVideo() {
    return document.querySelector('video');
  }

  function seek(delta) {
    var v = getVideo();
    if (!v) return;
    var dur = (v.duration && v.duration !== Infinity) ? v.duration : (v.currentTime + 3600);
    var target = Math.max(0, Math.min(dur, v.currentTime + delta));
    v.currentTime = target;
    v._lastUserSeek = Date.now();
    v._lastUserSeekTo = target;
    showHudToast((delta > 0 ? '+ ' : '- ') + Math.abs(delta) + 's');
  }

  function togglePlay() {
    var v = getVideo();
    if (!v) return;
    if (v.paused) {
      v.play().catch(function() {});
      showHudToast('▶ Play');
    } else {
      v.pause();
      showHudToast('⏸ Pause');
    }
  }

  function changeVolume(delta) {
    var v = getVideo();
    if (!v) return;
    v.muted = false;
    v.volume = Math.max(0, Math.min(1, Math.round((v.volume + delta) * 100) / 100));
    showHudToast('🔊 Volume ' + Math.round(v.volume * 100) + '%');
  }

  function toggleMute() {
    var v = getVideo();
    if (!v) return;
    v.muted = !v.muted;
    if (v.muted) {
      showHudToast('🔇 Muted');
    } else {
      showHudToast('🔊 ' + Math.round(v.volume * 100) + '%');
    }
  }

  function toggleFullscreen() {
    var v = getVideo();
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(function() {});
      showHudToast('Exit Fullscreen');
    } else {
      var target = (v && v.requestFullscreen) ? v : document.documentElement;
      target.requestFullscreen().catch(function() {});
      showHudToast('Fullscreen');
    }
  }

  function seekPercent(pct) {
    var v = getVideo();
    if (!v || !v.duration || v.duration === Infinity) return;
    var target = v.duration * pct;
    v.currentTime = target;
    v._lastUserSeek = Date.now();
    v._lastUserSeekTo = target;
    showHudToast('Jump to ' + Math.round(pct * 100) + '%');
  }

  // Smooth repeat throttle: allow rapid seeking when held, at most once per 80ms
  var lastKeyTime = 0;
  var MIN_REPEAT_INTERVAL = 80;

  document.addEventListener('keydown', function(e) {
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }

    var now = Date.now();
    if (e.repeat && (now - lastKeyTime < MIN_REPEAT_INTERVAL)) {
      return;
    }

    var code = e.code;
    var key = e.key;

    if (code === 'Space' || key === 'k' || key === 'K') {
      e.preventDefault();
      lastKeyTime = now;
      togglePlay();
      showSkipUi();
    } else if (code === 'ArrowLeft' || key === 'j' || key === 'J') {
      e.preventDefault();
      lastKeyTime = now;
      seek(-10);
      showSkipUi();
    } else if (code === 'ArrowRight' || key === 'l' || key === 'L') {
      e.preventDefault();
      lastKeyTime = now;
      seek(10);
      showSkipUi();
    } else if (code === 'ArrowUp') {
      e.preventDefault();
      lastKeyTime = now;
      changeVolume(0.1);
      showSkipUi();
    } else if (code === 'ArrowDown') {
      e.preventDefault();
      lastKeyTime = now;
      changeVolume(-0.1);
      showSkipUi();
    } else if (key === 'm' || key === 'M') {
      e.preventDefault();
      lastKeyTime = now;
      toggleMute();
      showSkipUi();
    } else if (key === 'f' || key === 'F') {
      e.preventDefault();
      lastKeyTime = now;
      toggleFullscreen();
    } else if (key >= '0' && key <= '9' && !e.repeat) {
      e.preventDefault();
      lastKeyTime = now;
      seekPercent(parseInt(key, 10) / 10);
      showSkipUi();
    }
  }, true);

  // Expose global controller for direct host script execution
  window.__streambertPlayer = {
    togglePlay: togglePlay,
    seek: seek,
    changeVolume: changeVolume,
    toggleMute: toggleMute,
    toggleFullscreen: toggleFullscreen,
    seekPercent: seekPercent,
    showHudToast: showHudToast
  };
})();
`;
