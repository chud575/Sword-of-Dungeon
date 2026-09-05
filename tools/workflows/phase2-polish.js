export const meta = {
  name: 'fargoal-phase2-polish-loops',
  description: 'Per-feature polish loops: builder improves, two harsh critics screenshot and grade; loop until both score AAA (>=9/10) or the round cap',
  phases: [
    { title: 'Polish', detail: 'builder -> critics, looping per feature' },
    { title: 'Regression', detail: 'smoke + tests + bot play after all loops' },
  ],
}

const ROOT = process.env.FARGOAL_ROOT || process.cwd()
const MAX_ROUNDS = args?.maxRounds ?? 6
const PASS = 9

const COMMON = `
Repo: ${ROOT} (Vite + Three.js 0.170; node_modules installed; headless Chromium WebGL2 works via tools/*.mjs).
Read ${ROOT}/docs/ARCHITECTURE.md (binding contract: ownership, events, debug API) and skim ${ROOT}/docs/DESIGN.md (design bible) first.
Screenshot: cd ${ROOT} && node tools/shot.mjs --scenario <name> --out shots/<name>.png  (list: node tools/shot.mjs --list). Then Read the PNG to look at it.
Smoke: cd ${ROOT} && npm run smoke   Tests: cd ${ROOT} && node --test tests/
Rules: no external assets/network at runtime; no Math.random (use core/rng.js); never leave the game broken; no git commit/push.
Other agents are editing OTHER files concurrently: only edit the files you own (listed in your task) plus tiny additive edits to src/debug/scenarios.js (use targeted Edit on a fresh Read, never rewrite the whole file). If you need CSS, put it in your own .css file imported from your own JS module — do not edit styles.css beyond the design tokens you truly need.
Your final message is machine-consumed: return only the requested structured data.`

