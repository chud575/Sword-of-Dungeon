// tileSkins: named castings of an imported sheet onto the board's field vocabulary.
//
// A SKIN IS A CASTING, NOT A RESTYLE. `tiles.js` owns what a field IS — corridor is the pale run
// you trace the layout by, `wallTop` is the block band that frames it, and a room's field is the
// thing that changes at a doorway to tell you you have gone somewhere new. A skin only says WHICH
// PAINTED TILES play each of those parts. Every skin has to cover all of them: leave a style out
// and that room falls back to its procedural field, and the level reads as two art sets at once.
//
// A FIELD TAKES A FAMILY, NOT A TILE. Each style is cast onto a FAMILY of two to four sheet cells
// that measurably share a hue, and `materials.js` fills the style's `VARIANTS` atlas cells from it,
// so a room is several different stones of one colour rather than one stone stamped across a grid.
// `dungeon.js` then turns each tile as far as its pattern survives (tiles.js `PATTERN_TURNS`), and
// between the two a twenty-tile room stops announcing that it is a single repeated bitmap.
//
// THAT PUTS ONE HARD CONSTRAINT ON THE TABLE BELOW, and `tests/tileSkins.test.js` enforces it from
// the sheet's own pixels: a family of DIRECTIONAL art (a plank run, a coursed board floor) may only
// be cast onto a field that is allowed half turns — `styleTurns(id) === 2`. Cast it onto a
// four-fold field and the field's own freedom to take a quarter turn will spin the planks ninety
// degrees against their neighbours, which is the "shredded into confetti" the old blanket no-turn
// rule in dungeon.js was written to avoid.
//
// Cells are [col, row], 0-BASED from the sheet's top-left; the sheet prints its own labels 1-based,
// so [0, 2] is the sheet's "1 / 3".
import { TILE_STYLES, styleTurns } from './tiles.js';
import { SHEET } from './tileSheet.js';

/**
 * The families. Each is a set of cells that measured within ~20 degrees of hue of one another
 * (tools/tilesheet-import.mjs sliced them; the test re-measures every one from the packed sheet).
 * The comment on each is what it looks like, not what it is for — a family is cast differently by
 * every skin.
 */
export const FAMILIES = {
  // --- pale neutrals, the corridor and wall-band material
  paleWarm: [[0, 0], [3, 0], [14, 1], [15, 1]],   // cream flagstone, pale brick, white cracked
  paleGrid: [[10, 1], [14, 0], [11, 1]],          // pale square grid, pale block, checker
  paleOlive: [[9, 1], [11, 3], [4, 0]],           // bleached olive-grey stone, mossed pale grid
  // --- greys
  greyMid: [[2, 0], [0, 1], [9, 0]],              // flat grey brick, river cobble, dark course
  greyCool: [[1, 0], [6, 0], [5, 1]],             // blue-grey brick, grey cobble, hex cobble
  greyBlue: [[13, 1], [7, 1], [12, 1]],           // pale blue gravel, blue-grey brick and cobble
  scree: [[8, 3], [14, 3], [15, 3], [16, 3]],     // loose grey stone, cobweb-grey, bone-grey
  bone: [[6, 3], [8, 3], [16, 3]],                // bones on pale ground, grey scree
  // --- tans and golds
  tan: [[5, 0], [7, 0], [12, 0]],                 // tan brick, tan flagstone, sand cobble
  tanWorn: [[2, 1], [4, 1], [16, 1]],             // cracked tan stone, round tan cobble, gilt stone
  // --- reds and fire
  red: [[8, 0], [13, 0], [6, 1]],                 // red brick, red cobble, cracked red brick
  lava: [[15, 4], [16, 4]],                       // molten rock, cooled crust
  // --- woods. woodPlank and woodDark are DIRECTIONAL: half-turn fields only (see the header).
  woodPlank: [[0, 2], [3, 2], [13, 2], [7, 2]],   // board floors, run one way
  woodDark: [[1, 2], [4, 2], [2, 2]],             // dark and honey board floors
  woodFlat: [[8, 2], [9, 2], [15, 2], [12, 2]],   // crate lids and banded panels — no run to break
  // --- earth
  earth: [[0, 3], [1, 3], [4, 3], [6, 3]],        // packed dirt, dirt over bone, gravel
  earthDark: [[3, 3], [2, 3], [16, 2]],           // dark churned earth, rust gravel
  // --- greens
  mossPale: [[4, 0], [11, 0], [9, 3]],            // moss in the joints, pale olive grid
  mossDeep: [[10, 0], [10, 3], [13, 3]],          // mossed cobble, deep moss, vines
  greenWet: [[8, 1], [12, 4], [4, 4]],            // green hex cobble, wet weed, algae
  slime: [[12, 3], [13, 4], [14, 4]],             // vivid slime, dark slime
  // --- water
  teal: [[3, 4], [5, 4]],                         // green-teal standing water
  waterMid: [[11, 4], [6, 4]],                    // a stone-lined channel, water over rock
  waterDeep: [[0, 4], [2, 4], [1, 4]],            // deep blue and teal water
  waterPale: [[7, 4], [8, 4], [9, 4]],            // shallow water, meltwater, ice
};

