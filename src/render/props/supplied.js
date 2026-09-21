// supplied: THE TEST WHERE NOTHING IN THE ROOM IS MINE (`?props=supplied`).
//
// Every standing piece, every scatter stone and every carpet comes from art the owner supplied: the
// Top-Down Dungeons and Top-Down Interiors packs in their Unity project, imported by
// `tools/supplied-import/` (see src/assets/supplied/README.md), plus the Freeport models already in
// the game. The walls and the Dungeon Crawlers floor stay exactly as they are — that was the brief.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE: in supplied mode, a decor type either draws a supplied
// model or draws NOTHING. It never falls through to the kit pieces or the painted billboards, because
// those are my art and the point of the test is to see the owner's own set standing on its own.
// `furniture.js` and `dressing.js` hold that line; `MAP` below is the whole vocabulary, and the types
// listed under "deliberately empty" are the gaps in the packs, not oversights.
//
// HOW A PACK MESH IS MADE TO BELONG — the same three rules as kit.js and freeport.js:
//  1. ONE TEXEL SIZE: the importer resampled each albedo to the floor's ~32 texels a tile, and the
//     lookup goes through `patchSurface`'s `quant` path at the mesh's own measured uv-per-tile.
//  2. THE CAST'S PROJECTION: every vertex is sheared north by `SHEAR * y` after its facing, so a
//     front face arrives at the floor's foreshortening.
//  3. THE HOUSE KEY LIGHT IN THE VERTEX COLOUR, normals bent up into the room's overhead light.
// Plus the kit's contact shadow, the flames and glow pools for anything burning, and the fog of war.
//
// FITTING. These are architectural assets drawn for a 1m grid and a free camera, so several are too
// big for a decor slot (a 3.7-tile cupboard, a 3.6-tile carpet). Each entry carries `fit` — the plan
// size in tiles the piece is scaled to — and `fitH`, a height ceiling, and the smaller of the two
// scales wins. Scaling the built group is safe: the shear is proportional to y, so it scales with it.
import * as THREE from 'three';
import { SUPPLIED_FILES } from '../../assets/supplied/data.js';
import { SHEAR } from './kit.js';
import { patchSurface } from '../materials.js';
import { flame, groundGlow, getFog } from '../propFx.js';
import { contactShadow, pixelSnap } from '../props.js';
import { MOBILE } from '../../core/mobile.js';

const ON = (() => {
  if (typeof window === 'undefined' || typeof atob !== 'function') return false;
  try { return new URLSearchParams(location.search).get('props') === 'supplied'; } catch { return false; }
})();
/** Is the supplied-art test mode on? When it is, unmapped decor draws nothing at all. */
export function suppliedEnabled() { return ON; }
/** Did the importer actually leave assets behind? (An empty data.js means the mode draws nothing.) */
export function suppliedReady() { return Object.keys(SUPPLIED_FILES).length > 0; }

const YAW = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };
const KEY = new THREE.Vector3(-0.45, 0.8, -0.4).normalize();
const BEND = new THREE.Vector3(0, 1.5, 0.3);
const _p = new THREE.Vector3(), _n = new THREE.Vector3();

function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * WHICH SUPPLIED MODEL STANDS IN FOR WHICH DECOR TYPE.
 *
 * `ids` are asset ids from src/assets/supplied/data.js (the source prefab name, lowercased); the one
 * drawn is picked by a hash of the tile, so a storeroom's three barrels differ and the same seed always
 * builds the same room (CLAUDE.md rule 1). `fit` is the plan size in tiles the piece is scaled to,
 * `fitH` its height ceiling in tiles. `burn` lights it: 'coals' glows the bowl of a furnace, 'flame'
 * puts a candle flame at the top. `lay` tips a column onto its side. `wall` backs the piece against
 * the wall face behind it. `flat` marks a carpet — no contact shadow, it IS the floor decal.
 */