const FEATURES = args?.features ?? [
  { key: 'dungeon', owns: 'src/render/dungeon.js, src/render/materials.js', scenarios: ['dungeon-overview', 'stairs', 'pit', 'water', 'temple'],
    brief: 'The dungeon architecture itself: floors, walls, corridors, stairs, pits, temples, water, doors, rubble. Goal: a hand-crafted-looking, richly detailed stone dungeon (beveled/irregular flagstones with grout, moss and wet patches near water, cracked tiles, wall bricks with varied courses and chipped edges, wall tops with proper caps, corridor arches or lintels at room entrances, stair steps with worn centers, pits with crumbling rims and a faint red glow from below, temple with altar/candles/pillars/mosaic floor and a light shaft, animated water with refraction-like shimmer and caustics). Use vertex colors + baked AO from neighbors + procedural normal maps for depth. Instanced meshes so it stays fast. No repeating-texture tiling visible at overview zoom.' },
  { key: 'lighting', owns: 'src/render/lighting.js, src/render/renderer.js', scenarios: ['default', 'deep-level', 'spell-light'],
    brief: 'Lighting, atmosphere and post-processing: torch point lights with warm flicker and soft shadows, the player-carried cool light with a gentle radius falloff, volumetric-feeling god rays or dust in the air (screen-space or particle sheets), fog of war as physical darkness with smooth bilinear edges (unknown black, remembered dim/desaturated, visible lit), depth-dependent color grading (deeper = colder/more oppressive), bloom tuned so gold/magic glows but stone does not, vignette, filmic tone mapping, subtle chromatic aberration off by default. It must still read clearly in the SwiftShader software renderer (do not depend on features that silently fail).' },
  { key: 'characters', owns: 'src/render/characters.js', scenarios: ['bestiary', 'combat', 'default'],
    brief: 'Every character model and its animation: the hero (sword, shield or cloak, readable face direction) and every monster in the bestiary with a distinct silhouette, proportions, color story and one signature detail (kobold small and hunched with a spear; hobgoblin bulky; ogre huge; dragon with wings/tail/horns; wraith translucent tattered; vampire bat flapping; slime blobby translucent; spider eight legs; salamander flame-tinted; werewolf; barbarian; warlock/mage with staff and hat; ranger with bow; assassin hooded; ghoul; vampire caped). Procedural animations: idle breathing, walk bob with leg/arm swing, attack lunge, hurt flash/knockback, death collapse + fade. Models must read at the game camera distance and look like a coherent stylized low-poly art style (think Octopath/Tunic/Dwarf Fortress premium tilesets), not primitive-shape stick figures.' },
  { key: 'props-effects', owns: 'src/render/props.js, src/render/effects.js', scenarios: ['treasure', 'sword-found', 'spell-teleport', 'spell-shield', 'spell-invisibility', 'spell-regeneration', 'spell-drift', 'combat'],
    brief: 'Props and VFX: gold sacks/coins with sparkle, chests (open/closed), potions, scrolls/spellbooks, the Sword of Fargoal as a hero prop with a strong glow and orbiting motes, altars/candles, torches with flame sprites. Effects: hit sparks and blood/ichor puffs, floating damage numbers with easing, crits, level-up burst, spell casts (teleport dissolve+reassemble, shield bubble, invisibility shimmer, regeneration motes, light bloom, drift glide trail), stairs descend transition, gold pickup sparkle + coin fountain, death effect. Effects must be readable, punchy, and layered (flash + particles + light) like a AAA action RPG, never a single sprite.' },
  { key: 'hud-log', owns: 'src/ui/hud.js, src/ui/log.js, src/ui/hud.css, src/ui/styles.css', scenarios: ['default', 'hud-low-hp', 'sword-found', 'combat'],
    brief: 'The in-game HUD and message log: character card (name/level/HP bar with damage trail/XP bar/gold count-up), depth indicator, Sword countdown (pulsing when low), hotbar with spell/item icons (procedural SVG/CSS icons, counts, hotkeys), status effects, message log with category colors and elegant fade. It must feel like a premium dark-fantasy UI (crisp gold hairlines, parchment textures via CSS, typography hierarchy, subtle motion), never default-browser looking; layout must not cover the play area; readable at 1280x720 and 1920x1080.' },
  { key: 'menus', owns: 'src/ui/menus.js, src/ui/menus.css', scenarios: ['title', 'pause', 'help', 'settings', 'death', 'victory'],
    brief: 'Title screen (logo treatment for "Sword of Fargoal" with a metallic/ember text effect, animated 3D dungeon backdrop, menu with keyboard and mouse), difficulty select, pause, help/controls, settings, death screen (cause, stats, hall of fame entry) and victory screen (escape time, celebration). Cinematic, cohesive, AAA main-menu quality.' },
  { key: 'panels', owns: 'src/ui/inventory.js, src/ui/minimap.js, src/ui/tooltip.js, src/ui/panels.css', scenarios: ['inventory', 'minimap', 'default'],
    brief: 'Inventory/character/spellbook panel, minimap, and tooltips: inventory with icons, descriptions, keyboard nav, use/drop; minimap with explored tiles, stairs/temple/pit glyphs, seen monsters, player heading, smooth zoom; tooltips for tiles/monsters/items with lore lines and threat rating. Same design language as the HUD.' },
  { key: 'camera-feel', owns: 'src/render/camera.js', scenarios: ['default', 'stairs', 'combat'],
    brief: 'Camera rig and game feel: smooth follow with look-ahead and dead zone, tasteful zoom levels, screen shake on hits (toggleable), camera dive on stairs and drop on pits, slight tilt/dolly in temples, no jitter at tile boundaries (interpolation), zoom with mouse wheel, and a cinematic slow orbit for the title screen. Verify with multi-frame sequences (take 4 shots with debug.step between).' },
  { key: 'generator', owns: 'src/world/generator.js, src/world/level.js', scenarios: ['dungeon-overview', 'deep-level'],
    brief: 'Level generation quality: the original Fargoal look (rooms of varied shapes including irregular/cave-like ones, long twisting single-tile corridors with dead ends and loops, occasional wide halls, pillars, rubble, water pools, secret alcoves with hidden gold), guaranteed connectivity, stairs far apart, temples in small side chambers, difficulty and treasure scaling by depth, no visible grid artifacts. Add tests/generator.test.js checks. Critics judge ASCII dumps (write tools/mapdump.mjs printing levels for seeds) and dungeon-overview renders across 3 seeds.' },
  { key: 'combat-ai', owns: 'src/game/monsters.js, src/game/combat.js', scenarios: ['combat', 'deep-level'],
    brief: 'Monster AI and combat feel per DESIGN.md: wander/hunt/flee with FOV and hearing, pack behaviour, thieves steal and run, invisible sprites, followers through stairs, sanctuary respected, speed differences, ranged casters (mage/warlock) keep distance and cast, dragons breathe fire, combat rolls with crits, damage variance, XP curve; plus logs and events for every beat so VFX/audio trigger. Critic runs the bot (tools/play.mjs) and reads logs + frame sequences.' },
  { key: 'audio', owns: 'src/core/audio.js', scenarios: ['default'],
    brief: 'Procedural audio: every SFX (footsteps on stone/water, sword swings, hits per material, monster voices per family, gold, potion, spells, stairs, level-up fanfare, low-HP heartbeat, proximity danger cue like the original), adaptive ambient music that layers with depth and combat, reverb tail for dungeon feel, mixer with settings. Write tools/audiodump.mjs that uses OfflineAudioContext in the page to render each SFX and 20 s of music to WAV-like buffers, saves waveform+spectrogram PNGs to shots/audio/, and reports peak/RMS; critics review those images and the code for musicality and mix balance.' },
  { key: 'qol', owns: 'src/core/input.js, src/core/save.js, src/game/game.js, src/game/player.js', scenarios: ['default', 'inventory'],
    brief: 'Modern quality of life: click-to-move with path preview, auto-explore, auto-pause on new monster sighting and on tab blur, hold-to-repeat movement with acceleration, rebindable keys, gamepad, touch-friendly D-pad, undo-safe confirmations for stairs with the sword timer, save/continue reliability, daily seed, run stats. Critic tests behaviour via Playwright scripts, not only screenshots.' },
]

