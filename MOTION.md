# Kokuro Motion System

One small layer, `motion/kokuro-motion.js`, drives all animation. Pages opt in with `data-k-*` attributes; no component carries its own animation code.

## Motion language: Claw, Ink, Type

| Motif | What it is | Where |
|---|---|---|
| **Slash** | A diagonal clip-path wipe, like a claw cut revealing the image | hero claw marks, collection tiles, product stage, custom examples, route transitions |
| **Ink** | Headline lines rise out of a mask; the brush underline draws left to right; slow crimson smoke (WebGL) drifts in the hero | hero and page titles, brush strokes, hero canvas |
| **Type** | Lines of display type move as units, never letter-by-letter DOM splits (safe with the component runtime) | all H1s |
| **Depth** | Layered parallax: photo drifts slowly, claw marks drift against it, kanji floats | hero, page banners, about, custom hero |
| **Touch** | Subtle pointer tilt on product media, magnetic primary buttons, cart badge pop | cards, product stage, CTAs |

Items revealed in the same scroll batch stagger automatically (`--k-m-stagger`), so grids and badge rows cascade with no per-item config.

## Attributes

```
data-k-reveal="rise|fade|line|slash|draw|pop"   once, on entering the viewport
data-k-delay="0.2"                              seconds, added to the batch stagger
data-k-parallax="0.12"                          drift as a fraction of height; negative drifts against the scroll
data-k-parallax-cover                           scale up slightly so drift never shows edges
data-k-tilt="4"                                 degrees; fine pointers only
data-k-magnetic="0.2"                           pull strength; fine pointers only
data-k-gl="ink"                                 lazy WebGL canvas
```

API: `KokuroMotion.transition({mode:'page'|'theme', swap})`, `.pulse(selector)`, `.scan()`, `.tier()`.

Tokens (`--k-m-*` in `theme/human.css`) hold duration, stagger, rise distance and easings. A theme overrides them to retime the entire site.

## Performance and accessibility rules (built in)

- **Content first.** Elements are hidden only after the script arms the page (`html.k-motion`), never under `prefers-reduced-motion` or print, and a failsafe disarms everything if no reveal fires within 4.5 s.
- **Tiers.** `none` (reduced motion): no hiding, no transitions, no WebGL. `lite` (Save-Data or 2 GB / 2-core devices): shorter reveals only, no parallax, tilt, magnetic, WebGL or GSAP. `full`: everything.
- **Pause when not visible.** Reveals, parallax and the WebGL loop are gated by IntersectionObserver; the WebGL loop also stops on hidden tabs.
- **Lazy WebGL.** `kokuro-gl.js` is fetched on idle only if a `data-k-gl` canvas exists, the tier is `full`, and the device is not a small touch screen. Half-resolution canvas, 30 fps cap, DPR capped at 1.25, self-disposing, context-loss safe. The CSS claw art beneath it is the fallback.
- **Never blocks buying.** Route transitions are about 0.85 s total and non-interactive overlay only. Cart, mini-cart and add-to-cart changes are instant; the cart page and forms have no reveals that gate interaction.
- **Independent transforms.** Reveals and parallax use the CSS `translate` and `scale` properties (not `transform`), so they never overwrite a component's own rotation or skew.

## Engines

- **Native (shipping now):** Web Animations API + IntersectionObserver. No dependencies.
- **GSAP + ScrollTrigger (optional, wired but not bundled):** GSAP was not available to install in this build environment, so the two vendor files are not in the project. To enable: upload `gsap.min.js` and `ScrollTrigger.min.js` as assets and paste their `/_blob/...` URLs into `config.gsap` and `config.scrollTrigger` at the top of `kokuro-motion.js`. When present they load lazily on idle (full tier only): ScrollTrigger supplies parallax progress, and GSAP runs the overlay clip-path timelines. That GSAP path has not been exercised yet.

## Evaluations

- **Three.js / React Three Fiber:** not used. R3F needs a React runtime (this storefront is not React) and Three costs about 150 KB gzipped for what is currently one 2D shader. Revisit only if a real 3D asset (wolf crest model, cloth) is commissioned. Raw WebGL covers the current need.
- **HyperFrames (HeyGen, open source):** renders HTML plus seekable GSAP timelines to deterministic MP4 through headless Chrome. It is an offline authoring tool, not a runtime dependency. Recommended use: render the Human to Furry transition and hero loops to MP4/WebM posters for social, ads and a video fallback on low-power devices. The loader already creates `window.__timelines` when GSAP loads, which is where HyperFrames expects timelines to register. Source: https://hyperframes.heygen.com/

## Human Mode to Furry Mode: the Matrix intro