const MAP = {
  // containers
  strongbox: { ids: ['chest2a', 'chest2b'], fit: 0.78, fitH: 0.9 },
  footlocker: { ids: ['chest1b'], fit: 0.85, fitH: 0.6 },
  barrel: { ids: ['barrel1', 'barrel2', 'barrels1'], fit: 0.78, fitH: 1.1 },
  // `sewers_crate1` is NOT a crate — it is a barred sewer gate set in a stone wall (610 tris, the
  // heaviest piece in the set). It is imported and available, but it belongs in an architectural slot,
  // not under `crate`, so nothing maps to it yet.
  crate: { ids: ['box1', 'box2', 'crate1', 'crate6'], fit: 0.82, fitH: 0.95 },
  sackPile: { ids: ['sacks_gr1', 'sacks_gr2', 'sack1', 'sack2'], fit: 0.9, fitH: 0.8 },
  urn: { ids: ['jar1', 'jar2', 'jar3', 'jar4', 'jar5', 'jar6'], fit: 0.42, fitH: 0.7 },
  bottles: { ids: ['jar_gr1', 'jar_gr2'], fit: 0.6, fitH: 0.6 },
  cauldron: { ids: ['basin1', 'bucket1'], fit: 0.7, fitH: 0.8 },
  // furniture
  table: { ids: ['table1'], fit: 1.0, fitH: 0.85 },
  tableLong: { ids: ['table_tawern3', 'table1b'], fit: 1.0, fitH: 0.85, run: true },
  bench: { ids: ['bench1', 'bench7'], fit: 0.95, fitH: 0.6 },
  stool: { ids: ['bench3', 'chair4'], fit: 0.5, fitH: 0.7 },
  throne: { ids: ['chair4'], fit: 0.8, fitH: 1.2 },
  cupboard: { ids: ['cupboard2_1'], fit: 0.95, fitH: 1.25, wall: true },
  bookcase: { ids: ['cupboard2_1_books1'], fit: 0.95, fitH: 1.3, wall: true },
  bunk: { ids: ['bed_17', 'bed_18'], fit: 1.0, fitH: 0.5 },
  lectern: { ids: ['furniture10_1'], fit: 0.8, fitH: 1.0 },
  alchemyBench: { ids: ['furniture10_1'], fit: 1.0, fitH: 1.0 },
  weaponRack: { ids: ['furniture11'], fit: 0.9, fitH: 1.2, wall: true },
  shieldStand: { ids: ['furniture11'], fit: 0.9, fitH: 1.2, wall: true },
  armourStand: { ids: ['furniture11'], fit: 0.9, fitH: 1.2, wall: true },
  rack: { ids: ['furniture11'], fit: 0.9, fitH: 1.2, wall: true },
  // fire and light
  brazier: { ids: ['furnace1', 'furnace3', 'furnace2a'], fit: 0.85, fitH: 1.2, burn: 'coals' },
  hearth: { ids: ['hearth1'], fit: 0.95, fitH: 1.0, burn: 'coals' },
  forge: { ids: ['furnace3'], fit: 0.95, fitH: 1.25, burn: 'coals' },
  candlestick: { ids: ['candle1', 'candle4'], fit: 0.3, fitH: 0.8, burn: 'flame' },
  candelabra: { ids: ['chandelier4'], fit: 0.55, fitH: 1.2, burn: 'flame' },
  // `sconce` is a wall-class type as well (torch1 hung on the masonry) and goes with the rest of the
  // wall art; the torches themselves are LIGHTS, which is what actually reads at this camera.
  // dungeon features
  wellHead: { ids: ['well1', 'well2'], fit: 1.1, fitH: 0.7 },
  pillarBroken: { ids: ['column5', 'column7', 'column9'], fit: 0.85, fitH: 1.3 },
  fallenColumn: { ids: ['column7', 'column9'], fit: 1.0, fitH: 0.6, lay: true },
  rubbleMound: { ids: ['pave_debris_gr1', 'pave_debris_gr2'], fit: 1.0, fitH: 0.5 },
  stalagmite: { ids: ['rock4a', 'rock4b'], fit: 0.9, fitH: 1.3 },
  dripstone: { ids: ['rock4b'], fit: 0.5, fitH: 0.8 },
  // BitGem's `stone_skull` is a real skull from the side and a smooth pale-blue lump from a near-plan
  // camera, in a different palette from both packs. Imported, judged on the sheet, not used.
  skull: { ids: ['deco1_skull'], fit: 0.35, fitH: 0.5 },
  skullPile: { ids: ['deco1_skull'], fit: 0.55, fitH: 0.55 },
  bonePile: { ids: ['deco1_skull'], fit: 0.6, fitH: 0.45 },
  // NO WALL-HUNG PIECES. Paintings and shields were imported, mounted in the wall's own object space
  // and scaled against it (flush at 0.52 from the block centre, face at 0.50) — and then measured at
  // the play camera: they paint 0.29% of the frame, because a 17-degree tilt leaves the wall's whole
  // 0.82-tall face just 22px high and shows a vertical piece almost edge-on. The owner's call
  // (2026-09-17): "remove all objects that attach themselves to walls, you were right they were
  // invisible." `paint1-6` and `shield1-3` stay in src/assets/supplied for reference; nothing maps to
  // them. If wall art is ever wanted again it belongs in `dressing.js`'s plate pipeline, which fakes
  // the face by stretching flat art, not as geometry.
  // the packs' own rubble replaces the painted scree decal, and their carpets the painted rugs
  scree: { ids: ['pav_debris1', 'pav_debris4', 'pav_debris7'], fit: 0.55, fitH: 0.35 },
  rug: { ids: ['carpet_round3'], fit: 1.6, fitH: 0.1, flat: true },
  runner: { ids: ['carpet_square3_1'], fit: 1.7, fitH: 0.1, flat: true },
  //
  // DELIBERATELY EMPTY — the packs have no honest stand-in, so these draw nothing in this mode rather
  // than falling back to my art: sarcophagus, tombSlab, anvil, cage, chainPost, retortStand, scales,
  // mushroomCluster, rat, tankards, dice, and every remaining floor decal (bones, puddle, bloodstain,
  // scorch, crackedFlags, mosaic, chalkSigil, spill, ashBed, coins, sporePatch, lichen, rime,
  // drainGrate) and wall piece (banner, tapestry, hungShield, trophyArms, chains, manacles, cobweb,
  // skullNiche, ossuaryShelf, ironRing, gargoyleSpout, wallShelf, plaque, wallCrack, mould,
  // fungusShelf). The packs' cobwebs and ivy ARE modelled, but as vertical planes a near-plan camera
  // cannot see; they would need re-orienting first.
};