const CRITIC_SCHEMA = { type: 'object', properties: { score: { type: 'number' }, betterThanOriginal: { type: 'boolean' }, verdict: { type: 'string' }, flaws: { type: 'array', items: { type: 'string' } }, mustFix: { type: 'array', items: { type: 'string' } } }, required: ['score', 'betterThanOriginal', 'verdict', 'flaws', 'mustFix'] }
const BUILD_SCHEMA = { type: 'object', properties: { summary: { type: 'string' }, changed: { type: 'array', items: { type: 'string' } }, smokeOk: { type: 'boolean' } }, required: ['summary', 'changed', 'smokeOk'] }

function criticPrompt(f, lens, round) {
  return `${COMMON}
You are a ${lens === 'art' ? 'brutally demanding AAA art director (think Naughty Dog / Supergiant / Blizzard cinematics level of taste)' : 'brutally demanding lead UX/game-feel designer who ships AAA games'}. You are reviewing feature "${f.key}" of a Three.js remake of Sword of Fargoal, round ${round}.
Feature brief the builder was given: ${f.brief}
Procedure: take fresh screenshots of scenarios ${JSON.stringify(f.scenarios)} at 1600x900 into shots/critic-${f.key}/ (use --seed 42 and also --seed 7 for one of them), Read every PNG carefully, and where motion matters take 3-4 sequential frames (node tools/shot.mjs --wait with different values, or write a tiny Playwright script using tools/browser.mjs and debug.step). ${f.key === 'audio' ? 'For audio, run tools/audiodump.mjs and review the waveform/spectrogram PNGs and the code.' : ''} ${f.key === 'generator' ? 'Also run tools/mapdump.mjs for 3 seeds and judge the ASCII maps.' : ''} ${f.key === 'qol' || f.key === 'combat-ai' ? 'Also exercise behaviour via Playwright (tools/play.mjs and your own scripts) and read the message log.' : ''}
Also Read ${ROOT}/shots/reference-original.png (a faithful replica of the original 1983 C64 game) and the real original screenshots in /tmp/claude-0/-home-user-Neural-Razz-Arena/b86a6426-9275-5d4f-afb1-9e537f512fb8/scratchpad/ (sofmain.PNG, sofmonsters.png, softemple.png, sofgotsword.png, sofgeneric.png) and decide honestly whether OUR version looks and feels better than it in this feature area — it must not just be shinier, it must be more beautiful, more readable and more evocative.
Scoring: 10 = flawless shipping AAA; 9 = AAA, you would sign off; 7-8 = good indie; 5-6 = programmer art; <5 = broken. Default to FAILING. A score of ${PASS} or more requires that you find NO must-fix flaws. Be concrete: every flaw must name what is wrong, where (which screenshot, which region) and what a AAA version would do instead. Do not edit any files.
Return {score:number, betterThanOriginal:boolean, verdict:string, flaws:string[], mustFix:string[]}.`
}