/** Families whose art runs one way; only a half-turn field may wear them. Checked by the test. */
export const DIRECTIONAL = new Set(['woodPlank', 'woodDark']);

/** @type {Object<string, {name:string, blurb:string, fields:Object<string,string>}>} */
export const TILE_SKINS = {
  stone: {
    name: 'Stone',
    blurb: 'the sheet read as a dungeon: grey courses, a pale corridor run, one colour per room',
    fields: {
      corridor: 'paleWarm', wallTop: 'paleGrid',
      greyStone: 'greyMid', greyBrick: 'greyCool', paleSpeck: 'greyBlue', paleCheck: 'scree', slabGrey: 'bone',
      tanBrick: 'tan', goldBrick: 'tanWorn', goldBar: 'woodFlat', goldCross: 'earth', oliveBlock: 'mossPale',
      redCrack: 'red', emberCrack: 'earthDark', redCheck: 'lava', rustSpeck: 'paleOlive',
      greenCrack: 'mossDeep', oliveCrack: 'greenWet', limeCrack: 'slime',
      tealTile: 'teal', tealDiamond: 'waterPale', plank: 'woodPlank',
    },
  },
  keep: {
    name: 'The Keep',
    blurb: 'a garrison still lived in: board floors, packed earth, tan cobble',
    fields: {
      corridor: 'tanWorn', wallTop: 'paleWarm',
      greyStone: 'earth', greyBrick: 'woodPlank', paleSpeck: 'scree', paleCheck: 'bone', slabGrey: 'greyMid',
      tanBrick: 'tan', goldBrick: 'woodFlat', goldBar: 'woodDark', goldCross: 'earthDark', oliveBlock: 'paleOlive',
      redCrack: 'red', emberCrack: 'lava', redCheck: 'greyCool', rustSpeck: 'mossPale',
      greenCrack: 'mossDeep', oliveCrack: 'greenWet', limeCrack: 'slime',
      tealTile: 'teal', tealDiamond: 'waterMid', plank: 'woodPlank',
    },
  },
  drowned: {
    name: 'The Drowned Works',
    blurb: 'moss over the courses, vines in the corners, water standing in the low rooms',
    fields: {
      corridor: 'paleOlive', wallTop: 'paleGrid',
      greyStone: 'greyBlue', greyBrick: 'greyCool', paleSpeck: 'scree', paleCheck: 'waterMid', slabGrey: 'greyMid',
      tanBrick: 'mossPale', goldBrick: 'earth', goldBar: 'woodFlat', goldCross: 'mossDeep', oliveBlock: 'greenWet',
      redCrack: 'slime', emberCrack: 'bone', redCheck: 'red', rustSpeck: 'earthDark',
      greenCrack: 'mossDeep', oliveCrack: 'greenWet', limeCrack: 'slime',
      tealTile: 'teal', tealDiamond: 'waterDeep', plank: 'woodPlank',
    },
  },
  infernal: {
    name: 'The Burning Floor',
    blurb: 'lava in the cracks, bone underfoot, scorched board and cinder',
    fields: {
      corridor: 'earthDark', wallTop: 'paleWarm',
      greyStone: 'scree', greyBrick: 'greyMid', paleSpeck: 'bone', paleCheck: 'greyBlue', slabGrey: 'earth',
      tanBrick: 'lava', goldBrick: 'red', goldBar: 'woodDark', goldCross: 'tanWorn', oliveBlock: 'paleOlive',
      redCrack: 'red', emberCrack: 'lava', redCheck: 'earthDark', rustSpeck: 'woodFlat',
      greenCrack: 'slime', oliveCrack: 'mossDeep', limeCrack: 'greenWet',
      tealTile: 'waterDeep', tealDiamond: 'teal', plank: 'woodPlank',
    },
  },
};

