// models: the imported Dungeon Crawlers prop library, wired to our decor vocabulary.
//
// WHY 3D PROPS AT ALL, IN A GAME OF PIXEL SPRITES
// HD-2D is a 3D diorama with 2D characters: Octopath's environments are real geometry and only the
// cast is billboarded pixel art. Our dungeon is already built that way, so imported furniture is
// the environment half of the style, not a break from it. The cast stays sprites.
//
// HOW THEY ARE MADE TO BELONG (the "one grid" rule this project is built on)
// These models ship with a 4096 hand-painted atlas, which at our camera would be far finer than the
// floor and the sprites and would read as two resolutions on one screen - the single failure the art
// audits kept coming back to. So the atlas is downscaled to 512 and sampled with NearestFilter: one
// texture texel then lands at roughly one sprite texel, and the props sit on the same pixel grid as
// everything else. That is the whole of "Option A" and it is why this file does not simply use the
// source texture at full resolution.
//
// SHIPPING
// The glTF and the atlas live in src/assets as gzipped base64 JS modules. The single-file artifact
// build allows neither fetch() nor data: URIs, so nothing here loads over the network: the bytes are
// already in the bundle and are inflated once, on first use.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { patchFog } from '../lighting.js';
import { WORLD_MASK_ALPHA } from '../materials.js';
import { PROPS_GLB_GZ_B64 } from '../../assets/propsModel.js';
import { ATLAS_W, ATLAS_H, ATLAS_RGBA_GZ_B64 } from '../../assets/propsAtlas.js';

/** decor `type` -> candidate model names. A type with several candidates picks one by variant, so a
 *  room full of barrels is not a row of identical barrels. Types absent here keep their hand-pixelled
 *  piece from furniture.js: the import covers dressing and light sources, not the whole catalogue. */
export const MODEL_MAP = {
  barrel: ['barrels/barrel_01', 'barrels/barrel_02', 'barrels/barrel_03'],
  table: ['tables/table_wood', 'tables/table_wood_cloth_red', 'tables/table_wood_cloth_white'],
  tableLong: ['tables/table_wood_all_red', 'tables/table_wood_all_white'],
  stool: ['chairs/chair_wood', 'chairs/chair_stone'],
  bench: ['chairs/chair_wood_cloth_red', 'chairs/chair_wood_cloth_white', 'chairs/chair_stone_cloth_red', 'chairs/chair_stone_cloth_white'],
  urn: ['vases/vase_01_01', 'vases/vase_02_01', 'vases/vase_03_01', 'vases/vase_04_01', 'vases/vase_05_01', 'vases/vase_06_01', 'vases/vase_07_01'],
  brazier: ['firepits/firepit_lit', 'firepits/firepit_wood_lit'],
  hearth: ['firepits/firepit_large_wood_lit', 'firepits/firepit_large_lit'],
  candelabra: ['candelabras/candelabra_001_lit', 'candelabras/candelabra_003_lit', 'candelabras/candelabra_006_lit', 'candelabras/candelabra_11_lit'],
  candlestick: ['candles/candle_01_lit', 'candles/candle_03_lit', 'candles/candle_holder', 'candles/candle_arrangement_01_01_lit'],
  lantern: ['lanterns/lantern_01_lit', 'lanterns/lantern_02_lit', 'lanterns/lantern_04_lit'],
  chandelier: ['chandeliers/chandelier_wood_lit', 'chandeliers/chandelier_metal_lit'],
  standingTorch: ['torches/standing_torch_01_lit', 'torches/standing_torch_03_lit', 'torches/standing_torch_05_lit', 'torches/standing_torch_06_lit'],
  sconce: ['torches/torch_01_lit', 'torches/torch_02_lit'],
  skull: ['table_deco/skull_001', 'table_deco/skull_002'],
  bowl: ['table_deco/bowl_large', 'table_deco/bowl_small'],
  plate: ['table_deco/plate_01'],
  cup: ['table_deco/cup_01'],
  scree: ['table_deco/rock'],
};

/** Unlit twins, for a piece standing in a room the torches never reached. */
const UNLIT = (name) => name.replace(/_lit$/, '_unlit');

/** glTF node names cannot carry the '/' our category paths use - the exporter drops it, turning
 *  'barrels/barrel_01' into 'barrelsbarrel_01'. Both sides of every lookup go through this, so the
 *  MODEL_MAP above stays readable. */
const key = (name) => name.replace(/[^a-z0-9_]/gi, '').toLowerCase();

let cache = null;

