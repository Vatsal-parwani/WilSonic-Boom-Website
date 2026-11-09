(function () {
  'use strict';

  var stage = document.querySelector('[data-vstage]');
  if (!stage) return;

  var pin = stage.querySelector('[data-vpin]');
  var plate = stage.querySelector('[data-vplate]');
  var frame = stage.querySelector('[data-vframe]');
  var video = stage.querySelector('[data-vvideo]');
  var title = stage.querySelector('[data-vtitle]');
  var btn = stage.querySelector('[data-vsound]');
  var label = stage.querySelector('[data-vsound-label]');
  var closeBtn = stage.querySelector('[data-vclose]');
  var bottomEls = Array.prototype.slice.call(stage.querySelectorAll('[data-vbottom]'));
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var vw = window.innerWidth;
  var vh = window.innerHeight;
  var baseH = vh;
  var S0 = 0.34;
  var DX0 = 0;
  var titleCY = vh / 2;
  var stageTopVal = 0;
  var travelVal = 1;
  var progress = 0;
  var forceClosed = false; // Tracks if user manually clicked close

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function smooth(a, b, v) {
    var t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function getVideoAspect() {
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      return video.videoHeight / video.videoWidth;
    }
    return 1080 / 1920;
  }

  function measure() {
    if (!title || !pin || !plate || !frame) return;
    vw = window.innerWidth;
    vh = window.innerHeight;
    var aspect = getVideoAspect();
    baseH = vw * aspect;

    var ledeEl = bottomEls[0];
    var prevTransform = title.style.transform;
    title.style.transform = 'none';
    title.style.marginTop = '0px';
    if (ledeEl) ledeEl.style.marginTop = '0px';

    var pinRect = pin.getBoundingClientRect();
    var plateRect = plate.getBoundingClientRect();
    var tRect = title.getBoundingClientRect();

    var plateLeft = plateRect.left - pinRect.left;
    var plateTop = plateRect.top - pinRect.top;
    frame.style.left = (-plateLeft) + 'px';
    frame.style.top = (-plateTop) + 'px';
    frame.style.width = vw + 'px';

    var plateStyle = window.getComputedStyle(plate);
    var padL = parseFloat(plateStyle.paddingLeft) || 0;
    var padR = parseFloat(plateStyle.paddingRight) || 0;
    var innerLeft = plateLeft + padL;
    var innerWidth = Math.max(220, plateRect.width - padL - padR);

    var targetW = innerWidth;
    S0 = clamp(targetW / vw, 0.05, 0.95);
    var w0 = S0 * vw;
    var h0 = S0 * baseH;

    var frameCX = innerLeft + w0 * 0.5 - 9;
    DX0 = frameCX - vw * 0.5;

    var serialEl = plate.querySelector('.serial');
    var serialBottom = serialEl
      ? (serialEl.getBoundingClientRect().bottom - pinRect.top)
      : (plateTop + 80);
    var gapAbove = vw <= 620 ? 10 : 14;
    var topBound = serialBottom + gapAbove;

    titleCY = topBound + h0 * 0.5;
    var frameBottom = topBound + h0;

    var titleH = tRect.height;
    var padBottomInsideFrame = 8;
    var desiredTitleBottom = frameBottom - padBottomInsideFrame;
    var desiredTitleTop = Math.max(topBound, desiredTitleBottom - titleH);

    var baseTitleTop = tRect.top - pinRect.top;
    var titleMarginTop = Math.max(0, Math.round(desiredTitleTop - baseTitleTop));
    title.style.marginTop = titleMarginTop + 'px';

    var newTitleBottom = baseTitleTop + titleMarginTop + titleH;
    if (ledeEl) {
      var gapBelow = vw <= 620 ? 20 : 26;
      var desiredLedeTop = Math.max(frameBottom, newTitleBottom) + gapBelow;
      var ledeMarginTop = Math.max(20, Math.round(desiredLedeTop - newTitleBottom));
      ledeEl.style.marginTop = ledeMarginTop + 'px';
    }

    title.style.transform = prevTransform;

    stageTopVal = stage.getBoundingClientRect().top + window.scrollY;
    travelVal = Math.max(1, stage.offsetHeight - vh);
  }

  function render() {
    var s = S0 + (1 - S0) * progress;
    var curH = baseH + (vh - baseH) * progress;
    var tx = DX0 * (1 - progress);
    var targetCY = titleCY + (vh / 2 - titleCY) * progress;
    var ty = targetCY - curH / 2;

    frame.style.height = curH.toFixed(2) + 'px';
    frame.style.setProperty('--s', s.toFixed(4));
    frame.style.transform =
      'translate3d(' + tx.toFixed(2) + 'px, ' + ty.toFixed(2) + 'px, 0) scale(' + s.toFixed(4) + ')';
    stage.style.setProperty('--p', progress.toFixed(4));

    var scrolled = (progress > 0 || window.scrollY > stageTopVal) && !forceClosed;
    stage.classList.toggle('is-scrolling', scrolled);
    bottomEls.forEach(function (el) {
      el.style.opacity = scrolled ? '0' : '1';
      el.style.pointerEvents = scrolled ? 'none' : '';
    });

    if (title) {
      var out = smooth(0.55, 0.9, progress);
      title.style.opacity = (1 - out).toFixed(3);
      title.style.transform = 'scale(' + (1 + 0.12 * progress).toFixed(4) + ')';
      title.style.zIndex = out >= 0.95 ? '1' : '3';
      title.style.pointerEvents = 'none';
    }

    stage.classList.toggle('is-full', progress >= 0.999 && !forceClosed);
    var isLarge = progress > 0.3 && !forceClosed;
    stage.classList.toggle('is-video-large', isLarge);
  }

  function update() {
    if (!reduced) {
      var currentScroll = window.scrollY;
      // If user scrolls back near the top, reset the force-closed state
      if (currentScroll <= stageTopVal + 20) {
        forceClosed = false;
        stage.classList.remove('is-force-closed');
      }
      // If forceClosed is true, lock progress at 0 (minimized)
      progress = forceClosed ? 0 : clamp((currentScroll - stageTopVal) / travelVal, 0, 1);
    }
    render();
  }

  function setFull() {
    measure();
    if (reduced) { progress = 1; render(); return; }
    window.scrollTo({ top: stageTopVal + travelVal, behavior: 'instant' });
    progress = 1;
    render();
  }

  /* ── sound ─────────────────────────────────────────────────────────────── */
  function syncButton() {
    var on = !video.muted;
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('is-on', on);
    if (label) label.textContent = on ? 'Mute' : 'Unmute';
  }

  if (btn && video) {
    btn.addEventListener('click', function () {
      if (video.muted) {
        video.muted = false;
        video.volume = 1;
        var p = video.play();
        if (p && p.catch) p.catch(function () { video.muted = true; syncButton(); });
        setFull();
      } else {
        video.muted = true;
      }
      syncButton();
    });
    syncButton();
  }

  /* ── close button handler ─────────────────────────────────────────────── */
  if (closeBtn) {
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();

      var oldScrollY = window.scrollY;
      var oldStageHeight = stage.offsetHeight;

      // Force video to minimize and collapse the scroll track
      forceClosed = true;
      stage.classList.add('is-force-closed');
      progress = 0;
      render();

      // Measure the new height and adjust scroll position to prevent any jump
      var newStageHeight = stage.offsetHeight;
      var heightDiff = oldStageHeight - newStageHeight;

      if (heightDiff > 0 && oldScrollY >= stageTopVal) {
        window.scrollTo({
          top: Math.max(stageTopVal, oldScrollY - heightDiff),
          behavior: 'instant'
        });
      }
    });
  }

  /* ── YouTube-Style Video Hover Controls ───────────────────────────────── */
  var playPauseBtn = stage.querySelector('#vid-playpause');
  var rewindBtn = stage.querySelector('#vid-rewind');
  var forwardBtn = stage.querySelector('#vid-forward');

  if (video) {
    if (rewindBtn) {
      rewindBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        video.currentTime = Math.max(0, video.currentTime - 5);
      });
    }

    if (forwardBtn) {
      forwardBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        video.currentTime = Math.min(video.duration || 0, video.currentTime + 5);
      });
    }

    if (playPauseBtn) {
      var playIcon = playPauseBtn.querySelector('.icon-play');
      var pauseIcon = playPauseBtn.querySelector('.icon-pause');

      function updatePlayPauseIcon() {
        if (video.paused) {
          if (playIcon) playIcon.style.display = 'block';
          if (pauseIcon) pauseIcon.style.display = 'none';
        } else {
          if (playIcon) playIcon.style.display = 'none';
          if (pauseIcon) pauseIcon.style.display = 'block';
        }
      }

      playPauseBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (video.paused) {
          video.play();
        } else {
          video.pause();
        }
        updatePlayPauseIcon();
      });

      video.addEventListener('play', updatePlayPauseIcon);
      video.addEventListener('pause', updatePlayPauseIcon);

      updatePlayPauseIcon();
    }
  }

  /* ── don't decode a video nobody can see ───────────────────────────────── */
  if (video && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { var p = video.play(); if (p && p.catch) p.catch(function () {}); }
        else video.pause();
      });
    }, { threshold: 0.01 }).observe(stage);
  }

  /* ── wiring ────────────────────────────────────────────────────────────── */
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', function () { measure(); update(); });
  window.addEventListener('load', function () { measure(); update(); });
  if (video) {
    video.addEventListener('loadedmetadata', function () { measure(); update(); });
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { measure(); update(); });
  }

  measure();
  update();
})();