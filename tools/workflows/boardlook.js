export const meta = {
  name: 'fargoal-board-look',
  description: 'Replace every floor and wall top with the HeroQuest tile vocabulary, one field per room, and brighten the dungeon to board-bright',
  phases: [
    { title: 'Wire', detail: 'atlas, per-room style assignment, corridor and wall top' },
    { title: 'Bright', detail: 'raise exposure so the board reads bright, not a dark cave' },
    { title: 'Judge', detail: 'compare against the reference board' },
  ],
}

const ROOT = process.env.FARGOAL_ROOT || process.cwd()

const COMMON = `
Repo: ${ROOT} (Vite + Three.js 0.170; headless Chromium WebGL2 via tools/*.mjs).
Screenshot: cd ${ROOT} && node tools/shot.mjs --scenario <name> --out shots/<name>.png — then Read the PNG. Crop with a small Playwright script at 4-12x to judge pixels.
Tile preview: node tools/tilepreview.mjs shots/x.png renders every style as a labelled field.
Tests: node --test tests/ (73 passing)   Smoke: npm run smoke
HARD RULES: no external assets or network at runtime; no Math.random (use core/rng.js); the camera is ORTHOGRAPHIC, a near-plan view tilted 17 degrees; ONE PIXEL GRID — everything painted at TEXELS_PER_TILE (32) texels per world unit; never leave the game broken.
Verify in a rendered frame at the PLAY camera, never from the atlas alone.
Your final message is machine-consumed: return only the requested structured data.`

const B = { type: 'object', properties: { summary: { type: 'string' }, changed: { type: 'array', items: { type: 'string' } }, smokeOk: { type: 'boolean' } }, required: ['summary', 'changed', 'smokeOk'] }
const C = { type: 'object', properties: { score: { type: 'number' }, verdict: { type: 'string' }, mustFix: { type: 'array', items: { type: 'string' } } }, required: ['score', 'verdict', 'mustFix'] }

phase('Wire')
const wire = await agent(`${COMMON}
CONTEXT: the project owner supplied a photo of the HeroQuest board and asked for its floors. src/render/tiles.js already implements that vocabulary and is APPROVED — do not restyle it, only wire it in. It exports TILE_STYLES (20 room fields plus 'corridor' and 'wallTop'), ROOM_STYLE_IDS, VARIANTS (4) and paintTile({alb,hgt,W,x0,y0,S,style,seed}) which paints one 32x32 tile into a float RGB buffer and a height buffer.
THE LOOK: every room is ONE field; the change of field at a doorway is what says you have entered somewhere new. Corridors are all the pale 'corridor' cobble. Wall tops are all 'wallTop' blocks. This REPLACES the old flagstone/moss/wet/cracked cell scheme entirely.
TASK. You own src/render/materials.js, src/render/dungeon.js, src/world/generator.js, src/world/level.js and tests/.
1. ATLAS. materials.js currently builds an 8x4 atlas of 32 cells (ATLAS/CELLS/cellUV) in flagstoneAtlas(), deriving normal and roughness from a height field. Grow it to hold every style at VARIANTS cells each (22 styles x 4 = 88 cells, e.g. 8 cols x 11 rows) and paint each cell with paintTile() instead of the old stone logic. KEEP the existing normal/roughness derivation from the height buffer, and keep obsidian/temple special cells working (or give them styles). Export a lookup from style id -> its variant cell indices.
2. PER-ROOM STYLE. generator.js assigns each room a \`room.tileStyle\` from ROOM_STYLE_IDS, seeded, so a level shows a good spread rather than one field repeated, and revisiting a level gives the same fields. Store it on the room and make it survive serialization. Every floor tile inside a room uses that room's style; every corridor tile uses 'corridor'; every wall top uses 'wallTop'.
3. CELL CHOICE. dungeon.js cellFor() currently picks from CELLS.plain/mossy/wet/cracked by probability. Replace that: look up the room containing the tile, take its style's variant cells, and pick one by a seeded hash of the tile position so a field does not read as one tile stamped in a grid. Corridor tiles and wall tops take theirs. Keep the existing half/quarter-cobble sub-cell handling working.
4. Update any test that assumed the old CELLS scheme, and add one asserting every room gets a style and that a seed reproduces the same styles.
VERIFY: shot 'default', 'dungeon-overview', 'deep-level', 'treasure', 'temple' and Read them. Rooms must be visibly different fields from each other; corridors pale cobble; wall tops pale blocks. Crop at 6x to confirm the tile grid is crisp and on the pixel grid.
node --test tests/ and npm run smoke must pass. Commit and push.
Return {summary, changed, smokeOk}.`, { label: 'wire:tiles', phase: 'Wire', schema: B })
log(`Wire: smoke=${wire?.smokeOk}`)