function builderPrompt(f, round, feedback) {
  return `${COMMON}
You are a senior AAA ${['dungeon', 'lighting', 'characters', 'props-effects', 'camera-feel'].includes(f.key) ? 'technical artist / graphics engineer' : f.key === 'audio' ? 'audio designer / DSP engineer' : ['hud-log', 'menus', 'panels'].includes(f.key) ? 'UI artist / front-end engineer' : 'gameplay engineer'} polishing feature "${f.key}" (round ${round} of at most ${MAX_ROUNDS}).
You own ONLY these files: ${f.owns} (create them if missing; you may also create new files under the same directory for your feature and import them from your owned files). Relevant scenarios: ${JSON.stringify(f.scenarios)} — add or improve scenarios in src/debug/scenarios.js (targeted additive edits only) so each is a flattering, representative showcase.
Brief: ${f.brief}
${feedback ? `CRITIC FEEDBACK FROM THE PREVIOUS ROUND (you must address every must-fix item; do not argue, fix):\n${feedback}` : 'This is the first polish round: first screenshot the current state, Read the PNGs, list what separates it from AAA, then do a deep, ambitious pass.'}
Work method: look before and after (Read your PNGs), iterate several times within this round, keep performance sane (instancing, shared materials, dispose on level change), keep determinism. Before finishing: cd ${ROOT} && npm run smoke must print SMOKE OK and node --test tests/ must pass (fix any failure you caused).
FINALLY, once smoke and tests are green, commit ONLY your own files so the work survives container restarts: cd /home/user/Neural-Razz-Arena && git add <your owned files> fargoal/src/debug/scenarios.js && git commit -m "Polish ${f.key} (round ${round}): <one line>" && git push origin claude/sword-of-fargoal-remake-nahftb. If git reports index.lock, wait 5 s and retry (another agent is committing). Never use git add -A, never commit files you do not own, never rebase/force-push.
Return {summary:string, changed:string[], smokeOk:boolean}.`
}

phase('Polish')
const results = await pipeline(FEATURES, async (f, _item, i) => {
  let feedback = null
  const history = []
  let passed = false
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const b = await agent(builderPrompt(f, round, feedback), { label: `build:${f.key}#${round}`, phase: 'Polish', schema: BUILD_SCHEMA })
    const [art, ux] = await parallel([
      () => agent(criticPrompt(f, 'art', round), { label: `critic-art:${f.key}#${round}`, phase: 'Polish', schema: CRITIC_SCHEMA, effort: 'high' }),
      () => agent(criticPrompt(f, 'ux', round), { label: `critic-ux:${f.key}#${round}`, phase: 'Polish', schema: CRITIC_SCHEMA, effort: 'high' }),
    ])
    const scores = [art, ux].filter(Boolean)
    const min = scores.length ? Math.min(...scores.map((s) => s.score)) : 0
    const better = scores.length > 0 && scores.every((s) => s.betterThanOriginal)
    history.push({ round, builder: b?.summary, smokeOk: b?.smokeOk, art: art?.score, ux: ux?.score, better })
    log(`[${f.key}] round ${round}: art=${art?.score ?? '?'} ux=${ux?.score ?? '?'} betterThanOriginal=${better} smoke=${b?.smokeOk}`)
    if (min >= PASS && better && b?.smokeOk !== false) { passed = true; break }
    feedback = scores.map((s, k) => `--- ${k === 0 ? 'ART DIRECTOR' : 'UX LEAD'} (score ${s.score}, betterThanOriginal=${s.betterThanOriginal}) ---\nVerdict: ${s.verdict}\nMUST FIX:\n- ${s.mustFix.join('\n- ')}\nOther flaws:\n- ${s.flaws.join('\n- ')}`).join('\n')
  }
  if (!passed) log(`[${f.key}] CAPPED at ${MAX_ROUNDS} rounds without a unanimous AAA pass`)
  return { key: f.key, passed, history }
})

phase('Regression')
const reg = await agent(`${COMMON}
All polish loops finished. Run cd ${ROOT} && node --test tests/ && npm run smoke && node tools/play.mjs --seed 3 (or the documented invocation). Fix any breakage introduced by the concurrent polish work (conflicting edits in scenarios.js, missing imports, disposed-resource errors, performance regressions: measure debug.step over 120 frames on 'deep-level' and report ms/frame). Keep fixes minimal. Return {summary, fixed:string[], testsOk:boolean, smokeOk:boolean, playOk:boolean, msPerFrame:number}.`,
  { label: 'regression', phase: 'Regression', schema: { type: 'object', properties: { summary: { type: 'string' }, fixed: { type: 'array', items: { type: 'string' } }, testsOk: { type: 'boolean' }, smokeOk: { type: 'boolean' }, playOk: { type: 'boolean' }, msPerFrame: { type: 'number' } }, required: ['summary', 'fixed', 'testsOk', 'smokeOk', 'playOk'] } })

return { features: results.filter(Boolean), regression: reg }
