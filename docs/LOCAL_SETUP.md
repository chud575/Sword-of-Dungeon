# Running this locally

Everything below assumes a normal machine (macOS, Linux or WSL) with a real GPU. The project was
built inside a cloud container whose only WebGL was SwiftShader — software rasterisation on four
cores — which is why the screenshot and QA tooling has been the bottleneck all along. On a machine
with hardware GL the same tools run roughly an order of magnitude faster, and that is the entire
reason for moving.

## 1. Get it

```sh
git clone https://github.com/chud575/neural-razz-arena.git
cd neural-razz-arena
git checkout claude/sword-of-fargoal-remake-nahftb
cd fargoal
```

The clone is small — about 10 MB of git history and 124 tracked files. The heavy things
(`node_modules/`, `dist/`, `shots/`) are all generated and all ignored.

## 2. Install

Node 20 or newer; it was developed on Node 22.

```sh
npm install
npx playwright install chromium
```

That second line is the one step the container could not do — it ships Chromium at a fixed path and
forbids the download. `tools/browser.mjs` now uses the pinned path only when it actually exists and
otherwise lets Playwright resolve its own browser, so the same tools work in both places. Set
`CHROMIUM_PATH=/path/to/chrome` if you want to point at a specific binary.

## 3. Play it

```sh
npm run dev            # http://127.0.0.1:5173
```

Useful URL parameters: `?debug=1` exposes `window.__game.debug`, `&seed=42` pins the dungeon,
`&scenario=treasure` jumps straight into a named setup.

To get a single self-contained HTML file — the thing published as a shareable demo:

```sh
node tools/bundle.mjs                                    # dist/fargoal.html, artifact-ready
node tools/bundle.mjs dist/play.html --standalone        # opens by double-clicking
```

## 4. The tools that were slow and now are not

All of these boot a Vite server and a headless Chromium, render real frames, and read pixels back.
This is where the local speedup lands.

| command | what it does |
| --- | --- |
| `node tools/shot.mjs --scenario default --out shots/x.png` | one frame from a named scenario |
| `node tools/audit.mjs --scenario default` | screen-truth metrics off real pixels: `litMedian`, `edgeAlign`, `runTexels`, contact shadow |
| `node tools/lumen.mjs` | mean scene luminance and its histogram — the board-bright meter |
| `node tools/tilepreview.mjs shots/tiles.png` | every floor style as a labelled field |
| `node tools/decordump.mjs --seed 7 --depth 8` | furniture placement as ASCII |
| `node tools/mapdump.mjs` / `tools/flows.mjs` / `tools/play.mjs` | level layout, event flows, scripted play |
| `node tools/perf.mjs` | frame timing |
| `npm run smoke` | boots every scenario and fails on any page error |
| `npm test` | `node --test tests/` |

There are ~90 named scenarios; `src/debug/scenarios.js` is the list. The ones that matter most for
art review are `default`, `dungeon-overview`, `deep-level`, `treasure`, `temple`, `room-crypt`,
`cavern`, `dressing`, `bestiary`.

## 5. Re-running the agent workflows

`tools/workflows/` holds the multi-agent scripts used to build this, kept because the prompts encode
a lot of hard-won specifics — measured failure numbers, the gates each round had to clear, and the
rules the art keeps breaking. They take their repo root from `FARGOAL_ROOT` or the working
directory. Run one from Claude Code with the `Workflow` tool:

```
Workflow({ scriptPath: "tools/workflows/boardfix.js" })
```

`boardfix.js` is the one that was in flight when the project moved and is the natural next thing to
run — see below.

## 6. Where the project actually stands

The last art director review scored the rendered frame **4/10**, and its diagnosis is specific and
worth not re-deriving:

- The tile atlas is right. The same critic scored the authored sheet 8–9/10 — all 22 HeroQuest
  fields correct. The problem is entirely in the transform between the atlas and the screen.
- **ACES tone mapping at 0.92 exposure is eating the palette** (`src/render/renderer.js`). A cream
  corridor authored at luminance 0.82 reaches the screen at 0.29. A board photo under room light
  sits at 0.5–0.6; we measure 0.16.
- **Corridor and wall values are inverted.** Wall tops 0.50, corridor floor 0.29 — so the wall mass
  reads as the floor, backwards from the board.
- **Below depth 13 the room fields vanish** (`depthTint` in `src/render/lighting.js`). At depth 20 a
  tan-brick room measures rgb(105,64,99) and the corridor beside it rgb(102,63,101).
- **Pixels per texel is not an integer** (`src/render/camera.js`): 2.008 horizontally, ~1.92
  vertically after the 17° tilt, so grout lines flicker between 2 and 3 px wide.

`tools/workflows/boardfix.js` targets exactly these with numeric gates (mean luminance > 0.45, under
3% near-black, corridor ≥ 0.70 with the wall band just below it, ≥ 30/255 separation between room
fields at depth 20).

Still untouched, and the biggest risk in the project: **nobody has played a full run from level 1
down to the Sword and back out.** The art has been reviewed to death; the game loop has not. That
is `tools/play.mjs` plus a bug-fix loop, and it wants doing before any more art passes.

## 7. Things worth knowing before you change anything

- `docs/ARCHITECTURE.md` is the binding contract — file ownership, the `TILE` enum, entity shapes,
  the event list, the debug API. Read it first.
- `docs/DESIGN.md` is the design bible drawn from research on the 1982 original.
- `docs/AMBIENCE.md` is the room-archetype and decor spec.
- **No `Math.random()`.** Everything seeded through `core/rng.js`, or replays stop reproducing.
- **One pixel grid.** `TEXELS_PER_TILE` is 32 and the camera frustum is derived *from* an integer
  texel size, not the other way round. Breaking this is the single most common regression.
- The camera is **orthographic**. Anything reading `camera.fov` is a bug — it is `undefined` here
  and silently turns scale maths into `NaN`.
- **Sheet-level metrics lie.** This was proven twice: an art check reading the sprite sheet was
  3–10× optimistic versus the same sprite measured on screen. Gate on `tools/audit.mjs`, which reads
  the actual canvas back.
- Two stashes are parked on the branch (`git stash list`): an unfinished water/models refactor and
  some older partial edits. Neither is needed; drop them once you are sure.
