// floorDesigner: an empty hall to place and test every prop and any light (title menu -> Floor Designer).
//
// It is a real game running a room of its own, so everything the level builder does (debug/levelBuilder.js)
// works here unchanged — props, decals, wall pieces, the owner's models and sheet sprites, and placed lights
// (lighting.js `setMoods` reads `light` entries). Three things make it a workbench rather than a quest:
//
//   · NOTHING SAVES. The game is marked `placeholder`, which every save path already refuses
//     (core/save.js saveGame, core/lifecycle.js), so a designer session can never overwrite a real quest.
//     The ROOM persists anyway: the builder stores its layout under the room's own `seed:depth`, so the
//     hall you left is the hall you come back to.
//   · NOTHING ATTACKS. The hall has no monsters, and its wandering-monster clock is set to never.
//   · NOTHING IS HIDDEN. The fog is lifted, so a piece or a light placed anywhere in the hall is seen.
import { Level } from '../world/level.js';
import { TILE } from '../core/constants.js';

/** The hall's own seed: its layout is stored under `${DESIGNER_SEED}:1` by the level builder. */
export const DESIGNER_SEED = 424242;
export const DESIGNER_SIZE = { width: 25, height: 19 };

/**
 * Build the designer hall into `game` at depth 1, replacing whatever the new game generated there.
 * @param {object} game a fresh Game
 * @returns {{level:Level, arrival:{x:number,y:number}}}
 */
export function buildDesignerHall(game) {
  const { width: W, height: H } = DESIGNER_SIZE, depth = 1;
  const lv = new Level({ depth, width: W, height: H, seed: DESIGNER_SEED });
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) lv.set(x, y, TILE.FLOOR);
  const cx = W >> 1, cy = H >> 1;
  lv.rooms.push({ x: 1, y: 1, w: W - 2, h: H - 2, type: 'hall', cx, cy, archetype: 'guardroom', lightMood: 'torchlit', decay: 0 });
  lv.stairsUp = { x: 1, y: 1 };
  lv.revealAll();
  lv.setDecor([]);
  lv.designer = true;
  game.levels.set(depth, lv);
  return { level: lv, arrival: { x: cx, y: cy } };
}