Flow: Human Mode home -> secret button (`FurryPrompt`) -> full-screen Matrix intro -> Furry Mode home. Furry -> Human uses the short claw `page` transition and never replays the intro.

**Files**
- `motion/matrix-intro.js`: the supplied animation as an isolated component. Loaded only when the visitor clicks "Obviously." (`KokuroMotion.loadMatrixIntro()` injects it on demand).
- `FurryPrompt.dc.html`: the floating secret. Appears after ~3.5 s on the Human home only, dismissible (Esc or the close button; collapses to a small paw tab for the session).
- `FurryHome.dc.html`, `theme/furry.css`: the Furry theme (see below).
- `Main.dc.html`: `enterFurry()`, `exitFurry()`, mode persistence.

**Isolation.** The overlay renders inside a Shadow DOM host (`#kokuro-matrix-host`), so its CSS cannot reach the storefront and the storefront's CSS cannot reach it. No iframe. The original `CRTAudioEngine`, `MatrixRainEngine` and `TerminalSequenceController` are kept as supplied (messages, typing cadence, 2.2 s opening cursor, holds, katakana plus paw/bone glyphs, scanlines, vignette, refresh bar, green phosphor palette). Edits to original code are marked `// KOKURO:` (`CRTAudioEngine.dispose()`, `MatrixRainEngine.destroy()` plus a removable resize handler). The Tailwind HUD was replaced with three controls in the same palette: **Skip Intro** (visible from frame one), **Sound** toggle, and **Close**.

**Finish sequence.** Full terminal sequence (about 28 s), then `rainSeconds` more of rain, then the rain intensifies for `intensifyMs`, the theme swaps underneath, and the overlay fades over `fadeMs`. Skip swaps immediately with a short fade. Close (X) exits without switching modes. Original pacing is not accelerated; the only changes are the added tail.

**Options** (`KokuroMatrixIntro.play(options)`, defaults in `KokuroMatrixIntro.config`)

| Option | Default | Meaning |
|---|---|---|
| `rainSeconds` | 3 | rain time after the terminal ends |
| `intensifyMs` | 700 | rain brightens before the reveal |
| `fadeMs` | 1100 | overlay fade-out |
| `skipFadeMs` | 380 (config) | fade when skipped or closed |
| `reducedHoldMs` | 900 (config) | static frame length under reduced motion |
| `reduced` | false | static frame, no canvas, no audio |
| `messages` | the 4 originals | override the lines (array of 4) |
| `pageRoot` | `.k-root` | element made `inert` while the overlay is up |
| `onBeforeReveal` | none | called once while the overlay still covers the page |

`play()` returns `Promise<{ reason }>` with `reason` of `complete`, `skipped` or `closed`. A second `play()` while active returns the same promise (no duplicate loops).

**Events** on `window`: `kokuro:matrix:start`, `kokuro:matrix:rain`, `kokuro:matrix:beforereveal`, `kokuro:matrix:end` (`detail.reason` on end).

**Audio.** Off by default and never enabled by the click. The AudioContext is created only on the first Sound toggle, and is closed on complete, skip or close.

**Accessibility and cleanup.** Esc skips; Tab is trapped between the three controls; the storefront is `inert` and scroll-locked during playback; focus moves to the Furry hero title afterward. Reduced motion (`tier none`) shows one static "Knock, Knock, Pup." frame, then swaps, with no canvas or audio. On end, the rain loop is cancelled, the resize listener removed, the canvas freed, the audio context closed and the host removed.

**Relationship to the Furry theme.** The intro only calls `onBeforeReveal`; it knows nothing about themes. `Main.enterFurry()` supplies the swap (`theme: 'furry'`, saved to `localStorage['kokuro.mode.v1']`, restored on load without animation). Cart and product state are never reset. `KokuroApp.setTheme('furry' | 'human')`, `.enterFurry()` and `.exitFurry()` are the public hooks. If the intro script fails to load, `enterFurry()` falls back to the claw `theme` transition.

**Furry Mode scope.** Built: the Furry home (hero, species band, custom-print banner, Human Mode switch), `theme/furry.css` token overrides, header "Human Mode" button and "The Den" label. Every other page reuses the Human storefront under the furry tokens. The four species tiles are non-interactive concept art marked "Coming soon", because no species-tagged products exist. Hero and species art are concept crops from the supplied kit, not clean cutouts.

## Not verified

None of this has been rendered or profiled in a browser, including the Matrix intro, the prompt, and mode switching. Check on a real phone and a mid-range laptop: reveal timing, parallax smoothness, the hero canvas frame time, the transition cover, that nothing flashes hidden on route changes, rain frame rate, audio toggle, Skip, rapid clicks, and repeated Human/Furry switching.
