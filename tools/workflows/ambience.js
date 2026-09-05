export const meta = {
  name: 'fargoal-ambience',
  description: 'Furnish the dungeon: HeroQuest-style room archetypes with purpose-signalling furniture, scatter dressing and per-room lighting',
  phases: [
    { title: 'Design', detail: 'room archetype bible + decor data contract' },
    { title: 'Build', detail: 'placement, furniture art, dressing and ambience in parallel' },
    { title: 'Integrate', detail: 'wire up, verify, critic pass' },
  ],
}

const ROOT = process.env.FARGOAL_ROOT || process.cwd()

const RESEARCH = `
THE TWO REFERENCES, RESEARCHED (use these findings; do not re-derive them):

1. HEROQUEST (Milton Bradley, 1989). Its dungeon is a bare board that becomes a PLACE purely through furniture: every room is identified by the pieces standing in it. The complete manifest is small and deliberate —
   FURNITURE: 3 treasure chests, 2 bookcases, 2 tables, 1 throne, 1 alchemist's bench, 1 sorcerer's table, 1 tomb (sarcophagus), 1 torture rack, 1 fireplace, 1 weapons rack, 1 cupboard.
   SCATTER DRESSING: 2 candlesticks, bottles, scales, 10 skulls, 4 rats.
   BOARD FEATURES: doors in frames, a stairway tile, pit traps, secret doors, and "blocked square" tiles (rubble that closes a square).
   THE LESSON: a handful of well-chosen silhouettes, each stating what a room is FOR — this is an armoury, this is a wizard's study, this is a crypt — plus cheap scatter (skulls, rats, candles) that makes the space feel inhabited. Corridors stay bare; rooms carry the character. Furniture sits ON squares and reads from directly above, because the board is seen from overhead.

2. DUNGEON CRAWLERS HD (Drowning Monkeys). Painted, high-frequency environment textures under bold cartoony characters, and variety of environs rather than one repeated hall — goblin-infested corridors, lava caverns and so on. THE LESSON: density and painterly surface detail, and a reason for each area to look different from the last.

APPLY BOTH: HeroQuest's furniture-as-identity and bare-corridor discipline; Dungeon Crawlers' density and per-region variety. Our dungeon is currently handsome but EMPTY — well-built halls with nothing in them. That is the problem to solve.`

const COMMON = `
Repo: ${ROOT} (Vite + Three.js 0.170; headless Chromium WebGL2 via tools/*.mjs).
Read ${ROOT}/docs/ARCHITECTURE.md, ${ROOT}/docs/DESIGN.md and ${ROOT}/src/render/sprites/style.js (the binding house art style: INK, INK_LIT, LIT, ramp(), ceilings) before touching anything.
Screenshot: cd ${ROOT} && node tools/shot.mjs --scenario <name> --out shots/<name>.png — then Read the PNG. Crop to 4-12x to judge pixels.
Measure: cd ${ROOT} && node tools/audit.mjs --scenario <name> reads real rendered pixels back off the canvas (litMedian, texel run-length, contact shadow, pillow metric). Tests: node --test tests/    Smoke: npm run smoke
HARD RULES:
 - No external assets or network at runtime: every texture and sprite is painted procedurally in code.
 - No Math.random anywhere — all placement goes through core/rng.js so a seed reproduces a dungeon exactly.
 - The camera is ORTHOGRAPHIC, a fixed plan view tilted 17 degrees off vertical (player-adjustable 0-45 in Settings). Everything must read from almost directly overhead, like a board game seen from above. camera.fov is undefined; use camera.top/bottom and camera.zoom.
 - ONE PIXEL GRID: the frustum is derived from a whole texel size, so every sprite, prop and floor texel is the same size on screen. Anything you add must sit on that grid — props already have a measured history of drifting off it, and tests/screenTruth.test.js will fail you.
 - Never leave the game broken: node --test tests/ and npm run smoke must both pass before you finish.
 - THE STANDING LESSON, PROVEN THREE TIMES ON THIS PROJECT: sheet-level metrics lie. Verify in a rendered frame at the PLAY camera, not in the atlas.
Concurrency: other agents edit sibling files. Own only your listed files; targeted Edits on shared files, never wholesale rewrites. If git reports index.lock, wait 5s and retry. Never git add -A; never rebase or force-push.
Your final message is machine-consumed: return only the requested structured data.`

