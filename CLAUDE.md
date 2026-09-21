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
2. **THE PIXEL GRID IS RETIRED: every sprite is a QUAD ON THE FLOOR** (2026-09-20, owner: "let's remove
   the pixel grid and get everything onto a quad the way it should be"). The cast, the props and the
   pickups are quads lying in the floor plane, sized in TILES from their own texels
   (`render/sprites/spriteBillboard.js` WORLD_QUADS, `render/props.js` `worldQuadSprite`,
   `render/props/atlas2d.js` `buildGroundSprite`). Nothing is sized in device pixels, nothing snaps to a
   texel lattice, and the camera does not snap either. `?quads=0` restores the old screen-space path.
   **Why**: under the owner's camera — perspective, tilt 0 — the screen-space machinery could not be made
   to hold still. Each fix moved the wobble somewhere else: the camera snapped to the wrong grid (2 device
   px against the cast's 3 at 2x), the pivot snapped to pixels rather than texels (a third of a texel of
   crawl per frame), and the snap itself hunted at the end of every camera tween (0.0313 world units of
   movement in the last 30 frames of a settle, against 0.006 unsnapped). A quad in the world resamples
   exactly as the flagstones do — not at all — and the wobble ended the moment the art stopped being
   measured in screen pixels. The gates moved with it: `tools/audit.mjs` `gridOf` reads a sprite's grid off
   its projected corners (affine, the play camera is orthographic), and the `off-grid` sabotage is skipped
   because there is no per-sprite texel size left to corrupt.
3. **The old pixel grid, kept for `?quads=0`.** `TEXELS_PER_TILE` is 32 and the camera
   frustum is derived *from* an integer texel size, not the other way round. Flat art on quads — the
   cast, the pickup sprites, the wall plates — is snapped to that grid in the vertex shader
   (`pixelSnap`, `render/props.js`), because its texels should land on whole pixels.
   **Solid modelled props are NOT snapped, by the owner's decision** (2026-09-16, "Straight 3d"): the
   floor field is not snapped either, so a snapped prop held still for two or three frames and then
   jumped a whole texel while the floor slid smoothly beneath it, and on screen the props wobbled and
   melted whenever the camera followed the hero. Measured at the play camera, walking a hundredth of a
   tile a step: floor 0.21px every step, the prop beside it 0, 0, 0.6, 0, 0, 0.6. Do not re-snap the
   kit or Freeport meshes to "fix" the audit's PROPS `onGrid`/`edgeAlign` row — that row rewards the
   very rounding that caused the bug. `?snap=rigid` and `?snap=vertex` restore the lattice for
   comparison, and `?camsnap=1` snaps the CAMERA to whole texels (which also cures the stutter, by
   stepping the whole frame in 2px units — rejected because scrolling then reads as chunky).
4. **Two projections, one pixel grid.** The default is orthographic — a near-plan view, tilt
   user-adjustable around 17° — but `CameraRig.setProjection('perspective')` swaps in a real
   `PerspectiveCamera(35, …)` and emits `camera:projection`; the renderer must rebind to the camera
   it returns. So `camera.fov` is `undefined` in the default mode and a real number in the other:
   never assume either, branch on `camera.isOrthographicCamera` and use `camera.top`/`camera.bottom`
   for scale maths. The whole-texel guarantee holds on the orthographic path **only**, and that is a
   deliberate trade, not a bug — see the note on `setProjection` in `render/camera.js`.
5. **Sheet-level metrics lie.** Measuring a sprite sheet or an atlas is not evidence about the
   screen; it was 3–10× optimistic when checked, and a sprite with 269 undeclared-black texels passed
   a sheet-level lint. Gate on `tools/audit.mjs`, which reads the real canvas back.
6. **Verify at the play camera.** A frame shot from a bestiary or preview camera does not tell you
   what the player sees. The atlas can be right and the frame still wrong — that is the current bug.
7. **The headless tools cannot see everything, and a green board is not a played game.** They drive
   a headless Chromium; the browser you play in has hardware GL and a multisampled composer target.
   A `pow()` of a negative base in `render/effects.js` blacked the WHOLE frame for 2-4 seconds at
   level-up, at a sacrifice, on finding the Sword, on death and on victory — and `npm test`,
   `npm run smoke` and every audit gate stayed green throughout, because none of them renders under
   MSAA on real hardware and none of them asks "is the frame black?". Open the game after a render
   change. See the header of `beamMaterial` for the mechanism.
8. **Never leave the game broken.** `npm run smoke` passes before you finish, and `npm test` is no
   worse than the baseline below — which is **not** currently zero. Check the baseline before you go
   looking for something you broke.
9. **`asleep` is a monster state, and its pace is not 0.** The AI runs
   `wander / lurk / search / hunt / flee / asleep / dead`; 45% of monsters start a level asleep
   (`AI.sleepChance`, `game/monsterAi.js`). Its pace is `0.6`, not `0`, because the pace gate decides
   whether `monsterAct` runs at all — at `0` a sleeper would never be asked whether anything woke it.

## Measuring instead of guessing

Every one of these boots a headless Chromium and renders real frames.

| command | what it tells you |
| --- | --- |
| `node tools/shot.mjs --scenario default --out shots/x.png` | one frame from a named scenario |
| `node tools/audit.mjs --scenario default` | `litMedian`, `edgeAlign`, `runTexels`, contact shadow, off real pixels |
| `node tools/lumen.mjs` | mean scene luminance and histogram (a lower mean is not a defect now — see Art direction) |
| `node tools/fieldpreview.mjs` | a level's painted floor field as a PNG, in node, no browser |
| `node tools/cast.mjs --depths 4,20` | how much of a floor field's OWN colour survives to the screen — the band-wash meter |
| `node tools/tilepreview.mjs shots/tiles.png` | every floor style as a labelled field |
| `node tools/decordump.mjs --seed 7 --depth 8` | furniture placement as ASCII |
| `node tools/mapdump.mjs --seed 42 --depth 5` | level layout + stats as ASCII |
| `node tools/play.mjs` | scripted play, for the game loop |
| `node tools/bundle.mjs` | fold the build into one self-contained HTML file |
| `node tools/propsheet.mjs` | every decor type and variant at the play camera, labelled with whose art drew it (`shots/props/`) |

`src/debug/scenarios.js` lists 84 scenarios. For art review: `default`, `dungeon-overview`,
`deep-level`, `treasure`, `temple`, `room-crypt`, `cavern`, `dressing`, `bestiary`.

Debug API in the browser: `?debug=1&seed=42&scenario=treasure` exposes `window.__game.debug`.

## Art direction

**Changed 2026-09-13.** The HeroQuest-board direction (saturated flat room fields, near-white wall
band, "bright board") is retired. The targets are now the user's painted concept panels, kept in
`docs/art-ref/`: `target-dungeon.png` for the dungeon, `target-forest.png` for the forest.
`topdown-map-x3.png` is drawn at nearly our camera angle — copy from it before the 45° panels.

- **The camera does not change** for the art: near-plan orthographic, tilt ~17°. We see TOPS. Brick
  courses on wall faces, tall silhouettes and long raking shadows cannot be copied; don't chase them.
- **Floor:** chunky irregular bevelled flagstones, several stones to a tile, so the 1m grid disappears.
  Stone width:height ≈ 0.85–1.5 — longer, thinner courses read as "brick wall laid flat", and that
  regression has happened twice. Rooms stay distinct by stone type and restrained tint.
- **Light:** warm orange torch pools (hue ~20–30°) against cool blue-grey stone. Moody is correct — a
  lower scene mean is not a defect; a dark FLOOR or near-black play area is.
- **A room's mood does NOT tint the frame** (2026-09-16, owner: "No global tone change at all"). The
  per-room mood used to multiply and colour the global key light — measured on seed 42 depth 1, ×1.00
  at #958c81 under `torchlit` against ×2.25 at #8abe96 under `fungal` and ×2.31 under `cold` — so
  walking one tile through a doorway reflipped the tone of the whole dungeon in a 0.45s sweep. A room
  is told by its own stone (its Dungeon Crawlers material) and the fires burning in it (`moodLights`,
  local point lights). Mood still sets the torch budget and the dust. `?moodkey=1` restores the old
  behaviour to compare; the note on `MOOD_ON_KEY` in `render/lighting.js` carries the measurements,
  and the pillow-gate lesson beneath it explains why room colour must not go on a point light or the
  hemisphere either.
- **Wall tops** lighter than the floor, but only ~1.3×, never a glare field.
- **Props:** solid, sheared low-poly pieces with a baked top-left light and a contact shadow, on the
  same 2px texel grid. Nothing flat is drawn on wall faces or as loud floor decals.
- **`?props=supplied`** (2026-09-17) dresses a level ONLY in art the owner supplied — their Top-Down
  Dungeons / Top-Down Interiors packs, imported by `tools/supplied-import/` into `src/assets/supplied/`,
  plus the Freeport models. Walls and the DC floor stay. A type the packs cannot cover draws **nothing**;
  it must never fall back to the kit or the billboards (`render/props/supplied.js` maps the vocabulary,
  `props/furniture.js` and `props/dressing.js` hold the line). Plate: `scenario=supplied-props`.
- **Lighting is a property of the WORLD, not of the hero or the camera** (2026-09-18, owner: "The hero is
  not the camera... these flickers, changes, etc should not be happening"). A wall torch is a fixed object,
  so nothing about it may answer to where the player is standing. Three things broke that rule and all three
  are fixed in `render/lighting.js`:
  - **Shadows come from `sun`**, a directional light with a CONSTANT direction (`SHADOW_TUNE`, default
    `source: 'world'`), carved out of the key's intensity by `share` so exposure does not move. The two old
    casters were the lantern spot parked at the hero and a spot that re-seated itself on his nearest torch —
    a spot is a POINT, so a prop's shadow swung around it as he walked past. Measured over a walk from x=10
    to x=32: the sun's direction changes **0.000°** (azimuth 32.1°, elevation 52.0°); the lantern spot swung
    up to **171.1°** for a fixed patch of floor. `?shadows=lantern|both|off` and the panel's `cast by` row restore the old casters to compare.
  - **The shadow frustum is quantised to whole shadow-map texels.** Letting it follow the view un-snapped was
    WORSE than the original bug — 1.24% of the frame changed as the hero moved, against 0.77% for the old
    caster — because the map's grid slid under every silhouette. Snapped: 0.46%, against 0.89% with shadows off.
  - **The torch pool is 8 slots (5 on `low`), ranked from `cameraRig.smoothTarget`, and `POOL_TUNE.ramp` is
    OFF.** 17 torches on seed 42 depth 1, 2-5 in frame at once and 4-7 counting those just off-frame whose pool
    still lands on visible floor: five slots could not cover it, and the ramp dimmed torches by the hero's
    distance to them. Gains now read 1,1,1,1,1,1,1,1 where they read 1,1,1,0.64,0.23.
  - **The billboards take ONE key direction and it must be `moon`.** `collectLights` used to keep whichever
    `DirectionalLight` `traverse` reached last, so adding the sun silently reshaded the entire cast to 52° at
    55% strength. A caster-only light sets `userData.shadowOnly`; `moon` publishes the undivided key as
    `userData.keyTotal`. The pillow gate reads 30 entries with HEAD's lighting, with the old casters and with
    the sun — this work moves it by nothing.
- **The level builder** (2026-09-19, `src/debug/levelBuilder.js`): Settings → Developer → Level builder, then
  Shift+B or the BUILD tab on the left edge. It edits `level.decor` and nothing else — place, drag, turn, footprint
  (`tilesX` × `tilesY`), `scale`, raise (`lift`), block, hide, clear, revert — using the optional fields documented
  in AMBIENCE §4.1. The world keeps running and WASD stays the game's while it is open; it takes only the mouse on the
  canvas. Pick by GEOMETRY, not by the floor tile under the cursor: this camera draws a standing piece's body a tile
  north of the tile it stands on. Edits save
  to localStorage keyed by `level.seed:depth` and come back whenever that level is entered, dev mode or not.
  **Where the props come from** (`tools/propsheet.mjs`, measured, 81 types / 238 variants): the owner's Freeport
  models draw 6 types, my procedural kit 50, my painted pixel art 10, and 15 draw nothing. The owner's Dungeon
  Crawlers library loads all 116 meshes and draws **none** of them in a generated level — the kit claims every
  type it maps first — so the builder offers its models by name (`art: 'dc'`). Freeport picks between its two
  chests and two braziers by TILE, not by variant, so a sheet shot on one tile only ever shows one of each pair.
- **Forest:** olive-to-yellow-lime grass with tufts and flowers, clumpy three-tone canopies darker and
  bluer than the grass, pale ruins, a winding stream with bridges where trails cross.

## Where it stands

A five-round floor / props / reviewer pass (2026-09-13) took the environment from roughly 3/10 to
7–8.5/10 against those targets, scored by a reviewer reading real play-camera frames:

| area | before | after |
| --- | --- | --- |
| dungeon floor | 4 | 7 |
| dungeon props | 3 | 8.5 |
| forest ground | 2 | 8 |
| forest props | 2 | 8 |

- **Floor** is one painted texture per level (`render/floorField.js`, preview with
  `node tools/fieldpreview.mjs`), not per-tile slabs; stones are laid per region and cross tile lines.
  `tools/tilepreview.mjs` still previews the old per-tile atlas, which now only feeds stair treads,
  pool kerbs and pit lips.
- **Props** are built from `render/props/kit.js` (painted atlas, shear, baked light) — dungeon pieces in
  `props/kitProps.js`, outdoor pieces in `props/forest.js`. The old painted billboards remain as the
  fallback and for tests; pickups are still billboards.
- **Gates the pass held to** (the meters were scratch scripts, not in the repo): tile-edge seam dip
  ≤0.12; ≤15% of the play area above luma 0.6; lit floors ≥0.12 and near-black ≤3% outside unexplored
  fog; torch-pool vs shade warmth split ≥0.17; audit PROPS onGrid ≥0.68 (was 0.41).
- **Not yet seen on real hardware.** Open Safari before trusting it: torch flicker across the pools
  (default's north wall tops are the most striped), the floor's highlight shoulder at level-up /
  sacrifice / Sword / death / victory, the pool softening's seven samples under real mipmapping,
  canopy and bridge-rail edges under MSAA, and depth 8/9/20 darkness.
- **Accepted residuals:** the default start room's pools sit at hue 30.9° and read slightly striped;
  stones stack in short vertical files in the guardroom and deep levels; the forest canopy would only
  improve further with a generated texture.

**The floor is now the user's own art (2026-09-14).** The default dungeon floor is the hand-painted tiles from their
earlier game, Dungeon Crawlers: `src/assets/tiles/dc/atlasN.png` (three rows of eight 128px tiles = six materials ×
four variants) with matching `atlasN_nrm.png` normal maps, one atlas per dungeon level (1–5, then round again).
Material 5 of each atlas (a brick or cobble run) paves the corridors; rooms take one of the other five. Loading,
per-material tone (`DC_TONE`: dark materials lifted, warm ones desaturated so torches don't blow them out) and the
normal-map green flip live in `render/paintedTiles.js`; laying them into the field is `paintPaintedTiles` in
`render/floorField.js`. `?tiles=painted` shows the generated flagstones instead; `?tiles=0` the procedural stone.
The user called these tiles "what was missing" — prefer their assets (Dropbox `Dungeon Crawlers/…/Atlases/`,
which also holds props, banners and decals) over generated or procedural art.

**The UI** is the user's "4a Worn vellum" design (2026-09-15): torn, slightly rotated vellum panels with burn and wear
textures, Pirata One headings and IM Fell English body — `src/ui/vellum.css` (`body.ui-vellum`), helpers in
`src/ui/theme.js` (ordinal words, roman numerals), textures in `src/assets/ui/`, fonts bundled in `src/assets/fonts/`
(SIL OFL, see FONTS.md). The design board lives in the handoff zip ("Fargoal UI Explorations.dc.html", option 4a).
`?ui=module` gives the TSR module-cover theme (`src/ui/module.css`; its Futura / Avenir fonts are Apple system fonts,
not bundled) and `?ui=classic` the original parchment HUD. **`?ui=booklet`** is the board's option 2c, the "module
booklet" (2026-09-17): cream paper panels in heavy ink with ink tab headers, Jost caps and Courier Prime numerals
(both bundled), a rust HP bar ticked in paper, a printer's-blue XP bar, a TSR-blue graph-paper minimap with a
`1 SQ = 10 FT` scale, and a chronicle numbered like a play log (`ui/log.js` stamps `data-n` on every line).
It sets `ui-booklet` ALONGSIDE `ui-module` and restyles that HUD rather than adding a third one, and it works by
INVERTING the cover's own tokens (`--mc-ink` becomes the paper, `--mc-paper` the ink) — override rule by rule
instead and you get cream text on cream paper, which is exactly how the first cut came out.
**`?ui=glass`** is option 2b, "ink on glass" (2026-09-17): smoked-dark translucent panels that recede into the
scene, a hairline tan frame over an inset double rule, cream type, Alegreya serif body and italics, Jost caps,
Courier Prime numerals, a rust HP bar ticked in the panel's own dark, a cream XP bar, hotkeys knocked out of cream
blocks, and the dark graph-paper map. It also rides on `ui-module`, but needs NO inversion — the cover is already
dark panels with cream type, so `ui/glass.css` only re-points the tokens. Both new themes share the bundled Jost /
Courier Prime; 2b adds Alegreya. Every theme is in Settings → Display → Interface style, which is how the iOS
build reaches them. The panels' shadows are box-shadows on pseudo-elements,
not `filter: drop-shadow` — keep it that way; Safari has already reloaded this page for memory use.

**Saves:** the game built at boot (behind the title screen) is marked `placeholder` and nothing saves it; before
that, every page load overwrote the player's quest (the title menu pauses the game and a pause autosaves).
`tests/saveGuard.test.js` holds the line.

Measure floor colour with `tools/cast.mjs` before believing anything about it.

### The band wash, and the three places it came from

The band colour was reaching the FIELDS through three separate multiplies, and each needed its own
cut. `tools/cast.mjs` measures what survives; `dHue` on the corridor (the largest continuous field,
so the least noisy row) roughly halved at both ends of the dungeon — 32.2 → 16.9 at depth 4 and
46.7 → 24.6 at depth 20.

1. **The band lights.** `depthTint`'s colours were used directly as the hemisphere and key light,
   and a light colour is a multiply on albedo — the shallow band's 0xa08a68 is a red:blue of 1.54
   applied to every surface underground. `bandLean()` (`render/lighting.js`) keeps the band's hue
   DIRECTION and drops most of its magnitude, mixing toward the colour's own luminance so exposure
   does not move.
2. **The saturation boost clipped channels.** `mix(vec3(lum), col, uSat)` with `uSat` at 1.24–1.34
   EXTRAPOLATES away from grey, driving any channel already under the luminance negative, and the
   `max(col, 0.0)` below clipped it — a hue shift wearing saturation's clothes, and the same
   mistake the flash blend in that shader already carries a comment about. The boost is now limited
   per pixel to the largest one that leaves every channel non-negative.
3. **The split tone was not splitting.** `col *= st / luma(st)` is a chroma multiply, and in the
   deep bands BOTH ends of the split are the same violet, so it is a global tint. Leaning each end
   separately made the shallow bands worse — down there the cool shadows are deliberately
   counteracting the torch warmth — so `splitToneLean()` neutralises only what the two ends SHARE
   and keeps the whole difference between them.

**Deep levels are still violet, and that is the design** ("the band is told by hue, not by dark").
The bug was fields being indistinguishable, not the band having a colour: field spread at depth 20
is now 97/255 against boardfix's gate of 30.

### Known-failing tests — the baseline

`npm test` is **111/112** (2026-09-14, after the module-cover UI, the Dungeon Crawlers floor tiles and the
save / audio fixes). The one failure is real, and it is an ART fact rather than a lighting bug:

**Its count is 25 as of 2026-09-20**, down from 30 when the cast was drawn as upright screen-space
sprites: the quads changed what lights a body, not the art. The gate still fails and still tracks the
imported sheet, not a lighting bug.

- `no body is lit down its own middle` — cast entries over the 15% pillow-shading ceiling (24 listed
  on 2026-09-13, e.g. hobgoblin 28%, demon 22%, gargoyle 22%; it was 33 before the environment pass,
  whose floor and light changes alter what sits behind the cast). The count tracks the cast list and
  the scene, not a lighting bug: it was 29 when the list was shorter.

**Do not try to fix this with the lighting.** It was measured. Swinging the sprite gains hard —
`uAmbientGain` 0.82 → 0.30 and `uDirectGain` 0.88 → 1.40, far past anything shippable — moves the
three worst offenders by nothing at all (ogre 0.294 → 0.296, hobgoblin 0.269 → 0.286, dwarven-guard
0.263 → 0.263). Their centre-lit bodies with shadowed edges are painted INTO the imported bitmaps.
The gate was written for the hand-painted procedural sprites; the whole cast now comes off the
imported sheet (`sprites/castMap.js`), which is why the list went from 1 entry to 29 in a single
commit. Only repainting the source art, or rescoping the gate, can close it.

**`tests/contextLoss.test.js` "a burst of losses trips the guard" is FLAKY under load, not broken.**
On a loaded machine it counts 8 context losses where it expects the guard to trip at the fourth and then
runs out its 180 s timeout; it failed the same way on a clean worktree of commit 9b739aa (and with HEAD's
`lighting.js` swapped back in), so it is nothing the 2026-09-18/19 work did. On a quiet machine the same
test passes in 62 s. The guard counts losses inside a ONE-MINUTE window, and a single context restore
takes ~47 s in software GL here, so the window is the wrong order of magnitude for this machine rather
than the guard being wrong. Do not chase it after a failed run until you have re-run it on an idle box.
`npm test` is 114/115 when it passes, 113/115 when it does not.

**Its count is 30 as of 2026-09-18, and lighting is not what moved it.** Measured three ways on the
same tree with the same command: HEAD's `lighting.js` 30, the old player-relative shadow casters 30,
the new world sun 30. So the drift from the 24 recorded on 2026-09-13 is older than the shadow work
and belongs to something else in the scene — when you next touch this gate, measure the baseline on
YOUR tree before attributing a number to your change. (A count of 27 was measured mid-session and was
wrong: the sprite key was reading a zero-intensity light, so three entries fell under the gate's own
visibility filter. See `collectLights`.)

Nor is the black `lift` in the depth grades to blame, which was the standing theory. Lowering it to
its pre-import values (0.008–0.009) makes pillow slightly WORSE (29 → 32 entries) AND drops the
mage's robe to litMedian 0.117 against the 0.12 "reads as a hole in the floor" floor. Lift is doing
its job; leave it where it is.

**The largest untested area is the game itself.** No one has yet played a full run from level 1 down
to the Sword and back out. The art has been reviewed exhaustively; the loop has not been played end
to end even once. That is worth doing before any further art pass.
