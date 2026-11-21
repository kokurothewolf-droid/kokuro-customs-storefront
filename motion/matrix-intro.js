/* ==========================================================================
   KOKURO MATRIX INTRO: Human Mode -> Furry Mode cinematic transition
   Lazy-loaded by KokuroMotion.loadMatrixIntro(); never loaded until a
   visitor activates the secret button.

   This file wraps the supplied animation ("the_matrix_wake_up_neo_digital_rain")
   as an isolated, reusable component:

     - Rendering lives in a Shadow DOM, so its CSS cannot touch the
       storefront and the storefront's CSS cannot touch it.
     - The three original engines are preserved: CRTAudioEngine,
       MatrixRainEngine, TerminalSequenceController. Their timing, messages,
       katakana + custom paw/bone glyphs, green phosphor palette, CRT
       scanlines/vignette/refresh bar and synthesized audio are unchanged.
       Every edit to original code is marked  // KOKURO:
     - New: lifecycle (play / skip / close), configurable finish sequence,
       focus management, reduced-motion path, full cleanup.

   Public API
     KokuroMatrixIntro.play(options) -> Promise<{ reason }>
       options.reduced        true = static frame, no canvas, no audio
       options.rainSeconds    rain time after the terminal finishes (default 3)
       options.intensifyMs    rain brightens before the reveal (default 700)
       options.fadeMs         overlay fades to reveal the page (default 1100)
       options.messages       override the 4 lines (defaults are the originals)
       options.onBeforeReveal called once, while the overlay still covers the
                              page. Swap the theme here.
     reason: 'complete' | 'skipped' | 'closed'
       closed = visitor exited; onBeforeReveal is NOT called.

   Window events (bubbling to window, detail = { reason? }):
     kokuro:matrix:start, kokuro:matrix:rain, kokuro:matrix:beforereveal,
     kokuro:matrix:end
   ========================================================================== */
