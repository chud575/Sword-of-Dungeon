# Sword of Fargoal — remake

A modern homage to the 1982 Epyx roguelike. Vite + Three.js 0.170, vanilla ES2022 modules, no
framework. HD-2D: a 3D diorama environment with 2D billboarded pixel-art characters, in the Octopath
Traveler model. Everything is procedural except one imported prop library, which ships bundled.

Run from `fargoal/`. `npm run dev` serves it; `npm test` is `node --test tests/`; `npm run smoke`
boots every scenario and fails on any console error.

## Read these before changing anything

- `docs/ARCHITECTURE.md` — the binding contract: file ownership, the `TILE` enum, entity shapes, the
  event list, the debug API. It governs; this file is the short version.
- `docs/DESIGN.md` — the design bible, from research on the original.
- `docs/AMBIENCE.md` — room archetypes and the decor data contract.
- `docs/LOCAL_SETUP.md` — tools, and an honest account of where the project stands.

## Rules that get broken most often

These are not style preferences. Each one has already cost a rebuild.

1. **No `Math.random()`.** Every random value comes from `core/rng.js`, seeded. Same seed must give
   the same dungeon and the same run — the QA bots and the screenshot tests depend on it. Fork a new
   stream with `seedFrom(seed, 'label')` rather than drawing from an existing one, or you shift every
   placement downstream of it.
2. **One pixel grid.** `TEXELS_PER_TILE` is 32. The camera frustum is derived *from* an integer texel
   size, not the other way round. Floors, props and the cast must all land on the same grid; the
   moment one is resampled finer than the others it reads as two resolutions on one screen.
3. **The camera is orthographic** — a near-plan view, tilt user-adjustable around 17°. Anything
   reading `camera.fov` is a bug: it is `undefined` here and turns scale maths silently into `NaN`.
   Branch on `camera.isOrthographicCamera` and use `camera.top`/`camera.bottom`.
4. **Sheet-level metrics lie.** Measuring a sprite sheet or an atlas is not evidence about the
   screen; it was 3–10× optimistic when checked, and a sprite with 269 undeclared-black texels passed
   a sheet-level lint. Gate on `tools/audit.mjs`, which reads the real canvas back.
5. **Verify at the play camera.** A frame shot from a bestiary or preview camera does not tell you
   what the player sees. The atlas can be right and the frame still wrong — that is the current bug.
6. **Never leave the game broken.** `npm test` and `npm run smoke` both pass before you finish.

## Measuring instead of guessing

Every one of these boots a headless Chromium and renders real frames.

| command | what it tells you |
| --- | --- |
| `node tools/shot.mjs --scenario default --out shots/x.png` | one frame from a named scenario |
| `node tools/audit.mjs --scenario default` | `litMedian`, `edgeAlign`, `runTexels`, contact shadow, off real pixels |
| `node tools/lumen.mjs` | mean scene luminance and histogram — the board-bright meter |
| `node tools/tilepreview.mjs shots/tiles.png` | every floor style as a labelled field |
| `node tools/decordump.mjs --seed 7 --depth 8` | furniture placement as ASCII |
| `node tools/mapdump.mjs --seed 42 --depth 5` | level layout + stats as ASCII |
| `node tools/play.mjs` | scripted play, for the game loop |
| `node tools/bundle.mjs` | fold the build into one self-contained HTML file |

`src/debug/scenarios.js` lists ~90 scenarios. For art review: `default`, `dungeon-overview`,
`deep-level`, `treasure`, `temple`, `room-crypt`, `cavern`, `dressing`, `bestiary`.

Debug API in the browser: `?debug=1&seed=42&scenario=treasure` exposes `window.__game.debug`.

## Art direction

The reference is the HeroQuest board: every room one saturated colour-and-pattern field, corridors
one continuous pale cobble you trace the layout by, the wall band chunky near-white blocks framing
it. Bright and legible — no large dark areas. `src/render/tiles.js` authors that vocabulary and is
approved; do not restyle it.

## Where it stands

The authored tile atlas was reviewed at 8–9/10. The rendered frame was reviewed at **4/10** — the
transform between them is wrong, in four measured ways:

- ACES tone mapping at 0.92 exposure (`render/renderer.js`) delivers a cream corridor authored at
  luminance 0.82 to the screen at 0.29. Scene mean is 0.16; a board under room light is 0.5–0.6.
- Corridor 0.29 vs wall top 0.50 — inverted. The floor should be the light anchor.
- `depthTint` (`render/lighting.js`) applies band colour as a hue multiplier on albedo, so room
  fields vanish below depth 13: at depth 20 a tan-brick room is rgb(105,64,99) and the corridor
  beside it rgb(102,63,101).
- Pixels per texel is 2.008 horizontal, ~1.92 vertical after the tilt, so grout flickers 2–3px wide.

`tools/workflows/boardfix.js` targets all four with numeric gates.

**The largest untested area is the game itself.** No one has yet played a full run from level 1 down
to the Sword and back out. The art has been reviewed exhaustively; the loop has not been played end
to end even once. That is worth doing before any further art pass.
