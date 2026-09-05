export const meta = {
  name: 'fargoal-ambience-2',
  description: 'Close the ambience critic findings: no bare rooms, readable scatter and wall dressing, water rebuilt as furniture, props on the pixel grid, and the imported 3D models wired in',
  phases: [
    { title: 'Fill', detail: 'no room left unfurnished; scatter and wall dressing that read' },
    { title: 'Render', detail: 'water as furniture, props on the grid, imported models wired' },
    { title: 'Judge', detail: 'critic re-review' },
  ],
}

const ROOT = process.env.FARGOAL_ROOT || process.cwd()

const COMMON = `
Repo: ${ROOT} (Vite + Three.js 0.170; headless Chromium WebGL2 via tools/*.mjs).
Read ${ROOT}/docs/AMBIENCE.md (the binding ambience spec), ${ROOT}/docs/ARCHITECTURE.md and ${ROOT}/src/render/sprites/style.js before touching anything.
Screenshot: cd ${ROOT} && node tools/shot.mjs --scenario <name> --out shots/<name>.png — then Read the PNG; crop to 6-12x to judge pixels.
Measure: node tools/audit.mjs --scenario <name> reads real rendered pixels back (litMedian, edgeAlign, runTexels, contact shadow). node tools/decordump.mjs --seed N --depth D prints the placement as ASCII.
Tests: node --test tests/ (72 passing today)   Smoke: npm run smoke
HARD RULES: no external assets or network at runtime beyond what is already bundled; no Math.random (use core/rng.js); the camera is ORTHOGRAPHIC, a near-plan view tilted 17 degrees; ONE PIXEL GRID for cast, floor and props; never leave the game broken.
THE STANDING LESSON: sheet-level metrics lie. Verify in a rendered frame at the PLAY camera.
Concurrency: own only your listed files; targeted Edits on shared files. If git reports index.lock, wait 5s and retry. Never git add -A; never rebase or force-push.
Your final message is machine-consumed: return only the requested structured data.`

const B = { type: 'object', properties: { summary: { type: 'string' }, changed: { type: 'array', items: { type: 'string' } }, smokeOk: { type: 'boolean' } }, required: ['summary', 'changed', 'smokeOk'] }
const C = { type: 'object', properties: { score: { type: 'number' }, verdict: { type: 'string' }, mustFix: { type: 'array', items: { type: 'string' } } }, required: ['score', 'verdict', 'mustFix'] }

phase('Fill')
const [rooms, dressing] = await parallel([
  () => agent(`${COMMON}
TASK: NO ROOM IS LEFT UNFURNISHED. You own src/world/generator.js, docs/AMBIENCE.md and tests/decor.test.js.
An art director measured the shipped result: \`node tools/decordump.mjs --seed 7 --depth 8\` reports {bare:7} of 15 rooms, and seeds 42/1337 at depths 1,2,4,12,16 all land at 5-7 bare rooms — several with ZERO pieces across 12-24 tiles (e.g. "library bare dark decay=0.25 area=12"). So 35-45% of every level is a lit, well-built, completely unfurnished hall. That is precisely the problem this whole feature exists to solve, still present in four rooms out of ten.
FIX: delete \`bare\` as a room outcome. HeroQuest has no unfurnished rooms, only rooms with fewer pieces. Every room gets a real archetype and a floor of at least two standing pieces plus one wall piece. Keep \`bare\` only for alcoves under 4 tiles and for corridors (the bare-corridor rule stays — corridors are correct today and must not change).
Rebalance the archetype table so the extra rooms do not all become the same identity: a level should read as varied, and the smaller/odd-shaped rooms need archetypes that suit them (a two-tile nook is a shrine or a store, not an audience chamber).
Update docs/AMBIENCE.md to match, and extend tests/decor.test.js to ASSERT the new floor: across at least 20 seeds and depths 1..25, no room of 4+ tiles has fewer than two standing pieces and one wall piece, and connectivity still holds with decor placed.
Verify with decordump across seeds 42/7/1337 at depths 1,2,4,8,12,16 and paste the archetype histograms into your summary.
Commit and push.
Return {summary, changed, smokeOk}.`, { label: 'fill:rooms', phase: 'Fill', schema: B }),
  () => agent(`${COMMON}
TASK: MAKE THE DRESSING ACTUALLY VISIBLE. You own src/render/props/dressing.js.
Two measured failures from the art director, both about things being painted too small to read at the play camera:
1. SCATTER IS FLOOR GRIT. In shots of the 'dressing' scenario at 6x, the skull, rat, bottles, tankards and dice each cover under 15% of their tile; the rat is "an unidentifiable beige lozenge". HeroQuest ships TEN skulls and FOUR rats precisely because they are chunky, high-contrast, instantly-named shapes. Repaint the scatter set at roughly 2x its current footprint (a skull about 14 texels across, a rat with a readable head, hunch and tail), push skulls toward near-white against the floor's mid value so they read as bone, and raise the per-level budget from the 0-2 skulls / 0-2 rats the dumps show to roughly HeroQuest's ten skulls and four rats spread across the inhabited rooms.
2. SIXTEEN OF SEVENTEEN WALL TYPES RENDER AS NOTHING. Only banner and tapestry are visible; sconce, hungShield, trophyArms, chains, manacles, cobweb, skullNiche, ossuaryShelf, ironRing, gargoyleSpout, wallShelf, plaque, wallCrack, mould and fungusShelf are 2-4 texel smudges at the wall band's own value. A previous commit claimed to fix this and did not. Give the wall band a real height budget at the play camera, paint each piece to fill it, and light every hung piece off the room's key so a shield or a skull niche carries a bright rim against dark stone.
VERIFY THE WAY THE CRITIC DID: shot the 'dressing' scenario, crop each label at 6x, and require that EVERY label has something identifiable above it. Put the failing ones right before you finish. Read your crops.
Commit and push.
Return {summary, changed, smokeOk}.`, { label: 'fill:dressing', phase: 'Fill', schema: B }),
])
log(`Fill: rooms=${rooms?.smokeOk} dressing=${dressing?.smokeOk}`)

