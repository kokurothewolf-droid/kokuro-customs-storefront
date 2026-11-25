/* ==========================================================================
   KOKURO SCROLL ACTS (scroll-craft kit, vanilla)
   Publishes scroll progress to the DOM so pages can build pinned acts, cues and
   lateral rails in plain CSS. It owns no layout. Safe to load once in <head>:
   it finds [data-act] elements live each frame, so pages that mount and unmount
   (the storefront router) need no wiring.

   Markup contract
     [data-act="pin"  style="--span:3"]  tall section holding a sticky .stage.
                                         --p goes 0..1 across the pinned travel.
     [data-act="pan"  style="--span:6"]  as pin, and its [data-rail] child is
                                         translated sideways by --p.
     [data-act="flow"]                   ordinary flow. --p goes 0..1 as the
                                         section crosses the viewport.
     [data-cue="0.2 0.8"]                inside an act: --c fades in over the
                                         ramp before 0.2 and out by 0.8.
                                         One value: in at that point, then stay.
                                         "0 0.8": visible on arrival.
     [data-rail-item]                    inside a rail: keyboard focus on it
                                         scrolls the page so it comes into view.

   Enhancement is opt-in per visitor: the script adds html.sc-on only when it
   will actually run. Without it (no JS, or prefers-reduced-motion) the page
   uses its static layout: no pinned scroll space, everything visible.

   Pointer depth (fine pointers only): --mx / --my on <html>, range -0.5..0.5.
   ========================================================================== */
(function () {
  'use strict';
  if (window.KokuroActs) return;
  var doc = document, root = doc.documentElement;
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var fine = window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  if (mq.matches) { root.classList.add('sc-static'); window.KokuroActs = { active: false }; return; }
  root.classList.add('sc-on');

  var clamp = function (v, a, b) { return Math.min(b === undefined ? 1 : b, Math.max(a === undefined ? 0 : a, v)); };
  var ease = function (t) { return t * t * (3 - 2 * t); };
  var queued = false;

  function parseCue(el) {
    var parts = (el.getAttribute('data-cue') || '').trim().split(/\s+/).map(Number);
    return { s: isFinite(parts[0]) ? parts[0] : 0, e: parts.length > 1 && isFinite(parts[1]) ? parts[1] : 9 };
  }

  function frame() {
    queued = false;
    var vh = window.innerHeight;
    var acts = doc.querySelectorAll('[data-act]');
    for (var i = 0; i < acts.length; i++) {
      var el = acts[i];
      var r = el.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) continue; // far from the viewport: skip
      var flow = el.getAttribute('data-act') === 'flow';
      var travel = r.height - vh;
      var p = flow ? clamp((vh - r.top) / (vh + r.height)) : clamp(travel > 0 ? -r.top / travel : 0);
      el.style.setProperty('--p', p.toFixed(4));
      var cues = el.querySelectorAll('[data-cue]');
      for (var j = 0; j < cues.length; j++) {
        var q = parseCue(cues[j]);
        var inn = q.s <= 0 ? 1 : clamp((p - q.s) / 0.06);
        var out = clamp((q.e - p) / 0.06);
        cues[j].style.setProperty('--c', ease(Math.min(inn, out)).toFixed(3));
      }
      var rail = el.querySelector('[data-rail]');
      if (rail) {
        var max = Math.max(0, rail.scrollWidth - el.clientWidth);
        rail.style.transform = 'translate3d(' + (-p * max).toFixed(1) + 'px,0,0)';
      }
    }
  }

  function queue() { if (!queued) { queued = true; requestAnimationFrame(frame); } }

  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  window.addEventListener('orientationchange', queue);
  window.addEventListener('load', queue);

  // Pages mount and unmount as the visitor navigates: recompute when the DOM changes.
  if (window.MutationObserver) {
    new MutationObserver(queue).observe(doc.documentElement, { childList: true, subtree: true });
  }

  // Keyboard users: focus inside a rail brings that item into view.
  doc.addEventListener('focusin', function (e) {
    var item = e.target.closest && e.target.closest('[data-rail-item]');
    if (!item) return;
    var act = item.closest('[data-act]');
    var rail = act && act.querySelector('[data-rail]');
    if (!rail) return;
    var max = rail.scrollWidth - act.clientWidth;
    var travel = act.offsetHeight - window.innerHeight;
    if (max <= 0 || travel <= 0) return;
    var centered = clamp((item.offsetLeft - (act.clientWidth - item.offsetWidth) / 2) / max);
    var top = act.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + centered * travel, behavior: 'auto' });
  });

  if (fine) {
    window.addEventListener('pointermove', function (e) {
      root.style.setProperty('--mx', (e.clientX / window.innerWidth - 0.5).toFixed(3));
      root.style.setProperty('--my', (e.clientY / window.innerHeight - 0.5).toFixed(3));
      queue();
    }, { passive: true });
  }

  window.KokuroActs = { active: true, refresh: queue };
  queue();
  // First paint after a route change can land before layout settles.
  setTimeout(queue, 120); setTimeout(queue, 600);
})();
