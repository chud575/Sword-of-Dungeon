# AMBIENCE — the room-archetype bible

**Status: binding contract.** `ARCHITECTURE.md` binds code structure, `DESIGN.md` binds rules and
numbers, `src/render/sprites/style.js` binds how a pixel is painted. **This file binds what is IN
the rooms** — the furniture, the scatter, the light, and the exact data the generator hands the
renderer to put it there.

---

## 0. The problem, and the two references

Our dungeon is handsome and **empty**. Well-built halls, correct light, nothing standing in them.
A player walks a level and cannot tell one room from the next, because nothing in a room says what
the room is *for*.

**HeroQuest (Milton Bradley, 1989)** solved this with a manifest of *twelve* furniture pieces on a
board that is otherwise bare cardboard: 3 treasure chests, 2 bookcases, 2 tables, 1 throne,
1 alchemist's bench, 1 sorcerer's table, 1 tomb, 1 torture rack, 1 fireplace, 1 weapons rack,
1 cupboard — plus cheap scatter (2 candlesticks, bottles, scales, 10 skulls, 4 rats) and board
features (doors in frames, a stairway, pits, secret doors, blocked squares). **Corridors are bare.
Rooms carry the character.** Every piece reads from directly overhead, because the board is seen
from above — which is exactly our camera.

Two rules fall out of that and both are law here:

1. **Furniture is identity.** One silhouette per room says *armoury / study / crypt*. Not a set
   dressing budget spent evenly — a statement per room.
2. **Scarcity is the point.** One throne on the level. One rack. Two bookcases. A dungeon where
   every room has a throne has no throne in it. See §6, the per-level manifest.

**Dungeon Crawlers HD (Drowning Monkeys)** supplies the other half: painted, high-frequency surface
detail, and *a reason for each area to look different from the last* — goblin corridors, lava
caverns, flooded works. So: HeroQuest's discipline about **what stands on the floor**, Dungeon
Crawlers' appetite for **density and per-region variety**. Depth is our region axis (§2).

**And the standing lesson of this project, proven three times: sheet-level metrics lie.** Nothing in
here is done until it has been judged in a rendered frame at the play camera
(`node tools/shot.mjs`, `node tools/audit.mjs`), not in an atlas. See §10.

---

## 1. The grid, the paint, and the camera (non-negotiable)

Everything in this document is drawn to these numbers. They are not restated per piece.

| Fact | Value | Source |
|---|---|---|
| Texels per world tile | `PX_PER_TILE = 32` | `render/sprites/spriteBillboard.js` |
| The hero's figure height | `HERO_FIGURE_PX = 46` texels (≈1.44 tiles) | `style.js` |
| Texel size on screen | `frameTexelSize(renderer, camera, PX_PER_TILE)` — **one integer for the whole frame** | `spriteBillboard.js` |
| Camera | ORTHOGRAPHIC plan view, fixed 17° off vertical (player 0–45 in Settings). `camera.fov` is `undefined`; scale comes off `camera.top/bottom` and `camera.zoom` | `render/camera.js` |
| Outline ink | `INK #17111f`, lit edge `INK_LIT #4e4459`, voids `INK_DEEP #120c1c` | `style.js` |
| Key light | `LIT = {x:-1, y:-1}` — **top-left, always, every piece, every facing** | `style.js` |
| Colour | `ramp(base, 5..7)` hue-shifted steps. Never a flat darken | `style.js` |
| Gamut ceilings | `VALUE_CEIL 0.92`, `CHROMA_CEIL 0.60`, body-mean chroma ≤ `0.24`, `VALUE_FLOOR 0.22` | `style.js` |
| Form | No pillow shading (`FORM_PILLOW_MAX 0.15`), no banding, one-pixel contour | `style.js` |

**ONE PIXEL GRID.** A decor piece is built through the *existing* helpers and no others:

| Class | Helper | Geometry | Pivot |
|---|---|---|---|
| Standing prop | `pixelSprite(key, art, pal, o)` in `render/props.js` | screen-aligned quad, sized by `frameTexelSize()` | bottom art row on the flagstone, `y = ITEM_PIVOT_Y = 0.01` |
| Floor decal | `floorDecal(key, painter, pal, o)` | 1×1 tile quad, `rotation.x = -π/2`, `userData.floorDecal = true` (dungeon.js turns these with the slab) | tile centre, `y ≈ 0.02` |
| Wall-mounted | group placed like `PropFactory.torch()` | meshes/quad at `(x + dx*0.5, mountY, y + dy*0.5)`, yaw from `facing` | bottom art row at `mountY` |

Nobody sizes a quad from its own distance to the camera. Nobody invents a texel size. Props have a
**measured history of drifting off this grid** and `tests/screenTruth.test.js` will fail you for it
(`edgeAlign`, `runTexels` on the PROPS row of the audit table).

**Art boxes are whole texels** and are given per type in §5. Two hard caps:

