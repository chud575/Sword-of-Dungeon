// props2d: the owner's own dungeon-props sprite sheet, standing in the dungeon (`?props=sheet`).
//
// WHERE IT COMES FROM. `src/assets/props2d/atlas.png` + `map.js` are built by `tools/props2d-import/`
// from the sheet the owner supplied: sliced by connected components (the captions under each sprite are
// wider than the sprite, so a column projection merged whole sections), the near-black ground keyed out
// by a flood fill from each crop's edge (a luminance threshold eats this art's black outlines), then
// shelf-packed into one 1024-wide atlas.
//
// WHY 2D AT ALL, AND WHY NOT FOR EVERYTHING. The owner's camera — perspective at tilt 0, straight down —
// leaves a sheared 3D prop showing nothing but its lid: measured in `room-guardroom` at that camera, the
// Freeport table is a beige slab. A drawn piece facing the camera reads instantly, which is the whole
// point ("less realism and more pragmatism so that the user can identify what they are looking at").
// But the owner also keeps the 3D FLOOR CLUTTER, because those pieces come alive as the perspective
// shifts past them — "some 3d props work really great in this environment... skulls, etc. floor stuff".
// So this file maps the FURNITURE and the big silhouettes only, and every type it does not name falls
// through to the ordinary chain (the Freeport models, then the kit). `CLUTTER_STAYS_3D` below is not a
// list this module reads — it is the note explaining the gaps, so nobody "finishes the job" by mapping
// skulls, bones, scree and coins and quietly takes the 3D clutter away.
//
// SIZE. A sheet sprite is drawn at whatever scale the sheet used (40-145 px), which is not this game's
// 32-texels-a-tile. Each entry gives the width it should cover IN TILES and the quad is sized from that,
// so a table is a table beside the hero whatever the sheet did.
import * as THREE from 'three';
import { textureSprite, contactShadow } from '../props.js';
import { spriteTexture, spriteTexels } from './atlas2d.js';
export { buildGroundSprite } from './atlas2d.js';

/** Types deliberately NOT mapped, so they keep their solid pieces (see the header). */
export const CLUTTER_STAYS_3D = ['skull', 'skullPile', 'bonePile', 'bones', 'scree', 'coins', 'rat', 'dice',
  'tankards', 'bottles', 'puddle', 'bloodstain', 'scorch', 'spill', 'ashBed', 'sporePatch', 'lichen', 'rime'];

/**
 * decor type -> sheet sprite. `tiles` is how wide the piece should stand, in tiles; `v` maps a decor
 * variant onto a different sprite (a chest opens, a door swings, a bed is slept in).
 */
const MAP = {
  // tables and seats
  table: { name: 'table', tiles: 1.25 },
  tableLong: { name: 'table-long', tiles: 1.9 },
  stool: { name: 'stool', tiles: 0.55 },
  bench: { name: 'bench', tiles: 1.2 },
  throne: { name: 'throne', tiles: 0.95 },
  lectern: { name: 'table-map', tiles: 0.95 },
  // containers
  strongbox: { name: 'chest-closed', tiles: 0.85, v: { 1: 'chest-open', 2: 'chest-open', 3: 'chest-open' } },
  footlocker: { name: 'locked-chest', tiles: 0.9, v: { 1: 'chest-open' } },
  crate: { name: 'crate', tiles: 0.8 },
  barrel: { name: 'barrel', tiles: 0.7 },
  urn: { name: 'urn', tiles: 0.55, v: { 1: 'jar', 2: 'jar' } },
  sackPile: { name: 'sleeping-bag', tiles: 0.8 },
  // shelves and presses
  bookcase: { name: 'bookcase', tiles: 1.0 },
  cupboard: { name: 'shelf', tiles: 0.95 },
  // the crypt
  sarcophagus: { name: 'sarcophagus', tiles: 1.15 },
  tombSlab: { name: 'coffin', tiles: 1.0 },
  // fires and lights
  brazier: { name: 'brazier', tiles: 0.85 },
  hearth: { name: 'campfire', tiles: 0.9 },
  candlestick: { name: 'candles', tiles: 0.45 },
  candelabra: { name: 'candle-stand', tiles: 0.55 },
  // the barracks, the workshop, the cells
  bunk: { name: 'bunk-bed', tiles: 1.35 },
  rack: { name: 'torture-rack', tiles: 1.15 },
  cage: { name: 'cage', tiles: 1.0 },
  chainPost: { name: 'gallows', tiles: 1.0 },
  wellHead: { name: 'well', tiles: 1.0 },
  alchemyBench: { name: 'table-map', tiles: 1.15 },
  retortStand: { name: 'hourglass', tiles: 0.45 },
  scales: { name: 'globe', tiles: 0.5 },
  // the cave
  pillarBroken: { name: 'column', tiles: 0.7 },
  fallenColumn: { name: 'rubble', tiles: 0.9 },
  rubbleMound: { name: 'rubble', tiles: 0.85 },
  stalagmite: { name: 'stalagmite', tiles: 0.7 },
  dripstone: { name: 'stalactite', tiles: 0.6 },
  mushroomCluster: { name: 'mushrooms', tiles: 0.6 },
  // wall pieces
  banner: { name: 'banner-1', tiles: 0.7, v: { 1: 'banner-2', 2: 'banner-3', 3: 'banner-3' } },
  tapestry: { name: 'banner-2', tiles: 0.75, v: { 1: 'banner-3', 2: 'banner-1' } },
  sconce: { name: 'wall-torch-1', tiles: 0.5, v: { 1: 'wall-torch-2', 2: 'wall-sconce' } },
  cobweb: { name: 'cobweb', tiles: 0.8 },
};

/**
 * How hard the room is allowed to light this art (see `textureSprite` in props.js). `albedo` dims what
 * the torches multiply; `glow` is the floor that keeps a piece readable in the dark. One setting for the
 * whole sheet: it is one artist's set and it should sit at one exposure.
 */
export const SHEET_TUNE = { albedo: 0.62, glow: 0.5 };

/** Is there a sheet sprite for this decor type? */
export function hasSheetProp(type) { return !!MAP[type]; }

/**
 * One decor entry as a sheet sprite, or null for a type the sheet does not cover (the caller falls
 * back to the solid piece).
 * @param {string} type
 * @param {{variant?:number, facing?:string, blocking?:boolean}} [o]
 * @returns {THREE.Group|null}
 */
export function buildSheetProp(type, o = {}) {
  const m = MAP[type];
  if (!m) return null;
  const v = Math.max(0, o.variant | 0);
  const name = (m.v && m.v[v]) || m.name;
  const tex = spriteTexture(name);
  const size = spriteTexels(name, m.tiles);
  if (!tex || !size) return null;
  const { w, h } = size;
  const g = new THREE.Group();
  g.add(textureSprite(`${name}`, tex, { w, h }, { glow: SHEET_TUNE.glow, albedo: new THREE.Color(SHEET_TUNE.albedo, SHEET_TUNE.albedo, SHEET_TUNE.albedo).getHex() }));
  g.add(contactShadow(Math.min(1, m.tiles * 0.8), { strength: 0.5, spread: 1.1 }));
  g.userData.decor = { type, variant: v, facing: o.facing || 's', cls: 'prop', sheet: name };
  g.userData.blocking = !!o.blocking;
  return g;
}