export const SKIN_IDS = Object.keys(TILE_SKINS);

/**
 * The sheet cells a skin gives a field, in variant order.
 * @param {string} skinId @param {string} styleId
 * @returns {Array<[number,number]>|null} the family's cells, or null if the skin does not cast it
 */
export function skinCells(skinId, styleId) {
  const skin = TILE_SKINS[skinId];
  if (!skin) return null;
  const fam = FAMILIES[skin.fields[styleId]];
  return fam && fam.length ? fam : null;
}

/**
 * Check every skin names every field, that every family exists and sits on the sheet, and that no
 * DIRECTIONAL family is cast onto a field that takes quarter turns.
 *
 * THIS IS NOT DECORATION. A missing style is invisible at author time and shows up in a rendered
 * frame as one room still wearing the procedural atlas next to twenty wearing the sheet. A plank
 * family on a four-fold field is invisible until you look at a floor and find the boards running
 * four ways in one room. `tests/tileSkins.test.js` runs this and also re-measures the hue of every
 * family straight out of the packed sheet, which is the part a table cannot lie about.
 * @returns {string[]} problems, empty when the table is sound
 */
export function validateSkins() {
  const ids = Object.keys(TILE_STYLES);
  const bad = [];
  for (const [name, cells] of Object.entries(FAMILIES)) {
    if (!Array.isArray(cells) || cells.length < 2) { bad.push(`family '${name}': a field takes a FAMILY, so it needs at least two cells`); continue; }
    for (const c of cells) {
      if (!Array.isArray(c) || c.length !== 2) { bad.push(`family '${name}': every cell must be [col, row]`); continue; }
      if (c[0] < 0 || c[0] >= SHEET.cols || c[1] < 0 || c[1] >= SHEET.rows) bad.push(`family '${name}': cell [${c}] is off a ${SHEET.cols}x${SHEET.rows} sheet`);
    }
  }
  for (const [id, skin] of Object.entries(TILE_SKINS)) {
    for (const style of ids) {
      const famName = skin.fields[style];
      if (!famName) { bad.push(`${id}: no family for field '${style}'`); continue; }
      if (!FAMILIES[famName]) { bad.push(`${id}.${style}: '${famName}' is not a family`); continue; }
      if (DIRECTIONAL.has(famName) && styleTurns(style) !== 2) {
        bad.push(`${id}.${style}: '${famName}' runs one way, but '${style}' takes ${styleTurns(style)} quarter turns — its tiles would spin against each other`);
      }
    }
    for (const style of Object.keys(skin.fields)) if (!ids.includes(style)) bad.push(`${id}: '${style}' is not one of the ${ids.length} TILE_STYLES`);
  }
  return bad;
}
