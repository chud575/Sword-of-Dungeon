// freeport: the owner's own Zealot / Freeport props — chests, braziers, the cupboard and the tables —
// standing in for the kit pieces of those four kinds.
//
// WHERE THEY COME FROM (tools/freeport-import/, src/assets/freeport/README.md)
//   braziers, cupboard, tables  the textured Unity-ready packages: FBX + a baked albedo (AO and the
//                               normal map's detail under the house key light), WebP at ~32 texels a tile
//   chests, the coin heap       the 3D-print plates, decimated to ~3K triangles, iron and wood told apart
//                               by structure and relief, AO baked per vertex; they carry TEXEL positions,
//                               not UVs, and are textured here from the prop kit's own painted atlas
//
// HOW THEY ARE MADE TO BELONG — the same three rules kit.js lays down, applied to meshes nobody here drew:
//  1. ONE TEXEL SIZE. Chests sample the kit atlas at `TPU`, through the kit's own snapped materials. The
//     textured pieces were resampled to the floor's density by the importer, and their lookups go through
//     `patchSurface`'s `quant` path with their measured uv-per-tile, so they snap to the live world grid.
//  2. THE CAST'S PROJECTION. Every vertex is sheared north by `SHEAR * y` after it is turned to its facing,
//     exactly as `KitBuilder.build` does, so a front face comes to the screen at the floor's foreshortening.
//  3. THE HOUSE KEY LIGHT IN THE VERTEX COLOUR, normals bent up into the room's overhead light.
// Plus the kit's contact shadow, its flames and glow pools, the fog of war (both material paths are
// fogged) and the pixel lattice snap.
//
// THE SWITCH. They are the default. `?props=kit` puts the kit pieces back for comparison, and nothing
// here runs outside a browser, so the node tests see the kit exactly as before.
import * as THREE from 'three';
import { FREEPORT_FILES } from '../../assets/freeport/data.js';
import { SHEAR, MAT as M } from './kit.js';
import { kitPropMaterials } from './kitProps.js';
import { patchSurface } from '../materials.js';
import { flame, groundGlow, getFog } from '../propFx.js';
import { contactShadow, pixelSnap } from '../props.js';
import { MOBILE } from '../../core/mobile.js';

const ON = (() => {
  if (typeof window === 'undefined' || typeof atob !== 'function') return false;
  try { return new URLSearchParams(location.search).get('props') !== 'kit'; } catch { return true; }
})();
/** Are the imported props drawn (the default), or the kit pieces (`?props=kit`, and always in node)? */
export function freeportEnabled() { return ON; }

/** decor `facing` -> yaw turning the local front (+z) that way (kitProps.js YAW). */
const YAW = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };
const KEY = new THREE.Vector3(-0.45, 0.8, -0.4).normalize();
const BEND = new THREE.Vector3(0, 1.5, 0.3);
const CELL = 64, COLS = 8, AW = 512, AH = 256;

function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ------------------------------------------------------------------------------ the assets
function bytesOf(name) {
  const b64 = FREEPORT_FILES[name];
  if (!b64) throw new Error(`freeport: no asset ${name}`);
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

const TYPED = { 5126: Float32Array, 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const parsed = new Map();
/**
 * The importer's glTF binaries, parsed synchronously: they are written by tools/freeport-import/mesh.mjs
 * (one primitive per mesh, plain accessors, no sparse, no compression), so this reads exactly that.
 * @returns {{meshes: Record<string, {attributes: Record<string, {array, size}>, index}>, extras: object}}
 */
function glb(id) {
  let g = parsed.get(id);
  if (g) return g;
  const bytes = bytesOf(`${id}.glb`);
  const dv = new DataView(bytes.buffer);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen)));
  const bin = 20 + jsonLen + 8;
  const acc = (i) => {
    const a = json.accessors[i], bv = json.bufferViews[a.bufferView], T = TYPED[a.componentType], n = WIDTH[a.type];
    const start = bin + bv.byteOffset;
    return { array: new T(bytes.buffer.slice(start, start + a.count * n * T.BYTES_PER_ELEMENT)), size: n, normalized: !!a.normalized };
  };
  const meshes = {};
  for (const m of json.meshes) {
    const p = m.primitives[0];
    const attributes = {};
    for (const [k, i] of Object.entries(p.attributes)) attributes[k] = acc(i);
    meshes[m.name] = { attributes, index: acc(p.indices).array };
  }
  g = { meshes, extras: json.extras || {} };
  parsed.set(id, g);
  return g;
}

