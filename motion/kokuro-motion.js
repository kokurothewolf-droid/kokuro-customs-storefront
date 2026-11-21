/* ==========================================================================
   KOKURO MOTION SYSTEM  (v1)
   One small, declarative animation layer for the whole storefront.

   Pages opt in with data attributes. No component owns animation code.

     data-k-reveal="rise|fade|line|slash|draw|pop"   reveal once when scrolled into view
     data-k-delay="0.2"                              extra delay (seconds)
     data-k-parallax="0.12"                          scroll drift, fraction of height (negative = counter-drift)
     data-k-parallax-cover                           scale up slightly so the drift never exposes edges
     data-k-tilt="4"                                 pointer tilt in degrees (fine pointers only)
     data-k-magnetic="0.2"                           button pulls toward the pointer (fine pointers only)
     data-k-gl="ink"                                 lazy WebGL ink layer (see kokuro-gl.js)

   API (window.KokuroMotion):
     transition({ mode: 'page'|'theme', swap })      claw-slash wipe around a DOM swap
     pulse(selector)                                 tiny scale pop (cart badge)
     scan()                                          register new data-k-* elements
     tier()                                          'full' | 'lite' | 'none'
     config                                          tokens, GSAP script URLs, asset URLs

   Principles
     1. Content is visible without this file. Elements are only hidden once
        the script has armed itself (html.k-motion) and are force-revealed
        by a failsafe if reveals never fire.
     2. Core effects use the Web Animations API and CSS independent transform
        properties (translate, scale), so they never overwrite a component's
        own transform. GSAP and ScrollTrigger are optional enhancements:
        ScrollTrigger drives parallax progress and GSAP drives the overlay
        timelines when the two vendor files are present (config.gsap).
     3. Nothing runs while off screen: IntersectionObserver gates reveals,
        parallax, tilt and the WebGL loop; hidden tabs pause everything.
     4. prefers-reduced-motion = no hiding, no transitions, no WebGL.
     5. Timings and easings come from --k-m-* tokens in the active theme, so
        a future theme (Furry Mode) can retime the whole site from CSS.
   ========================================================================== */