phase('Render')
const render = await agent(`${COMMON}
TASK: three renderer fixes, one of them the feature the project owner asked for. You own src/render/dungeon.js, src/render/materials.js, src/render/props/models.js and src/render/props/furniture.js.
1. WIRE IN THE IMPORTED 3D MODELS (the owner's request, already imported and committed).
   src/render/props/models.js holds 114 low-poly models from the Dungeon Crawlers library as a bundled glTF, with MODEL_MAP covering 19 decor types (barrel, table, tableLong, stool, bench, urn, brazier, hearth, candelabra, candlestick, lantern, chandelier, standingTorch, sconce, skull, bowl, plate, cup, scree). loadPropModels() inflates and parses in ~40ms; makePropModel(lib, type, variant, lit) returns a mesh standing on y=0, centred, facing +z; hasPropModel(type) tells you whether a type is covered.
   Make the decor renderer PREFER an imported model where one exists and fall back to the existing hand-pixelled piece otherwise. Respect the decor entry's facing and variant (pass variant so a storeroom is not one barrel repeated), and use the unlit twin when the room's light mood is dark/cold and the piece is a light source that should not be burning. Load the library once, asynchronously, without stalling the first frame — the game must still render if it is slow or fails, falling back to pixel art.
   These are 3D meshes rather than billboards, so they occlude and are lit by the room's real lights; make sure they do not z-fight the floor, do not intersect walls, and are disposed with the level.
2. PROPS ARE OFF THE ONE PIXEL GRID, MEASURABLY. node tools/audit.mjs reports PROPS edgeAlign 0.63 / runTexels 0.83 on 'default', 0.61/0.97 'treasure', 0.65/1.17 'temple', 0.56/1.31 'room-crypt', 0.51/1.11 'deep-level' — against the hero's edgeAlign 1.00 and onGrid 0.993 in the same frames. The pixel-art furniture is being resampled finer than the cast beside it, so its edges are soft where the hero's are hard. Quantise every decor billboard to the frame's integer texel size the way spriteBillboard already does for characters, and re-measure until PROPS edgeAlign approaches the hero's.
3. WATER IS A CYAN STICKER THAT IGNORES THE DUNGEON — the single most damaging object in the game. It is a full-brightness rectangle with a square hole punched in it, edges cutting mid-tile, no kerb, the floor grout not running under it, and it takes neither torch light, fog-of-war nor the depth grade: at depth 15-16 a puddle is the brightest thing on screen, out-reading the hero and the altar. Rebuild it like a piece of furniture: a stone kerb course around every water edge, the tile grout continuing into the surface, caustics driven by and clamped to the room's own light, and the whole pool multiplied by the depth band so a deep cistern is black-green rather than daylight blue.
4. A LIGHTING REGRESSION CAME IN WITH THE ROOM/DRESSING WORK, AND IT IS THE FIRST THING A PLAYER SEES. Depth 1 used to open on a warm, torchlit ochre hall; on the current commit the same seed and scenario ('default', seed 42) renders flat, cold and blue-grey, with no warm pools from the wall torches at all — the previous art director specifically praised "depth 1-5 warm ochre" and it is gone. Find out what took it (a light mood assigned wrongly to shallow rooms, a torch that stopped emitting, the depth grade applied at the wrong band) and restore it, WITHOUT flattening the per-room moods that were the point of the dressing work: a hearth room warm, a crypt cold, a shallow hall warm by default. Compare your fix against shots/a2-reverted.png, which is the regressed frame.
Verify: shot 'default', 'treasure', 'temple', 'room-crypt', 'deep-level', 'room-guardroom', 'cavern'; Read them; crop at 7-12x around props and water; run tools/audit.mjs and paste the PROPS numbers before and after.
node --test tests/ and npm run smoke must both pass. Commit and push.
Return {summary, changed, smokeOk}.`, { label: 'render:models-water-grid', phase: 'Render', schema: B })

phase('Judge')
const critic = await agent(`${COMMON}
You are the same demanding art director who reviewed this feature before and scored it 6/10 ("furnished halls with empty halls between them"). Re-review against your own findings.
Verify each by measurement, and say the numbers: (a) run tools/decordump.mjs across seeds 42/7/1337 at depths 1,2,4,8,12,16 — how many rooms are still unfurnished? (b) shot the 'dressing' scenario and crop every label at 6x — does each have something identifiable above it? (c) run tools/audit.mjs on 'default','treasure','temple','deep-level' — what is PROPS edgeAlign now versus the hero's? (d) is water still the brightest object on a deep level?
Then shot 'default', 'dungeon-overview', 'deep-level', 'treasure', 'temple', 'cavern' across at least two seeds and two depth bands; Read them all. Judge whether the dungeon now reads as an inhabited place throughout, whether the imported 3D furniture sits convincingly beside the pixel cast (it should be lit by the room and on the same pixel grid; if it looks like a different game, say so), and whether corridors stayed bare.
Scoring: 10 flawless; 9 sign-off; 7-8 good; 5-6 thin; <5 empty. Default to FAILING. Each must-fix names what, where, and what a master would do. Do not edit files.
Return {score, verdict, mustFix}.`, { label: 'judge:ambience2', phase: 'Judge', schema: C, effort: 'high' })

return { rooms: rooms?.summary?.slice(0, 250), dressing: dressing?.summary?.slice(0, 250), render: render?.summary?.slice(0, 400), critic }
