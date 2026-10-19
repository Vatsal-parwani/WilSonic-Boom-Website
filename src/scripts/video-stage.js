/* ══════════════════════════════════════════════════════════════════════════
   HOME · SCROLL-LINKED VIDEO STAGE (INTEGRATED HERO)
   The hero's stage is taller than the screen and its pin is sticky, so
   scrolling through the extra height grows the video container from behind the
   "Wilsonic Boom." h1 up to the full 100vw × 100vh viewport.

   Initial Layering inside .plate--title:
   - Top Layer (z-index: 3):    [data-vtitle] ("Wilsonic Boom.")
   - Middle Layer (z-index: 2): [data-vframe] (scaled-down video container)
   - Bottom Layer (z-index: 1): [data-vbottom] (paragraph text + sponsor buttons)

   Scroll Behavior:
   - Bottom Layer: disappears immediately (opacity: 0, pointer-events: none)
     the moment scrolling begins.
   - Middle Layer: scales smoothly from behind the title to 100vw × 100vh.
   - Top Layer: fades out and drops below the video (z-index: 1) as the video
     scales up to full screen.
   ══════════════════════════════════════════════════════════════════════════ */

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

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function smooth(a, b, v) {
    var t = clamp((v - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function getVideoAspect() {
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      return video.videoHeight / video.videoWidth;
    }
    return 1080 / 1920; /* 0.5625: native 1920 × 1080 (16:9) aspect ratio */
  }

  /* Measure the title and plate inside the sticky pin so the video starts
     at its exact native 16:9 aspect ratio inside the .plate--title card behind
     "Wilsonic Boom." with a clear gap above the paragraph below it, and expands
     to 100vw × 100vh at (0, 0) of the viewport when progress reaches 1. */
  function measure() {
    if (!title || !pin || !plate || !frame) return;
    vw = window.innerWidth;
    vh = window.innerHeight;
    var aspect = getVideoAspect();
    /* Setting baseH = vw * aspect guarantees that at progress = 0 the scaled
       frame (w0 = S0 * vw, h0 = S0 * baseH) has the exact 16:9 native aspect
       ratio of the 1920×1080 video on every viewport size, never cropping
       the bottom subtitles. As progress -> 1, curH interpolates to vh. */
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
    S0 = clamp(targetW / vw, 0.22, 0.95);
    var w0 = S0 * vw;
    var h0 = S0 * baseH;

    /* Align the video frame on the left with the text (innerLeft), shifted 9px
       to the left in unscrolled format (along with the unmute button). */
    var frameCX = innerLeft + w0 * 0.5 - 9;
    DX0 = frameCX - vw * 0.5;

    /* Place the full 16:9 initial video frame cleanly below .serial */
    var serialEl = plate.querySelector('.serial');
    var serialBottom = serialEl
      ? (serialEl.getBoundingClientRect().bottom - pinRect.top)
      : (plateTop + 80);
    var gapAbove = vw <= 620 ? 10 : 14;
    var topBound = serialBottom + gapAbove;

    /* Frame top edge at topBound, bottom edge at frameBottom = topBound + h0 */
    titleCY = topBound + h0 * 0.5;
    var frameBottom = topBound + h0;

    /* Align the "Wilsonic Boom." header with the bottom of the video frame,
       ensuring the entire header remains inside the frame (topBound <= desiredTitleTop). */
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

    /* Bottom Layer: instantly disappears the moment scroll is triggered */
    var scrolled = progress > 0 || window.scrollY > stageTopVal;
    stage.classList.toggle('is-scrolling', scrolled);
    bottomEls.forEach(function (el) {
      el.style.opacity = scrolled ? '0' : '1';
      el.style.pointerEvents = scrolled ? 'none' : '';
    });

    /* Top Layer: fades out and falls below the video as it scales to full screen */
    if (title) {
      var out = smooth(0.55, 0.9, progress);
      title.style.opacity = (1 - out).toFixed(3);
      title.style.transform = 'scale(' + (1 + 0.12 * progress).toFixed(4) + ')';
      title.style.zIndex = out >= 0.95 ? '1' : '3';
      title.style.pointerEvents = 'none';
    }

    stage.classList.toggle('is-full', progress >= 0.999);
  }

  function update() {
    if (!reduced) {
      progress = clamp((window.scrollY - stageTopVal) / travelVal, 0, 1);
    }
    render();
  }

  function setFull() {
    measure();
    if (reduced) { progress = 1; render(); return; }
    /* 'instant' overrides the site's smooth-scroll, so the change is immediate */
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
