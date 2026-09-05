export const meta = {
  name: 'fargoal-board-fix',
  description: 'Close the 4/10 board-look findings: take the dungeon off the film curve, anchor the floor as the bright plane, keep room fields at every depth, and land an integer texel ratio',
  phases: [
    { title: 'Transform', detail: 'tone mapping, floor-anchored value, depth grade off the fields' },
    { title: 'Grid', detail: 'integer pixels per texel at the play camera' },
    { title: 'Judge', detail: 're-review against the board photo' },
  ],
}

const ROOT = process.env.FARGOAL_ROOT || process.cwd()

const COMMON = `
Repo: ${ROOT} (Vite + Three.js 0.170; headless Chromium WebGL2 via tools/*.mjs).
Screenshot: cd ${ROOT} && node tools/shot.mjs --scenario <name> --out shots/<name>.png — then Read the PNG. Crop with a small Playwright script at 6-12x to judge pixels.
Measure: node tools/lumen.mjs prints mean game-area luminance and the histogram. node tools/audit.mjs --scenario <name> reads real rendered pixels back. node tools/tilepreview.mjs renders the authored atlas.
Tests: node --test tests/ (78 passing)   Smoke: npm run smoke
HARD RULES: no external assets or network at runtime; no Math.random (use core/rng.js); the camera is ORTHOGRAPHIC, a near-plan view tilted ~17 degrees; ONE PIXEL GRID at TEXELS_PER_TILE (32); never leave the game broken.
THE STANDING LESSON: authored values lie. Verify by sampling pixels out of a rendered frame at the PLAY camera.
Concurrency: own only your listed files; targeted Edits elsewhere. If git reports index.lock, wait 5s and retry. Never git add -A; never rebase or force-push.
Your final message is machine-consumed: return only the requested structured data.`

const B = { type: 'object', properties: { summary: { type: 'string' }, changed: { type: 'array', items: { type: 'string' } }, smokeOk: { type: 'boolean' } }, required: ['summary', 'changed', 'smokeOk'] }
const C = { type: 'object', properties: { score: { type: 'number' }, verdict: { type: 'string' }, mustFix: { type: 'array', items: { type: 'string' } } }, required: ['score', 'verdict', 'mustFix'] }