const B = { type: 'object', properties: { summary: { type: 'string' }, changed: { type: 'array', items: { type: 'string' } }, smokeOk: { type: 'boolean' } }, required: ['summary', 'changed', 'smokeOk'] }
const C = { type: 'object', properties: { score: { type: 'number' }, verdict: { type: 'string' }, mustFix: { type: 'array', items: { type: 'string' } } }, required: ['score', 'verdict', 'mustFix'] }

phase('Design')
const design = await agent(`${COMMON}
${RESEARCH}
TASK: write ${ROOT}/docs/AMBIENCE.md — the room-archetype bible the other agents will build from, and the data contract that carries it. You own that file only.
It must specify:
1. ROOM ARCHETYPES. A set of furnished room identities suited to Fargoal's fiction (a deep dungeon under a mountain, guarded by goblinoids, men-at-arms, drakes and a demon; the Sword lies at the bottom). Draw on HeroQuest's manifest but fit OUR bestiary and items — e.g. armoury (weapon racks, shields), scriptorium/library (bookcases, lecterns, candles), crypt (tombs, bone piles, urns), alchemy lab (bench, bottles, scales, retorts), guardroom (table, benches, dice, tankards), audience chamber (throne, banners, braziers), refectory (long table, hearth, barrels), torture chamber (rack, brazier, chains), storeroom (crates, barrels, sacks), flooded cave (pools, dripstone, fungus), collapsed hall (rubble, fallen columns), barracks (bunks, footlockers), well room, mushroom cavern. For EACH: the furniture set, the scatter dressing, the lighting mood, which depth band it appears in, roughly how often, and any gameplay association (which monsters favour it, what treasure it tends to hold). Rooms deep in the dungeon should feel older, colder and more ruined than the upper halls.
2. THE BARE-CORRIDOR RULE. Corridors stay largely undressed so rooms carry the character, exactly as on the HeroQuest board — say what little corridors DO get (scattered bones, a puddle, a wall sconce, rubble).
3. SCATTER DRESSING CATALOGUE. The cheap, repeatable pieces that make a space inhabited: skulls and bone piles, rats, candlesticks, bottles, scales, cobwebs, rubble, puddles, mushrooms, scorch marks, bloodstains, dropped coins, chains, wall sconces, banners, floor rugs and mosaics. Note which are floor decals, which are standing props and which are wall-mounted.
4. THE DATA CONTRACT (this is what the other agents code against, so be exact and unambiguous):
   - \`level.decor\`: an array of \`{ type, x, y, facing:'n'|'e'|'s'|'w', variant:number, blocking:boolean }\`.
   - \`room.archetype\`: the string id assigned by the generator, plus any per-room fields the renderer needs (e.g. \`room.lightMood\`).
   - The list of every valid \`type\` string, grouped by whether it is a standing prop, a floor decal or wall-mounted.
   - BLOCKING IS DANGEROUS: a piece that blocks a tile can seal a room or strand the stairs. State the rule plainly — decor is NON-BLOCKING by default; anything blocking must be placed only where the generator re-verifies connectivity afterwards, and never on a stairway, temple, door or the only route between two parts of a level.
5. A PLACEMENT GRAMMAR: furniture goes against walls facing into the room, big pieces on the long wall, hearths and thrones centred on a wall, tables central, scatter thinning away from furniture; nothing on stairs, doors, temple tiles or trap tiles; nothing so dense a room stops reading as walkable floor.
Keep it concrete and tabular. Return {summary, changed, smokeOk:true}.`,
  { label: 'design:ambience', phase: 'Design', schema: B })
