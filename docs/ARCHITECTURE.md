# Sword of Fargoal — Modern Remake: Architecture Contract

Everything lives in `fargoal/`. Vite + Three.js (0.170), vanilla ES modules, no framework, no external
assets (all textures, models, sounds are generated procedurally in code). Target: 60 fps at 1600x900
on integrated GPUs; it must also render in headless SwiftShader (used by the screenshot tools).

## Ground rules for every agent
- Own only the files you are assigned. To hook into other systems, use the event bus (`core/events.js`)
  and the registries below — never rewrite someone else's module. If you must touch a shared file
  (`main.js`, `styles.css`), make the smallest possible additive edit.
- Deterministic: all randomness goes through `core/rng.js` seeded from `?seed=`. No `Math.random()`.
- The game must never be left broken: run `npm run smoke` (loads the game, runs every debug scenario,
  fails on console errors or a blank canvas) before you finish. Run `node --test tests/` for logic.
- Screenshots: `node tools/shot.mjs --scenario <name> --out shots/<name>.png` (see Debug API).
- Fixed-timestep simulation (`SIM_DT = 1/30 s`) separated from rendering (interpolated). Game time
  advances only via `Game.update(dtSeconds)`, so `debug.step(ms)` can drive it headlessly.
- Code style: ES2022, 2-space indent, JSDoc types on exported functions, small pure functions.

## Directory layout & ownership
```
src/main.js                 bootstrap: creates Game, Renderer, UI; requestAnimationFrame loop; exposes window.__game
src/core/constants.js       TILE enum, TILE_SIZE (1 world unit), SIM_DT, directions, colors, balance tables
src/core/rng.js             mulberry32-style seeded RNG: createRng(seed) -> { next(), int(a,b), pick(arr), chance(p), shuffle(arr), fork(label) }
src/core/events.js          EventBus: on(name, fn) -> off, once, emit(name, payload). Global `bus` export.
src/core/input.js           Input: keyboard (WASD/arrows/numpad/vi-keys, hotkeys), mouse click-to-move, gamepad; emits 'input:*' events
src/core/audio.js           AudioEngine: procedural WebAudio SFX + adaptive ambient music; listens to game events
src/core/save.js            save/load to localStorage (versioned JSON via Game.serialize()/Game.deserialize())
src/game/game.js            Game: owns GameState, orchestrates levels, player, monsters, timers, sword-quest rules
src/game/state.js           plain-data GameState schema + factory (serializable)
src/game/player.js          player stats, leveling, inventory, spells, actions (move/attack/use/cast/descend/ascend)
src/game/monsters.js        MONSTER_TABLE (all original monsters + stats + behaviors) and monster AI update
src/game/items.js           ITEM_TABLE, SPELL_TABLE, treasure generation, effects
src/game/combat.js          combat resolution (attack rolls, damage, XP), fleeing, death
src/game/quest.js           Sword of Fargoal quest: sword placement depth, pickup timer, escape victory
src/world/generator.js      generateLevel(seed, depth) -> Level (rooms, winding corridors, stairs, pits, temples, traps, treasure, monsters)
src/world/level.js          Level class: tiles grid, entities, explored/visible masks, walkability, neighbors
src/world/fov.js            computeVisibility(level, x, y, radius) (symmetric shadowcasting), fog-of-war memory
src/world/pathfinding.js    aStar(level, from, to, opts), flowField for monsters
src/render/renderer.js      Renderer: Three scene, camera rig, post-processing (bloom, vignette, SSAO-ish), resize, render(alpha)
src/render/dungeon.js       DungeonView: builds/updates instanced tile meshes for a Level (floors, walls, water, stairs, pits, temple, traps)
src/render/materials.js     procedural canvas/shader textures & materials (stone, moss, water, gold, magic) + palette
src/render/characters.js    CharacterFactory: procedural low-poly meshes + rigs for player and every monster; animation clips
src/render/props.js         item/treasure/torch/altar prop meshes and pickup animations
src/render/lighting.js      ambient + torch flicker + player light + fog-of-war darkness shader (explored/visible/unknown)
src/render/effects.js       ParticleSystem + one-shot effects (hit sparks, blood, spell bursts, teleport, level-up, gold sparkle), camera shake, floating damage numbers
src/render/camera.js        follows player smoothly, zoom, screen-shake hooks, cinematic transitions (descend/ascend)
src/ui/styles.css           all CSS (design tokens at top: --font-display, --gold, --ink, ...)
src/ui/hud.js               HP/XP/gold/depth/sword-timer, spell & item hotbar with counts, status effects
src/ui/log.js               message log with categories/colors, fade-out, scrollable history
src/ui/inventory.js         inventory/spellbook/character panel (keyboard + mouse)
src/ui/minimap.js           minimap (explored tiles, stairs, temples, player) drawn on a 2D canvas overlay
src/ui/menus.js             title screen, new-game/difficulty, pause, help/controls, settings (volume, screen shake), death & victory screens, hall of fame
src/ui/tooltip.js           hover tooltips for tiles/monsters/items (mouse-over via renderer picking)
src/debug/scenarios.js      registry of screenshot scenarios (see below)
tests/*.test.js             node:test unit tests for pure logic (generator, fov, combat, rng, quest)
tools/shot.mjs, smoke.mjs   screenshot and smoke tools (do not modify without reason)
```