phase('Transform')
const [tone, grid] = await parallel([
  () => agent(`${COMMON}
CONTEXT. The owner supplied a photo of the HeroQuest board and asked the dungeon to look like it: saturated colour-and-pattern fields, a pale corridor you trace the layout by, chunky near-white wall blocks, bright and legible, no large dark areas. src/render/tiles.js authors exactly that and is APPROVED — node tools/tilepreview.mjs shows 22 correct fields and an art director scored that SHEET 8-9/10. The rendered frame scored 4/10. The atlas is right; the transform between it and the screen is wrong. Do not touch tiles.js.

THREE MEASURED FAILURES, all yours. You own src/render/renderer.js, src/render/lighting.js, src/render/dungeonGeo.js and src/render/materials.js (grading only).

1. THE FILM CURVE IS EATING THE PALETTE. renderer.js:83-89 sets THREE.ACESFilmicToneMapping at toneMappingExposure 0.92. ACES is a film curve: it rolls off the shoulder and lifts nothing in the low-mids, so the corridor cobble authored at 0xd8d1c2 (luminance 0.82) reaches the screen at luminance 0.29 — 35% of its authored value. Measured mean game-area luminance across six scenarios x two seeds: 0.162-0.196, and 0.111 at depth 20. A board photo under room light sits at 0.5-0.6. Worse than the mean is the SHAPE: 66-78% of every play frame sits in one 0.1-0.2 luminance bucket and 10-44% is below 0.10.
   A master takes the dungeon off the film curve: NoToneMapping, or a linear transform with a soft knee applied only above 1.0 so flames and the Sword still clip gracefully, with outputColorSpace SRGB — so an albedo of 0.82 under unit ambient lands near 0.82 on screen, the way ink on card does. THEN re-tune the light intensities DOWN to taste against a correct floor value, rather than tuning ambient UP to fight a curve that eats it. Torches must still read as warm pools of SHAPE on a floor that is already legible, not as the only thing keeping a room visible.
   GATE: mean game-area luminance above 0.45 with under 3% of pixels below 0.10, on 'default', 'treasure', 'temple', 'room-crypt' at two seeds.

2. CORRIDOR AND WALL VALUE ARE INVERTED. Measured in a play frame (dungeon-overview, seed 42): wall-top block lum 0.499, corridor cobble lum 0.293 — and both pushed to the same gold hue. Source albedos are 0xe0d9c9 and 0xd8d1c2, near-white cream. The wall top sits higher and catches the hemisphere and the directional; the corridor floor sits in the shade of its own walls, so THE WALL MASS READS AS THE FLOOR. On the board it is the reverse: the pale corridor is the brightest continuous thing on the sheet and the wall band frames it.
   A master makes the FLOOR the light anchor — light the floor plane toward a fixed target value per style (a printed board has no falloff across a room) and lets torches add warmth and shape ON TOP by no more than about a third of a stop; and drops the wall-top band slightly BELOW the corridor rather than above it. Relevant: lighting.js:433 (baseHemi 0.26 / baseMoon 1.20 x ambientScale) and the floor-vs-wall-top lighting in dungeonGeo.js.
   GATE: sample a corridor tile and an adjacent wall-top tile in a play frame; corridor lum >= 0.70, wall top within 0.05 BELOW it, both reading cream rather than gold.

3. THE DEPTH GRADE ERASES THE ROOM FIELDS BELOW DEPTH 13. lighting.js:283-309 depthTint(), the depth<=18 band and the final violet band, apply their band colours (0x84a68e, 0xa088a0) as a HUE MULTIPLIER on albedo, so a low-saturation field has nothing of its own left. Measured at depth 20 fully revealed: a tan-brick room rgb(105,64,99) and the corridor beside it rgb(102,63,101) — a 3/255 difference. At depth 18 corridor, wall and every room are one green-black wash with no vocabulary visible.
   A master moves the band signal OFF the fields: keep the room floors on their authored colour at every depth and carry depth in things that are not the floor — the fog tint, the atmospherics, the light colour and the vignette — so depth 20 feels colder and more oppressive while a player can still tell a red crypt from a teal grid from a corridor.
   GATE: at depth 20, two rooms of different styles and the corridor between them must differ by at least 30/255 in at least one channel, and each must stay recognisably its own hue.

ALSO: unexplored bedrock measures rgb(34,32,43) (lum 0.11-0.13) while a code comment at lighting.js:38 claims 0.150. Either make the comment true or fix the number — against a bright room it must read as lit rock, not a hole.
CONSTRAINT: tests/screenTruth.test.js measures a lit character's separation from its background. Run it and keep it passing. If a brighter floor swallows a sprite, LIFT THE SPRITE — do not lower the floor back. That trade is the whole point of this round.
VERIFY: shot 'default', 'dungeon-overview', 'deep-level', 'treasure', 'temple', 'room-crypt' at two seeds and at depths 1, 8, 18, 20; Read every PNG; paste the before/after luminance table and the three GATE measurements into your summary.
node --test tests/ and npm run smoke must pass. Commit and push.
Return {summary, changed, smokeOk}.`, { label: 'fix:transform', phase: 'Transform', schema: B, effort: 'high' }),
  () => agent(`${COMMON}
TASK: LAND AN INTEGER PIXEL-PER-TEXEL RATIO AT THE PLAY CAMERA. You own src/render/camera.js and tests/.
An art director measured the shipped frames: NearestFilter is on and there is no bilinear mush, but the ratio is not integer. 900px viewport / BASE_TILES_TALL 14.0 = 64.3 screen px per tile, / 32 texels = 2.008 px per texel horizontally; the ~17 degree tilt foreshortens that to ~1.92 vertically. The visible result in 8x crops: grout lines fatten and thin between 2 and 3 px across a single room, and the tile lattice beats against the pixel grid.
camera.js applyFrustum() already derives the frustum FROM an integer texel size S — that is the right idea and it must stay. The failure is that the tilt then foreshortens the vertical axis by cos(tilt) so the vertical ratio is not the horizontal one, and that BASE_TILES_TALL 14.0 combined with an arbitrary viewport height does not give the horizontal axis an exact integer either at every window size.
A master solves this by choosing the frustum so BOTH axes land on whole texels at the current tilt: derive the visible tile count from the integer texel size AND the tilt's foreshortening together, snapping the world-to-screen scale so a floor texel is a whole number of device pixels along both screen axes, and re-deriving whenever the viewport, the zoom or the tilt slider changes (the tilt is user-adjustable, 0-45 degrees, so this must hold across the slider's range, not just at 17).
Keep the existing behaviour intact: opens zoomed out, camera sway off, setTilt() clamped 0-60, the overview mode fitting the whole level.
VERIFY: shot 'default' and 'dungeon-overview'; crop a corridor run at 8-12x and Read it; every grout line in one room must be the same pixel width. Add a test asserting the derived scale is an integer number of device pixels per texel on both screen axes across a spread of viewport sizes, zoom levels and tilt values.
node --test tests/ and npm run smoke must pass. Commit and push.
Return {summary, changed, smokeOk}.`, { label: 'fix:grid', phase: 'Grid', schema: B }),
])
log(`Transform: tone=${tone?.smokeOk} grid=${grid?.smokeOk}`)