function inflate(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

/**
 * Inflate and parse the library once. Safe to call repeatedly; later callers await the same promise.
 *
 * `fog` is not optional in practice: a prop that does not go through `patchFog` is drawn at full
 * brightness in a room the player has never entered, which is the same bug the water surface had
 * (materials.js) and it reads exactly as badly — a lit barrel hanging in unexplored black rock.
 * It is only defaulted so a test or a tool can parse the library without a scene.
 * @param {import('../lighting.js').FogOfWar} [fog]
 * @returns {Promise<{meshes:Map<string,THREE.Mesh>, material:THREE.Material}>}
 */
export function loadPropModels(fog) {
  if (cache) return cache;
  cache = (async () => {
    const [glb, rgbaBuf] = await Promise.all([inflate(PROPS_GLB_GZ_B64), inflate(ATLAS_RGBA_GZ_B64)]);
    const tex = new THREE.DataTexture(new Uint8Array(rgbaBuf), ATLAS_W, ATLAS_H, THREE.RGBAFormat);
    // Nearest, no mips: this is what puts the props on the cast's pixel grid rather than a finer one.
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false; // the source atlas is authored top-down; the exporter kept those UVs
    tex.needsUpdate = true;
    const material = new THREE.MeshStandardMaterial({
      // THE LIBRARY IS PAINTED BRIGHTER THAN OUR STONE. Its atlas was authored for a renderer with
      // a flat white key; dropped into a torchlit room at full albedo the props sit a clear step
      // above the flagstones beside them and read as cut-outs pasted over the floor. The tint puts
      // them back inside the dungeon's own value range - the same job `stoneFamily` does for slabs.
      map: tex, color: 0xc2bab2, roughness: 0.88, metalness: 0.04, alphaTest: 0.5, side: THREE.DoubleSide,
    });
    if (fog) {
      patchFog(material, fog);          // the fog of war owns these props like it owns the stone
      // ...and so does the grain mask: these are 32-texel blocks like the floor (materials.js
      // WORLD_MASK_ALPHA), so the grading pass must keep its film grain off them too.
      const fogged = material.onBeforeCompile;
      material.onBeforeCompile = (shader, renderer) => {
        fogged(shader, renderer);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <dithering_fragment>', `#include <dithering_fragment>\n gl_FragColor.a = ${WORLD_MASK_ALPHA.toFixed(3)};`);
      };
      material.customProgramCacheKey = () => 'fogofwar-v2|propmodels';
    }
    const gltf = await new GLTFLoader().parseAsync(glb, '');
    const meshes = new Map();
    gltf.scene.traverse((o) => { if (o.isMesh) { o.material = material; meshes.set(key(o.name), o); } });
    return { meshes, material };
  })();
  return cache;
}

/**
 * One prop, ready to add to the scene: standing on y=0, centred on its tile, facing +z.
 * @param {{meshes:Map<string,THREE.Mesh>}} lib from loadPropModels()
 * @param {string} type a decor type from MODEL_MAP
 * @param {number} [variant] chooses between candidates (any integer; wrapped)
 * @param {boolean} [lit] false swaps to the unlit twin where one exists
 * @returns {THREE.Mesh|null} null when this type has no model and should fall back to pixel art
 */
export function makePropModel(lib, type, variant = 0, lit = true) {
  const names = MODEL_MAP[type];
  if (!names || !names.length) return null;
  let name = names[((variant % names.length) + names.length) % names.length];
  if (!lit && lib.meshes.has(key(UNLIT(name)))) name = UNLIT(name);
  const src = lib.meshes.get(key(name));
  if (!src) return null;
  const mesh = new THREE.Mesh(src.geometry, src.material);
  mesh.name = `prop:${type}`;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * The library's own footprint for a model, in world units: `[width, height, depth]` of its
 * geometry's bounding box. The caller scales from this to the art box the hand-pixelled piece
 * occupies, so an imported barrel stands exactly where the painted barrel stood.
 * @param {THREE.Mesh} mesh from `makePropModel`
 * @returns {{sx:number, sy:number, sz:number, cx:number, cy:number, cz:number}}
 */
export function modelBounds(mesh) {
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  const b = g.boundingBox;
  return {
    sx: b.max.x - b.min.x, sy: b.max.y - b.min.y, sz: b.max.z - b.min.z,
    cx: (b.max.x + b.min.x) / 2, cy: b.min.y, cz: (b.max.z + b.min.z) / 2,
  };
}

/** True when this decor type is served by an imported model rather than a hand-pixelled piece. */
export function hasPropModel(type) { return !!MODEL_MAP[type]; }