/**
 * One texture per textured piece, decoded off the main path (WebP bytes -> ImageBitmap; no URL, no fetch,
 * so the single-file build's CSP is satisfied). Until it lands, every material that samples it stays
 * invisible: a black cupboard for two frames is worse than a cupboard that appears.
 */
const textures = new Map();
function textureFor(id) {
  let t = textures.get(id);
  if (t) return t;
  const tex = new THREE.Texture();
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.generateMipmaps = true;
  let settle;
  t = { tex, ready: false, waiting: [], done: new Promise((r) => { settle = r; }) };
  textures.set(id, t);
  const phone = `${id}_phone.webp`;
  const name = MOBILE.mobile && FREEPORT_FILES[phone] ? phone : `${id}.webp`;
  const done = (ok) => {
    t.ready = true;
    for (const m of t.waiting) {
      if (!ok) { m.map = null; m.color.setHex(0x6e5238); m.needsUpdate = true; }
      m.visible = true;
    }
    t.waiting.length = 0;
    settle();
  };
  try {
    createImageBitmap(new Blob([bytesOf(name)], { type: 'image/webp' }))
      .then((bmp) => { tex.image = bmp; tex.needsUpdate = true; done(true); })
      .catch((err) => { console.warn(`freeport: ${name} did not decode; the piece is drawn untextured.`, err); done(false); });
  } catch (err) {
    console.warn(`freeport: ${name} could not be decoded here.`, err);
    done(false);
  }
  return t;
}

const materials = new Map();
/**
 * A textured piece's material: lit, on the world texel grid (quant at its own measured uv per tile),
 * fogged, pixel-snapped. `glow` adds the braziers' coals: the saturated hot orange in the baked albedo
 * is keyed out and added back as emission, so a lit brazier's bowl burns in a dark room and a cold one
 * (`glow` false) is iron and ash.
 */
function texturedMaterial(id, glow) {
  const key = `${id}:${glow ? 1 : 0}`;
  let m = materials.get(key);
  if (m) return m;
  const t = textureFor(id);
  const uvPerTile = glb(id).extras.uvPerTile || 0.5;
  // THE FREEPORT ALBEDO IS PAINTED FOR A WHITE KEY LIGHT. Measured in 'freeport-props', the banquet cloth
  // came to the screen as the brightest thing in the room under the torches — brighter than the wall caps.
  // The tint puts the pieces back inside the dungeon's value range (models.js does the same for its library).
  m = new THREE.MeshStandardMaterial({ map: t.tex, vertexColors: true, roughness: 0.92, metalness: 0, color: 0xc8c0b8 });
  m.name = `freeport:${key}`;
  if (!t.ready) { m.visible = false; t.waiting.push(m); }
  const fog = getFog();
  if (fog) patchSurface(m, fog, { quant: [uvPerTile, uvPerTile] });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uFpGlow = { value: glow ? 1.7 : 0 };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFpGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 hc = diffuseColor.rgb;
        float heat = clamp((hc.r - max(hc.g, hc.b) * 1.15 - 0.06) * 5.0, 0.0, 1.0);
        totalEmissiveRadiance += hc * heat * uFpGlow;
      }`);
  };
  const prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : null;
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|freeport:${glow ? 'glow' : 'cold'}`;
  pixelSnap(m, { rigid: true });
  materials.set(key, m);
  return m;
}

// ------------------------------------------------------------------------------ geometry
const geoCache = new Map();
const _n = new THREE.Vector3(), _p = new THREE.Vector3();
/**
 * One mesh of one asset, turned to `facing`, sheared, lit in its vertex colours, cached.
 * @param {string} id asset @param {string} part mesh name inside it
 * @param {object} o
 *  facing; open (radians the lid swings back about its hinge); chest: {wood, iron, tint, seed} to build kit
 *  atlas UVs from the texel charts; place: extra Matrix4 applied before the facing (the coin heap).
 */