/** The decor types this module can draw. */
export const SUPPLIED_TYPES = Object.keys(MAP);

// ------------------------------------------------------------------------------ the assets
function entryOf(id) {
  const e = SUPPLIED_FILES[id];
  if (!e) throw new Error(`supplied: no asset ${id}`);
  return e;
}

function bytesOf(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

const TYPED = { 5126: Float32Array, 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const parsed = new Map();
/** The importer's glTF binaries, parsed synchronously (one primitive per mesh, plain accessors). */
function glb(id) {
  let g = parsed.get(id);
  if (g) return g;
  const bytes = bytesOf(entryOf(id).glb);
  const dv = new DataView(bytes.buffer);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  const bin = 20 + jsonLen + 8;
  const acc = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], T = TYPED[a.componentType], n = WIDTH[a.type];
    const start = bin + bv.byteOffset;
    return { array: new T(bytes.buffer.slice(start, start + a.count * n * T.BYTES_PER_ELEMENT)), size: n };
  };
  const meshes = {};
  for (const m of json.meshes) {
    const p = m.primitives[0];
    const attributes = {};
    for (const [k, i] of Object.entries(p.attributes)) attributes[k] = acc(i);
    meshes[m.name] = { attributes, index: acc(p.indices).array };
  }
  g = { meshes, extras: json.extras || {}, names: json.meshes.map((m) => m.name) };
  parsed.set(id, g);
  return g;
}

