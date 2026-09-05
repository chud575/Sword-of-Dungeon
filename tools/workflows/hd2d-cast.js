export const meta = {
  name: 'fargoal-hd2d-cast',
  description: 'Fix the HD-2D hero integration, then convert the whole bestiary from 3D meshes to hand-pixelled HD-2D sprites, with harsh critics',
  phases: [
    { title: 'Integration', detail: 'texel snapping, contact shadow, scene light response' },
    { title: 'Bestiary', detail: 'monsters converted to sprites in parallel groups' },
    { title: 'Judge', detail: 'critics review the full cast' },
  ],
}

const ROOT = process.env.FARGOAL_ROOT || process.cwd()

const COMMON = `
Repo: ${ROOT} (Vite + Three.js 0.170; node_modules installed; headless Chromium WebGL2 via tools/*.mjs).
Read ${ROOT}/docs/ARCHITECTURE.md first; skim ${ROOT}/docs/DESIGN.md for the bestiary.
Screenshot: cd ${ROOT} && node tools/shot.mjs --scenario <name> --out shots/<name>.png; then Read the PNG to actually look at it.
Smoke: cd ${ROOT} && npm run smoke   Tests: cd ${ROOT} && node --test tests/
Rules: no external assets or network at runtime (all art is painted procedurally in code); no Math.random (use core/rng.js); never leave the game broken.
The existing HD-2D hero toolkit is in src/render/sprites/: pixelPainter.js (ramps, outline, shading, mirror, layered part compositing), heroSprite.js, spriteSheet.js (atlas + THREE.DataTexture, NearestFilter), spriteBillboard.js (lit billboard + blob shadow + animator). REUSE it; do not fork it.
VERIFIED FACTS (I measured these myself — do not waste time re-litigating):
 - The blob contact shadow IS rendering (frame diff with it toggled: avg 42, max 502 under the hero). It is too soft/wide to read as contact, not missing.
 - The atlas texture already uses NearestFilter with no mipmaps. Residual softness comes from non-integer texel-to-screen scale and from post-processing (bloom/grain), NOT from filtering.
 - fogMask returns (1,1) on lit tiles; reversed-edge smoothstep works correctly on this driver.
Your final message is machine-consumed: return only the requested structured data.`

const HD2D = `
HD-2D means Square Enix's Octopath Traveler / Triangle Strategy look: hand-pixelled 2D character sprites standing as billboards inside a lit 3D diorama. Sprites must be drawn like a master pixel artist made them: 5-7 hue-shifted colour ramps (shadows cooler/purpler, highlights warmer), a single dark non-black outline with selective outlining, consistent top-left key light, clean silhouette, no pillow shading, no banding, minimal dithering, anti-aliasing only inside forms. Every character reads instantly by silhouette alone at the real game camera distance.`

const BUILD_SCHEMA = { type: 'object', properties: { summary: { type: 'string' }, changed: { type: 'array', items: { type: 'string' } }, smokeOk: { type: 'boolean' } }, required: ['summary', 'changed', 'smokeOk'] }
const CRITIC_SCHEMA = { type: 'object', properties: { score: { type: 'number' }, verdict: { type: 'string' }, mustFix: { type: 'array', items: { type: 'string' } } }, required: ['score', 'verdict', 'mustFix'] }

phase('Integration')
const integ = await agent(`${COMMON}
${HD2D}
TASK: make the hero sit in the diorama like a real HD-2D character. You own src/render/sprites/spriteBillboard.js, src/render/sprites/spriteSheet.js, and may make small targeted edits to src/render/renderer.js (post chain) and src/render/lighting.js ONLY where needed for the below.
1. TEXEL CRISPNESS: the sprite's texels currently land on a non-integer screen grid, so pixel blocks come out uneven (3px, 4px, 3px) and read as soft/ragged. Fix so one sprite texel maps to a near-constant, ideally integer, number of screen pixels: derive the billboard's world size from the camera's projected pixels-per-world-unit at the sprite's depth, and snap the quad's world position and size so texel edges align to screen pixels. Document the maths in a comment.
2. POST-PROCESSING: bloom and film grain are crawling over the pixel art and softening it. Keep the scene's atmosphere but protect the sprites — e.g. render characters so grain does not speckle flat colours and bloom only blooms genuinely bright pixels (raise the bloom threshold and/or exclude sprite pixels below it). Do not flatten the whole scene's look to achieve this.
3. CONTACT SHADOW: the blob exists but is too soft and wide to ground the character. Make it read as contact: tighter core directly under the feet with a fast falloff, a wider faint ambient occlusion halo, scaled to the sprite's actual foot width, and darker directly beneath. Verify by toggling and comparing crops.
4. SCENE LIGHT RESPONSE: in the showcase the hero reads periwinkle-grey against a warm gold room while two torches blaze two tiles away — it looks like a sticker. Make sprites take a real warm key and rim from nearby torch lights and the player's lantern, so the character sits in the room's light, while the hand-picked ramps still survive (do not just tint the whole sprite).
Verify: shot 'hero-showcase', 'hero-in-game', 'default' and crop/zoom under the boots and on the face; Read them and iterate until the sprite is crisp, grounded and lit. npm run smoke must print SMOKE OK and node --test tests/ must pass.
Commit only your files: cd /home/user/Neural-Razz-Arena && git add fargoal/src/render && git commit -m "HD-2D integration: texel snapping, grounded contact shadow, sprite light response" && git push origin claude/sword-of-fargoal-remake-nahftb
Return {summary, changed, smokeOk}.`,
  { label: 'hd2d:integration', phase: 'Integration', schema: BUILD_SCHEMA })