function geometry(id, part, o) {
  const key = `${id}:${part}:${o.facing}:${o.open || 0}:${o.chest ? `${o.chest.wood},${o.chest.iron},${o.chest.tint},${o.chest.seed}` : 'tex'}:${o.placeKey || ''}`;
  let geo = geoCache.get(key);
  if (geo) return geo;
  const src = glb(id), m = src.meshes[part], ex = src.extras;
  const P = m.attributes.POSITION.array, N = m.attributes.NORMAL.array, T = m.attributes.TEXCOORD_0.array;
  const n = P.length / 3;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  const frame = new THREE.Matrix4();
  if (o.place) frame.copy(o.place);
  if (o.open && ex.hinge) {
    const [hy, hz] = ex.hinge;
    frame.premultiply(new THREE.Matrix4().makeTranslation(0, -hy, -hz))
      .premultiply(new THREE.Matrix4().makeRotationX(-o.open))
      .premultiply(new THREE.Matrix4().makeTranslation(0, hy, hz));
  }
  frame.premultiply(new THREE.Matrix4().makeRotationY(YAW[o.facing] ?? 0));
  const cls = m.attributes._CLASS ? m.attributes._CLASS.array : null;
  const ao = m.attributes._AO ? m.attributes._AO.array : null;
  const height = Math.max(0.2, ex.height || 0.6);
  let offS = 0, offT = 0;
  if (o.chest) { offS = Math.floor(hash2(o.chest.seed, 1, 23) * 30); offT = Math.floor(hash2(o.chest.seed, 2, 23) * 36); }
  for (let i = 0; i < n; i++) {
    _p.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]).applyMatrix4(frame);
    _n.set(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]).transformDirection(frame);
    // the house key light, in WORLD space after the facing: the light is always from the top-left
    const lit = Math.max(0, _n.dot(KEY));
    let k = 0.6 + 0.26 * Math.max(0, _n.y) + 0.24 * lit + 0.06 * Math.max(0, _n.z) - 0.1 * Math.max(0, -_n.y);
    k *= 0.8 + 0.2 * Math.min(1, Math.max(0, _p.y / (height * 0.35)));        // falling into occlusion at the foot
    if (ao) k *= 0.55 + 0.45 * (ao[i] / 255);                                // AO shapes the piece; it must not blacken it
    k = Math.min(1, Math.max(0.12, k));
    const tint = o.chest ? o.chest.tint : 1;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = k * tint;
    // bent up into the room's overhead light (kit.js `vert`)
    _n.multiplyScalar(0.62).add(BEND).normalize();
    pos[i * 3] = _p.x; pos[i * 3 + 1] = _p.y; pos[i * 3 + 2] = _p.z - SHEAR * _p.y;
    nor[i * 3] = _n.x; nor[i * 3 + 1] = _n.y; nor[i * 3 + 2] = _n.z;
    if (o.chest) {
      const cell = cls && cls[i] ? o.chest.iron : o.chest.wood;
      const cc = cell % COLS, rr = Math.floor(cell / COLS);
      const s = Math.min(CELL - 0.02, Math.max(0.02, T[i * 2] + offS)), t = Math.min(CELL - 0.02, Math.max(0.02, T[i * 2 + 1] + offT));
      uv[i * 2] = (cc * CELL + s) / AW; uv[i * 2 + 1] = (AH - (rr + 1) * CELL + t) / AH;
    } else {
      uv[i * 2] = T[i * 2]; uv[i * 2 + 1] = T[i * 2 + 1];
    }
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

/** Where a local point lands after the facing and the shear (flames, glints). */
function placed(facing, x, y, z) {
  _p.set(x, y, z).applyMatrix4(new THREE.Matrix4().makeRotationY(YAW[facing] ?? 0));
  return [_p.x, _p.y, _p.z - SHEAR * _p.y];
}

function solid(geo, mat, name) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true; mesh.receiveShadow = false;
  mesh.name = name;
  return mesh;
}

// ------------------------------------------------------------------------------ the pieces
/** The chest assets and what the decor types ask of them. */
const CHESTS = ['chest_a', 'chest_b'];
const WOOD = { strongbox: { wood: M.dark, iron: M.iron, tint: 1.14 }, footlocker: { wood: M.oak, iron: M.iron, tint: 1.12 }, pickup: { wood: M.oak, iron: M.gold, tint: 1.3 } };
/** How far an open lid is thrown back, in radians. */
const LID_OPEN = 1.95;