/** One texture per asset, decoded off the main path (no URL, no fetch: the single-file build's CSP). */
const textures = new Map();
function textureFor(id) {
  let t = textures.get(id);
  if (t) return t;
  const tex = new THREE.Texture();
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  // NO MIPMAPS ON A PACKED CHART. The importer crops each material's UV bbox and shelf-packs the crops,
  // so the space between them is BLACK: measured, 67% of chest2a's chart and 63% of jar_gr1's is
  // near-black padding. Every mip blends that padding into the crop, and since a prop is 30-80px on
  // screen the renderer picks exactly those mips — the pieces came to the frame as silhouettes. Nearest
  // with no mipmaps samples only the crop. (The proper fix is dilating the crops with their edge colour
  // at bake time; until the importer does that, this is the honest one.)
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  t = { tex, ready: false, waiting: [] };
  textures.set(id, t);
  const e = entryOf(id);
  const b64 = MOBILE.mobile && e.texSmall ? e.texSmall : e.tex;
  const done = (ok) => {
    t.ready = true;
    for (const m of t.waiting) {
      if (!ok) { m.map = null; m.color.setHex(0x6e5238); m.needsUpdate = true; }
      m.visible = true;
    }
    t.waiting.length = 0;
  };
  try {
    createImageBitmap(new Blob([bytesOf(b64)], { type: 'image/webp' }))
      .then((bmp) => { tex.image = bmp; tex.needsUpdate = true; done(true); })
      .catch((err) => { console.warn(`supplied: ${id} texture did not decode; drawn untextured.`, err); done(false); });
  } catch (err) {
    console.warn(`supplied: ${id} texture could not be decoded here.`, err);
    done(false);
  }
  return t;
}

const materials = new Map();
/**
 * A supplied piece's material: lit, quantised to the world texel grid at its own measured uv-per-tile,
 * fogged, pixel-snapped. `glow` keys the hot orange out of the baked albedo and adds it back as
 * emission, so a lit furnace's coals burn in a dark room and a cold one is iron and ash. The tint
 * pulls the pack's albedo — painted for a white studio key — back into the dungeon's value range.
 */
function materialFor(id, glow) {
  const key = `${id}:${glow ? 1 : 0}`;
  let m = materials.get(key);
  if (m) return m;
  const t = textureFor(id);
  const e = entryOf(id);
  const uvPerTile = e.uvPerTile || glb(id).extras.uvPerTile || 0.5;
  m = new THREE.MeshStandardMaterial({
    // NOT the Freeport tint. Those albedos were painted bright for a white studio key and had to come
    // DOWN into the dungeon's range; these packs bake their own shadow in and arrive dark (chart means
    // of 12-76 against Freeport's), so they are left at full value and lifted by the vertex light below.
    map: t.tex, vertexColors: true, roughness: 0.92, metalness: 0, color: 0xffffff,
    ...(e.cutout ? { transparent: false, alphaTest: 0.5, side: THREE.DoubleSide } : {}),
  });
  m.name = `supplied:${key}`;
  if (!t.ready) { m.visible = false; t.waiting.push(m); }
  // FOGGED, BUT NOT QUANTISED. `patchSurface`'s `quant` path snaps the texture lookup to a WORLD-TILED
  // grid, which is right for an albedo mapped 1:1 across the piece (the Freeport props) and wrong here:
  // the importer crops each material's UV bbox and shelf-packs the crops into one small chart per asset,
  // so a snapped lookup walks off a crop into the chart's black padding. Measured before this line
  // changed: the pixels over a chest read (20,18,17) with the texture decoded and the vertex colours at
  // 0.68 — the piece was sampling padding. The pixel grid still holds: the chart was baked at the
  // floor's own ~32 texels a tile, and the geometry is snapped by `pixelSnap` below.
  const fog = getFog();
  if (fog) patchSurface(m, fog);
  void uvPerTile;
  if (glow) {
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      if (prev) prev(shader, renderer);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 hc = diffuseColor.rgb;
          float heat = clamp((hc.r - max(hc.g, hc.b) * 1.15 - 0.06) * 5.0, 0.0, 1.0);
          totalEmissiveRadiance += hc * heat * 1.7;
        }`);
    };
    const prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
    m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|supplied:glow`;
  }
  pixelSnap(m, { rigid: true });
  materials.set(key, m);
  return m;
}