log(`Integration: smoke=${integ?.smokeOk}`)

phase('Bestiary')
// Groups are sized so each agent can give every monster real attention.
const GROUPS = [
  { key: 'vermin', monsters: 'the small fast fodder of the upper dungeon: giant rat, vampire bat, spider, slime/green slime, kobold' },
  { key: 'humanoid', monsters: 'the humanoid warriors: hobgoblin, orc/goblin, barbarian, assassin/thief, ranger' },
  { key: 'caster', monsters: 'the spellcasters and tricksters: mage, warlock, sprite (invisible shimmer), wizard/illusionist' },
  { key: 'undead', monsters: 'the undead and horrors: ghoul, wraith, vampire, werewolf' },
  { key: 'boss', monsters: 'the heavies of the deep: ogre, salamander, dragon, and the Demon/mage guardian of the Sword' },
]

const cast = await pipeline(GROUPS, async (g) => {
  return await agent(`${COMMON}
${HD2D}
TASK: convert ${g.monsters} from 3D low-poly meshes to HD-2D pixel sprites, matching the hero's art style exactly (same ramp discipline, outline treatment, key-light direction and pixel density).
Read docs/DESIGN.md for each monster's role, depth range and behaviour, and src/render/characters.js to see how monsters are currently built and animated and what the renderer calls on them.
You own a NEW file src/render/sprites/monsters/${g.key}.js (create it) exporting a builder per monster in your group, registered through a shared registry. If a shared registry file (src/render/sprites/monsters/index.js) does not exist yet, create it defensively: a plain map from monster type -> builder, merging whatever other group files export, written so concurrent agents adding their own group do not clobber each other (import each group module and spread its exports; if another agent already created it, ADD your import line with a targeted Edit rather than rewriting the file). Then make characters.js use a sprite billboard for any monster type present in the registry and fall back to the existing mesh for the rest — a tiny, additive edit at the single place monsters are constructed.
Per monster: canvas sized to its bulk (small vermin ~24x24, humanoids ~32x40, ogre/dragon ~48x56), 3/4 top-down facings south/east/north (west mirrored), and animation clips idle (4), walk (4-6), attack (4), hurt (2), death (4-5). Each monster needs a silhouette nobody could confuse with another and one signature detail (the bat's membrane wings mid-flap, the slime's translucent wobble and inner nucleus, the dragon's horns and wing arch, the wraith's tattered translucent hem, the spider's eight articulated legs, the mage's broad hat and staff).
Register a debug scenario 'bestiary-${g.key}' in src/debug/scenarios.js (targeted additive Edit, never rewrite the file) showing your monsters in a lit room in a labelled row facing the camera, plus reuse the existing 'bestiary' scenario if it already lists all monsters.
Verify: shot 'bestiary-${g.key}', Read it, and iterate several times until every sprite reads. npm run smoke must print SMOKE OK and node --test tests/ must pass.
Commit only your files: cd /home/user/Neural-Razz-Arena && git add fargoal/src/render/sprites/monsters fargoal/src/render/characters.js fargoal/src/debug/scenarios.js && git commit -m "HD-2D bestiary: ${g.key} sprites" && git push origin claude/sword-of-fargoal-remake-nahftb  (if git reports index.lock, wait 5s and retry — other agents commit too; never use git add -A, never rebase or force-push)
Return {summary, changed, smokeOk}.`,
    { label: `bestiary:${g.key}`, phase: 'Bestiary', schema: BUILD_SCHEMA })
})
log(`Bestiary groups done: ${cast.filter(Boolean).length}/${GROUPS.length}`)

phase('Judge')
const [art, cohesion] = await parallel([
  () => agent(`${COMMON}
${HD2D}
You are a legendary pixel artist and HD-2D art director, notoriously impossible to please. Review the FULL CAST (hero + every monster) now that monsters are sprites too.
Procedure: shot 'bestiary' and each 'bestiary-<group>' scenario, plus 'combat', 'deep-level', 'hero-showcase' and 'default'; Read every PNG. Judge silhouette distinctiveness, ramp/outline consistency across artists (five different agents drew these groups — look hard for style drift: differing outline darkness, pixel density, key-light direction, saturation), animation quality, and whether the scene now reads as one coherent HD-2D world rather than a hero pasted into it.
Scoring: 10 flawless Square Enix; 9 AAA sign-off; 7-8 good indie; 5-6 programmer art; <5 broken. Default to FAILING; 9+ requires NO must-fix items. Every must-fix names what, where (which shot, which monster) and what a master would do instead. Do not edit files.
Return {score, verdict, mustFix}.`, { label: 'judge:art', phase: 'Judge', schema: CRITIC_SCHEMA, effort: 'high' }),
  () => agent(`${COMMON}
${HD2D}
You are a brutally demanding art director judging ONE thing: does this look like a single game made by one studio, or like five artists who never spoke? Shot every 'bestiary-<group>' scenario and 'combat' and 'deep-level'; Read them and compare the groups against each other and against the hero.
Report concrete inconsistencies: outline colour/darkness differences, pixel-density mismatches (a monster drawn at a different effective resolution than its neighbours), key-light coming from different directions, saturation or value-range drift, scale errors (a rat as tall as an ogre), and any monster still rendering as a 3D mesh among sprites.
Same scoring and failure bias as any AAA art director. Do not edit files.
Return {score, verdict, mustFix}.`, { label: 'judge:cohesion', phase: 'Judge', schema: CRITIC_SCHEMA, effort: 'high' }),
])

return { integration: integ, cast: cast.filter(Boolean).map((c) => c?.summary?.slice(0, 200)), judge: { art, cohesion } }