log(`Design: ${design?.summary?.slice(0, 160)}`)

phase('Build')
const BUILD = [
  { key: 'placement', owns: 'src/world/generator.js, src/world/level.js, tests/', brief: `Assign archetypes and place the decor, per docs/AMBIENCE.md.
Add \`level.decor\` and \`room.archetype\` exactly as the bible specifies. Choose an archetype per room from its size, shape and depth band, with sensible weighting so a level feels varied rather than repeating one identity; keep the existing 'temple', 'shrine', 'alcove' and 'surface' rooms working as they already do. Place furniture by the placement grammar (against walls, facing in, big pieces on long walls, tables central), then scatter dressing thinning away from the furniture, then corridor dressing at a much lower density.
SAFETY, THE PART THAT MATTERS MOST: decor must never break a level. Non-blocking by default. Nothing on a stairway, door, temple or trap tile. If you place anything blocking, re-run the existing connectivity check afterwards and back the piece out if it isolates anything. Everything through core/rng.js so a seed reproduces exactly.
Add tests: decor is deterministic for a seed; no decor sits on a forbidden tile; every level remains fully connected with decor placed, across at least 20 seeds and depths 1..25; rooms get varied archetypes rather than all the same.
Write tools/decordump.mjs printing an ASCII map with decor marked, so placement can be judged without a renderer, and paste a couple of maps into your summary.` },
  { key: 'furniture', owns: 'src/render/props/furniture.js (new), src/render/props.js (targeted additive edits only)', brief: `Draw the FURNITURE — the big silhouettes that say what a room is for. Read src/render/props.js first: it already has a pixel-art drawing toolkit (box, span, ell, topFace, frontFace, setPx and a palette convention) and existing props like the chest, sack and altar. REUSE it and match its style exactly; do not fork it.
Pieces (from HeroQuest's manifest, adapted): table (plain and long), bookcase, weapon rack, throne, alchemist's bench, sorcerer's table, tomb/sarcophagus, torture rack, fireplace/hearth, cupboard, plus what the bible adds for our archetypes (lectern, bunk, footlocker, barrel, crate, sack pile, brazier, well, fallen column, bone pile, urn).
They are seen from an almost overhead orthographic camera tilted 17 degrees, like a board game piece viewed from above: build them so the TOP face carries most of the read and a short front face gives them height. Each must be identifiable by silhouette alone at the play camera. House style: INK outer contour, hue-shifted ramps, top-left key light, no pillow shading. On the cast's texel grid — props have drifted off it before and the screen-truth test will catch you.
Register them so the renderer can instantiate by \`type\` from level.decor. Add a debug scenario 'furniture' showing every piece in a labelled grid, shot it, Read it, and iterate until each reads.` },
  { key: 'dressing', owns: 'src/render/props/dressing.js (new), src/render/lighting.js, src/render/atmosphere.js', brief: `The cheap detail that makes a place feel inhabited, plus the per-room mood.
1. SCATTER DRESSING: skulls and bone piles, rats (a small idle animation is welcome), candlesticks, bottles, scales, cobwebs in corners, rubble, puddles that catch the light, mushrooms, scorch marks, bloodstains, dropped coins, chains. Floor decals must sit in the floor's own perspective and pixel treatment (an earlier pass shipped a trap decal drawn with no perspective on a floor that has some — do not repeat that).
2. WALL DRESSING: sconces, banners, hanging chains, cracks, murals or carvings on some walls.
3. PER-ROOM LIGHTING MOOD (this is what turns dressing into ambience): a hearth throws warm flickering light and the room around it is warmer; a crypt is cold and blue and under-lit; an alchemy lab has a small sickly green glow at the bench; a torture chamber has one hard brazier; a flooded cave gets rippling reflected light. Read how torches already work in lighting.js and extend that vocabulary rather than replacing it. Add subtle air where it belongs: dust motes in still rooms, drips in wet ones, embers near fire.
Keep it affordable: instanced or pooled, disposed on level change, and measure frame cost on 'deep-level' before and after with tools/perf.mjs (or the documented equivalent) and report the numbers.` },
]
const built = await pipeline(BUILD, async (b) => agent(`${COMMON}
${RESEARCH}
Read ${ROOT}/docs/AMBIENCE.md first — it is the binding spec for archetypes, the decor data contract and the placement grammar. Design notes: ${JSON.stringify(design?.summary?.slice(0, 400) || '')}
TASK (${b.key}). You own: ${b.owns}.
${b.brief}
Verify by rendering and looking: shot 'default', 'dungeon-overview', 'deep-level', 'treasure' and your own scenario; Read them; iterate until rooms read as furnished places rather than empty halls.
node --test tests/ and npm run smoke must both pass.
Commit only your files: cd /home/user/Neural-Razz-Arena && git add <your files> && git commit -m "Ambience (${b.key}): <one line>" && git push origin claude/sword-of-fargoal-remake-nahftb
Return {summary, changed, smokeOk}.`, { label: `build:${b.key}`, phase: 'Build', schema: B }))
log(`Build done: ${built.filter(Boolean).length}/${BUILD.length}`)