- **No standing prop may exceed 46 texels tall** (the hero's own figure height). Something that
  wants to look bigger asks for *more texels of art*, never for fatter ones, and never for a piece
  that hides the cast.
- **Every decor piece occupies exactly one tile.** Big furniture reads big by being *tall and wide
  within its tile* and by being placed against a long wall — not by spanning tiles. The one
  exception is a declared *run* (`tableLong`, `bunk`, `ossuaryShelf`), which is several one-tile
  entries in a line; see §5.4.

---

## 2. Depth bands — why deep rooms feel older

Bands are keyed to `depthTint()` in `render/lighting.js` and to `levelStyle()` in
`world/generator.js`, so ambience and grading agree.

| Band | Depth | Grade (`depthTint`) | Level style | The fiction | The feel |
|---|---|---|---|---|---|
| **B0** | 0 | daylight blue | `surface` | The temple of Ferrin at the mountain's foot | Open air, one archetype (`courtyard`) |
| **B1** | 1–5 | warm ochre | `masonry` | The garrison of Umla's men-at-arms: still *used* | Torchlit, swept, furniture intact, banners hung |
| **B2** | 6–12 | cold blue-grey | `masonry`/`ruin` | The old works: goblinoid squats in a human keep | Half the torches dead, furniture broken and re-used, filth |
| **B3** | 13–18 | green-black | `ruin`/`cavern` | Older than the keep: crypts, drake dens, water | Cold, wet, fungal; furniture is wreckage; bone everywhere |
| **B4** | 19+ | red-violet | `cavern` | The demon's floor | Scorched, chained, ember-lit, almost nothing man-made survives |
| **BS** | sword level (15–19) | as its band | `obsidian` | Where Umla hid the Sword | Violet, silent, unfurnished except tombs and rubble |

### 2.1 `room.decay` — one number carries "older, colder, more ruined"

```js
room.decay = clamp01((depth - 1) / 18 + rng.float(-0.12, 0.12));   // 0 = kept, 1 = ruin
```

It is a **per-room field the renderer reads** and the generator obeys:

| `decay` | Variant choice | Scatter weights | Light mood drift |
|---|---|---|---|
| 0.00–0.25 | variant 0–1 (intact) | rugs, banners, candles up; bones, scree down | keep the archetype's mood |
| 0.25–0.55 | variant 1–2 (worn) | cobweb ×2, bones ×2, rug ×0.5 | `torchlit` → `torchlit` (one torch instead of two) |
| 0.55–0.80 | variant 2–3 (broken) | scree ×3, bones ×3, banner ×0.2, rug ×0 | `torchlit` → `ember`, `hearth` → `ember` |
| 0.80–1.00 | highest variant (wreck) | scree ×4, bones ×4, rime/lichen on, candles off | `ember` → `cold`, `candle` → `dark` |

**Variant index convention (law):** for every type, **lower variant = more intact, higher variant =
more ruined**. An agent painting variants must order them that way or `decay` inverts.

---

## 3. THE BARE-CORRIDOR RULE

> Corridors are the board between the rooms. They stay bare so the rooms can speak.

Binding limits for anything the generator writes on a `TILE.CORRIDOR` tile:

| Rule | Value |
|---|---|
| Level-wide corridor decor budget | **≤ 1 piece per 10 corridor tiles**, hard cap **12 pieces per level** |
| Never adjacent | no two corridor pieces within **2 tiles** of each other (Chebyshev) |
| Never near a door | nothing within **2 tiles** of a `TILE.DOOR` |
| Never blocking | corridor decor is **always `blocking:false`**, no exception. A blocked corridor can sever a level |
| Never furniture | only the types in the table below may appear in a corridor |

**The whole corridor catalogue** (weights are relative, within the budget above):

| Type | Class | Weight | Notes |
|---|---|---|---|
| `bones` | decal | 5 | a dropped ribcage, scattered femurs |
| `scree` | decal | 4 | grit spilling from a crack; heavier as `decay` rises |
| `puddle` | decal | 3 | only where a `TILE.WATER` tile is within 6, or `decay > 0.5` |
| `sconce` | wall | 3 | **unlit** iron bracket (the *lit* torches are `lighting.js`'s job, not decor) |
| `cobweb` | wall | 3 | corners only: a wall tile with wall on an adjacent side |
| `wallCrack` | wall | 2 | |
| `skull` | prop | 2 | one skull, never a pile, never in a run |
| `bloodstain` | decal | 1 | only depth ≥ 3 |
| `mould` | wall | 1 | depth ≥ 6 |
| `rat` | prop | 1 | depth ≤ 12; a rat in a corridor is a jump-scare, not a crowd |

**Dead ends are the one indulgence.** A corridor tile with exactly one walkable neighbour may take
**one extra** piece (`bones`, `scree`, `rubbleMound` — still non-blocking) outside the budget, at
30 % chance. That is the "someone died here" beat, and it is the only story a corridor tells.

Rubble as *terrain* is unaffected: `TILE.RUBBLE` is placed by `placeRubble()` and is not decor.

---

## 4. THE DATA CONTRACT

This is what every other agent codes against. It is exact; treat any deviation as a bug.

### 4.1 `level.decor`

```js
/**
 * @typedef {Object} Decor
 * @property {string}  type      one of the ids in §5. Required. Unknown ids are dropped by the
 *                               renderer with one console.warn per level, never an exception.
 * @property {number}  x         integer tile column. For wall-mounted pieces this is the WALL tile.
 * @property {number}  y         integer tile row.    For wall-mounted pieces this is the WALL tile.
 * @property {'n'|'e'|'s'|'w'} facing  the direction the FRONT of the piece looks toward.
 * @property {number}  variant   integer >= 0, < VARIANTS[type] (§5). Lower = intact, higher = ruined.
 * @property {boolean} blocking  true only for a piece the player and monsters cannot walk through.
 */
level.decor = [];   // Decor[]  — always an array, never null, empty on depth 0 unless dressed
```

**All six fields are required and present on every entry.** No `undefined`, no optional-by-omission.
Entries are plain JSON-safe data (numbers, strings, booleans) — nothing else, ever. No extra fields
without an edit to this document.

**Coordinate law**

- `facing` is the direction the piece's front looks, in level coordinates:
  `'n'` = −y, `'e'` = +x, `'s'` = +y, `'w'` = −x. Yaw for the renderer:
  `{ n: 0, e: Math.PI/2, s: Math.PI, w: -Math.PI/2 }`.
- A **standing prop** stands ON the walkable tile `(x,y)` and faces `facing`. Against a wall it
  faces **away from the wall, into the room**.
- A **floor decal** is on the walkable tile `(x,y)`; `facing` rotates the decal quad by 90° steps.
- A **wall-mounted** piece has `(x,y)` = the `TILE.WALL` tile it hangs on, and `facing` = the
  direction from that wall tile into the open tile it looks at
  (`level.get(x + dx, y + dy)` must be walkable). It is drawn at
  `(x + dx*0.5, mountY, y + dy*0.5)`, mirroring `lighting.js`'s torch spots.

**Ordering and determinism.** `level.decor` is built in one deterministic pass from
`createRng(seedFrom(level.seed, 'decor'))`. Same seed + depth ⇒ byte-identical array, same order.
No `Math.random` anywhere, ever (`ARCHITECTURE.md`). Sort order is placement order: furniture first
(per room, in `level.rooms` order), then room scatter, then corridor scatter. The renderer must not
depend on the order for correctness, but tests do compare arrays.

**Serialization.** `Level.serialize()` adds `decor: this.decor.map((d) => ({ ...d }))` and
`Level.deserialize()` restores `lv.decor = (d.decor || []).map((x) => ({ ...x }))`. The `|| []`
matters: old saves have no decor and must still load.

**Queries** (`world/level.js`, additive):

```js
level.decorAt(x, y)         // Decor[] on that tile (usually 0 or 1; a decal + a prop is legal)
level.decorBlocked(x, y)    // boolean — is a blocking decor piece standing here?
```

### 4.2 Per-room fields

Set by the generator on every entry of `level.rooms`. Existing fields (`x, y, w, h, type, cx, cy,
shape, area, door`) are **unchanged** — `type` stays the carve-time role the generator already
assigns (`hall`, `cave`, `grotto`, `cistern`, `crypt`, `library`, `barracks`, `vault`, `temple`,
`shrine`, `alcove`, `surface`). Archetype is a new layer on top of it.

| Field | Type | Meaning |
|---|---|---|
| `room.archetype` | `string` | one of the 24 ids in §6. **Always set**, `'bare'` when the room is deliberately empty. |
| `room.lightMood` | `string` | one of the 11 moods in §7. Always set. |
| `room.decay` | `number` 0..1 | §2.1. Always set. |
| `room.decorSeed` | `number` | integer; the fork the room's dressing was rolled from, so a single room can be re-dressed without re-rolling the level. |

Side rooms (`temple`, `shrine`, `alcove`) get `archetype: 'shrine'` / `'shrine'` / `'bare'`
respectively and are never given furniture beyond §6's shrine row.

### 4.3 BLOCKING IS DANGEROUS

> A piece that blocks a tile can seal a room, strand the stairs, or wall the player away from the
> only staircase down. A level that cannot be finished is worse than a level that is empty.

**The rule, plainly:**

1. **Decor is NON-BLOCKING by default.** `blocking:false` unless the type is in the blockable set
   below *and* the generator has re-verified connectivity afterwards. When in doubt: `false`.
2. **Only these types may ever carry `blocking:true`** — everything else is a hard error:
   `sarcophagus`, `fallenColumn`, `pillarBroken`, `rubbleMound`, `stalagmite`, `wellHead`, `cage`,
   `forge`, `anvil`.
3. **Never blocking on, or orthogonally adjacent to:** any staircase (`stairsUp`, every entry of
   `stairsDownAll`), any `TILE.TEMPLE`, any `TILE.DOOR`, any `TILE.PIT`, any trap in `level.traps`,
   any tile holding an `ItemInstance`, the tile of any entity, the player's start tile, or any
   `TILE.CORRIDOR` tile at all.
4. **Never on the only route.** After placing blocking decor the generator MUST flood-fill from
   `level.stairsUp` across `isWalkable(x,y) && !decorBlocked(x,y)` and prove that every staircase,
   every temple, every item, every alcove cache, every entity spawn and every room's `cx,cy` is
   still reached. If anything is unreachable, **drop blocking pieces in reverse placement order**
   (set `blocking:false`, or remove the piece) until the fill passes, and record
   `level.debug.decorBlockDrops`.
5. **Budget.** At most **2** blocking pieces per room, and never more than **1 per 12** of that
   room's floor tiles. A room with fewer than 12 floor tiles gets none.
6. **A blocking piece must not be the only thing between two halves of a room** either: a room's
   free floor must stay 4-connected (§8, density rule 4).
7. **Blocking blocks MOVEMENT ONLY.** Decor never changes `isOpaqueTile`, never occludes FOV, never
   changes light, never blocks pickup, and never changes a tile's `TILE` value.
   `world/fov.js` is untouched by this feature.
8. **Pathfinding and AI must agree with the player.** Whoever owns `world/level.js` folds
   `decorBlocked()` into `isWalkable()` (or every consumer — `pathfinding.js`, monster AI,
   click-to-move, auto-explore, teleport target picking, wandering-monster spawn — checks it).
   One source of truth; a monster that walks through a sarcophagus the player cannot is a bug.

**Required test** (`tests/generator.test.js` or a new `tests/decor.test.js`): for seeds × depths
1…20, assert every invariant in 1–6 and that the flood fill in 4 passes with zero drops needed on
at least 95 % of levels (drops are a safety net, not a strategy).

### 4.4 Where decor may never go, blocking or not

`level.decorForbidden(x, y)` must be true for:

- `TILE.WALL` (except as the mount tile of a wall-mounted piece), `TILE.DOOR`, `TILE.STAIRS_UP`,
  `TILE.STAIRS_DOWN`, `TILE.TEMPLE`, `TILE.PIT`, `TILE.WATER`, `TILE.TRAP_TELEPORT`, `TILE.TRAP_PIT`
- any tile in `level.traps` (revealed or not — decor must not mark a hidden trap)
- any tile holding an item (`level.itemsAt(x,y).length`)
- any tile holding an entity, and the player's start tile
- the **door throat**: a `TILE.DOOR` tile and the walkable tile on each side of it
- the 8 neighbours of any staircase (nothing crowds a staircase — see §9)
- `TILE.RUBBLE` may take decals only (it is already dressed terrain), never a standing prop

---

## 5. THE TYPE CATALOGUE

Three classes. **`class` is a property of the TYPE, not of the entry** — a `bookcase` is always a
standing prop, a `rug` is always a decal, a `banner` is always wall-mounted. Agents ship these in
tier order (§5.5).

`W×H` is the art box in **texels** (32 texels = one tile). `V` is the number of variants that must
exist (`variant` is always `0 ≤ v < V`, lower = intact). `Blk` = may ever be `blocking:true`.

### 5.1 Standing props (billboard, pivot on the floor row)

| type | W×H | V | Blk | Faces? | Reads as |
|---|---|---|---|---|---|
| `strongbox` | 20×16 | 3 | – | yes | banded treasure chest, lid shut |
| `bookcase` | 26×46 | 4 | – | yes | tall shelves, spines and gaps |
| `cupboard` | 22×40 | 3 | – | yes | closed press, one door ajar at v≥1 |
| `lectern` | 16×30 | 3 | – | yes | slanted desk, open book |
| `table` | 30×22 | 4 | – | yes | plank table, seen from above |
| `tableLong` | 32×22 | 3 | – | yes | **run piece** — v0 end, v1 middle, v2 end (§5.4) |
| `bench` | 26×12 | 2 | – | yes | |
| `stool` | 12×14 | 2 | – | – | |
| `throne` | 24×44 | 2 | – | yes | high back, arms, a step |
| `sarcophagus` | 30×20 | 4 | **yes** | yes | stone coffin, lid on (v0) → slid off (v3) |
| `tombSlab` | 30×14 | 3 | – | yes | low grave slab, carved |
| `urn` | 14×20 | 3 | – | – | ash jar; v2 cracked |
| `alchemyBench` | 30×26 | 3 | – | yes | bench of glass and copper |
| `retortStand` | 16×26 | 2 | – | yes | glass retort over a burner |
| `scales` | 14×18 | 2 | – | yes | brass balance |
| `cauldron` | 20×22 | 3 | – | – | iron pot on a tripod |
| `brazier` | 18×30 | 4 | – | – | v0 burning, v3 cold and tipped |
| `hearth` | 32×40 | 3 | **–** | yes | fireplace; **wall-adjacent, faces into the room** |
| `forge` | 30×36 | 2 | **yes** | yes | stone forge, coals |
| `anvil` | 18×18 | 2 | **yes** | – | |
| `weaponRack` | 26×42 | 4 | – | yes | spears and blades upright |
| `shieldStand` | 22×32 | 3 | – | yes | |
| `armourStand` | 18×40 | 3 | – | yes | mail on a frame; v2 empty |
| `barrel` | 14×20 | 3 | – | – | v2 staved in |
| `crate` | 18×18 | 3 | – | – | |
| `sackPile` | 20×14 | 3 | – | – | grain sacks |
| `bunk` | 30×24 | 3 | – | yes | **run piece** — two-tier cot |
| `footlocker` | 18×12 | 2 | – | yes | |
| `rack` | 30×26 | 2 | – | yes | the torture rack; rollers and rope |
| `chainPost` | 10×34 | 3 | – | – | post with hanging manacles |
| `cage` | 26×40 | 3 | **yes** | yes | iron bars; v2 door hanging open |
| `wellHead` | 28×26 | 2 | **yes** | – | stone kerb, rope, windlass |
| `pillarBroken` | 20×26 | 3 | **yes** | – | column snapped off |
| `fallenColumn` | 32×14 | 3 | **yes** | yes | column lying down, spans its tile |
| `rubbleMound` | 24×14 | 4 | **yes** | – | heaped collapse |
| `stalagmite` | 14×28 | 4 | **yes** | – | |
| `dripstone` | 16×44 | 3 | – | – | floor-to-ceiling column of flowstone |
| `mushroomCluster` | 18×14 | 4 | – | – | pale caps, faint glow at v≥2 |
| `candlestick` | 8×22 | 3 | – | – | one candle, guttering |
| `candelabra` | 14×30 | 3 | – | – | |
| `skull` | 8×7 | 3 | – | yes | one skull — the cheapest storytelling in the catalogue |
| `skullPile` | 16×12 | 3 | – | – | |
| `bonePile` | 20×10 | 3 | – | – | ribs and long bones |
| `rat` | 12×8 | 2 | – | yes | scatter, never an entity, never fought |
| `bottles` | 14×12 | 3 | – | – | |
| `tankards` | 12×8 | 2 | – | – | |
| `dice` | 6×4 | 2 | – | – | bone dice, a spilled cup |

### 5.2 Floor decals (1×1 tile quad, turned with the slab)

Every decal is painted into a **32×32 texel** canvas whatever it draws.

| type | V | Reads as |
|---|---|---|
| `bones` | 4 | scattered bone |
| `scree` | 4 | grit and chips |
| `puddle` | 3 | standing water, a sky-slot of reflection |
| `bloodstain` | 3 | old, brown at v2 |
| `scorch` | 3 | soot star |
| `crackedFlags` | 3 | split flagstones |
| `mosaic` | 4 | laid pattern — masonry rooms only |
| `rug` | 3 | woven square; v2 rotted |
| `runner` | 2 | long carpet piece (**run piece**) |
| `chalkSigil` | 3 | drawn circle and marks |
| `spill` | 3 | alchemical stain, faint emissive at v0 |
| `ashBed` | 2 | hearth ash |
| `coins` | 3 | a few dropped coins (**cosmetic — not gold, not pickable**) |
| `sporePatch` | 3 | fungal mat |
| `lichen` | 3 | |
| `rime` | 2 | frost bloom, B3/B4 only |
| `drainGrate` | 2 | iron grate over a hole |

**`coins` is decoration.** It is never an `ItemInstance`, never picked up, never worth gold. Real
gold is `items` (`DESIGN.md` §5.2). Do not blur the two — a player who tries to pick up a decal
learns to distrust the whole screen.

### 5.3 Wall-mounted

`mountY` is the world y of the art's **bottom row**. Walls are 1.2 units tall; nothing may top 1.15.

| type | W×H | V | mountY | Reads as |
|---|---|---|---|---|
| `sconce` | 10×18 | 3 | 0.62 | **unlit** iron bracket (lit torches are `lighting.js`) |
| `banner` | 20×34 | 4 | 0.10 | hanging cloth, device on it; v3 shredded |
| `tapestry` | 28×36 | 3 | 0.08 | woven scene |
| `hungShield` | 18×18 | 4 | 0.66 | |
| `trophyArms` | 24×22 | 3 | 0.62 | crossed axes or spears |
| `chains` | 8×30 | 3 | 0.30 | |
| `manacles` | 14×14 | 2 | 0.44 | |
| `cobweb` | 20×20 | 4 | 0.80 | corner web; density rises with `decay` |
| `skullNiche` | 14×16 | 3 | 0.60 | skull in a carved recess |
| `ossuaryShelf` | 28×18 | 3 | 0.40 | stacked bone (**run piece**) |
| `ironRing` | 8×8 | 2 | 0.50 | tether ring |
| `gargoyleSpout` | 18×16 | 3 | 0.85 | carved head, drip below |
| `wallShelf` | 24×14 | 3 | 0.55 | jars and boxes |
| `plaque` | 18×12 | 3 | 0.70 | carved name, unreadable |
| `wallCrack` | 24×28 | 3 | 0.00 | |
| `mould` | 24×24 | 3 | 0.00 | damp bloom |
| `fungusShelf` | 20×14 | 3 | 0.35 | bracket fungus |

### 5.4 Run pieces

`tableLong`, `bunk`, `runner` and `ossuaryShelf` may form a straight run of **2–4** consecutive
entries. Rules: all entries share `facing`; the run lies along the axis perpendicular to `facing`
(a table against a north wall faces `'s'` and runs east–west); `variant` encodes the segment —
`0` = end, `1` = middle, `2` = end (mirrored) — and for `runner` `0`/`1` alternate. Every segment is
its own `Decor` entry on its own tile. **There is no multi-tile entry in this contract.**

### 5.5 Ship order

| Tier | Types | Why |
|---|---|---|
| **T1 — the HeroQuest manifest** (24) | `strongbox` `bookcase` `table` `throne` `alchemyBench` `sarcophagus` `rack` `hearth` `weaponRack` `cupboard` `candlestick` `bottles` `scales` `skull` `skullPile` `rat` `barrel` `crate` `brazier` · `bones` `bloodstain` `rug` · `sconce` `banner` | These alone furnish every archetype well enough to ship. Do these first and the dungeon stops being empty. |
| **T2 — density** (28) | `lectern` `bench` `stool` `tombSlab` `urn` `retortStand` `cauldron` `forge` `anvil` `shieldStand` `armourStand` `sackPile` `bunk` `footlocker` `chainPost` `cage` `wellHead` `bonePile` `tankards` `dice` `candelabra` · `scree` `scorch` `mosaic` `coins` · `tapestry` `hungShield` `chains` | Depth and wear; the dungeon starts to feel lived in and then abandoned. |
| **T3 — region flavour** (29) | `tableLong` `pillarBroken` `fallenColumn` `rubbleMound` `stalagmite` `dripstone` `mushroomCluster` · `puddle` `crackedFlags` `runner` `chalkSigil` `spill` `ashBed` `sporePatch` `lichen` `rime` `drainGrate` · `trophyArms` `manacles` `cobweb` `skullNiche` `ossuaryShelf` `ironRing` `gargoyleSpout` `wallShelf` `plaque` `wallCrack` `mould` `fungusShelf` | Per-region variety: caves, water, fungus, collapse — the Dungeon Crawlers half of the brief. |

An archetype whose furniture is not yet painted falls back to its T1 subset. It must never fall back
to *nothing* — a `scriptorium` with only two bookcases and a candle still reads as a scriptorium.

---

## 6. ROOM ARCHETYPES

24 ids. Every room gets one; `'bare'` is a legitimate, *deliberate* answer (§6.3).

### 6.1 Identity and dressing

"Signature" is the piece that must be there or the room is not that room.

| id | Signature | Furniture set | Scatter dressing | Wall |
|---|---|---|---|---|
| `guardroom` | `table` | table, 2–3 `stool`/`bench`, `weaponRack`, `brazier` | `tankards`, `dice`, `bottles`, `bones`, `coins` | `sconce`, `hungShield` |
| `barracks` | `bunk` | 2–4 `bunk` (runs), `footlocker`, `armourStand`, `stool` | `bottles`, `rat`, `bones`, `bloodstain` | `sconce`, `chains`, `hungShield` |
| `armoury` | `weaponRack` | 2–3 `weaponRack`, `shieldStand`, `armourStand`, `crate`, `anvil` | `scree`, `coins` | `trophyArms`, `hungShield`, `sconce` |
| `forge` | `forge` | `forge`, `anvil`, `barrel` (quench), `crate`, `weaponRack` | `ashBed`, `scorch`, `scree` | `trophyArms`, `wallShelf` |
| `refectory` | `tableLong` | `tableLong` run, 2–4 `bench`, `hearth`, 2–3 `barrel`, `cupboard` | `tankards`, `bottles`, `bones`, `rat`, `ashBed` | `banner`, `sconce` |
| `storeroom` | `crate` | 4–7 `crate`/`barrel`/`sackPile`, `cupboard`, `strongbox` | `scree`, `rat`, `coins` | `wallShelf`, `sconce` |
| `vault` | `strongbox` | 2–3 `strongbox`, `cupboard`, `candelabra`, `pillarBroken` | `coins`, `mosaic`, `chalkSigil` | `plaque`, `tapestry` |
| `scriptorium` | `bookcase` | 2 `bookcase`, `lectern`, `table`, `stool`, `candelabra` | `bottles`, `chalkSigil`, `rug`, `coins` | `tapestry`, `wallShelf`, `cobweb` |
| `alchemy` | `alchemyBench` | `alchemyBench`, `retortStand`, `scales`, `cauldron`, `bookcase`, `stool` | `bottles`, `spill`, `chalkSigil`, `scorch` | `wallShelf`, `cobweb` |
| `audience` | `throne` | `throne` (centred on a wall), 2 `brazier`, `bench`, `candelabra` | `rug`, `runner`, `mosaic`, `coins` | `banner` ×2, `tapestry` |
| `torture` | `rack` | `rack`, `brazier`, `cage`, `chainPost`, `stool` | `bloodstain`, `bones`, `scorch`, `skull` | `manacles`, `chains`, `ironRing` |
| `kennel` | `cage` | 2–3 `cage`, `chainPost`, `barrel`, `cauldron` (a feed trough) | `bones`, `bonePile`, `bloodstain`, `scorch`, `rat` | `ironRing`, `chains`, `mould` |
| `crypt` | `sarcophagus` | 1–2 `sarcophagus`, 2–3 `tombSlab`, `urn`, `candlestick` | `bones`, `skull`, `skullPile`, `crackedFlags` | `skullNiche`, `plaque`, `cobweb` |
| `ossuary` | `skullPile` | `ossuaryShelf` runs, 2–3 `skullPile`, `urn`, `candlestick` | `bones`, `bonePile`, `skull`, `scree` | `ossuaryShelf`, `skullNiche`, `cobweb` |
| `barrow` | `tombSlab` | `sarcophagus`, `tombSlab` ×2, `weaponRack` (grave goods), `brazier` v3, `strongbox` | `bones`, `coins`, `rime`, `crackedFlags` | `plaque`, `banner` v3, `cobweb` |
| `shrine` | (the `TILE.TEMPLE` tile) | `candelabra` ×2, `candlestick`, `bench` — **nothing on the temple tile itself** | `mosaic`, `rug`, `coins` | `tapestry`, `plaque` |
| `cistern` | `wellHead` | `wellHead`, `barrel`, `pillarBroken` | `puddle`, `drainGrate`, `lichen`, `rime` | `gargoyleSpout`, `mould`, `wallCrack` |
| `flooded` | `dripstone` | `dripstone` ×2, `stalagmite` ×3, `rubbleMound` | `puddle`, `lichen`, `sporePatch`, `bones` | `mould`, `fungusShelf`, `gargoyleSpout` |
| `mushroom` | `mushroomCluster` | 4–7 `mushroomCluster`, `stalagmite`, `dripstone` | `sporePatch`, `lichen`, `bones`, `rat` | `fungusShelf`, `mould` |
| `collapsed` | `fallenColumn` | `fallenColumn`, 2–3 `pillarBroken`, 2–4 `rubbleMound` | `scree`, `crackedFlags`, `bones`, `scorch` | `wallCrack`, `cobweb` |
| `wellroom` | `wellHead` | `wellHead` (centred), `bench`, `barrel`, `brazier` | `puddle`, `coins`, `mosaic` | `gargoyleSpout`, `ironRing`, `sconce` |
| `warren` | `sackPile` | `sackPile` ×2, `crate` v2, `barrel` v2, `cauldron`, `chainPost` | `bones`, `bloodstain`, `rat`, `scorch`, `tankards` | `hungShield` v3, `chains`, `mould` |
| `bare` | — | **nothing** | at most 1 scatter decal | at most 1 `cobweb`/`wallCrack` |
| `courtyard` | — | `bench`, `barrel`, `candelabra`, `banner` | `mosaic`, `rug`, `puddle` | `banner`, `plaque` |

### 6.2 Scheduling and gameplay

Weights are relative, per depth band; `0` = never. Cap = maximum rooms of that archetype **per
level**. Monster and treasure columns are **placement preferences only** — they choose *which room*
an already-rolled monster or item is put in. They never touch the roll itself (`DESIGN.md` §2.6,
§5.3, §4). Fidelity is not negotiable for a bit of atmosphere.

| id | Allowed `room.type` | B1 | B2 | B3 | B4 | Cap | `lightMood` | Favours (monsters) | Tends to hold |
|---|---|---|---|---|---|---|---|---|---|
| `guardroom` | hall, barracks, crypt, library, vault, cistern | 8 | 6 | 2 | 0 | 2 | `torchlit` | mercenary, swordsman, barbarian | gold bags |
| `barracks` | barracks, hall | 6 | 5 | 2 | 0 | 2 | `torchlit` | dwarven guard, mercenary, dark warrior | gold, potion |
| `armoury` | vault, barracks, hall | 4 | 4 | 2 | 1 | 1 | `torchlit` | dwarven guard, swordsman | **enchanted weapon** |
| `forge` | hall, vault | 2 | 3 | 2 | 1 | 1 | `forge` | dwarven guard, troll | enchanted weapon |
| `refectory` | hall | 4 | 3 | 1 | 0 | 1 | `hearth` | ogre, hobgoblin, barbarian | gold, potion |
| `storeroom` | vault, barracks, cave | 5 | 5 | 3 | 1 | 2 | `dark` | rogue, assassin | magic sack, gold |
| `vault` | vault | 2 | 3 | 3 | 2 | 1 | `candle` | assassin, dark warrior | **the open chest** (`placeTreasure`) |
| `scriptorium` | library | 4 | 4 | 2 | 0 | 1 | `candle` | monk, mage | **magic map, spell books** |
| `alchemy` | library, vault | 2 | 4 | 3 | 1 | 1 | `candle` | monk, mage | **healing potions** |
| `audience` | hall | 2 | 3 | 2 | 1 | **1** | `torchlit` | war lord, dark warrior | gold, enchanted weapon |
| `torture` | crypt, barracks, vault | 1 | 4 | 3 | 2 | **1** | `ember` | dark warrior, assassin | — |
| `kennel` | cave, barracks, hall | 3 | 4 | 4 | 3 | 1 | `ember` | dire wolf, werebear, wyvern, **fyre drake** | bones, gold |
| `crypt` | crypt | 3 | 5 | 6 | 4 | 2 | `cold` | gargoyle, shadow dragon | buried cache |
| `ossuary` | crypt, cave | 1 | 3 | 5 | 4 | 1 | `cold` | gargoyle, dimension spider | buried cache |
| `barrow` | crypt, vault | 0 | 2 | 5 | 5 | 1 | `cold` | shadow dragon, war lord, **demon** | buried cache, enchanted weapon |
| `shrine` | temple, shrine | — | — | — | — | all | `shrine` | none (sanctuary, `DESIGN.md` §6) | — |
| `cistern` | cistern, grotto | 3 | 4 | 4 | 2 | 1 | `water` | dimension spider, troll | — |
| `flooded` | cave, grotto, cistern | 1 | 3 | 5 | 4 | 2 | `water` | troll, wyvern, dimension spider | — |
| `mushroom` | cave, grotto | 1 | 3 | 5 | 3 | 1 | `fungal` | hobgoblin, troll | potion |
| `collapsed` | cave, hall, crypt | 2 | 4 | 5 | 5 | 2 | `dark` | gargoyle, troll | buried cache |
| `wellroom` | cistern, hall | 2 | 2 | 1 | 0 | **1** | `torchlit` | — | gold |
| `warren` | cave, barracks, hall | 5 | 5 | 3 | 2 | 2 | `ember` | hobgoblin, ogre, rogue, elvin ranger | gold bags |
| `bare` | any | 5 | 6 | 7 | 8 | all | `dark` / `cold` | any | any |
| `courtyard` | surface | — | — | — | — | 1 | `shrine` | none | — |

**Sword level (BS).** Only `crypt`, `barrow`, `ossuary`, `collapsed`, `vault` and `bare` are rolled;
every mood becomes `sword`; caps stay. The Sword's own room is `barrow` if the shape allows and
`bare` otherwise — nothing on the level should out-shout the Sword.

### 6.3 Assignment algorithm (generator, binding)

Runs **after** `placeTraps()`/`placeTreasure()` and **before** `spawnMonsters()`, so monster
placement can read `room.archetype` and treasure is already on the floor to avoid.

```
rng = createRng(seedFrom(level.seed, 'decor'))
for each room in level.rooms:
    room.decay     = clamp01((depth - 1) / 18 + rng.float(-0.12, 0.12))
    room.decorSeed = rng.int(1, 2**30)
1. side rooms (temple/shrine -> 'shrine', alcove -> 'bare') are assigned first and locked
2. rooms are visited LARGEST FIRST (by `area`): the biggest room gets first pick of the
   signature archetypes, because a throne in a 3x3 closet is a joke
3. for each room: build the weight list for its `room.type` and depth band, zero out any
   archetype already at its per-level cap, zero out any archetype whose signature piece
   does not FIT (§8.1), then weighted-pick
4. if every weight is zero -> 'bare'
5. room.lightMood = the archetype's mood, drifted by `decay` (§2.1); a room with no wall
   torch spot from `lighting.js` may not claim `torchlit` — it drifts to `ember`/`dark`
6. AT LEAST 25% AND AT MOST 60% of a level's non-side rooms must end up 'bare'. Enforce it:
   if too few, re-roll the lowest-weight assignments to 'bare'; if too many, re-roll the
   largest bare rooms with the bare weight removed.
```

**Rule 6 is the HeroQuest discipline in code.** Empty rooms are what make a furnished room land.

---

## 7. LIGHT MOODS

`room.lightMood` is a closed set. `lighting.js` owns the implementation; this table is the contract
of what each mood *means*. "Torches" are the wall-torch spots `Lighting.setLevel()` already chooses
per room (currently 1–2, none in temples).

| mood | Torches | Colour | Intensity ×| Dust × | Extra |
|---|---|---|---|---|---|
| `torchlit` | 2 (1 if `decay > 0.4`) | `0xffa04a` | 1.00 | 1.0 | the default warm room |
| `hearth` | 1 + the `hearth` prop as a hot low point | `0xff8a3a` | 1.15 | 1.4 | ember particles, slow flicker |
| `forge` | 1 + a strong pulsing point at the `forge` | `0xff6a20` | 1.35 | 1.6 | ember particles, 0.7 Hz pulse |
| `candle` | 0 + one small point per `candelabra`/`candlestick` | `0xffe6b0` | 0.55 | 0.8 | tight radius (≈2.5), bloom-friendly |
| `ember` | 0 + a dull point at each `brazier` | `0xc0442a` | 0.45 | 1.2 | smoke drift, deep red |
| `cold` | 0 | ambient only | 0.85 | 0.7 | band tint pushed 15 % cooler |
| `dark` | 0 | — | 0.60 | 0.6 | only the player's lantern; the room is a hole |
| `water` | 1 (if the room has one) | `0x9fd0e8` | 0.80 | 0.5 | caustic shimmer over `TILE.WATER`, drip SFX |
| `fungal` | 0 + faint emissive from `mushroomCluster` v≥2 | `0x7fe3a8` | 0.50 | 0.9 | slow breathing glow, no flicker |
| `shrine` | 0 + temple candles and the light shaft (existing) | `0xdfe8ff` | 1.00 | 1.0 | unchanged from today's temple |
| `sword` | 0 | `0xb08ad0` | 0.55 | 0.7 | sword-level violet; the Sword itself is the light |

Constraints: a mood never raises a room above the band's grading ceiling; nothing here may push a
sprite's on-screen `litMedian` past what `screenTruth.test.js` allows, and `dark`/`ember` rooms must
still leave the cast readable when the player's lantern reaches them (`GROUND_LIT_MIN` gate).

---

## 8. THE PLACEMENT GRAMMAR

Placement runs per room from `createRng(room.decorSeed)`.

### 8.1 Furniture

1. **Against the wall, facing in.** A furniture piece goes on a floor tile orthogonally adjacent to
   a `TILE.WALL`, with `facing` = the direction from the wall into the room. Wall-hugging is the
   default for: `bookcase` `cupboard` `weaponRack` `shieldStand` `armourStand` `bunk` `bench`
   `crate` `barrel` `sackPile` `strongbox` `footlocker` `chainPost` `cage` `throne` `hearth`
   `forge` `ossuaryShelf` `sarcophagus` `tombSlab` `lectern` `alchemyBench`.
2. **Big pieces on the long wall.** `bookcase`, `weaponRack`, `tableLong`, `bunk`, `rack`,
   `alchemyBench`, `ossuaryShelf` pick a wall run on the room's **longer axis**, and need a clear
   run of at least their tile count + 1.
3. **Hearths and thrones are centred on a wall.** `hearth`, `throne`, `forge` take the middle tile
   (±1) of the longest unbroken wall run, and the two tiles flanking them stay clear.
4. **Tables are central.** `table`, `tableLong`, `rack`, `wellHead`, `cauldron`, `fallenColumn`
   go in the room's interior — never adjacent to a wall — with seating (`bench`, `stool`) placed on
   the tiles around them, facing the table.
5. **Signature first.** The archetype's signature piece is placed before anything else; if it does
   not fit, the archetype was mis-assigned and the room falls back to `bare` (§6.3 step 3 exists to
   prevent this).
6. **Never in the door throat, never blocking sight of the door.** No furniture on the tile in
   front of a `TILE.DOOR`, and none on the straight line of the door's first two tiles.
7. **Never crowding the stairs.** Nothing within 1 tile of a staircase (§4.4); nothing at all *on*
   stairs, doors, temple tiles, water, pits or trap tiles.
8. **Pairs read as design.** `brazier`, `banner`, `candelabra`, `pillarBroken` prefer to be placed
   as a mirrored pair flanking the signature piece or the door. One brazier is litter; two are
   architecture.

### 8.2 Scatter

9. **Scatter thins away from furniture.** For each candidate tile compute
   `d = Chebyshev distance to the nearest furniture piece`; scatter chance is
   `base * (0.35 ^ min(d, 3))` — dense at the feet of the furniture, gone by 3 tiles out. Isolated
   scatter in the middle of an empty floor is the one thing that reads as *litter* rather than
   *life*, and it is the mistake to avoid.
10. **Room centre stays clear.** The 4 tiles nearest `room.cx, room.cy` take at most one decal and
    no standing scatter, unless the archetype's grammar puts a table there (rule 4).
11. **Wall-mounted pieces need a viewer.** Only on a wall tile whose `facing` neighbour is walkable
    *and* inside the room. Max one per wall tile; no two of the same type within 2 tiles unless
    they are a declared pair (rule 8).
12. **Decals may share a tile with a standing prop** (a bloodstain under a rack is good). Two
    standing props may never share a tile. Two decals may never share a tile.

### 8.3 Density — a room must still read as walkable floor

| Limit | Value |
|---|---|
| Tiles carrying **any** decor | ≤ **35 %** of the room's floor tiles |
| Tiles carrying a **standing prop** | ≤ **18 %** of the room's floor tiles |
| Completely clear floor | ≥ **55 %** of the room's floor tiles, and that clear set must be **4-connected** and touch every door/entrance |
| Blocking pieces | ≤ 2 per room, ≤ 1 per 12 floor tiles (§4.3) |
| Corridors | §3 — ≤ 1 per 10 corridor tiles, 12 per level |
| Level-wide sanity | ≤ **220** decor entries per level (the renderer budget: ≤ 150 draw calls total, `ARCHITECTURE.md`) |

If a room fails any limit, the generator drops scatter in reverse placement order until it passes —
furniture is never dropped for density, because furniture is the point.

---

## 9. WHAT DECOR MUST NEVER DO

A checklist for review; each line is a failure mode we can already name.

- Never sit on stairs, doors, temple tiles, trap tiles, pits or water (§4.4).
- Never seal a room, strand a staircase, or sever a level (§4.3).
- Never look like a pickup. Decor is dull, matte and unglowing; pickups glow, bob and sparkle
  (`props.js` `bob`, `addGlints`). If a player walks onto a `strongbox` expecting loot, the piece is
  wrong — `strongbox` decor is only placed in rooms where a real chest is *also* nearby, or with its
  lid visibly broken (variant ≥ 1).
- Never mark a hidden trap or a buried cache by standing next to it — hidden means hidden.
- Never obscure the cast. Nothing over 46 texels tall; nothing standing on a tile a monster spawns
  on; wall pieces hang above head height or flat against the wall.
- Never leave the shared texel grid: no custom quad sizes, no per-prop texel maths, no fractional
  offsets. `screenTruth.test.js` measures `edgeAlign` and `runTexels` on the PROPS row.
- Never use `Math.random` (`core/rng.js` only), never load an external asset, never touch the
  network. Every texture is painted in code.
- Never change a `TILE` value, `isOpaqueTile`, FOV, item odds, monster rolls or any number in
  `DESIGN.md`. Decor is dressing on top of the classic rules, not a rule change.

---

## 10. HOW ANY OF THIS IS ACCEPTED

**Sheet-level metrics lie. Judge the frame.**

```
cd fargoal
node tools/shot.mjs  --scenario <name> --out shots/<name>.png     # then READ the png, crop 4-12x
node tools/audit.mjs --scenario <name>                            # litMedian, run length, contact, pillow
node --test tests/
npm run smoke
```

Required new scenarios (register in `src/debug/scenarios.js`), each a *furnished* room at the play
camera: `room-guardroom`, `room-crypt`, `room-scriptorium`, `room-alchemy`, `room-audience`,
`corridor-bare` (proof that corridors stayed bare), `decor-density` (the worst-case dressed hall).

Acceptance for a decor pass:

| Gate | Where |
|---|---|
| The room's identity is legible from the plan view in one glance, cropped 4× | `shot.mjs` + eyes |
| Props share the cast's texel grid (`edgeAlign`, `runTexels` on the PROPS row) | `audit.mjs` |
| No sprite breaks `style.js` gamut, ink or pillow law | `tests/spriteStyle.test.js` |
| Cast still readable in every mood, including `dark`/`ember` | `tests/screenTruth.test.js` |
| Determinism: same seed ⇒ identical `level.decor` | `tests/decor.test.js` |
| Every §4.3/§4.4/§8.3 invariant, seeds × depths 1–20 | `tests/decor.test.js` |
| `node --test tests/` and `npm run smoke` both green | always, before finishing |

---

## Appendix — quick reference

**Valid `type` strings, by class.**

*Standing props (47):* `strongbox` `bookcase` `cupboard` `lectern` `table` `tableLong` `bench`
`stool` `throne` `sarcophagus` `tombSlab` `urn` `alchemyBench` `retortStand` `scales` `cauldron`
`brazier` `hearth` `forge` `anvil` `weaponRack` `shieldStand` `armourStand` `barrel` `crate`
`sackPile` `bunk` `footlocker` `rack` `chainPost` `cage` `wellHead` `pillarBroken` `fallenColumn`
`rubbleMound` `stalagmite` `dripstone` `mushroomCluster` `candlestick` `candelabra` `skull`
`skullPile` `bonePile` `rat` `bottles` `tankards` `dice`

*Floor decals (17):* `bones` `scree` `puddle` `bloodstain` `scorch` `crackedFlags` `mosaic` `rug`
`runner` `chalkSigil` `spill` `ashBed` `coins` `sporePatch` `lichen` `rime` `drainGrate`

*Wall-mounted (17):* `sconce` `banner` `tapestry` `hungShield` `trophyArms` `chains` `manacles`
`cobweb` `skullNiche` `ossuaryShelf` `ironRing` `gargoyleSpout` `wallShelf` `plaque` `wallCrack`
`mould` `fungusShelf`

*May ever block (9):* `sarcophagus` `fallenColumn` `pillarBroken` `rubbleMound` `stalagmite`
`wellHead` `cage` `forge` `anvil`

**Valid `room.archetype` strings (24):** `guardroom` `barracks` `armoury` `forge` `refectory`
`storeroom` `vault` `scriptorium` `alchemy` `audience` `torture` `kennel` `crypt` `ossuary` `barrow`
`shrine` `cistern` `flooded` `mushroom` `collapsed` `wellroom` `warren` `bare` `courtyard`

**Valid `room.lightMood` strings (11):** `torchlit` `hearth` `forge` `candle` `ember` `cold` `dark`
`water` `fungal` `shrine` `sword`

**Valid `facing` strings (4):** `n` `e` `s` `w`