(function () {
  'use strict';
  if (window.KokuroMatrixIntro) return;

  var CONFIG = {
    rainSeconds: 3,      // digital rain continues this long after the terminal finishes
    intensifyMs: 700,    // rain brightens, then the theme swaps underneath
    fadeMs: 1100,        // overlay fades out to reveal Furry Mode
    skipFadeMs: 380,     // quick fade when skipped
    reducedHoldMs: 900,  // static frame length under reduced motion
    fontsHref: 'https://fonts.googleapis.com/css2?family=Courier+Prime:wght@400;700&family=Share+Tech+Mono&display=swap'
  };

  /* ------------------------------------------------------------------------
     STYLES (original CRT styles preserved; html/body selectors became :host)
     ------------------------------------------------------------------------ */
  var CSS = [
    ':host{all:initial;position:fixed;inset:0;display:block;font-family:"Share Tech Mono","Courier New",monospace;color:#00ff41;}',
    '*{box-sizing:border-box;user-select:none;}',
    '#kmi{--phosphor-green:#00ff41;--phosphor-dim:#008f11;--phosphor-glow:rgba(0,255,65,.75);--terminal-phosphor:#96b8a2;--terminal-bloom:rgba(138,192,158,.45);--crt-bg:#020502;position:absolute;inset:0;background:#000;overflow:hidden;opacity:1;}',
    '#monitor-viewport{position:absolute;inset:0;background:radial-gradient(circle at center,#051107 0%,#010301 85%,#000 100%);overflow:hidden;display:flex;align-items:center;justify-content:center;}',
    '.crt-enabled #monitor-viewport::after{content:"";position:absolute;inset:0;pointer-events:none;z-index:30;background:radial-gradient(circle at center,transparent 62%,rgba(0,0,0,.45) 85%,rgba(0,0,0,.92) 100%);box-shadow:inset 0 0 80px rgba(0,0,0,.9);}',
    '.crt-enabled #scanlines{position:absolute;inset:0;pointer-events:none;z-index:25;background:linear-gradient(rgba(18,16,16,0) 50%,rgba(0,0,0,.38) 50%),linear-gradient(90deg,rgba(255,0,0,.03),rgba(0,255,0,.015),rgba(0,0,255,.03));background-size:100% 3px,6px 100%;animation:scanlineFlicker .14s infinite alternate;}',
    '.crt-enabled #refresh-bar{position:absolute;left:0;right:0;height:12%;background:linear-gradient(to bottom,transparent,rgba(0,255,65,.035),transparent);pointer-events:none;z-index:24;animation:refreshRoll 7s linear infinite;}',
    '@keyframes refreshRoll{0%{top:-15%}100%{top:115%}}',
    '@keyframes scanlineFlicker{0%{opacity:.93}100%{opacity:1}}',
    '#terminal-layer{position:absolute;inset:0;padding:clamp(24px,5vw,64px);z-index:15;display:flex;flex-direction:column;justify-content:flex-start;align-items:flex-start;transition:opacity .8s ease;}',
    '#terminal-line{font-family:"Courier Prime","Courier New",Courier,monospace;font-weight:700;font-size:clamp(1.3rem,2.9vw,2.35rem);letter-spacing:.03em;line-height:1.4;color:var(--terminal-phosphor);white-space:pre-wrap;word-break:break-word;max-width:90vw;}',
    '.crt-enabled #terminal-line{text-shadow:-.6px 0 1px rgba(110,210,155,.35),.6px 0 1px rgba(175,215,190,.3),0 0 5px rgba(150,195,168,.65),0 0 14px rgba(115,175,138,.35);filter:blur(.25px);}',
    '#cursor{display:inline-block;width:.56em;height:1.04em;background-color:var(--terminal-phosphor);vertical-align:-.15em;margin-left:3px;}',
    '.crt-enabled #cursor{box-shadow:0 0 5px rgba(150,195,168,.7),0 0 12px rgba(115,175,138,.4);}',
    '.cursor-blink{animation:blinkCursor .95s steps(1,end) infinite;}',
    '@keyframes blinkCursor{0%,49%{opacity:1}50%,100%{opacity:0}}',
    '#matrix-canvas{position:absolute;inset:0;width:100%;height:100%;z-index:10;opacity:0;transition:opacity .6s ease-in;}',
    '#matrix-canvas.active{opacity:1;}',
    '.crt-enabled #matrix-canvas{filter:contrast(1.12) brightness(1.06);}',
    /* KOKURO: finishing sequence (intensify, then fade) */
    '#kmi.intensify #matrix-canvas{filter:contrast(1.35) brightness(2) saturate(1.25);transition:opacity .6s ease-in,filter ' + 'var(--kmi-intensify,.7s) ease-in;}',
    '#flash{position:absolute;inset:0;z-index:28;pointer-events:none;opacity:0;background:radial-gradient(circle at center,rgba(190,255,205,.55),rgba(0,255,65,.18) 45%,transparent 75%);transition:opacity var(--kmi-intensify,.7s) ease-in;}',
    '#kmi.intensify #flash{opacity:1;}',
    '#kmi.fading{opacity:0;transition:opacity var(--kmi-fade,1.1s) ease-in-out;}',
    '#kmi.static *{animation:none!important;transition:none!important;}',
    /* KOKURO: controls, restyled in the same phosphor palette (replaces the Tailwind HUD) */
    '#hud{position:absolute;z-index:50;top:max(12px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;max-width:calc(100% - 24px);}',
    '#hud button{min-height:44px;padding:0 16px;display:inline-flex;align-items:center;gap:8px;background:rgba(0,0,0,.85);color:#6dffa1;border:1px solid rgba(0,255,65,.5);border-radius:10px;font:600 13px/1 "Share Tech Mono","Courier New",monospace;letter-spacing:.14em;text-transform:uppercase;cursor:pointer;box-shadow:0 0 18px rgba(0,255,65,.14);}',
    '#hud button:hover{background:rgba(0,70,22,.7);color:#d6ffe2;}',
    '#hud button:focus-visible{outline:3px solid #d6ffe2;outline-offset:3px;}',
    '#hud #btn-skip{background:rgba(0,90,30,.55);border-color:#00ff41;color:#d6ffe2;}',
    '#hud #btn-audio[aria-pressed="true"]{border-color:#00ff41;background:rgba(0,90,30,.55);}',
    '#hud #btn-close{padding:0 14px;}',
    '#audio-toast{position:absolute;z-index:40;left:50%;bottom:max(18px,env(safe-area-inset-bottom));transform:translateX(-50%);padding:8px 14px;border-radius:8px;background:rgba(0,0,0,.8);border:1px solid rgba(0,255,65,.4);color:#6dffa1;font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:0;transition:opacity .5s;pointer-events:none;text-align:center;}',
    '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;}',
    '@media (max-width:520px){#hud button{padding:0 12px;font-size:12px;letter-spacing:.1em;}}'
  ].join('\n');

  var HTML = [
    '<div id="kmi" class="crt-enabled">',
    '<main id="monitor-viewport">',
    '<canvas id="matrix-canvas" aria-hidden="true"></canvas>',
    '<section id="terminal-layer" aria-hidden="true"><div id="terminal-line"><span id="typed-text"></span><span id="cursor" class="cursor-blink"></span></div></section>',
    '<div id="refresh-bar"></div><div id="scanlines"></div><div id="flash"></div>',
    '</main>',
    '<p class="sr" id="kmi-desc"></p>',
    '<div id="audio-toast" aria-hidden="true">Sound is off. Unmute for CRT audio.</div>',
    '<nav id="hud" aria-label="Intro controls">',
    '<button id="btn-skip" type="button">Skip Intro</button>',
    '<button id="btn-audio" type="button" aria-pressed="false"><span id="audio-label">Sound Off</span></button>',
    '<button id="btn-close" type="button" aria-label="Exit and stay in Human Mode">&#10005;</button>',
    '</nav>',
    '</div>'
  ].join('');

  /* ------------------------------------------------------------------------
     1. ORIGINAL: PROCEDURAL WEB AUDIO SYNTHESIZER
     ------------------------------------------------------------------------ */
  class CRTAudioEngine {
    constructor() {
      this.ctx = null;
      this.enabled = false;
      this.humGain = null;
      this.humOsc1 = null;
      this.humOsc2 = null;
    }

    init() {
      if (this.ctx) return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      this.ctx = new AudioContextClass();

      // Master gain for continuous CRT electrical hum
      this.humGain = this.ctx.createGain();
      this.humGain.gain.value = 0.0;
      this.humGain.connect(this.ctx.destination);

      // 60Hz AC mains transformer hum (warm low triangle wave)
      this.humOsc1 = this.ctx.createOscillator();
      this.humOsc1.type = 'triangle';
      this.humOsc1.frequency.value = 60;

      // Subtle 120Hz harmonic
      this.humOsc2 = this.ctx.createOscillator();
      this.humOsc2.type = 'sine';
      this.humOsc2.frequency.value = 120;

      const subGain2 = this.ctx.createGain();
      subGain2.gain.value = 0.25;

      this.humOsc1.connect(this.humGain);
      this.humOsc2.connect(subGain2);
      subGain2.connect(this.humGain);

      this.humOsc1.start();
      this.humOsc2.start();
    }

    toggle() {
      this.enabled = !this.enabled;
      if (this.enabled) {
        this.init();
        if (this.ctx && this.ctx.state === 'suspended') {
          this.ctx.resume();
        }
        if (this.humGain && this.ctx) {
          this.humGain.gain.setTargetAtTime(0.022, this.ctx.currentTime, 0.25);
        }
      } else {
        if (this.humGain && this.ctx) {
          this.humGain.gain.setTargetAtTime(0.0, this.ctx.currentTime, 0.12);
        }
      }
      return this.enabled;
    }

    /**
     * Synthesizes a subtle, crisp terminal character blip + mechanical key click
     */
    playKeystroke(isSpace = false) {
      if (!this.enabled || !this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const now = this.ctx.currentTime;

      // Short filtered noise burst for tactile switch click
      const bufferSize = Math.floor(this.ctx.sampleRate * 0.018);
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.28));
      }

      const noise = this.ctx.createBufferSource();
      noise.buffer = noiseBuffer;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = isSpace ? 950 : 1650 + (Math.random() * 350 - 175);
      filter.Q.value = 2.4;

      const clickGain = this.ctx.createGain();
      clickGain.gain.setValueAtTime(0.055, now);
      clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.018);

      noise.connect(filter);
      filter.connect(clickGain);
      clickGain.connect(this.ctx.destination);
      noise.start(now);

      // Subtle phosphor terminal data chirp
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(isSpace ? 520 : 880 + Math.random() * 140, now);
      osc.frequency.exponentialRampToValueAtTime(320, now + 0.022);

      const blipGain = this.ctx.createGain();
      blipGain.gain.setValueAtTime(0.016, now);
      blipGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.022);

      osc.connect(blipGain);
      blipGain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.024);
    }

    /**
     * Synthesizes a subtle CRT static sweep when screen clears or transitions
     */
    playScreenClear() {
      if (!this.enabled || !this.ctx) return;
      if (this.ctx.state === 'suspended') this.ctx.resume();

      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(55, now + 0.09);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    }

    // KOKURO: full teardown. Silences, stops the oscillators and closes the
    // AudioContext so nothing keeps running after the intro ends.
    dispose() {
      this.enabled = false;
      try { if (this.humGain && this.ctx) this.humGain.gain.cancelScheduledValues(this.ctx.currentTime); } catch (e) {}
      try { if (this.humOsc1) this.humOsc1.stop(); } catch (e) {}
      try { if (this.humOsc2) this.humOsc2.stop(); } catch (e) {}
      try { if (this.ctx && this.ctx.state !== 'closed') this.ctx.close(); } catch (e) {}
      this.ctx = null; this.humGain = null; this.humOsc1 = null; this.humOsc2 = null;
    }
  }

  /* ------------------------------------------------------------------------
     2. ORIGINAL: MATRIX DIGITAL RAIN CANVAS ENGINE
     ------------------------------------------------------------------------ */
  class MatrixRainEngine {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.running = false;
      this.animationId = null;
      this.lastTime = 0;

      // Authentic glyph pool: Half-width Katakana + numerals + Matrix symbols + custom vector tokens
      const katakana = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ';
      const numbers = '0123456789';
      const symbols = ':=*+-<>¦｜çﾘｸ';
      this.textGlyphs = (katakana + numbers + symbols).split('');
      this.customTokens = ['__PAW__', '__BONE__'];

      this.columns = [];
      this.width = 0;
      this.height = 0;
      this.dpr = 1;

      this.resize();
      // KOKURO: keep a reference so destroy() can remove the listener
      this._onResize = () => this.resize();
      window.addEventListener('resize', this._onResize);
    }

    randomGlyph() {
      // ~22% chance to spawn a stylized digital paw print or bone glyph
      if (Math.random() < 0.22) {
        return Math.random() < 0.55 ? '__PAW__' : '__BONE__';
      }
      return this.textGlyphs[Math.floor(Math.random() * this.textGlyphs.length)];
    }

    /**
     * Draws a crisp, Matrix-styled vector paw print or bone inside a single character cell,
     * matching the exact stroke thickness, glow, and vertical bounds of adjacent katakana.
     */
    drawCustomGlyph(ctx, token, x, y, size) {
      const cx = x + size * 0.42;
      const cy = y + size * 0.52;
      const strokeW = Math.max(1.25, size * 0.095);

      ctx.save();
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineWidth = strokeW;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (token === '__PAW__') {
        // Stylized digital paw mark: geometric metacarpal pad + 4 crisp toe beans
        const padW = size * 0.21;
        const padH = size * 0.16;
        const padY = cy + size * 0.12;

        // Main central pad (stylized rounded triangle/trapezoid)
        ctx.beginPath();
        ctx.moveTo(cx, padY - padH * 0.85);
        ctx.quadraticCurveTo(cx + padW * 1.15, padY - padH * 0.15, cx + padW * 0.85, padY + padH * 0.75);
        ctx.quadraticCurveTo(cx, padY + padH * 0.45, cx - padW * 0.85, padY + padH * 0.75);
        ctx.quadraticCurveTo(cx - padW * 1.15, padY - padH * 0.15, cx, padY - padH * 0.85);
        ctx.closePath();
        ctx.fill();

        // Four toe beans arranged in an arc above the main pad
        const toes = [
          { dx: -0.25, dy: -0.04, rx: 0.068, ry: 0.095, rot: -0.28 },
          { dx: -0.095, dy: -0.21, rx: 0.072, ry: 0.105, rot: -0.1 },
          { dx: 0.095, dy: -0.21, rx: 0.072, ry: 0.105, rot: 0.1 },
          { dx: 0.25, dy: -0.04, rx: 0.068, ry: 0.095, rot: 0.28 }
        ];

        for (let t = 0; t < toes.length; t++) {
          const toe = toes[t];
          ctx.beginPath();
          ctx.ellipse(
            cx + size * toe.dx,
            cy + size * toe.dy,
            size * toe.rx,
            size * toe.ry,
            toe.rot,
            0,
            Math.PI * 2
          );
          ctx.fill();
        }
      } else if (token === '__BONE__') {
        // Stylized vertical/slightly tilted digital bone matching character cell proportions
        ctx.translate(cx, cy);
        ctx.rotate(-0.18);

        const halfLen = size * 0.27;
        const shaftW = size * 0.075;
        const knobR = size * 0.085;
        const knobOffset = size * 0.075;

        // Crisp outlined + inner-lit tech bone silhouette
        ctx.beginPath();
        // Left shaft up to top-left condyle
        ctx.moveTo(-shaftW, -halfLen + knobR * 0.5);
        ctx.arc(-knobOffset, -halfLen, knobR, Math.PI * 0.35, Math.PI * 1.75, false);
        ctx.arc(knobOffset, -halfLen, knobR, Math.PI * 1.25, Math.PI * 0.65, false);
        // Right shaft down to bottom-right condyle
        ctx.lineTo(shaftW, halfLen - knobR * 0.5);
        ctx.arc(knobOffset, halfLen, knobR, -Math.PI * 0.65, Math.PI * 0.75, false);
        ctx.arc(-knobOffset, halfLen, knobR, Math.PI * 0.25, -Math.PI * 0.35, false);
        ctx.closePath();

        ctx.stroke();
        // Subtle inner fill so it reads cleanly at small sizes without overpowering neighbors
        ctx.globalAlpha *= 0.45;
        ctx.fill();
      }

      ctx.restore();
    }

    resize() {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.width = window.innerWidth;
      this.height = window.innerHeight;

      this.canvas.width = Math.floor(this.width * this.dpr);
      this.canvas.height = Math.floor(this.height * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

      this.initColumns();
    }

    initColumns() {
      this.columns = [];
      // Base font size scales gracefully from mobile to 4K monitors
      const baseSize = Math.max(14, Math.min(20, Math.floor(this.width / 72)));
      const colCount = Math.ceil(this.width / baseSize);

      for (let i = 0; i < colCount; i++) {
        // Assign depth tier: 0 = distant/dim, 1 = standard, 2 = close/bright
        const depthRoll = Math.random();
        let depth = 1;
        if (depthRoll < 0.28) depth = 0;
        else if (depthRoll > 0.82) depth = 2;

        const fontSize = depth === 0 ? Math.floor(baseSize * 0.82) : (depth === 2 ? Math.floor(baseSize * 1.18) : baseSize);
        const maxRows = Math.ceil(this.height / fontSize) + 5;
        const trailLength = Math.floor(10 + Math.random() * (maxRows * 0.72));

        // Pre-populate column characters so mutations happen in place
        const chars = new Array(maxRows);
        for (let r = 0; r < maxRows; r++) {
          chars[r] = this.randomGlyph();
        }

        this.columns.push({
          x: i * baseSize + (baseSize - fontSize) * 0.5,
          yRow: -Math.floor(Math.random() * maxRows * 1.2), // Staggered start above screen
          speed: (depth === 0 ? 7 : depth === 2 ? 17 : 12) + Math.random() * 7, // rows per second
          accumulator: 0,
          fontSize,
          depth,
          trailLength,
          maxRows,
          chars
        });
      }
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.initColumns();
      this.canvas.classList.add('active');
      this.lastTime = performance.now();
      const loop = (now) => {
        if (!this.running) return;
        const dt = Math.min((now - this.lastTime) / 1000, 0.1);
        this.lastTime = now;
        this.updateAndDraw(dt);
        this.animationId = requestAnimationFrame(loop);
      };
      this.animationId = requestAnimationFrame(loop);
    }

    stop() {
      this.running = false;
      this.canvas.classList.remove('active');
      if (this.animationId) {
        cancelAnimationFrame(this.animationId);
        this.animationId = null;
      }
    }

    // KOKURO: stop the loop, detach the resize listener, free the canvas bitmap
    destroy() {
      this.stop();
      window.removeEventListener('resize', this._onResize);
      this.columns = [];
      try { this.canvas.width = 1; this.canvas.height = 1; } catch (e) {}
    }

    updateAndDraw(dt) {
      const ctx = this.ctx;

      // Deep black clear (since we render explicit decaying trails per column,
      // glyphs stay razor-sharp without muddy grey smudge buildup)
      ctx.fillStyle = '#010401';
      ctx.fillRect(0, 0, this.width, this.height);

      ctx.textBaseline = 'top';

      for (let i = 0; i < this.columns.length; i++) {
        const col = this.columns[i];
        col.accumulator += col.speed * dt;

        while (col.accumulator >= 1) {
          col.accumulator -= 1;
          col.yRow += 1;

          // Assign a fresh glyph at the new head position
          const headIdx = ((col.yRow % col.maxRows) + col.maxRows) % col.maxRows;
          col.chars[headIdx] = this.randomGlyph();

          // Reset stream smoothly to top once its entire tail exits the bottom
          if ((col.yRow - col.trailLength) * col.fontSize > this.height) {
            col.yRow = -Math.floor(Math.random() * 14);
            col.trailLength = Math.floor(10 + Math.random() * (col.maxRows * 0.72));
          }
        }

        // Occasional in-place glyph mutation inside the active trail (iconic Matrix detail)
        if (Math.random() < 0.22) {
          const randOffset = Math.floor(Math.random() * col.trailLength);
          const targetRow = col.yRow - randOffset;
          if (targetRow >= 0) {
            const idx = targetRow % col.maxRows;
            col.chars[idx] = this.randomGlyph();
          }
        }

        ctx.font = `bold ${col.fontSize}px "Share Tech Mono", monospace`;

        // Draw from tail to head so the glowing lead character sits cleanly on top
        const startRow = Math.max(0, col.yRow - col.trailLength);
        const endRow = Math.min(col.maxRows - 1, col.yRow);

        for (let r = startRow; r <= endRow; r++) {
          const distFromHead = col.yRow - r;
          const yPos = r * col.fontSize;
          if (yPos > this.height) break;

          const glyph = col.chars[r % col.maxRows];

          if (distFromHead === 0) {
            // Lead character: bright white-green phosphor flash
            ctx.shadowColor = col.depth === 0 ? 'rgba(0, 255, 65, 0.4)' : 'rgba(180, 255, 195, 0.95)';
            ctx.shadowBlur = col.depth === 2 ? 14 : (col.depth === 1 ? 9 : 4);
            ctx.fillStyle = col.depth === 0 ? '#7aff95' : '#e6ffea';
          } else {
            // Trailing glyphs: exponential brightness falloff
            ctx.shadowBlur = 0;
            const progress = 1 - (distFromHead / col.trailLength);
            const depthAlpha = col.depth === 0 ? 0.48 : (col.depth === 2 ? 1.0 : 0.82);
            const alpha = Math.max(0.04, Math.pow(progress, 1.45) * depthAlpha);

            if (distFromHead <= 2 && col.depth > 0) {
              ctx.fillStyle = `rgba(65, 255, 105, ${alpha.toFixed(3)})`;
            } else {
              ctx.fillStyle = `rgba(0, 225, 55, ${alpha.toFixed(3)})`;
            }
          }

          // Mirror horizontally on ~35% of columns for authentic Matrix glyph feel
          if (glyph === '__PAW__' || glyph === '__BONE__') {
            if (i % 3 === 0) {
              ctx.save();
              ctx.translate(col.x + col.fontSize * 0.84, yPos);
              ctx.scale(-1, 1);
              this.drawCustomGlyph(ctx, glyph, 0, 0, col.fontSize);
              ctx.restore();
            } else {
              this.drawCustomGlyph(ctx, glyph, col.x, yPos, col.fontSize);
            }
          } else if (i % 3 === 0) {
            ctx.save();
            ctx.translate(col.x + col.fontSize * 0.7, yPos);
            ctx.scale(-1, 1);
            ctx.fillText(glyph, 0, 0);
            ctx.restore();
          } else {
            ctx.fillText(glyph, col.x, yPos);
          }
        }
      }

      // Reset shadow state
      ctx.shadowBlur = 0;
    }
  }

  /* ------------------------------------------------------------------------
     3. ORIGINAL: "WAKE UP, FLOOF..." TERMINAL SEQUENCE CONTROLLER
        (messages, pacing and cadence untouched)
     ------------------------------------------------------------------------ */
  class TerminalSequenceController {
    constructor(typedEl, cursorEl, terminalLayerEl, audioEngine, onComplete) {
      this.typedEl = typedEl;
      this.cursorEl = cursorEl;
      this.terminalLayerEl = terminalLayerEl;
      this.audio = audioEngine;
      this.onComplete = onComplete;

      this.defaultMessages = [
        "Wake up, floof...",
        "The Matrix has you...",
        "Follow the white rabbit.",
        "Knock, Knock, Pup."
      ];
      this.messages = [...this.defaultMessages];
      this.abortController = null;
    }

    sleep(ms, signal) {
      return new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }

    clearScreen(playSound = true) {
      this.typedEl.textContent = '';
      if (playSound) this.audio.playScreenClear();
    }

    async typeText(text, baseSpeed, variance, signal) {
      // Solid cursor while actively typing
      this.cursorEl.classList.remove('cursor-blink');

      for (let i = 0; i < text.length; i++) {
        if (signal.aborted) return;
        const char = text[i];
        const prevChar = i > 0 ? text[i - 1] : '';
        this.typedEl.textContent += char;
        this.audio.playKeystroke(char === ' ');

        // Realistic human remote-operator typing cadence:
        // - Fast double-tap when repeating the same letter (e.g., 'oo', 'll', 'bb')
        // - Slight micro-hesitation before uppercase letters or after commas
        // - Rhythmic ellipsis dots ('...')
        let delay = baseSpeed + (Math.random() * variance * 2 - variance);
        if (char === prevChar && char !== '.') {
          delay *= 0.62;
        } else if (char === '.' && prevChar === '.') {
          delay = baseSpeed * 1.15 + Math.random() * 45;
        } else if (char === ',') {
          delay += 170;
        } else if (char === '.') {
          delay += 130;
        } else if (char === ' ') {
          delay += 55 + Math.random() * 45;
        } else if (char >= 'A' && char <= 'Z' && i > 0) {
          delay += 65;
        }

        await this.sleep(Math.max(38, delay), signal);
      }

      // Resume blinking once typing pauses
      this.cursorEl.classList.add('cursor-blink');
    }

    async run() {
      this.stop();
      this.abortController = new AbortController();
      const signal = this.abortController.signal;

      // Reset terminal visibility
      this.terminalLayerEl.style.opacity = '1';
      this.terminalLayerEl.style.pointerEvents = 'auto';
      this.cursorEl.style.display = 'inline-block';
      this.cursorEl.classList.add('cursor-blink');
      this.clearScreen(false);

      try {
        // 1. Initial blinking green block cursor on dark screen (2.2s)
        await this.sleep(2200, signal);

        // 2. "Wake up, floof..." — deliberate, slightly hesitant cadence
        await this.typeText(this.messages[0], 135, 55, signal);
        await this.sleep(2800, signal);
        this.clearScreen(true);
        await this.sleep(650, signal);

        // 3. "The Matrix has you..." — faster, smoother automated cadence
        await this.typeText(this.messages[1], 88, 30, signal);
        await this.sleep(2900, signal);
        this.clearScreen(true);
        await this.sleep(650, signal);

        // 4. "Follow the white rabbit." — crisp, steady cadence
        await this.typeText(this.messages[2], 78, 25, signal);
        await this.sleep(3100, signal);
        this.clearScreen(true);
        await this.sleep(500, signal);

        // 5. "Knock, Knock, Pup." — appears instantaneously on screen (just like the film)
        this.typedEl.textContent = this.messages[3];
        this.cursorEl.style.display = 'none';
        this.audio.playKeystroke(false);
        await this.sleep(2700, signal);

        // 6. Smooth transition into Phase 2 (Digital Rain)
        this.terminalLayerEl.style.opacity = '0';
        this.terminalLayerEl.style.pointerEvents = 'none';
        if (this.onComplete) this.onComplete();

      } catch (err) {
        if (err.name !== 'AbortError') console.error(err);
      }
    }

    stop() {
      if (this.abortController) {
        this.abortController.abort();
        this.abortController = null;
      }
    }

    hideImmediate() {
      this.stop();
      this.terminalLayerEl.style.opacity = '0';
      this.terminalLayerEl.style.pointerEvents = 'none';
    }
  }

  /* ------------------------------------------------------------------------
     4. KOKURO: LIFECYCLE (isolated mount, finish sequence, cleanup)
     ------------------------------------------------------------------------ */
  var current = null; // single-instance guard

  function ensureFonts() {
    if (document.getElementById('kokuro-matrix-fonts')) return;
    var l = document.createElement('link');
    l.id = 'kokuro-matrix-fonts'; l.rel = 'stylesheet'; l.href = CONFIG.fontsHref;
    document.head.appendChild(l);
  }

  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent('kokuro:matrix:' + name, { detail: detail || {} })); } catch (e) {}
  }

  function play(options) {
    // Prevent duplicated loops: a second call while active returns the same promise.
    if (current) return current.promise;

    var opt = Object.assign({}, CONFIG, options || {});
    var reduced = !!opt.reduced;
    var prevFocus = document.activeElement;
    var pageRoot = opt.pageRoot || document.querySelector('.k-root');
    var htmlEl = document.documentElement;
    var prevOverflow = htmlEl.style.overflow;
    var timers = [];
    var phase = 'terminal'; // terminal -> rain -> intensify -> fading -> done
    var revealed = false;
    var finished = false;
    var audio = null, rain = null, terminal = null;
    var resolveFn;
    var promise = new Promise(function (r) { resolveFn = r; });

    ensureFonts();

    var host = document.createElement('div');
    host.id = 'kokuro-matrix-host';
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', 'Furry Mode introduction');
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483200;';
    var sr = host.attachShadow({ mode: 'open' });
    sr.innerHTML = '<style>' + CSS + '</style>' + HTML;
    document.body.appendChild(host);

    var $ = function (id) { return sr.getElementById(id); };
    var root = $('kmi');
    var btnSkip = $('btn-skip'), btnAudio = $('btn-audio'), btnClose = $('btn-close');
    var audioLabel = $('audio-label'), toast = $('audio-toast');

    root.style.setProperty('--kmi-intensify', (opt.intensifyMs / 1000) + 's');
    root.style.setProperty('--kmi-fade', (opt.fadeMs / 1000) + 's');

    // Hide the storefront from sight, pointer and assistive tech while the overlay is up.
    function lockPage() {
      htmlEl.style.overflow = 'hidden';
      if (pageRoot) { pageRoot.setAttribute('inert', ''); pageRoot.setAttribute('aria-hidden', 'true'); }
    }
    function unlockPage() {
      htmlEl.style.overflow = prevOverflow;
      if (pageRoot) { pageRoot.removeAttribute('inert'); pageRoot.removeAttribute('aria-hidden'); }
    }
    lockPage();

    function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
    function clearTimers() { timers.forEach(clearTimeout); timers.length = 0; }

    function teardownEngines() {
      clearTimers();
      if (terminal) terminal.stop();
      if (rain) rain.destroy();
      if (audio) audio.dispose();
      terminal = null; rain = null; audio = null;
    }

    function destroy(reason) {
      if (finished) return;
      finished = true;
      phase = 'done';
      teardownEngines();
      document.removeEventListener('keydown', onKey, true);
      if (host.parentNode) host.parentNode.removeChild(host);
      unlockPage();
      current = null;
      emit('end', { reason: reason });
      if (typeof opt.onComplete === 'function') { try { opt.onComplete(reason); } catch (e) { console.error(e); } }
      resolveFn({ reason: reason });
    }

    function beforeReveal() {
      if (revealed) return;
      revealed = true;
      emit('beforereveal');
      if (typeof opt.onBeforeReveal === 'function') { try { opt.onBeforeReveal(); } catch (e) { console.error(e); } }
    }

    function fadeOut(ms, reason) {
      phase = 'fading';
      // Page becomes interactive as soon as the fade begins.
      host.style.pointerEvents = 'none';
      unlockPage();
      if (audio) { audio.dispose(); audio = null; }
      if (rain) { rain.destroy(); rain = null; }
      root.style.setProperty('--kmi-fade', (ms / 1000) + 's');
      void root.offsetWidth;
      root.classList.add('fading');
      later(function () { destroy(reason); }, ms + 60);
    }

    // ---- exits ---------------------------------------------------------
    function finish(reason) {
      if (finished || phase === 'fading') return;
      if (reason === 'closed') {
        teardownEngines();
        if (reduced) destroy('closed'); else fadeOut(CONFIG.skipFadeMs, 'closed');
        return;
      }
      teardownEngines();
      if (reason === 'skipped') {
        beforeReveal();
        if (reduced) destroy('skipped'); else fadeOut(CONFIG.skipFadeMs, 'skipped');
      }
    }

    function runFinishingSequence() {
      // Terminal done -> rain plays for `rainSeconds` -> intensify -> swap theme -> fade.
      phase = 'rain';
      emit('rain');
      later(function () {
        phase = 'intensify';
        root.classList.add('intensify');
        later(function () {
          beforeReveal();
          fadeOut(opt.fadeMs, 'complete');
        }, opt.intensifyMs);
      }, opt.rainSeconds * 1000);
    }

    // ---- keyboard: Esc skips, Tab is trapped inside the overlay ----------
    function onKey(e) {
      if (finished) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish('skipped'); return; }
      if (e.key !== 'Tab') return;
      var f = [btnSkip, btnAudio, btnClose];
      var active = sr.activeElement;
      var i = f.indexOf(active);
      e.preventDefault();
      if (e.shiftKey) f[(i <= 0 ? f.length : i) - 1].focus(); else f[(i + 1) % f.length].focus();
    }
    document.addEventListener('keydown', onKey, true);

    btnSkip.addEventListener('click', function () { finish('skipped'); });
    btnClose.addEventListener('click', function () { finish('closed'); });

    var messages = (opt.messages && opt.messages.length === 4) ? opt.messages : null;
    var desc = $('kmi-desc');

    emit('start');

    try { btnSkip.focus({ preventScroll: true }); } catch (e) {}

    if (reduced) {
      // Reduced motion: one static frame with the final line, no canvas, no audio, no animation.
      root.classList.add('static');
      btnAudio.hidden = true;
      $('typed-text').textContent = (messages || ['', '', '', 'Knock, Knock, Pup.'])[3];
      $('cursor').style.display = 'none';
      $('terminal-layer').style.opacity = '1';
      desc.textContent = 'Switching to Furry Mode.';
      later(function () { beforeReveal(); destroy('complete'); }, opt.reducedHoldMs);
    } else {
      audio = new CRTAudioEngine(); // starts muted: enabled === false until the visitor toggles it
      rain = new MatrixRainEngine($('matrix-canvas'));
      terminal = new TerminalSequenceController($('typed-text'), $('cursor'), $('terminal-layer'), audio, function () {
        rain.start();
        runFinishingSequence();
      });
      if (messages) terminal.messages = messages.slice();
      desc.textContent = 'Introductory animation: ' + terminal.messages.join(' ') + ' Use Skip Intro to continue to Furry Mode.';

      btnAudio.addEventListener('click', function () {
        if (!audio) return;
        var on = audio.toggle();
        btnAudio.setAttribute('aria-pressed', on ? 'true' : 'false');
        audioLabel.textContent = on ? 'Sound On' : 'Sound Off';
        toast.style.opacity = '0';
      });

      terminal.run();

      // Original behaviour: a brief hint that audio is optional.
      later(function () {
        if (audio && !audio.enabled) {
          toast.style.opacity = '1';
          later(function () { toast.style.opacity = '0'; }, 3800);
        }
      }, 900);
    }

    current = { promise: promise, skip: function () { finish('skipped'); }, close: function () { finish('closed'); } };
    return promise;
  }

  window.KokuroMatrixIntro = {
    version: 1,
    config: CONFIG,
    play: play,
    isActive: function () { return !!current; },
    skip: function () { if (current) current.skip(); },
    close: function () { if (current) current.close(); }
  };
})();