/**
 * Which asset a decor entry draws. A variant choice between the imported models is a hash of the tile,
 * so a vault's two strongboxes differ and the same seed always draws the same room (CLAUDE.md rule 1);
 * `o.model` names one outright (the `freeport-props` plate).
 */
function modelFor(type, o) {
  if (o.model) return o.model;
  const h = hash2(o.x | 0, o.y | 0, type.length * 977);
  switch (type) {
    case 'brazier': return h < 0.5 ? 'brazier_a' : 'brazier_b';
    case 'strongbox': return CHESTS[h < 0.5 ? 0 : 1];
    case 'footlocker': return 'chest_long';
    case 'cupboard': return 'cupboard';
    case 'table': return 'table';
    case 'tableLong': return 'banquet';
    default: return null;
  }
}

/** The decor types this module draws. */
export const FREEPORT_TYPES = ['brazier', 'strongbox', 'footlocker', 'cupboard', 'table', 'tableLong'];

/**
 * One decor entry as an imported Freeport prop, ready for DungeonView.addAt — or null (the kit draws it).
 * @param {string} type
 * @param {{variant?:number, facing?:string, blocking?:boolean, x?:number, y?:number, span?:number, model?:string, lit?:boolean}} o
 * @param {{v:number, blk?:boolean}} [spec] the furniture catalogue entry
 * @returns {THREE.Group|null}
 */
export function buildFreeportProp(type, o = {}, spec = null) {
  if (!ON || !FREEPORT_TYPES.includes(type)) return null;
  const id = modelFor(type, o);
  if (!id || !FREEPORT_FILES[`${id}.glb`]) return null;
  const vmax = spec && spec.v ? spec.v - 1 : 3;
  const v = Math.max(0, Math.min(vmax, o.variant | 0));
  let facing = YAW[o.facing] !== undefined ? o.facing : 's';
  // A TABLE HAS NO FRONT. Turned east or west, the cloth table's long axis ran north-south and the shear
  // stood it up into a tall grey slab (as-played, seed 740701 depth 1, the guardroom table facing 'w');
  // it keeps its long axis east-west whatever way the generator faced it, and still fits its tile.
  if (id === 'table' && (facing === 'e' || facing === 'w')) facing = facing === 'e' ? 's' : 'n';
  const ex = glb(id).extras;
  const g = new THREE.Group();
  let foot = ex.foot || [0.6, 0.6], cz = 0;
  if (id.startsWith('chest')) {
    const look = { ...(WOOD[type] || WOOD.strongbox), seed: (o.x | 0) * 31 + (o.y | 0) };
    look.seed = look.seed % 7;                                   // a handful of atlas offsets, shared geometry
    const open = v >= 1 ? LID_OPEN : 0;
    const [lit] = kitPropMaterials();
    g.add(solid(geometry(id, 'body', { facing, chest: look }), lit, `freeport:${id}:body`));
    g.add(solid(geometry(id, 'lid', { facing, chest: look, open }), lit, `freeport:${id}:lid`));
  } else if (id === 'banquet') {
    // a run segment: v0 and v2 the ends, v1 the middle (AMBIENCE §5.4), the table top running edge to edge
    const seg = `seg${Math.max(0, Math.min(2, v))}`;
    g.add(solid(geometry(id, seg, { facing }), texturedMaterial(id, false), `freeport:${id}:${seg}`));
    foot = [1, ex.foot[1]];
  } else {
    const burning = id.startsWith('brazier') && v < 2 && o.lit !== false;
    g.add(solid(geometry(id, id, { facing }), texturedMaterial(id, burning), `freeport:${id}`));
    if (id === 'cupboard') cz = (ex.back ?? -0.3) + ex.foot[1] / 2;
    if (burning && ex.flame) {
      const f = placed(facing, ex.flame[0], ex.flame[1], ex.flame[2]);
      const size = id === 'brazier_a' ? 0.26 : 0.22;
      const fl = flame(size, 1.7, { spherical: true });
      fl.position.set(f[0], f[1] - size * 0.2, f[2]);
      g.add(fl);
      const pool = groundGlow(0xff7a2a, 0.62, { opacity: 0.12 });
      g.add(pool);
    }
  }
  // the contact shadow: the footprint turned with the piece, a touch wider and pushed a hair south so a
  // rim of it shows at the foot of the front face (buildKitProp)
  const turned = facing === 'e' || facing === 'w';
  const sh = contactShadow(1, { strength: 0.72 });
  const lz = turned ? 0 : cz * (facing === 'n' ? -1 : 1), lx = turned ? cz * (facing === 'e' ? -1 : 1) : 0;
  sh.scale.set((turned ? foot[1] : foot[0]) * 1.18, (turned ? foot[0] : foot[1]) * 1.16, 1);
  sh.position.set(lx + 0.03, 0.013, lz + 0.05);
  g.add(sh);
  g.userData.decor = { type, variant: v, facing, cls: 'prop', kit: true, freeport: id, span: Math.max(1, o.span | 0) };
  g.userData.blocking = !!o.blocking && !!(spec && spec.blk);
  return g;
}