## Core data contracts
```js
// constants.js
export const TILE = { WALL: 0, FLOOR: 1, CORRIDOR: 2, STAIRS_DOWN: 3, STAIRS_UP: 4, PIT: 5, TEMPLE: 6, WATER: 7, DOOR: 8, TRAP_TELEPORT: 9, TRAP_PIT: 10, RUBBLE: 11 };
// Level (world/level.js)
class Level { depth, width, height, seed, tiles: Uint8Array, explored: Uint8Array, visible: Uint8Array,
  rooms: [{x,y,w,h,type}], entities: Entity[], items: ItemInstance[], stairsUp:{x,y}, stairsDown:{x,y}|null, temples:[{x,y}],
  get(x,y), set(x,y,t), isWalkable(x,y), inBounds(x,y), entityAt(x,y), itemsAt(x,y), addEntity(e), removeEntity(e) }
// Entity (monsters + player share this shape)
{ id, kind:'player'|'monster', type:'kobold'|..., x, y, px, py (render-interpolated position), facing:{dx,dy}, hp, maxHp, level, xpValue,
  speed (moves per second), moveTimer, state:'idle'|'wander'|'hunt'|'flee'|'attack'|'dead', target, invisible, flags:{...}, statusEffects:[] }
// ItemInstance: { id, type, x, y, qty, gold?, hidden? }
```

## Events (bus.emit(name, payload)) — the glue between game, renderer, UI, audio
- 'level:enter' {level, depth, via:'stairs'|'pit'|'teleport'|'new'}
- 'entity:moved' {entity, fromX, fromY, toX, toY}
- 'entity:attacked' {attacker, defender, damage, killed, crit}
- 'entity:died' {entity, killer}
- 'player:hp' {hp, maxHp}, 'player:xp' {xp, level, leveledUp}, 'player:gold' {gold, delta}
- 'item:picked' {item, entity}, 'item:used' {item}, 'spell:cast' {spell, x, y, target}
- 'trap:triggered' {type, x, y}, 'temple:sacrifice' {gold, xp}, 'sword:found', 'sword:timer' {remaining}
- 'log' {text, kind:'info'|'combat'|'loot'|'danger'|'magic'|'quest'}
- 'game:over' {victory:boolean, cause, stats}, 'game:paused' {paused}
- 'fx:*' arbitrary visual-effect requests (renderer listens), 'sfx:*' audio requests (audio listens)

## Debug API (required — screenshot tools depend on it)
`window.__game = { game, renderer, ui, debug }` where
```js
debug = {
  step(ms),                       // advance simulation + render deterministically (no RAF needed)
  scenarios: { name: async (ctx) => {} }, // registry, populated by src/debug/scenarios.js
  runScenario(name, {seed}) -> Promise<boolean>, // false if unknown
  setSeed(seed), goToDepth(d), teleport(x,y), revealAll(), spawn(type, x, y), give(itemType, qty), heal(), kill(entity), setTime(hourOfDay?)
}
```
Every visual feature MUST register at least one scenario that shows it at its best (e.g. 'title', 'dungeon-overview',
'combat', 'spell-teleport', 'temple', 'inventory', 'minimap', 'death', 'victory', 'sword-found').
`?debug=1&seed=N&scenario=X` on the URL skips the title screen, applies the seed, and runs scenario X after load.
`window.__GAME_READY = true` must be set once the first frame has rendered.