phase('Bright')
const bright = await agent(`${COMMON}
CONTEXT: the tile fields from the HeroQuest board are now wired in (previous step). The owner's direction: "from the gate I didn't really want so much negative space and darkness — let's go board-bright". The reference is a printed board under room light: saturated colour fields, everything legible, no large black areas. Our dungeon is currently a dark cave with small torch pools, which fights that.
TASK. You own src/render/lighting.js, src/render/renderer.js, src/render/surround.js and src/render/materials.js (grading only).
Raise the whole scene to read like a lit board while keeping it a dungeon:
1. AMBIENT. Lift the ambient/hemisphere so an unlit room still reads its own colour field clearly instead of going near-black. Torches should add warmth and shape, not be the only thing keeping a room visible.
2. FOG OF WAR. Explored-but-not-currently-visible must still show its field, dimmed and slightly desaturated rather than crushed. Unknown space stays hidden — that is a game rule, not a lighting one — but the bedrock outside the level (surround.js) should read as lit rock rather than a black void.
3. DEPTH GRADE. Deep levels may cool and darken, but by a fraction of what they do now: at depth 20 a room's field must still be recognisably its own colour, not a black-green wash.
4. EXPOSURE AND BLOOM. Retune tone mapping and bloom for the brighter scene so nothing clips to white and the pale corridor cobble does not glare.
CONSTRAINT: the cast must still read against the brighter floors. tests/screenTruth.test.js measures a lit character's separation from its background — run it and keep it passing; if the brighter floor swallows a sprite, say so and lift the sprite, do not lower the floor back.
VERIFY: shot 'default', 'dungeon-overview', 'deep-level', 'room-crypt', 'treasure' at two depths and Read them. Report the measured mean scene luminance before and after for each.
node --test tests/ and npm run smoke must pass. Commit and push.
Return {summary, changed, smokeOk}.`, { label: 'bright:exposure', phase: 'Bright', schema: B })

phase('Judge')
const critic = await agent(`${COMMON}
You are an art director holding two things side by side: the HeroQuest board photo the owner supplied, and this game.
THE BOARD: every room is one saturated colour-and-pattern field — basketweave planks, cracked red, teal grid, harlequin diamonds, checkerboards, gold bars — corridors are one continuous pale cobble, the wall band is chunky rounded near-white blocks, and the whole thing is bright and legible with no large dark areas. Scatter is a few chunky bones and skulls.
Shot 'default', 'dungeon-overview', 'deep-level', 'treasure', 'temple', 'room-crypt' across at least two seeds and two depth bands. Read every PNG. Also run node tools/tilepreview.mjs and Read it.
JUDGE: (a) does each room read as its own field, and does the change of field at a doorway register? (b) are corridors clearly the pale cobble, and wall tops the pale blocks? (c) is the game now BOARD-BRIGHT — saturated fields, no large negative space — or still a dark cave? (d) do the fields stay crisp on the pixel grid at the play camera, or are they resampled soft? (e) does the cast still read against the brighter floors? (f) at depth 20, is a room still recognisably its own colour?
Scoring: 10 indistinguishable from the board's clarity; 9 you would sign off; 7-8 good; 5-6 thin; <5 it did not land. Default to FAILING. Each must-fix names what, where, and what a master would do. Do not edit files.
Return {score, verdict, mustFix}.`, { label: 'judge:board', phase: 'Judge', schema: C, effort: 'high' })

return { wire: wire?.summary?.slice(0, 400), bright: bright?.summary?.slice(0, 400), critic }