(function () {
  'use strict';
  if (window.KokuroMotion) return;

  var doc = document;
  var root = doc.documentElement;
  var self = doc.currentScript;
  var BASE = self && self.src ? self.src : '';

  /* ---- configuration ------------------------------------------------- */
  var config = {
    // Upload gsap.min.js and ScrollTrigger.min.js as assets, then paste the
    // returned /_blob/<id> URLs here. Both are optional; leave '' to run on
    // the native engine only.
    gsap: '',
    scrollTrigger: '',
    claw: './assets/93eba917cff886a4ae1ea570c6b387ab.svg',
    glFile: 'kokuro-gl.js'
  };

  /* ---- capability tier ----------------------------------------------- */
  var reduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var coarse = window.matchMedia ? matchMedia('(pointer: coarse)').matches : false;
  var nav = navigator;
  var saveData = !!(nav.connection && nav.connection.saveData);
  var lowEnd = !!((nav.deviceMemory && nav.deviceMemory <= 2) || (nav.hardwareConcurrency && nav.hardwareConcurrency <= 2));

  function tier() {
    if (reduce.matches || !doc.documentElement.animate) return 'none';
    if (saveData || lowEnd) return 'lite';
    return 'full';
  }
  var T = tier();

  /* ---- tokens (read from the active theme) --------------------------- */
  function tok(name, fb) {
    try {
      var v = getComputedStyle(root).getPropertyValue(name).trim();
      return v || fb;
    } catch (e) { return fb; }
  }
  function num(name, fb) { var n = parseFloat(tok(name, '')); return isNaN(n) ? fb : n; }
  function tokens() {
    return {
      dur: num('--k-m-dur', 0.9),
      stagger: num('--k-m-stagger', 0.07),
      rise: num('--k-m-rise', 40),
      ease: tok('--k-m-ease', 'cubic-bezier(.16,1,.3,1)'),
      easeIO: tok('--k-m-ease-io', 'cubic-bezier(.76,0,.24,1)'),
      gsapEase: tok('--k-m-gsap-ease', 'expo.out'),
      gsapEaseIO: tok('--k-m-gsap-ease-io', 'expo.inOut'),
      accent: tok('--k-accent', '#D71925'),
      bg: tok('--k-bg', '#0B0B0B')
    };
  }
  config.tokens = tokens;

  /* ---- arming -------------------------------------------------------- */
  var armed = false;
  var revealedSeen = false;
  function arm() { if (T !== 'none') { root.classList.add('k-motion'); armed = true; } }
  function disarm() { root.classList.remove('k-motion'); armed = false; }
  if (reduce.addEventListener) {
    reduce.addEventListener('change', function () { T = tier(); if (T === 'none') disarm(); else arm(); });
  }
  arm();
  // Failsafe: if no reveal ever fires, show everything.
  setTimeout(function () {
    if (armed && !revealedSeen && doc.querySelector('[data-k-reveal]')) disarm();
  }, 4500);

  /* ---- optional GSAP / ScrollTrigger (lazy) -------------------------- */
  var G = null, ST = null;
  function loadScript(src) {
    return new Promise(function (res) {
      if (!src) return res(false);
      var s = doc.createElement('script');
      s.src = src; s.async = true;
      s.onload = function () { res(true); };
      s.onerror = function () { res(false); };
      doc.head.appendChild(s);
    });
  }
  function idle(fn) { (window.requestIdleCallback || function (f) { return setTimeout(f, 220); })(fn); }
  function loadEngine() {
    if (T !== 'full' || !config.gsap) return;
    idle(function () {
      loadScript(config.gsap).then(function (ok) {
        if (!ok || !window.gsap) return;
        G = window.gsap;
        window.__timelines = window.__timelines || {}; // HyperFrames expects timelines here
        if (!config.scrollTrigger) return;
        return loadScript(config.scrollTrigger).then(function (ok2) {
          if (ok2 && window.ScrollTrigger) { G.registerPlugin(window.ScrollTrigger); ST = window.ScrollTrigger; rebindParallax(); }
        });
      });
    });
  }

  /* ---- reveal -------------------------------------------------------- */
  var tk = tokens();
  function keyframes(type) {
    var r = tk.rise;
    switch (type) {
      case 'fade': return { f: { opacity: 0 }, t: { opacity: 1 }, d: 0.8 };
      case 'line': return { f: { opacity: 1, translate: '0 112%' }, t: { opacity: 1, translate: '0 0' }, d: 1.05 };
      case 'slash': return { f: { opacity: 1, clipPath: 'polygon(0 0,0 0,-18% 100%,0 100%)', scale: '1.14' }, t: { opacity: 1, clipPath: 'polygon(0 0,118% 0,100% 100%,-18% 100%)', scale: '1' }, d: 1.15 };
      case 'draw': return { f: { opacity: 1, scale: '0 1' }, t: { opacity: 1, scale: '1 1' }, d: 0.9, origin: 'left center' };
      case 'pop': return { f: { opacity: 0, scale: '0.9' }, t: { opacity: 1, scale: '1' }, d: 0.7 };
      default: return { f: { opacity: 0, translate: '0 ' + r + 'px' }, t: { opacity: 1, translate: '0 0' }, d: tk.dur };
    }
  }

  function finish(el) { el.removeAttribute('data-k-run'); el.setAttribute('data-k-done', ''); }

  function runReveal(el, delay) {
    revealedSeen = true;
    if (T === 'none' || !el.animate) { finish(el); return; }
    var k = keyframes(el.getAttribute('data-k-reveal'));
    el.setAttribute('data-k-run', '');
    if (k.origin) el.style.transformOrigin = k.origin;
    var dur = T === 'lite' ? Math.min(k.d, 0.6) : k.d;
    var a;
    try {
      a = el.animate([k.f, k.t], { duration: dur * 1000, delay: delay * 1000, easing: tk.ease, fill: 'both' });
    } catch (e) { finish(el); return; }
    a.onfinish = function () { finish(el); try { a.cancel(); } catch (e) {} };
    a.oncancel = function () { finish(el); };
  }

  var queue = [];
  var holding = false;
  var rafQ = 0;
  function pos(a, b) { return a.compareDocumentPosition(b) & 4 ? -1 : 1; }
  function flush() {
    rafQ = 0;
    if (holding || !queue.length) return;
    var batch = queue.splice(0, queue.length).sort(pos);
    batch.forEach(function (el, i) {
      var extra = parseFloat(el.getAttribute('data-k-delay')) || 0;
      runReveal(el, Math.min(i * tk.stagger, 0.5) + extra);
    });
  }
  var io = null;
  function ensureIO() {
    if (io || !('IntersectionObserver' in window)) return;
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        queue.push(e.target);
      });
      if (queue.length && !rafQ) rafQ = requestAnimationFrame(flush);
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  }

  /* ---- parallax ------------------------------------------------------ */
  var para = []; // { el, amt, ratio, st, visible }
  function applyPara(p, progress) {
    var y = (progress - 0.5) * 2 * p.amt * 50; // percent of own height
    p.el.style.translate = '0 ' + y.toFixed(2) + '%';
  }
  function measure(p) {
    var r = p.el.parentElement ? p.el.parentElement.getBoundingClientRect() : p.el.getBoundingClientRect();
    var vh = window.innerHeight || 800;
    var prog = (vh - r.top) / (vh + r.height);
    return Math.max(0, Math.min(1, prog));
  }
  var paraRaf = 0;
  function paraTick() {
    paraRaf = 0;
    para.forEach(function (p) { if (p.visible && !p.st) applyPara(p, measure(p)); });
  }
  function onScroll() { if (!paraRaf && para.length) paraRaf = requestAnimationFrame(paraTick); }
  var paraIO = null;
  function registerParallax(el) {
    if (T !== 'full') return;
    var amt = parseFloat(el.getAttribute('data-k-parallax')) || 0;
    if (!amt) return;
    if (el.hasAttribute('data-k-parallax-cover')) el.style.scale = String(1 + Math.abs(amt) * 1.3);
    var p = { el: el, amt: amt, visible: false, st: null };
    para.push(p);
    if (!paraIO && 'IntersectionObserver' in window) {
      paraIO = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          for (var i = 0; i < para.length; i++) if (para[i].el === e.target) para[i].visible = e.isIntersecting;
        });
        onScroll();
      }, { rootMargin: '10% 0px 10% 0px' });
      doc.addEventListener('scroll', onScroll, { passive: true, capture: true });
      window.addEventListener('resize', onScroll, { passive: true });
    }
    if (paraIO) paraIO.observe(el); else p.visible = true;
    bindST(p);
    applyPara(p, measure(p));
  }
  function windowScrolls() {
    var se = doc.scrollingElement || root;
    return se.scrollHeight > (window.innerHeight || 0) + 8;
  }
  function bindST(p) {
    if (!ST || p.st || !windowScrolls()) return;
    try {
      p.st = ST.create({
        trigger: p.el.parentElement || p.el, start: 'top bottom', end: 'bottom top',
        onUpdate: function (self) { applyPara(p, self.progress); }
      });
    } catch (e) { p.st = null; }
  }
  function rebindParallax() { para.forEach(bindST); }

  /* ---- pointer effects (fine pointers, full tier) --------------------- */
  function registerTilt(el) {
    if (T !== 'full' || coarse) return;
    var max = parseFloat(el.getAttribute('data-k-tilt')) || 4;
    var raf = 0, rx = 0, ry = 0;
    function paint() { raf = 0; el.style.transform = 'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)'; }
    el.addEventListener('pointermove', function (e) {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      var r = el.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      ry = px * max * 2; rx = -py * max * 2;
      el.style.transition = 'transform .12s linear';
      if (!raf) raf = requestAnimationFrame(paint);
    });
    el.addEventListener('pointerleave', function () {
      rx = 0; ry = 0;
      el.style.transition = 'transform .7s ' + tk.ease;
      if (!raf) raf = requestAnimationFrame(paint);
    });
  }
  function registerMagnetic(el) {
    if (T !== 'full' || coarse) return;
    var k = parseFloat(el.getAttribute('data-k-magnetic')) || 0.2;
    el.addEventListener('pointermove', function (e) {
      var r = el.getBoundingClientRect();
      var dx = (e.clientX - (r.left + r.width / 2)) * k;
      var dy = (e.clientY - (r.top + r.height / 2)) * k;
      el.style.translate = dx.toFixed(1) + 'px ' + dy.toFixed(1) + 'px';
    });
    el.addEventListener('pointerleave', function () { el.style.translate = '0 0'; });
  }

  /* ---- lazy WebGL ----------------------------------------------------- */
  var glState = 0; // 0 none, 1 loading, 2 ready, -1 failed
  var glWaiting = [];
  function glOK() { return T === 'full' && (!coarse || window.innerWidth >= 900); }
  function registerGL(canvas) {
    if (!glOK()) return;
    glWaiting.push(canvas);
    if (glState === 2) return drainGL();
    if (glState === 1 || glState === -1) return;
    glState = 1;
    idle(function () {
      var src = BASE ? new URL(config.glFile, BASE).href : './motion/' + config.glFile;
      loadScript(src).then(function (ok) {
        glState = ok && window.KokuroGL ? 2 : -1;
        if (glState === 2) drainGL();
      });
    });
  }
  function drainGL() {
    while (glWaiting.length) {
      var c = glWaiting.shift();
      try { window.KokuroGL.mount(c); } catch (e) { c.style.display = 'none'; }
    }
  }

  /* ---- scanning ------------------------------------------------------- */
  var seen = typeof WeakSet === 'function' ? new WeakSet() : { has: function () { return false; }, add: function () {} };
  var SEL = '[data-k-reveal],[data-k-parallax],[data-k-tilt],[data-k-magnetic],[data-k-gl]';
  function scan() {
    ensureIO();
    var list = doc.querySelectorAll(SEL);
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.hasAttribute('data-k-reveal')) {
        if (io && armed) io.observe(el); else finish(el);
      }
      if (el.hasAttribute('data-k-parallax')) registerParallax(el);
      if (el.hasAttribute('data-k-tilt')) registerTilt(el);
      if (el.hasAttribute('data-k-magnetic')) registerMagnetic(el);
      if (el.getAttribute('data-k-gl')) registerGL(el);
    }
  }
  var scanRaf = 0;
  function scheduleScan() { if (!scanRaf) scanRaf = requestAnimationFrame(function () { scanRaf = 0; scan(); }); }

  function start() {
    scan();
    try { new MutationObserver(scheduleScan).observe(doc.body, { childList: true, subtree: true }); } catch (e) {}
    loadEngine();
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();

  /* ---- claw-slash transition director -------------------------------- */
  var PRESETS = {
    // route changes: quick, never blocks interaction for long
    page: { strips: 5, cover: 0.34, stagger: 0.045, hold: 0.07, uncover: 0.46, claw: false },
    // Human <-> Furry: long, cinematic, shows the claw mark at the swap
    theme: { strips: 8, cover: 0.85, stagger: 0.07, hold: 0.7, uncover: 1.1, claw: true }
  };
  var fx = null, stripEls = [], clawEl = null, running = false;

  function band(i, n, s) {
    var w = 100 / n, lx = i * w - 10, rx = (i + 1) * w + 10, sl = 16;
    if (s === 'collapsedL') return 'polygon(' + (lx + sl) + '% 0,' + (lx + sl) + '% 0,' + lx + '% 100%,' + lx + '% 100%)';
    if (s === 'collapsedR') return 'polygon(' + (rx + sl) + '% 0,' + (rx + sl) + '% 0,' + rx + '% 100%,' + rx + '% 100%)';
    return 'polygon(' + (lx + sl) + '% 0,' + (rx + sl) + '% 0,' + rx + '% 100%,' + lx + '% 100%)';
  }
  function buildFx(n) {
    if (!fx) {
      fx = doc.createElement('div');
      fx.id = 'k-fx';
      fx.setAttribute('aria-hidden', 'true');
      fx.style.cssText = 'position:fixed;inset:0;z-index:2147483000;pointer-events:none;display:none;overflow:hidden';
      clawEl = doc.createElement('img');
      clawEl.alt = ''; clawEl.src = config.claw;
      clawEl.style.cssText = 'position:absolute;left:50%;top:50%;width:min(72vmin,640px);height:auto;translate:-50% -50%;opacity:0';
      doc.body.appendChild(fx);
    }
    var t = tokens();
    while (stripEls.length < n) {
      var d = doc.createElement('div');
      d.style.cssText = 'position:absolute;inset:0;will-change:clip-path';
      fx.appendChild(d); stripEls.push(d);
    }
    stripEls.forEach(function (d, i) {
      d.style.display = i < n ? 'block' : 'none';
      d.style.background = i % 2 ? t.bg : t.accent;
    });
    if (clawEl.parentNode !== fx) fx.appendChild(clawEl);
    return t;
  }

  // One clip-path tween. GSAP when present, WAAPI otherwise.
  function clipTween(el, from, to, dur, delay, easeCss, easeG) {
    return new Promise(function (res) {
      if (G) {
        G.fromTo(el, { clipPath: from }, { clipPath: to, duration: dur, delay: delay, ease: easeG, onComplete: res });
      } else {
        el.style.clipPath = from;
        var a = el.animate([{ clipPath: from }, { clipPath: to }], { duration: dur * 1000, delay: delay * 1000, easing: easeCss, fill: 'both' });
        a.onfinish = function () { el.style.clipPath = to; try { a.cancel(); } catch (e) {} res(); };
      }
    });
  }
  function wait(s) { return new Promise(function (r) { setTimeout(r, s * 1000); }); }

  function transition(o) {
    o = o || {};
    var swapped = false;
    function swap() { if (swapped) return; swapped = true; try { (o.swap || function () {})(); } catch (e) { console.error(e); } }
    if (T === 'none' || running || doc.hidden || !doc.body || o.mode === 'none') { swap(); return Promise.resolve(); }
    var cfg = PRESETS[o.mode] || PRESETS.page;
    running = true; holding = true;
    var t = buildFx(cfg.strips);
    fx.style.display = 'block';
    var n = cfg.strips;

    var cover = Promise.all(stripEls.slice(0, n).map(function (d, i) {
      return clipTween(d, band(i, n, 'collapsedL'), band(i, n, 'full'), cfg.cover, i * cfg.stagger, t.easeIO, t.gsapEaseIO);
    }));
    return cover.then(function () {
      swap();
      var showClaw = Promise.resolve();
      if (cfg.claw && clawEl.animate) {
        clawEl.style.clipPath = 'polygon(0 0,0 0,-18% 100%,0 100%)'; clawEl.style.opacity = '1';
        showClaw = clipTween(clawEl, 'polygon(0 0,0 0,-18% 100%,0 100%)', 'polygon(0 0,118% 0,100% 100%,-18% 100%)', Math.min(0.6, cfg.hold), 0.05, t.ease, t.gsapEase);
      }
      return Promise.all([wait(cfg.hold), showClaw]);
    }).then(function () {
      holding = false; flush();
      clawEl.style.opacity = '0';
      return Promise.all(stripEls.slice(0, n).map(function (d, i) {
        return clipTween(d, band(i, n, 'full'), band(i, n, 'collapsedR'), cfg.uncover, i * cfg.stagger, t.easeIO, t.gsapEaseIO);
      }));
    }).catch(function (e) { swap(); console.error(e); }).then(function () {
      holding = false; flush();
      if (fx) fx.style.display = 'none';
      running = false;
    });
  }

  function pulse(sel) {
    if (T === 'none') return;
    var list = doc.querySelectorAll(sel);
    for (var i = 0; i < list.length; i++) {
      try { list[i].animate([{ scale: 1 }, { scale: 1.35 }, { scale: 1 }], { duration: 420, easing: 'cubic-bezier(.16,1,.3,1)' }); } catch (e) {}
    }
  }

  /* ---- Matrix intro (Human -> Furry), loaded only on activation ------- */
  var matrixP = null;
  function loadMatrixIntro() {
    if (window.KokuroMatrixIntro) return Promise.resolve(window.KokuroMatrixIntro);
    if (matrixP) return matrixP;
    var src = BASE ? new URL('matrix-intro.js', BASE).href : './motion/matrix-intro.js';
    matrixP = loadScript(src).then(function (ok) {
      if (!ok || !window.KokuroMatrixIntro) { matrixP = null; throw new Error('matrix-intro failed to load'); }
      return window.KokuroMatrixIntro;
    });
    return matrixP;
  }

  window.KokuroMotion = {
    version: 2,
    config: config,
    tier: function () { return T; },
    scan: scan,
    transition: transition,
    pulse: pulse,
    loadMatrixIntro: loadMatrixIntro,
    presets: PRESETS
  };
})();