phase('Judge')
const critic = await agent(`${COMMON}
You are the art director who scored this 4/10 with the verdict "IT DID NOT LAND AT THE PLAY CAMERA — the atlas is board-bright and the frame is not". Re-review against your own findings, and be as hard as you were.
THE REFERENCE: the HeroQuest board photo — every room one saturated colour-and-pattern field (basketweave planks, cracked red, teal grid, harlequin diamonds, checkerboards, gold bars), corridors one continuous PALE cobble that you trace the layout by, the wall band chunky rounded near-white blocks framing it, bright and legible with no large dark areas.
MEASURE, and say the numbers:
(a) mean game-area luminance (HUD excluded) and the share of pixels below 0.10, on 'default','treasure','temple','room-crypt','deep-level' at two seeds. Previously 0.111-0.196 and 10-44%. The gate was above 0.45 and under 3%.
(b) sample a corridor tile and an adjacent wall-top tile. Previously corridor 0.293 and wall top 0.499 — inverted, both gold. The gate was corridor >= 0.70 with the wall top just below it, both cream.
(c) at depth 20 fully revealed, sample two rooms of different styles and the corridor between them. Previously rgb(105,64,99) / rgb(102,63,101) — a 3/255 difference. The gate was 30/255 with each hue still its own.
(d) crop a corridor run at 8-12x: is every grout line the same pixel width now, or does the lattice still beat against the pixel grid?
(e) does the cast still read against the brighter floors? Run tests/screenTruth.test.js and say whether a sprite got swallowed.
THEN LOOK: shot 'default','dungeon-overview','deep-level','treasure','temple','room-crypt' across two seeds and depths 1, 8, 18, 20; Read them all. Does each room read as its own field, does the change of field at a doorway register, and would a stranger shown this frame and the board photo say they came from the same art direction?
Scoring: 10 indistinguishable from the board's clarity; 9 you would sign off; 7-8 good; 5-6 thin; <5 it did not land. Default to FAILING. Each must-fix names what, where, and what a master would do. Do not edit files.
Return {score, verdict, mustFix}.`, { label: 'judge:boardfix', phase: 'Judge', schema: C, effort: 'high' })

return { tone: tone?.summary?.slice(0, 500), grid: grid?.summary?.slice(0, 300), critic }
