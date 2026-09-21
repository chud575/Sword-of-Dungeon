// The fixed list of Unity prefabs imported into src/assets/supplied — the owner picked these 64 by
// name off the contact sheets, so the list is DATA, not a heuristic: nothing here is discovered at
// build time and nothing is substituted. `job` is the id in the catalog's jobs.json (pack prefix
// D_ = Top-Down Dungeons/Prefabs, De_ = the same pack's Prefabs_elementar, I_ = Top-Down Interiors,
// B_ = BitGem Dungeon_Set_01), which is what resolves prefab -> fbx -> material -> texture.
//
// Fields
//   id     lowercase source name; the key of SUPPLIED_FILES and the file stem.
//   job    catalog id.
//   yaw    radians about y that turn the piece's FRONT to +z (checked on the four-view sheet,
//          `node tools/supplied-import/preview.mjs --views`).
//   cap    largest plan dimension in tiles. Defaults to CAP (1.6). A piece over it is scaled down.
//   scale  extra uniform scale applied BEFORE the cap, on top of the pack scale.
//   parts  separately named meshes inside the glb, first match wins; everything left over lands in
//          the last entry. `node` matches the prefab node name, `mat` the Unity material path.
//          Absent: one mesh, named after the id.
//
// PACK_SCALE is the one judgement call in the table. Top-Down Dungeons is already about a metre to
// the tile (its barrels are 0.72, chests 0.75, jars 0.3), so it passes through at 1. Top-Down
// Interiors is modelled roughly 1.4x life size against it — its crates are 1.18 where the Dungeons
// box is 0.73, its beds 2.66 long — so the whole pack is taken down by one factor, 0.70, rather than
// per piece, which keeps a stool smaller than a chair smaller than a table. BitGem passes through
// at 1 and is flagged in the report instead: its one piece here lands at 0.94 tiles, which is large
// for a skull but is what the source says.
export const PACK_SCALE = { D: 1, De: 1, I: 0.7, B: 1 };

/** Largest plan (x or z) dimension any piece may occupy, in tiles. */
export const CAP = 1.6;

/** Texels per tile the baked albedo aims for — the floor's density, CLAUDE.md rule 2. */
export const TEXELS_PER_TILE = 32;

// Yaws checked on `preview.mjs --sides`, which renders the four elevations so the face carrying the
// detail can be read off rather than inferred: the Dungeons chests wear their lock plate on -z; the
// Interiors beds put the pillow on +z; the BitGem skull faces -z; the wall pieces (the bookcase, the
// peg rack, the wall forge, the wall torch) were authored to hang off a wall along x, and turning
// them also swaps their footprint so the wide axis runs along x as a wall piece needs.
const FIRE = [
  { name: 'coals', node: /ring/i },
  { name: 'body' },
];
const FLAME = [
  { name: 'flame', mat: /_alpha\.mat$/i },
  { name: 'body' },
];

