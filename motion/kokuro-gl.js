/* ==========================================================================
   KOKURO GL: lazy-loaded WebGL layer (loaded by kokuro-motion.js on demand)

   One effect: "ink", slow crimson smoke drifting through the dark side of
   the hero, nudged by the pointer. Raw WebGL, one full-screen triangle,
   no Three.js.

   Why not Three.js / React Three Fiber (evaluated):
     - R3F needs a React runtime; this storefront is not React.
     - Three.js costs roughly 150 KB gzipped for what is a single 2D
       fragment shader here. Revisit Three.js only if a real 3D asset
       (a wolf crest model, a cloth sim) is commissioned.

   Budget: half-resolution canvas, DPR capped at 1.25, 30 fps cap, loop
   runs only while on screen and the tab is visible, disposes itself if the
   canvas leaves the DOM or the context is lost. The CSS claw art under it
   is the fallback, and the canvas fades in only after a successful frame.
   ========================================================================== */
(function () {
  'use strict';
  if (window.KokuroGL) return;

  var VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
  var FS = [
    'precision mediump float;',
    'uniform vec2 u_res;uniform float u_t;uniform vec2 u_m;',
    'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
    ' return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}',
    'float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*n(p);p*=2.02;a*=.5;}return v;}',
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/u_res;',
    ' vec2 p=vec2(uv.x*u_res.x/u_res.y,uv.y)*2.4;',
    ' float t=u_t*.06;',
    ' vec2 q=vec2(fbm(p+vec2(0.,t)),fbm(p+vec2(5.2,1.3)-t));',
    ' float f=fbm(p+2.1*q+(u_m-.5)*.6);',
    ' float mask=smoothstep(.72,.0,uv.x)*(1.-uv.y*.55);',
    ' float ink=smoothstep(.42,.86,f)*mask;',
    ' float a=ink*.6;',
    ' vec3 col=mix(vec3(.50,.03,.06),vec3(.92,.10,.14),f);',
    ' gl_FragColor=vec4(col*a,a);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  }

  function mount(canvas) {
    var gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) { canvas.style.display = 'none'; return false; }

    var prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('link');
    } catch (e) { canvas.style.display = 'none'; return false; }
    gl.useProgram(prog);

    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    var uRes = gl.getUniformLocation(prog, 'u_res');
    var uT = gl.getUniformLocation(prog, 'u_t');
    var uM = gl.getUniformLocation(prog, 'u_m');
    gl.clearColor(0, 0, 0, 0);

    var running = false, visible = false, raf = 0, last = 0, shown = false;
    var t0 = performance.now();
    var mx = 0.5, my = 0.5, tx = 0.5, ty = 0.5;

    function resize() {
      var s = 0.5 * Math.min(window.devicePixelRatio || 1, 1.25);
      var w = Math.max(2, Math.round(canvas.clientWidth * s));
      var h = Math.max(2, Math.round(canvas.clientHeight * s));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; gl.viewport(0, 0, w, h); }
    }

    function frame(now) {
      raf = 0;
      if (!running) return;
      if (!canvas.isConnected) { dispose(); return; }
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return;
      last = now;
      resize();
      mx += (tx - mx) * 0.06; my += (ty - my) * 0.06;
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uT, (now - t0) / 1000);
      gl.uniform2f(uM, mx, my);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!shown) { shown = true; canvas.style.opacity = '1'; }
    }

    function sync() {
      var want = visible && !document.hidden;
      if (want && !running) { running = true; raf = requestAnimationFrame(frame); }
      else if (!want && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
    }

    var io = new IntersectionObserver(function (es) { visible = es[0].isIntersecting; sync(); });
    io.observe(canvas);
    document.addEventListener('visibilitychange', sync);

    var host = canvas.parentElement || canvas;
    function onMove(e) {
      var r = host.getBoundingClientRect();
      tx = (e.clientX - r.left) / Math.max(1, r.width);
      ty = 1 - (e.clientY - r.top) / Math.max(1, r.height);
    }
    host.addEventListener('pointermove', onMove, { passive: true });

    function dispose() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
      host.removeEventListener('pointermove', onMove);
      canvas.style.display = 'none';
      try { var ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); } catch (e) {}
    }
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); dispose(); });
    return true;
  }

  window.KokuroGL = { mount: mount };
})();