/**
 * The treasure chest PICKUP (props.js `chest` / `chestOpen`): chest A in bright oak with its iron in gold,
 * and, open, its lid thrown back over a heap of the plate's own coins.
 * @param {boolean} open
 * @returns {{mesh: THREE.Group, glints: number[][]}|null} null when the kit chest should be drawn
 */
export function buildFreeportChest(open = false) {
  if (!ON || !FREEPORT_FILES['chest_a.glb']) return null;
  const id = 'chest_a', ex = glb(id).extras;
  const look = { ...WOOD.pickup, seed: 3 };
  const [lit] = kitPropMaterials();
  const g = new THREE.Group();
  g.add(solid(geometry(id, 'body', { facing: 's', chest: look }), lit, 'freeport:chest:body'));
  g.add(solid(geometry(id, 'lid', { facing: 's', chest: look, open: open ? LID_OPEN : 0 }), lit, 'freeport:chest:lid'));
  const d = ex.foot[1], rim = ex.rimY;
  let glints;
  if (open && FREEPORT_FILES['coins.glb']) {
    const cs = glb('coins').extras.size || [0.47, 0.18, 0.73];
    // the heap lies along the chest: turned a quarter, scaled into the body's opening, its crown at the rim
    const k = Math.min((ex.foot[0] * 0.62) / cs[2], (d * 0.52) / cs[0]);
    const y0 = Math.max(ex.inner || 0, rim - cs[1] * k * 0.95);
    const place = new THREE.Matrix4().makeRotationY(Math.PI / 2).premultiply(new THREE.Matrix4().makeScale(k, k, k)).premultiply(new THREE.Matrix4().makeTranslation(0, y0, 0.01));
    const gold = { wood: M.gold, iron: M.gold, tint: 1.15, seed: 5 };
    g.add(solid(geometry('coins', 'coins', { facing: 's', chest: gold, place, placeKey: 'pickup' }), lit, 'freeport:chest:coins'));
    const top = y0 + cs[1] * k;
    glints = [placed('s', 0.08, top, 0), placed('s', -0.14, top - 0.02, 0.05), placed('s', 0.02, top + 0.02, -0.04)];
  } else {
    glints = [placed('s', 0, rim, d / 2 + 0.04), placed('s', 0.26, ex.height - 0.04, d / 2 - 0.05)];
  }
  return { mesh: g, glints };
}

/** The textured pieces, whose WebP starts decoding the moment this module loads in a browser. */
const TEXTURED = ['brazier_a', 'brazier_b', 'cupboard', 'table', 'banquet'];
let readyPromise = null;
/**
 * Resolves when every texture has decoded (or failed and fallen back). DECODED AT LOAD, NOT AT FIRST USE:
 * the scripted tools step the game without letting real time pass, and a texture first asked for inside
 * a stepped scenario would never land before the frame was taken — measured: 'freeport-props' came back
 * with shadows and flames standing on empty tiles. main.js waits for this before it declares the game
 * ready, so a room built after boot always has its textures.
 * @returns {Promise<void>}
 */
export function freeportReady() {
  if (readyPromise) return readyPromise;
  if (!ON) return (readyPromise = Promise.resolve());
  readyPromise = Promise.all(TEXTURED.filter((id) => FREEPORT_FILES[`${id}.webp`]).map((id) => textureFor(id).done)).then(() => {});
  return readyPromise;
}
if (ON) freeportReady();

/** Test and debug hook: the parsed asset (extras and mesh names) for an id. */
export function freeportAsset(id) { const g = glb(id); return { extras: g.extras, meshes: Object.keys(g.meshes) }; }