// ------------------------------------------------------------------------------ geometry
const geoCache = new Map();
/** One mesh of one asset, turned to `facing`, optionally tipped over, sheared and lit, cached. */
function geometry(id, part, o) {
  const key = `${id}:${part}:${o.facing}:${o.lay ? 1 : 0}:${o.noShear ? 'flat' : 'shear'}`;
  let geo = geoCache.get(key);
  if (geo) return geo;
  const src = glb(id), m = src.meshes[part];
  const P = m.attributes.POSITION.array, N = m.attributes.NORMAL.array, T = m.attributes.TEXCOORD_0.array;
  const n = P.length / 3;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const frame = new THREE.Matrix4();
  // a fallen column lies on its side, tipped about x so its length runs along the floor
  if (o.lay) frame.premultiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  frame.premultiply(new THREE.Matrix4().makeRotationY(YAW[o.facing] ?? 0));
  const size = entryOf(id).sizeTiles || [0.8, 0.8, 0.8];
  const height = Math.max(0.2, o.lay ? size[2] : size[1]);
  let minY = Infinity;
  for (let i = 0; i < n; i++) {
    _p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(frame);
    if (_p.y < minY) minY = _p.y;
  }
  for (let i = 0; i < n; i++) {
    _p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(frame);
    _p.y -= minY;                                   // tipping a piece over puts it back on the floor
    _n.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).transformDirection(frame);
    // the house key light, in WORLD space after the facing: always from the top-left
    const lit = Math.max(0, _n.dot(KEY));
    let k = 0.6 + 0.26 * Math.max(0, _n.y) + 0.24 * lit + 0.06 * Math.max(0, _n.z) - 0.1 * Math.max(0, -_n.y);
    k *= 0.8 + 0.2 * Math.min(1, Math.max(0, _p.y / (height * 0.35)));   // falling into occlusion at the foot
    k = Math.min(1, Math.max(0.12, k));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k;
    _n.multiplyScalar(0.62).add(BEND).normalize();                       // bent up into the room's light
    // THE SHEAR IS FOR THINGS STANDING ON THE FLOOR. It leans a piece north by SHEAR*y so a front
    // face arrives at the floor's foreshortening — and on a picture hung flat against masonry it does
    // the opposite of what is wanted: measured on paint6, a 0.04-thick panel came out with its top
    // displaced 0.66 TILES behind its bottom, which is why the wall art read as boards floating in
    // the room rather than hung on the wall. A hung piece keeps its own plane.
    pos[i * 3] = _p.x; pos[i * 3 + 1] = _p.y; pos[i * 3 + 2] = _p.z - (o.noShear ? 0 : SHEAR * _p.y);
    nor[i * 3] = _n.x; nor[i * 3 + 1] = _n.y; nor[i * 3 + 2] = _n.z;
    uv[i * 2] = T[i * 2]; uv[i * 2 + 1] = T[i * 2 + 1];
  }
  geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(m.index, 1));
  geo.addGroup(0, m.index.length, 0);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geoCache.set(key, geo);
  return geo;
}

/** Where a local point lands after the facing and the shear (flames). */
function placed(facing, x, y, z) {
  _p.set(x, y, z).applyMatrix4(new THREE.Matrix4().makeRotationY(YAW[facing] ?? 0));
  return [_p.x, _p.y, _p.z - SHEAR * _p.y];
}

/** The scale that fits a piece into its slot: plan size and height, whichever binds harder. */
function fitScale(id, spec) {
  const s = entryOf(id).sizeTiles || [0.8, 0.8, 0.8];
  const plan = Math.max(0.01, Math.max(s[0], s[2]));
  const byPlan = (spec.fit || 0.9) / plan;
  const byHeight = (spec.fitH || 1.3) / Math.max(0.01, s[1]);
  return Math.min(byPlan, byHeight, 4);
}

/**
 * One decor entry as a supplied prop, ready for DungeonView.addAt — or null when nothing in the packs
 * stands in for it (in supplied mode the caller then draws nothing at all).
 * @param {string} type
 * @param {{variant?:number, facing?:string, blocking?:boolean, x?:number, y?:number, span?:number, model?:string, lit?:boolean}} o
 * @param {{v:number, blk?:boolean}} [spec] the decor catalogue entry
 * @returns {THREE.Group|null}
 */