phase('Integrate')
const integrate = await agent(`${COMMON}
${RESEARCH}
TASK: wire the three strands together and make the dungeon actually look furnished in play. The generator now emits level.decor, furniture art exists, and dressing/lighting exists — but they were built in parallel and the renderer may not yet instantiate every type, place it on the right tile, face it correctly, or dispose it on level change. You own src/render/dungeon.js and small targeted edits anywhere needed to close the gaps.
Do this: read docs/AMBIENCE.md and the three modules; make DungeonView build decor from level.decor on 'level:enter' and dispose it in clear(); confirm every declared type renders, faces the way the data says, sits on its tile and on the shared texel grid; confirm nothing draws over the hero or the HUD; confirm corridors stay sparse and rooms read.
Then walk the game: run tools/play.mjs (or drive it yourself with Playwright) across several seeds and depths, screenshot a dozen rooms, Read them, and fix what looks wrong — floating props, decor on stairs, a room so dense it stops reading, a piece that never appears, a mood that never fires.
Report frame cost on 'deep-level' before and after the whole ambience feature.
node --test tests/ and npm run smoke must both pass. Commit and push.
Return {summary, changed, smokeOk}.`, { label: 'integrate:ambience', phase: 'Integrate', schema: B })

const critic = await agent(`${COMMON}
${RESEARCH}
You are an art director who knows both references intimately. Judge ONE question: does this dungeon now feel like a furnished, inhabited place in the spirit of HeroQuest and Dungeon Crawlers HD, or does it still read as empty halls with a few objects dropped in?
Procedure: shot 'default', 'dungeon-overview', 'deep-level', 'treasure', 'temple' and the furniture scenario across at least three seeds AND at two depths (shallow and deep); Read every PNG; crop where detail matters. Judge: does each room state what it is FOR at a glance? Is furniture identifiable by silhouette from this near-overhead camera? Do corridors stay bare so rooms carry the character? Does dressing feel inhabited or sprinkled at random? Does lighting differ per room identity? Do deep levels feel older and colder than shallow ones? Is anything floating, off-grid, on a stairway, or so dense the floor stops reading?
Scoring: 10 flawless; 9 you would sign off; 7-8 good; 5-6 thin; <5 still empty. Default to FAILING. Each must-fix names what, where (which shot) and what a master would do. Do not edit files.
Return {score, verdict, mustFix}.`, { label: 'critic:ambience', phase: 'Integrate', schema: C, effort: 'high' })

return { design: design?.summary?.slice(0, 300), built: built.filter(Boolean).map((x) => x?.summary?.slice(0, 150)), integrate: integrate?.summary?.slice(0, 300), critic }