export const ASSETS = [
  // ---------------------------------------------------------------------------------- containers
  { id: 'chest2a', job: 'D_Chest2A', yaw: Math.PI },
  { id: 'chest2b', job: 'D_Chest2B', yaw: Math.PI },
  { id: 'chest1b', job: 'D_Chest1B', yaw: Math.PI },
  { id: 'barrel1', job: 'D_Barrel1', yaw: 0 },
  { id: 'barrel2', job: 'D_Barrel2', yaw: 0 },
  { id: 'barrels1', job: 'D_Barrels1', yaw: 0 },
  { id: 'barrels2', job: 'D_Barrels2', yaw: 0 },
  { id: 'box1', job: 'D_Box1', yaw: 0 },
  { id: 'box2', job: 'D_Box2', yaw: 0 },
  { id: 'sewers_crate1', job: 'D_Sewers_crate1', yaw: -Math.PI / 2 },
  { id: 'crate1', job: 'I_Crate1', yaw: 0 },
  { id: 'crate6', job: 'I_Crate6', yaw: 0 },
  { id: 'sack1', job: 'D_Sack1', yaw: 0 },
  { id: 'sack2', job: 'D_Sack2', yaw: 0 },
  { id: 'sacks_gr1', job: 'D_Sacks_gr1', yaw: 0 },
  { id: 'sacks_gr2', job: 'D_Sacks_gr2', yaw: 0 },
  { id: 'jar1', job: 'D_Jar1', yaw: 0 },
  { id: 'jar2', job: 'D_Jar2', yaw: 0 },
  { id: 'jar3', job: 'D_Jar3', yaw: 0 },
  { id: 'jar4', job: 'D_Jar4', yaw: 0 },
  { id: 'jar5', job: 'D_Jar5', yaw: 0 },
  { id: 'jar6', job: 'D_Jar6', yaw: 0 },
  { id: 'jar_gr1', job: 'D_Jar_gr1', yaw: 0 },
  { id: 'jar_gr2', job: 'D_Jar_gr2', yaw: 0 },
  { id: 'bucket1', job: 'D_Bucket1', yaw: 0 },
  { id: 'basin1', job: 'I_Basin1', yaw: 0, parts: [{ name: 'water', node: /^Water$/i }, { name: 'body' }] },
  // ----------------------------------------------------------------------------------- furniture
  { id: 'table1', job: 'I_Table1', yaw: 0 },
  { id: 'table1b', job: 'I_Table1B', yaw: 0 },
  { id: 'table_tawern3', job: 'I_Table_Tawern3', yaw: 0 },
  { id: 'bench1', job: 'I_Bench1', yaw: 0 },
  { id: 'bench3', job: 'I_Bench3', yaw: 0 },
  { id: 'bench7', job: 'I_Bench7', yaw: 0 },
  { id: 'cupboard2_1', job: 'I_Cupboard2_1', yaw: -Math.PI / 2 },
  { id: 'cupboard2_1_books1', job: 'I_Cupboard2_1_books1', yaw: -Math.PI / 2 },
  { id: 'bed_17', job: 'I_Bed_17', yaw: Math.PI, parts: [{ name: 'cloth', mat: /Alphas\.mat$/i }, { name: 'body' }] },
  { id: 'bed_18', job: 'I_Bed_18', yaw: Math.PI, parts: [{ name: 'cloth', mat: /Alphas\.mat$/i }, { name: 'body' }] },
  { id: 'furniture10_1', job: 'I_Furniture10_1', yaw: 0 },
  { id: 'furniture11', job: 'I_Furniture11', yaw: Math.PI },
  { id: 'chair4', job: 'I_Chair4', yaw: Math.PI / 2 },
  // ---------------------------------------------------------------------------------- fire/light
  { id: 'furnace1', job: 'D_Furnace1', yaw: 0, parts: FIRE },
  { id: 'furnace3', job: 'D_Furnace3', yaw: 0, parts: FIRE },
  { id: 'furnace2a', job: 'D_Furnace2A', yaw: Math.PI / 2, parts: FIRE },
  { id: 'hearth1', job: 'I_Hearth1', yaw: 0 },
  { id: 'candle1', job: 'I_Candle1', yaw: 0, parts: FLAME },
  { id: 'candle4', job: 'I_Candle4', yaw: 0, parts: FLAME },
  { id: 'chandelier4', job: 'I_Chandelier4', yaw: 0 },
  { id: 'torch1', job: 'D_Torch1', yaw: Math.PI / 2 },
  // ----------------------------------------------------------------------------- dungeon features
  { id: 'well1', job: 'De_Well1', yaw: 0 },
  { id: 'well2', job: 'De_Well2', yaw: 0 },
  { id: 'column5', job: 'De_Column5', yaw: 0 },
  { id: 'column7', job: 'De_Column7', yaw: 0 },
  { id: 'column9', job: 'De_Column9', yaw: 0 },
  { id: 'king_obelisk', job: 'De_King_obelisk', yaw: -Math.PI / 2 },
  { id: 'rock4a', job: 'D_Rock4A', yaw: 0 },
  { id: 'rock4b', job: 'D_Rock4B', yaw: 0 },
  { id: 'pav_debris1', job: 'D_Pav_debris1', yaw: 0 },
  { id: 'pav_debris4', job: 'D_Pav_debris4', yaw: 0 },
  { id: 'pav_debris7', job: 'D_Pav_debris7', yaw: 0 },
  { id: 'pave_debris_gr1', job: 'D_Pave_debris_gr1', yaw: 0 },
  { id: 'pave_debris_gr2', job: 'D_Pave_debris_gr2', yaw: 0 },
  { id: 'deco1_skull', job: 'D_Deco1_skull', yaw: 0 },
  { id: 'stone_skull', job: 'B_stone_skull', yaw: Math.PI },
  // ------------------------------------------------------------------------------------ textiles
  { id: 'carpet_round3', job: 'I_Carpet_round3', yaw: 0 },
  { id: 'carpet_square3_1', job: 'I_Carpet_square3_1', yaw: 0 },
  // ----------------------------------------------------------------------------- wall-hung (experiment)
  // The owner asked to see these on real walls (2026-09-17). They are authored hanging on a wall, so
  // their front is +z at yaw 0 and the runtime mounts them at a height rather than standing them on
  // the floor (props/supplied.js `hang`). A near-plan camera sees very little of a vertical piece —
  // that is the point of the experiment.
  { id: 'paint1', job: 'I_Paint1', yaw: Math.PI / 2 },
  { id: 'paint2', job: 'I_Paint2', yaw: Math.PI / 2 },
  { id: 'paint3', job: 'I_Paint3', yaw: Math.PI / 2 },
  { id: 'paint4', job: 'I_Paint4', yaw: Math.PI / 2 },
  { id: 'paint5', job: 'I_Paint5', yaw: Math.PI / 2 },
  { id: 'paint6', job: 'I_Paint6', yaw: Math.PI / 2 },
  { id: 'shield1', job: 'I_Shield1', yaw: 0 },
  { id: 'shield2', job: 'I_Shield2', yaw: 0 },
  { id: 'shield3', job: 'I_Shield3', yaw: 0 },
];