export function buildSuppliedProp(type, o = {}, spec = null) {
  if (!ON) return null;
  const m = MAP[type];
  if (!m) return null;
  const id = o.model && SUPPLIED_FILES[o.model] ? o.model : m.ids[Math.floor(hash2(o.x | 0, o.y | 0, type.length * 977) * m.ids.length) % m.ids.length];
  if (!id || !SUPPLIED_FILES[id]) return null;
  const vmax = spec && spec.v ? spec.v - 1 : 3;
  const v = Math.max(0, Math.min(vmax, o.variant | 0));
  // A RUN PIECE IS DRAWN ONCE. The pack's long tables and beds are single models, not the three-part
  // runs the kit cuts, so the first tile of a run carries the whole piece and the rest stay empty.
  if (m.run && v > 0) return null;
  const facing = YAW[o.facing] !== undefined ? o.facing : 's';
  const e = entryOf(id);
  const s = fitScale(id, m);
  const g = new THREE.Group();
  const parts = e.parts && e.parts.length ? e.parts : glb(id).names;
  const burning = !!m.burn && v < 2 && o.lit !== false;
  for (const part of parts) {
    // the coals and the flame of an unlit piece are simply not drawn
    if (!burning && (part === 'coals' || part === 'flame')) continue;
    const glow = burning && (part === 'coals' || part === 'flame' || parts.length === 1);
    g.add(Object.assign(new THREE.Mesh(geometry(id, part, { facing, lay: m.lay }), materialFor(id, glow)), {
      castShadow: true, receiveShadow: false, name: `supplied:${id}:${part}`,
    }));
  }
  const size = e.sizeTiles || [0.8, 0.8, 0.8];
  g.scale.setScalar(s);
  const foot = [size[0] * s, size[2] * s];
  // a piece that stands against a wall is pushed back to the face behind it; a HUNG piece goes flush
  // to that face — the masonry's plane is half a tile from the tile's centre, so anything less leaves
  // it hanging in the room (which is exactly how the first cut looked in perspective mode).
  if (m.wall) {
    const back = 0.5 - foot[1] / 2 - 0.06;
    const [bx, , bz] = placed(facing, 0, 0, -back);
    g.position.x += bx; g.position.z += bz;
  }
  if (burning) {
    // WHERE THE FIRE SITS. The importer recorded the prefab's own fire children (`anchors`: a furnace's
    // `Fire2` at y 1.315, a candle's `Candleflame` at 0.508), so the flame lands where the pack's artist
    // put it rather than at a guessed fraction of the height. `hearth1` ships its fire as a separate
    // prefab and so carries no anchor: three quarters up is the bowl on that one.
    const anchors = e.anchors || [];
    const fire = anchors.find((a) => /fire|flame|candleflame/i.test(a.name)) || anchors[0];
    const top = (fire ? fire.p[1] : size[1] * (id === 'hearth1' ? 0.75 : 0.92)) * s;
    const f = placed(facing, (fire ? fire.p[0] : 0) * s, top, (fire ? fire.p[2] : 0) * s);
    const size2 = m.burn === 'flame' ? 0.16 : 0.24;
    const fl = flame(size2, 1.7, { spherical: true });
    fl.position.set(f[0], f[1], f[2]);
    g.add(fl);
    g.add(groundGlow(0xff7a2a, m.burn === 'flame' ? 0.4 : 0.62, { opacity: 0.12 }));
  }
  // a carpet IS the floor decal: no contact shadow under it, and it sits a hair above the flagstones
  if (m.flat) g.position.y += 0.012;
  else {
    const sh = contactShadow(1, { strength: 0.72 });
    sh.scale.set(foot[0] * 1.18, foot[1] * 1.16, 1);
    sh.position.set(0.03, 0.013, 0.05);
    g.add(sh);
  }
  g.userData.decor = { type, variant: v, facing, cls: m.flat ? 'decal' : 'prop', kit: true, supplied: id, span: Math.max(1, o.span | 0) };
  g.userData.blocking = !!o.blocking && !!(spec && spec.blk) && !m.flat;
  return g;
}
