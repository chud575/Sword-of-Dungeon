// Prop meshes: items, treasure, the Sword of Fargoal, altars, torches, arches, rubble, runes.
// All geometry is procedural and shared through a geometry cache; materials are the shared set
// from materials.js plus a few fog-aware glow/billboard materials from propFx.js.
//
// Contract with DungeonView: item props carry userData.anim {y0, amp, speed, spin, t, node?, halo?}
// (bob/spin), flames carry userData.flame (scale flicker), the altar haze carries userData.glow.
// Richer motion (glints, orbiting motes, sigils, sparks) runs through the module-level animator:
// props register a tick function and Effects.update() calls updateProps() once per frame.
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { PALETTE, createShaftMaterial } from './materials.js';
import { glowTexture, glintTexture, sigilTexture, runeCircleTexture, billboard, groundGlow, flame, litMaterial, getFog, updateFlames } from './propFx.js';
import { paint, outline, toRGBA, Palette, makePix, blit, setPx, keyShade, bounds } from './sprites/pixelPainter.js';
import { INK, INK_LIT, LIT, ramp } from './sprites/style.js';
import { PX_PER_TILE, frameTexelSize } from './sprites/spriteBillboard.js';

const geoCache = new Map();
function geo(key, make) { let g = geoCache.get(key); if (!g) { g = make(); geoCache.set(key, g); } return g; }

function mesh(g, m, x = 0, y = 0, z = 0, opts = {}) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  if (opts.rx) o.rotation.x = opts.rx; if (opts.ry) o.rotation.y = opts.ry; if (opts.rz) o.rotation.z = opts.rz;
  if (opts.s) o.scale.setScalar(opts.s);
  o.castShadow = opts.shadow !== false; o.receiveShadow = true;
  return o;
}

export const SPELL_COLORS = { teleport: 0x4ee1ff, shield: 0xffd43b, regeneration: 0x69db7c, invisibility: 0xb197fc, light: 0xfff3bf, drift: 0xe9ecef };

// ==================================================================== hand-pixelled item sprites
// A treasure chest built from smooth-shaded low-poly primitives sits in the diorama like a render
// test: every other surface in shot is painted and high-frequency, and the chest has no texture at
// all. Octopath's props are 3D, but they are *painted*. So the pickups are drawn the same way the
// cast is — a hand-pixelled sprite on the house ramps, with the house ink outline and the house
// top-left key light — and billboarded upright in the lit room. Everything else (glow pools,
// glints, motes, particles) is unchanged, so the props still read as magical, just not as plastic.
const _wp = new THREE.Vector3(), _bufSize = new THREE.Vector2(), _fwd = new THREE.Vector3();
const pixTex = new Map();

/**
 * Palette from house ramps. `ramps` maps a key STRING (5-7 chars, darkest first) to a base colour;
 * `extra` sets single keys directly. The ink and its lit variant are always present.
 * @param {Object<string, string|number>} ramps @param {Object<string, string|number[]>} [extra]
 */
function itemPalette(ramps, extra = {}) {
  const p = new Palette().set('#', INK).set('@', INK_LIT);
  for (const keys in ramps) {
    const cols = ramp(ramps[keys], keys.length);
    for (let i = 0; i < keys.length; i++) p.set(keys[i], cols[i]);
  }
  for (const k in extra) p.set(k, extra[k]);
  return p;
}

/** Painted art -> a padded, house-outlined, NearestFilter texture (built once per key). */
function pixelTexture(key, art0, pal) {
  let t = pixTex.get(key);
  if (t) return t;
  const drawn = typeof art0 === 'function' ? art0() : paint(art0);
  // CROP TO THE DRAWING. The quad's pivot is its bottom edge, so a blank row left under an object
  // is a texel of air between it and the floor — which is exactly how a pickup starts to float.
  // Cropping to the painted bounds makes "the bottom row of the art" and "the row it rests on" the
  // same row, for every pickup, whatever canvas it happened to be drawn on.
  const b = bounds(drawn) || { x0: 0, y0: 0, w: drawn.w, h: drawn.h };
  const src = makePix(b.w, b.h);
  blit(src, drawn, -b.x0, -b.y0);
  const pad = makePix(src.w + 2, src.h + 2);
  blit(pad, src, 1, 1);
  const art = outline(pad, '#', { lit: LIT, litKey: '@' });
  const canvas = document.createElement('canvas');
  canvas.width = art.w; canvas.height = art.h;
  canvas.getContext('2d').putImageData(new ImageData(toRGBA(art, pal), art.w, art.h), 0, 0);
  t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.userData.size = { w: art.w, h: art.h };
  pixTex.set(key, t);
  return t;
}

/**
 * ONE PIXEL GRID FOR THE WHOLE SCREEN — pickups included.
 *
 * This used to round its own texel size, per prop, from the CAMERA'S DISTANCE to that prop:
 * `S = max(2, round(pxPerWorld / 32))`. Two faults fell straight out of it, both measured live in
 * the 'treasure' shot at 1600x900: the twelve pickups in one frame came out at texel sizes from
 * 0.0285 to 0.0484 world units — the same 16-texel sprite drawn at three different resolutions in
 * one picture — and every one of them was coarser than the hero beside them, who was on the cast's
 * shared grid at 0.0281. A potion whose pixels are 1.7x the hero's is not a prop in his world; it
 * is a sticker from a different game.
 *
 * So the size now comes from `frameTexelSize()` — THE grid, the one integer the whole cast shares,
 * derived from the camera alone (see spriteBillboard.js "ONE TEXEL SIZE FOR THE WHOLE SCREEN").
 * One art texel of a chest is exactly one art texel of the hero, always. A pickup that wants to
 * look bigger is a request for MORE TEXELS of art, never for fatter ones.
 *
 * The quad is screen-aligned rather than merely yawed: a world-upright quad under this steeply
 * pitched camera is foreshortened to about 60% of its height, which turns a carefully drawn pickup
 * into a flat lozenge. Facing the image plane keeps the art at its true aspect and every texel
 * square — the same bargain the character billboards make. `pxPerWorld` is therefore measured on
 * the camera's VIEW-SPACE DEPTH (not its radial distance, which is longer at the edges of the
 * frame and quietly shrank everything away from the centre).
 */
function syncPixelSprite(m, renderer, camera) {
  m.getWorldPosition(_wp);
  m.quaternion.copy(camera.quaternion);
  const size = renderer.getDrawingBufferSize(_bufSize);
  _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const d = Math.max(0.5, (_wp.x - camera.position.x) * _fwd.x + (_wp.y - camera.position.y) * _fwd.y + (_wp.z - camera.position.z) * _fwd.z);
  const pxPerWorld = (size.y * 0.5 * (camera.zoom || 1)) / (Math.tan((camera.fov || 45) * Math.PI / 360) * d);
  const w = frameTexelSize(renderer, camera, PX_PER_TILE) / pxPerWorld;
  const t = m.userData.tex;
  m.scale.set(t.w * w, t.h * w, 1);
  m.updateMatrix();
  if (m.parent) m.matrixWorld.multiplyMatrices(m.parent.matrixWorld, m.matrix);
  else m.matrixWorld.copy(m.matrix);
}

/**
 * A hand-pixelled item billboard, PIVOTED ON THE FLOOR ROW OF ITS QUAD and lit by the room like any
 * other surface (alpha-tested, so it writes depth and sorts against the dungeon properly).
 *
 * The pivot is the law: `y` is 0.01 (a hair off the flagstone so it never z-fights) for every
 * pickup in the game, so the bottom row of the art is the row the object rests on and the tile it
 * belongs to is never in doubt. A pickup may BOB — `bob()` below moves this mesh and nothing else —
 * but the shadow and the glow pool stay welded to the tile, which is what makes the bob read as the
 * object breathing rather than as the whole prop having come loose.
 * @param {string} key @param {string[]|(() => object)} art rows, or a painter returning a Pix
 * @param {Palette} pal
 * @param {{glow?:number, emissive?:number}} [o] `glow` is the emissive floor that keeps a pickup
 *   legible in an unlit corridor; magical items push it up.
 */
function pixelSprite(key, art, pal, o = {}) {
  const tex = pixelTexture(key, art, pal);
  const mat = litMaterial('pixel:' + key, {
    map: tex, alphaTest: 0.5, transparent: false, side: THREE.DoubleSide,
    roughness: 1, metalness: 0,
    emissiveMap: tex, emissive: new THREE.Color(o.emissive ?? 0xffffff), emissiveIntensity: o.glow ?? 0.14,
  });
  const m = new THREE.Mesh(geo('pixelQuad', () => new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)), mat);
  m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
  m.position.y = ITEM_PIVOT_Y;
  m.userData.tex = tex.userData.size;
  m.onBeforeRender = (renderer, scene, camera) => syncPixelSprite(m, renderer, camera);
  return m;
}

/** Every pickup's quad stands on this row and no other. */
const ITEM_PIVOT_Y = 0.01;

// ------------------------------------------------------------------ the contact shadow
/**
 * THE SAME TWO-LOBE CONTACT SHADOW THE CAST STANDS ON (spriteBillboard.js `makeBlobMaterial`).
 *
 * Pickups had no shadow at all — only an additive glow pool, which LIFTS a tile rather than
 * darkening it, so every chest, book and potion in the dungeon floated a few pixels above the
 * flagstone it was supposed to be lying on. A glow is not grounding; a hole in the tile is.
 *
 * Two lobes on one floor quad, exactly as the characters have:
 *  - a near-opaque CORE ellipse no wider than the object's footprint, flat across its middle and
 *    falling off over three or four screen pixels (a flat disc with a smoothstep rim, not a
 *    Gaussian: a Gaussian has no plateau, so its darkest value is one texel wide and the rest is
 *    smudge);
 *  - a wide, very faint ambient-occlusion HALO that just dirties the tile out to the quad's edge.
 * It is drawn AFTER the glow pool (`renderOrder`) so it darkens it instead of being erased by it,
 * and it is welded to the tile: nothing in `bob()` touches it.
 */
let _shadowMat = null;
function contactShadowMaterial() {
  if (_shadowMat) return _shadowMat;
  const fog = getFog();
  const uniforms = { uCore: { value: 0.42 }, uEdge: { value: 0.2 }, uStrength: { value: 1 } };
  if (fog) Object.assign(uniforms, { fogTex: fog.uniforms.fogTex, fogSize: fog.uniforms.fogSize, fogTint: fog.uniforms.fogTint });
  _shadowMat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 vUv; varying vec2 vFogXZ; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vFogXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float uCore, uEdge, uStrength; varying vec2 vUv; varying vec2 vFogXZ;
      ${fog ? fog.glsl() : 'vec2 fogMask(vec2 xz) { return vec2(1.0); }'}
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        // the core drifts a hair down-right, away from the house key light (top-left)
        float rc = length((p - vec2(0.06, -0.06)) / max(0.05, uCore));
        float core = 1.0 - smoothstep(1.0 - uEdge, 1.0 + uEdge, rc);
        float halo = pow(max(0.0, 1.0 - length(p)), 3.0);
        float a = clamp(core * 0.82 + halo * 0.16, 0.0, 1.0) * uStrength;
        a *= smoothstep(0.0, 1.0, fogMask(vFogXZ).r);
        gl_FragColor = vec4(0.014, 0.011, 0.018, a);
      }`,
  });
  return _shadowMat;
}

/**
 * The floor quad a pickup sits in. `footW` is the object's footprint in TILES (the width of the
 * art that actually touches the ground), and the quad runs out to 1.9x that for the AO skirt — the
 * same proportion the cast uses. It is squashed in z because the camera is pitched.
 * @param {number} footW
 */
function contactShadow(footW) {
  const halo = Math.max(0.1, footW) * 1.9;
  const m = new THREE.Mesh(geo('itemShadowQuad', () => new THREE.PlaneGeometry(1, 1)), contactShadowMaterial());
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.013;
  m.scale.set(halo, halo * 0.66, 1);
  m.renderOrder = 5;            // after the ground glow (3), so it darkens it instead of losing to it
  m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false;
  return m;
}

// ------------------------------------------------------------------ the art
//
// ONE PROJECTION FOR EVERY PICKUP.
//
// The pickups used to be drawn in three incompatible spaces at once: the scrolls and spellbooks
// stood up as flat playing cards facing the camera, the potions and gold sacks lay down as
// top-down blobs, and only the chest was a solid object seen from anywhere in particular. Three
// projections in one room is not a style, it is three artists; and none of the three agreed with
// the ROOM, which the camera looks into from above and in front.
//
// So there is now exactly one: **every pickup is a solid object resting on the floor, seen from
// above and in front** — the same angle the flagstones are seen at. That gives every one of them
// the same three parts:
//
//   · a TOP face, foreshortened to `SQUASH` of its true depth (the number the floor tiles
//     themselves are drawn at) and narrowing toward the back, so the eye reads a horizontal
//     surface: the lid of the chest, the cover of the book, the open mouth of the sack, the cork
//     of the flask, the top of the rolled scroll;
//   · a FRONT face, upright and unforeshortened, carrying the object's identity — planks and a
//     lock, page edges, cloth folds, the liquid line;
//   · a BASE that meets the floor, with the contact shadow underneath it.
//
// Light is the house key light (style.js `LIT`, top-left) on every face of every object: top faces
// sit high on the ramp, front faces a step or two lower, the left of each face lighter than its
// right. Colour is `ramp()` and nothing else, the outline is the house ink, and the art is drawn
// on the HERO'S TEXEL GRID — 32 texels to a tile, the same grid the cast stands on — so a chest is
// nineteen of the hero's pixels wide rather than nine of somebody else's.
const SQUASH = 0.55;

const step = (keys, i) => keys[i < 0 ? 0 : i >= keys.length ? keys.length - 1 : i];
/**
 * A horizontal run of one tone with the key light EDGED IN, not smeared across it: the run's left
 * pixel goes `grad` steps up the ramp and its right pixel `grad` steps down. Gradients across a
 * flat face are how pixel art turns a plank into a set of vertical stripes; a flat face is flat,
 * and the light lives on its edges.
 */
function span(p, x0, x1, y, keys, base, grad = 1) {
  for (let x = x0; x <= x1; x++) setPx(p, x, y, step(keys, base + (grad && x === x0 ? grad : grad && x === x1 ? -grad : 0)));
}
/** Solid rectangle in one key. */
function box(p, x0, y0, x1, y1, k) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setPx(p, x, y, k); }
/** Filled ellipse in one key. */
function ell(p, cx, cy, rx, ry, k) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    if (dx * dx + dy * dy <= 1.04) setPx(p, x, y, k);
  }
}
/**
 * THE TOP FACE: a horizontal surface `d` texels deep draws `round(d * SQUASH)` rows tall and
 * narrows toward the back by `taper`. Brightest at the back-left corner, one step down by the
 * front edge. Returns the row its front edge landed on.
 */
function topFace(p, cx, yBack, w, d, keys, { base = 5, taper = 0.84, grad = 1 } = {}) {
  const rows = Math.max(1, Math.round(d * SQUASH));
  for (let i = 0; i < rows; i++) {
    const t = rows === 1 ? 1 : i / (rows - 1);
    const ww = w * (taper + (1 - taper) * t);
    span(p, Math.round(cx - ww / 2), Math.round(cx + ww / 2), yBack + i, keys, base - (i === rows - 1 ? 1 : 0), grad);
  }
  return yBack + rows - 1;
}
/** THE FRONT FACE: an upright panel, `fall` steps darker at its foot, a step lighter on its left. */
function frontFace(p, cx, y0, y1, w, keys, { base = 4, grad = 1, fall = 1 } = {}) {
  const x0 = Math.round(cx - w / 2), x1 = Math.round(cx + w / 2);
  for (let y = y0; y <= y1; y++) span(p, x0, x1, y, keys, base + (y === y0 ? 1 : y > y1 - fall ? -1 : 0), grad);
  return { x0, x1 };
}
/** Move a pixel `d` steps along `keys` from whatever tone the modelling pass left there. */
function shift(p, x, y, keys, d) {
  const i = keys.indexOf(String.fromCharCode(p.d[y * p.w + x] || 0));
  if (i >= 0) setPx(p, x, y, step(keys, i + d));
}
/** Model a solid silhouette painted in `keys` with the house key light (pixelPainter.keyShade). */
const model = (p, keys, o = {}) => keyShade(p, keys, { lit: LIT, gain: 0.6, mid: 0.52, up: 0.6, dome: 0.15, local: 0.35, ...o });

// --- the eleven pickups, all in the one projection -------------------------------------------
/** Treasure chest, closed: domed lid seen from above, planked front, iron bands, a gold lock. */
function artChest() {
  const p = makePix(23, 20), cx = 11, W = 'abcdefg';
  const lipY = topFace(p, cx, 1, 18, 11, W, { base: 5, taper: 0.8 });   // the lid
  span(p, 2, 20, lipY + 1, W, 6, 1);                                    // the lid's lit front nose
  span(p, 2, 20, lipY + 2, W, 2, 0);                                    // the shadow the lid throws
  frontFace(p, cx, lipY + 3, 16, 18, W, { base: 4, fall: 1 });          // the planked body
  for (const x of [7, 15]) for (let y = lipY + 3; y <= 16; y++) setPx(p, x, y, 'c');  // plank grooves
  for (const bx of [5, 16]) for (let y = 3; y <= 16; y++) {             // iron bands over lid and body
    setPx(p, bx, y, 'j'); setPx(p, bx + 1, y, 'i');
  }
  box(p, 9, 9, 13, 13, 'p'); span(p, 9, 13, 9, 'mnopq', 4, 0); span(p, 9, 13, 13, 'mnopq', 2, 0);
  setPx(p, 11, 10, '%'); setPx(p, 11, 11, '%'); setPx(p, 10, 12, '%'); setPx(p, 12, 12, '%');
  box(p, 4, 17, 6, 18, 'a'); box(p, 16, 17, 18, 18, 'a');               // feet
  return p;
}

/** The same chest thrown open: lid tipped back, a heap of coin inside catching the light. */
function artChestOpen() {
  const p = makePix(23, 23), cx = 11, W = 'abcdefg';
  topFace(p, cx, 0, 16, 8, W, { base: 4, taper: 0.74 });                // the lid, tipped away
  span(p, 3, 19, 5, W, 2, 1);                                           // its underside edge
  box(p, 3, 6, 19, 10, '%');                                            // the dark of the open box
  ell(p, 11, 9, 7, 2.8, 'o'); ell(p, 9, 8, 3.6, 1.7, 'p');              // heaped coin
  for (const [x, y] of [[6, 9], [10, 7], [14, 9], [12, 10], [8, 10]]) setPx(p, x, y, 'q');
  span(p, 2, 20, 11, W, 6, 1);                                          // the box's front rim, lit
  span(p, 2, 20, 12, W, 2, 0);
  frontFace(p, cx, 13, 20, 18, W, { base: 4, fall: 1 });
  for (const x of [7, 15]) for (let y = 13; y <= 20; y++) setPx(p, x, y, 'c');
  for (const bx of [5, 16]) for (let y = 11; y <= 20; y++) { setPx(p, bx, y, 'j'); setPx(p, bx + 1, y, 'i'); }
  box(p, 4, 21, 6, 22, 'a'); box(p, 16, 21, 18, 22, 'a');
  return p;
}

/** Gold sack: a bulging cloth body, gathered neck and an open mouth you can see the coin in. */
function artSack(sigil = false) {
  let p = makePix(19, 18);
  ell(p, 9, 12, 8, 5.2, 'd');                                           // the body
  ell(p, 9, 7, 3.4, 3, 'd');                                            // the gathered neck
  p = model(p, 'abcdefg', { dome: 0.18 });
  ell(p, 9, 4, 3, 1.8, 'o'); ell(p, 8, 4, 1.9, 1, 'q');                 // the mouth: a TOP face of coin
  for (let y = 5; y <= 6; y++) span(p, 6, 12, y, 'abcdefg', 5 - (y - 5), 1);      // the cloth above the cord
  span(p, 5, 13, 7, 'abcdefg', 6, 0);                                   // the cord, catching the light
  for (const [x, y0, y1] of [[6, 11, 15], [9, 10, 16], [12, 11, 15]]) for (let y = y0; y <= y1; y++) shift(p, x, y, 'abcdefg', -1);
  if (sigil) {                                                          // a woven sigil for the magic sack
    for (const [x, y] of [[9, 11], [9, 12], [9, 13], [7, 12], [11, 12], [8, 14], [10, 14]]) setPx(p, x, y, 'k');
    setPx(p, 9, 12, '*');
  } else {
    for (const [x, y] of [[2, 15], [3, 16], [14, 15], [15, 16]]) { setPx(p, x, y, 'p'); setPx(p, x + 1, y, 'n'); }
  }
  span(p, 3, 15, 17, 'abcdefg', 1, 0);                                  // the base, in its own shade
  return p;
}

/** Buried cache: a low mound of turned earth with coin showing through the top of it. */
function artCache() {
  let p = makePix(21, 11);
  ell(p, 10, 8, 9, 4.4, 'd');
  p = model(p, 'abcdefg', { up: 0.9, dome: 0.18 });
  for (const [x, y, r] of [[7, 5, 1.8], [11, 4, 1.6], [14, 6, 1.7]]) { ell(p, x, y, r, r * 0.66, 'o'); span(p, Math.round(x - r), Math.round(x + r), Math.round(y - r * 0.5), 'mnopq', 3, 1); }
  for (const [x, y] of [[4, 7], [16, 7], [9, 9], [14, 9]]) setPx(p, x, y, 'b');   // clods of spoil
  span(p, 3, 17, 10, 'abcdefg', 0, 0);
  return p;
}

/** Healing potion: a round-bellied flask standing on the stone, corked, half-lit through the glass. */
function artPotion() {
  let p = makePix(15, 21);
  ell(p, 7, 14, 5.6, 5, 'd');                                           // the belly
  box(p, 5, 8, 9, 11, 'd'); box(p, 6, 4, 8, 8, 'd');                    // shoulder and neck
  box(p, 5, 3, 9, 4, 'e');                                              // the lip
  p = model(p, 'abcdefg', { dome: 0.18 });
  ell(p, 7, 15, 4.2, 3.6, 'j');                                         // the draught inside
  p = model(p, 'hijkl', { dome: 0.2, mid: 0.55 });
  span(p, 4, 10, 11, 'hijkl', 4, 0);                                    // its meniscus
  topFace(p, 7, 0, 5, 3, 'rstuv', { base: 4, taper: 0.7 });             // the cork, seen from above
  box(p, 5, 2, 9, 3, 't');
  setPx(p, 4, 12, '*'); setPx(p, 4, 13, '*'); setPx(p, 5, 11, '*');     // the catch-light on the glass
  span(p, 4, 10, 18, 'abcdefg', 1, 0);                                  // where the glass meets stone
  return p;
}

/** Treasure map: a scroll rolled and tied, lying across the tile, its spiral ends facing out. */
function artScroll() {
  const p = makePix(22, 12), P = 'abcdefg';
  const ROLL = [6, 6, 5, 5, 4, 4, 3];                                   // the cylinder, top lit to front
  for (let y = 3; y <= 9; y++) span(p, 3, 18, y, P, ROLL[y - 3], 1);
  for (const ex of [3, 18]) {                                           // the rolled ends
    ell(p, ex, 6, 2, 3.4, 'd');
    ell(p, ex, 6, 1.1, 1.9, 'c'); setPx(p, ex, 6, 'e');
    setPx(p, ex - 1, 4, 'f'); setPx(p, ex, 3, 'f');
  }
  box(p, 10, 2, 12, 10, 'i'); box(p, 10, 2, 10, 10, 'k'); box(p, 12, 2, 12, 10, 'h');   // the ribbon
  setPx(p, 11, 2, 'j'); setPx(p, 9, 3, 'i'); setPx(p, 13, 10, 'h');
  span(p, 5, 16, 10, P, 2, 0);
  return p;
}

/** Spellbook, closed and lying flat: tooled cover, gilt boss, a block of cream page edges. */
function artBook() {
  const p = makePix(22, 14), cx = 11, C = 'abcdefg';
  const lip = topFace(p, cx, 1, 17, 11, C, { base: 5, taper: 0.86 });   // the cover, seen from above
  for (let x = 5; x <= 17; x++) { setPx(p, x, 2, step(C, 6)); setPx(p, x, lip - 1, step(C, 3)); }  // tooled border
  for (const [x, y] of [[11, 3], [10, 4], [12, 4], [11, 5], [11, 4]]) setPx(p, x, y, 'o');
  setPx(p, 11, 4, 'q');                                                 // the gilt boss
  span(p, 3, 19, lip + 1, 'rstuv', 4, 1); span(p, 3, 19, lip + 2, 'rstuv', 3, 1);   // the block of page edges
  for (let x = 5; x <= 17; x += 2) shift(p, x, lip + 2, 'rstuv', -1);   // the leaves, one texel apart
  span(p, 2, 20, lip + 3, C, 3, 1);                                     // the cover's front lip
  for (let y = lip; y <= lip + 3; y++) { setPx(p, 2, y, step(C, 4)); setPx(p, 3, y, step(C, 3)); }  // the spine
  span(p, 3, 19, lip + 4, C, 1, 0);
  return p;
}

/** An enchanted blade, driven point-first into the flagstone and left standing. */
function artBlade() {
  const p = makePix(14, 26), cx = 6, S = 'abcdefg';
  ell(p, cx, 2, 1.8, 1.6, 'j'); setPx(p, cx - 1, 1, 'l');                // pommel
  box(p, cx - 1, 3, cx + 1, 7, 's'); setPx(p, cx - 1, 3, 'u');           // grip
  span(p, 2, 10, 8, 'hijkl', 4, 1); span(p, 3, 9, 9, 'hijkl', 2, 1);     // crossguard
  for (let y = 10; y <= 21; y++) {                                       // the blade, tapering to a point
    const hw = Math.max(0, Math.round(2.4 - (y - 10) * 0.17));
    span(p, cx - hw, cx + hw, y, S, 4, 2);
    if (hw > 0) setPx(p, cx, y, step(S, 6));                             // the fuller, catching the light
  }
  setPx(p, cx, 22, 'c'); setPx(p, cx, 23, 'b');
  for (const [x, y] of [[3, 22], [4, 23], [8, 22], [9, 23], [5, 24], [7, 24]]) setPx(p, x, y, 'r');  // chipped stone
  span(p, 3, 9, 24, 'rstuv', 1, 0);
  return p;
}

/** Beacon crystal: a standing shard on a bed of chipped stone, lit down its left facet. */
function artCrystal() {
  const p = makePix(15, 20), cx = 7, C = 'abcdefg';
  for (let y = 0; y <= 15; y++) {
    const hw = y < 6 ? Math.round(0.6 + y * 0.75) : y > 12 ? Math.round(4.5 - (y - 12) * 0.9) : 4;
    if (hw < 0) continue;
    for (let x = cx - hw; x <= cx + hw; x++) setPx(p, x, y, x < cx ? step(C, 5) : x === cx ? step(C, 6) : step(C, 3));
  }
  for (let y = 2; y <= 14; y++) setPx(p, cx - 1, y, step(C, 4));         // the near facet edge
  setPx(p, cx - 2, 4, '*'); setPx(p, cx - 2, 5, '*');
  ell(p, cx, 17, 5, 2.2, 't'); span(p, 3, 11, 18, 'rstuv', 1, 0);        // the stone it stands in
  for (const [x, y] of [[3, 16], [11, 16], [5, 18], [9, 18]]) setPx(p, x, y, 's');
  return p;
}

/** The hidden-treasure slab: a floor tile, so its top face IS the whole of it. */
const ART = {
  trapSlab: [
    'pppppppppppppppp',
    'pmmmmmmmmmmmmmmp',
    'pnqqqqqqqqqqqqnp',
    'pnqrrrsrsrrrrqnp',
    'pnqrsrrrrrsrrqnp',
    'pnqrrrrsrrrrrqnp',
    'pnqrrsrrrrsrrqnp',
    'pnqsrrrrrrrrsqnp',
    'pnqrrrrsrrrrrqnp',
    'pnqrsrrrrrrsrqnp',
    'pnqrrrrrsrrrrqnp',
    'pnqrrsrrrrrrsqnp',
    'pnqrrrrrrsrrrqnp',
    'pnqqqqqqqqqqqqnp',
    'pllllllllllllllp',
    'pppppppppppppppp',
  ],
};

// One key alphabet for every pickup, so the drawing routines above are material-agnostic:
// 'abcdefg' the object's own body, 'hijkl' its second material, 'mnopq' gold, 'rstuv' a third,
// '*' the catch-light, '%' a hollow the light does not reach.
// The gold ramp's base hue sits a hair BELOW style.LIGHT_HUE (0.115). `ramp()` cools a shadow the
// short way round the wheel from below that line and the LONG way (up through green and cyan) from
// above it, so '#c99a2e' — hue 0.116, a whisker over — gave a gold whose two dark steps were
// #0a5008 and #638a16: bottle green. '#c8912c' is hue 0.108 and cools through red into the house
// violet, which is what a coin in shadow actually does.
const GOLD = { mnopq: '#c8912c' };
const PAL = {
  chest: itemPalette({ abcdefg: '#7a5230', hijkl: '#6d6862', ...GOLD }, { '%': '#241a12' }),
  sack: itemPalette({ abcdefg: '#7a5a34', ...GOLD }, { '%': '#231a10' }),
  magicSack: itemPalette({ abcdefg: '#5b3a8a', hijkl: '#a37cf0', ...GOLD }, { '*': '#efe4ff', '%': '#150d24' }),
  cache: itemPalette({ abcdefg: '#6d5a42', ...GOLD }, { '%': '#1e1710' }),
  potion: itemPalette({ abcdefg: '#8ba4c2', hijkl: '#c8322f', rstuv: '#8a6034' }, { '*': '#f2f7ff', '%': '#2a1216' }),
  scroll: itemPalette({ abcdefg: '#c6b183', hijkl: '#a5262a' }, { '%': '#3a2f1c' }),
  blade: itemPalette({ abcdefg: '#9fc0d8', hijkl: '#c9a94e', rstuv: '#5d3d28' }, { '*': '#eaf6ff', '%': '#1d2530' }),
  crystal: itemPalette({ abcdefg: '#3fbf62', rstuv: '#6b6f63' }, { '*': '#e6ffe9', '%': '#0f2a17' }),
  trapSlab: itemPalette({ pqrst: '#7d7468', klmno: '#a8843a' }),
};
/** Spellbook: cream pages + a cover in the spell's own colour (one palette per spell type). */
const bookPal = (() => {
  const cache = new Map();
  return (type) => {
    let p = cache.get(type);
    if (!p) {
      const c = '#' + new THREE.Color(SPELL_COLORS[type] || 0xffffff).getHexString();
      p = itemPalette({ abcdefg: c, rstuv: '#d8c6a2', ...GOLD }, { '*': '#fff6d8', '%': '#241d14' });
      cache.set(type, p);
    }
    return p;
  };
})();

// ------------------------------------------------------------------ animator registry
const LIVE = new Set();
/** Register a per-frame tick for a prop (pruned automatically once it leaves the scene graph). */
export function animate(obj, fn) { obj.userData.tick = fn; LIVE.add(obj); return obj; }

/**
 * Advance every live prop. Called by Effects.update.
 * @param {number} dt
 * @param {number} time
 * @param {{px:number, pz:number, emit?:(o:object)=>void, rng:object}} ctx player position + particle emitter
 */
export function updateProps(dt, time, ctx) {
  updateFlames(time);
  for (const o of LIVE) {
    if (!o.parent) { LIVE.delete(o); continue; }
    const dx = o.position.x - ctx.px, dz = o.position.z - ctx.pz;
    const d2 = dx * dx + dz * dz;
    if (d2 > 16 * 16) continue; // far from the camera: skip (motion is invisible there)
    o.userData.tick(dt, time, ctx, Math.sqrt(d2));
  }
}
export function liveProps() { return LIVE.size; }

/**
 * A pickup's idle bob — and the ONE thing it is allowed to move.
 *
 * Bobbing used to be done by DungeonView on the whole prop GROUP, which lifted the glow pool off
 * the tile with the sprite: the pickup and its own grounding rose together, so nothing on screen
 * ever said which flagstone the thing was lying on. The bob now moves the SPRITE MESH and nothing
 * else; the contact shadow and the glow pool are welded to the tile at y ~ 0.012 and never budge.
 * The offset is one-sided (0..amp) so the object's base still touches the floor at the bottom of
 * every cycle rather than sinking through it.
 * @param {THREE.Group} g the prop @param {THREE.Mesh} sprite its billboard
 * @param {{amp?:number, speed?:number, t0?:number}} [o]
 */
function bob(g, sprite, { amp = 0.024, speed = 2, t0 = 0 } = {}) {
  const y0 = sprite.position.y, prev = g.userData.tick;
  animate(g, (dt, time, ctx, d) => {
    if (prev) prev(dt, time, ctx, d);
    sprite.position.y = y0 + (0.5 + 0.5 * Math.sin(time * speed + t0)) * amp;
  });
  return g;
}

let defaultFactory = null;
/** The renderer's PropFactory (Effects borrows it for transient props such as the opened chest). */
export function getPropFactory() { return defaultFactory; }

export class PropFactory {
  /**
   * @param {ReturnType<import('./materials.js').createMaterials>} mats
   */
  constructor(mats) {
    this.mats = mats;
    this.rng = createRng('fargoal-props');
    this.scrollMats = {};
    defaultFactory = this;
  }

  /** Lit material for a spell colour (book covers, seals). */
  spellMaterial(type) {
    const c = SPELL_COLORS[type] || 0xffffff;
    return litMaterial('spell:' + type, { color: new THREE.Color(c).multiplyScalar(0.55), roughness: 0.6, metalness: 0.1, emissive: new THREE.Color(c), emissiveIntensity: 0.35 });
  }

  // ------------------------------------------------------------------ items
  /** Build a prop for an ItemInstance. */
  item(it) {
    const g = new THREE.Group();
    g.userData.anim = { y0: 0, amp: 0, speed: 0, spin: 0, t: this.rng.float(0, 6) };
    switch (it.type) {
      case 'gold': return it.hidden ? this.buriedCache(g) : this.goldSack(g, it.gold || 20);
      case 'chest': return it.hidden ? this.trapSquare(g) : this.chest(g);
      case 'sword': return this.swordInStone(g);
      case 'potion': return this.potion(g);
      case 'sack': return this.magicSack(g);
      case 'map': return this.scroll(g);
      case 'enchant': return this.enchantedWeapon(g);
      case 'beacon': return this.beaconItem(g);
      default: return this.spellbook(g, it.type);
    }
  }

  /** Twinkling glints at given local positions (scale-animated, deterministic phases). */
  addGlints(g, color, spots, { size = 0.16, rate = 1.7 } = {}) {
    const glints = spots.map(([x, y, z], i) => {
      const b = billboard(glintTexture(), color, size);
      b.position.set(x, y, z); b.userData.phase = this.rng.float(0, 6.28) + i * 1.3; b.userData.rate = rate * this.rng.float(0.8, 1.25);
      g.add(b); return b;
    });
    g.userData.glints = glints;
    return glints;
  }

  tickGlints(o, time) {
    const gl = o.userData.glints; if (!gl) return;
    for (const b of gl) {
      const s = Math.max(0, Math.sin(time * b.userData.rate + b.userData.phase));
      const k = s * s * s * s; // sharp twinkle
      b.scale.set(b.userData.size0 * (0.2 + k), b.userData.size0 * (0.2 + k), 1);
    }
  }

  finishGlints(g) {
    for (const b of g.userData.glints || []) b.userData.size0 = b.scale.x;
    animate(g, (dt, time) => this.tickGlints(g, time));
  }

  goldSack(g, amount = 20) {
    const rich = Math.min(1, amount / 120);
    const s = pixelSprite('sack', artSack, PAL.sack, { glow: 0.1 });
    g.add(s);
    g.add(groundGlow(0xffb340, 0.36, { opacity: 0.2 + rich * 0.12 }));
    g.add(contactShadow(0.4));
    this.addGlints(g, 0xfff0b0, [[-0.2, 0.06, 0.05], [0.2, 0.06, 0.05], [0.0, 0.42, 0.03]], { size: 0.13 + rich * 0.04 });
    this.finishGlints(g);
    bob(g, s, { amp: 0.02, speed: 1.7, t0: g.userData.anim.t });
    g.userData.anim.sparkle = true;
    return g;
  }

  buriedCache(g) {
    g.add(pixelSprite('cache', artCache, PAL.cache, { glow: 0.08 }));
    g.add(groundGlow(0xffb340, 0.28, { opacity: 0.14 }));
    g.add(contactShadow(0.46));
    this.addGlints(g, 0xfff0b0, [[0.05, 0.13, 0.04]], { size: 0.12, rate: 1.1 });
    this.finishGlints(g);
    return g;   // spoil heaped on the floor does not bob: it is part of the floor
  }

  /** Hidden treasure/trap square: an inset slab of painted flagstone framed in brass. */
  trapSquare(g) {
    const M = this.mats;
    const slab = mesh(geo('trapSlab', () => new THREE.BoxGeometry(0.7, 0.04, 0.7)),
      litMaterial('trapSlabPix', { map: pixelTexture('trapSlab', ART.trapSlab, PAL.trapSlab), roughness: 0.92, metalness: 0.05 }), 0, 0.03, 0);
    g.add(slab);
    const frame = geo('trapFrame', () => new THREE.BoxGeometry(0.78, 0.03, 0.05));
    for (const [x, z, ry] of [[0, 0.365, 0], [0, -0.365, 0], [0.365, 0, Math.PI / 2], [-0.365, 0, Math.PI / 2]]) g.add(mesh(frame, M.brass, x, 0.035, z, { ry }));
    return g;
  }

  /** Closed chest: painted planks, iron bands and a gold lock, hand-pixelled. */
  chest(g) {
    g.add(pixelSprite('chest', artChest, PAL.chest, { glow: 0.1 }));
    g.add(groundGlow(0xffb340, 0.4, { opacity: 0.16 }));
    g.add(contactShadow(0.52));
    if (!g.userData.glints) { this.addGlints(g, 0xfff0b0, [[0.0, 0.3, 0.03], [0.2, 0.46, 0.02]], { size: 0.13, rate: 1.2 }); this.finishGlints(g); }
    return g;   // a chest is heavy: it sits, it does not bob
  }

  /** Open chest for the loot moment: lid thrown back, gold heaped inside, light spilling out. */
  chestOpen() {
    const g = new THREE.Group();
    g.add(pixelSprite('chestOpen', artChestOpen, PAL.chest, { glow: 0.12 }));
    g.add(contactShadow(0.52));
    const inner = billboard(glowTexture(), 0xffc860, 0.7); inner.position.set(0, 0.34, 0.02); g.add(inner);
    g.userData.inner = inner;
    this.addGlints(g, 0xfff4c0, [[0.09, 0.34, 0.02], [-0.11, 0.32, 0.02], [0.0, 0.4, 0.02]], { size: 0.2, rate: 3 });
    this.finishGlints(g);
    return g;
  }

  /** The Sword of Fargoal on its plinth: hero prop with aura, light shaft, halo and orbiting motes. */
  swordInStone(g) {
    const M = this.mats;
    g.add(mesh(geo('plinthStep', () => new THREE.CylinderGeometry(0.44, 0.5, 0.08, 10)), M.marble, 0, 0.04, 0));
    g.add(mesh(geo('plinth', () => new THREE.CylinderGeometry(0.26, 0.34, 0.24, 8)), M.marble, 0, 0.2, 0));
    g.add(mesh(geo('plinthCap', () => new THREE.CylinderGeometry(0.3, 0.26, 0.05, 8)), M.marble, 0, 0.34, 0));
    const sword = this.swordMesh(1.05);
    sword.position.set(0, 0.6, 0); sword.rotation.z = Math.PI; sword.rotation.y = 0.5;
    g.add(sword);
    // aura: soft violet-blue billboard behind the blade + a hot core glint at the tip
    const aura = billboard(glowTexture(), 0x8fb4ff, 1.5, { intensity: 0.9 }); aura.position.set(0, 0.72, 0); sword.userData.aura = aura; g.add(aura);
    const core = billboard(glintTexture(), 0xe0f0ff, 0.5); core.position.set(0, 0.35, 0); g.add(core);
    const halo = mesh(geo('halo', () => new THREE.RingGeometry(0.34, 0.6, 32)), M.rune, 0, 0.37, 0, { rx: -Math.PI / 2, shadow: false });
    g.add(halo);
    const rune = new THREE.Mesh(geo('runePlane', () => new THREE.PlaneGeometry(1, 1)), new THREE.MeshBasicMaterial({ map: runeCircleTexture(), color: PALETTE.magic, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
    rune.rotation.x = -Math.PI / 2; rune.position.y = 0.09; rune.scale.setScalar(1.4); rune.renderOrder = 3; g.add(rune);
    g.add(groundGlow(0x9fb4ff, 0.9, { opacity: 0.5 }));
    const fog = getFog();
    if (fog) {
      const shaft = new THREE.Mesh(geo('swordShaft', () => new THREE.CylinderGeometry(0.16, 0.42, 3.2, 20, 1, true)), createShaftMaterial(fog, 0xa8c0ff, 0.5, [0, 0.25, 0.55, 1]));
      shaft.position.y = 1.7; shaft.renderOrder = 4; g.add(shaft); g.userData.shaft = shaft;
    }
    // orbiting motes on two tilted rings
    const motes = [];
    for (let i = 0; i < 8; i++) {
      const b = billboard(glintTexture(), i % 2 ? 0xc58cff : 0x9fd0ff, 0.14);
      b.userData.orbit = { r: 0.42 + (i % 2) * 0.12, tilt: i % 2 ? 0.55 : -0.4, phase: (i / 8) * Math.PI * 2, speed: i % 2 ? 1.3 : -0.9 };
      g.add(b); motes.push(b);
    }
    g.userData.anim = { y0: 0, amp: 0.05, speed: 1.4, spin: 0.9, t: 0, node: sword, halo, sword: true };
    animate(g, (dt, time, ctx) => {
      for (const b of motes) {
        const o = b.userData.orbit, a = time * o.speed + o.phase;
        b.position.set(Math.cos(a) * o.r, 0.85 + Math.sin(a) * o.r * o.tilt + 0.05 * Math.sin(time * 1.4), Math.sin(a) * o.r);
        const tw = 0.7 + 0.3 * Math.sin(time * 5 + o.phase * 3);
        b.scale.set(0.14 * tw, 0.14 * tw, 1);
      }
      const pulse = 0.85 + 0.15 * Math.sin(time * 2.1);
      aura.scale.set(1.5 * pulse, 1.5 * pulse, 1);
      core.scale.set(0.5 * (0.8 + 0.2 * Math.sin(time * 6.3)), 0.5 * (0.8 + 0.2 * Math.sin(time * 6.3)), 1);
      rune.rotation.z -= dt * 0.35; rune.material.opacity = 0.6 + 0.25 * Math.sin(time * 1.7);
      if (g.userData.shaft) g.userData.shaft.material.uniforms.uTime.value = time;
      if (ctx.emit) { g.userData.acc = (g.userData.acc || 0) + dt; while (g.userData.acc > 0.11) { g.userData.acc -= 0.11; ctx.emit({ x: g.position.x, y: 0.5, z: g.position.z, count: 1, color: [0x9fd0ff, 0xc58cff], speed: 0.25, spread: 1, up: 1.2, life: 1.6, size: 0.07, gravity: 0.35, drag: 0.6, radius: 0.4, kind: 2 }); } }
    });
    return g;
  }

  /** Sword geometry (blade up along +y, hilt at origin). */
  swordMesh(scale = 1) {
    const M = this.mats;
    const s = new THREE.Group();
    s.add(mesh(geo('blade', () => new THREE.BoxGeometry(0.075, 0.62, 0.022)), M.swordBlade, 0, 0.36, 0));
    s.add(mesh(geo('fuller', () => new THREE.BoxGeometry(0.02, 0.5, 0.026)), M.swordHilt, 0, 0.33, 0, { shadow: false }));
    s.add(mesh(geo('bladeTip', () => new THREE.ConeGeometry(0.053, 0.13, 4)), M.swordBlade, 0, 0.735, 0, { ry: Math.PI / 4 }));
    s.add(mesh(geo('guard', () => new THREE.BoxGeometry(0.24, 0.045, 0.055)), M.swordHilt, 0, 0.05, 0));
    s.add(mesh(geo('guardGem', () => new THREE.OctahedronGeometry(0.03, 0)), M.beacon, 0, 0.05, 0.03));
    s.add(mesh(geo('grip', () => new THREE.CylinderGeometry(0.026, 0.024, 0.16, 8)), M.leather, 0, -0.05, 0));
    s.add(mesh(geo('pommel', () => new THREE.SphereGeometry(0.038, 8, 8)), M.swordHilt, 0, -0.145, 0));
    s.scale.setScalar(scale);
    return s;
  }

  /** Healing potion: a corked flask standing on the stone, its draught catching the light. */
  potion(g) {
    const s = pixelSprite('potion', artPotion, PAL.potion, { glow: 0.2, emissive: 0xffb4a4 });
    g.add(s);
    g.add(groundGlow(0xff5a48, 0.3, { opacity: 0.24 }));
    g.add(contactShadow(0.24));
    this.addGlints(g, 0xffd8d0, [[-0.1, 0.4, 0.03]], { size: 0.12, rate: 1.3 });
    this.finishGlints(g);
    bob(g, s, { amp: 0.026, speed: 2.2, t0: g.userData.anim.t });
    return g;
  }

  /** Magic sack: violet cloth with a glowing sigil woven into it. */
  magicSack(g) {
    const s = pixelSprite('magicSack', () => artSack(true), PAL.magicSack, { glow: 0.18, emissive: 0xc9a8ff });
    g.add(s);
    const sig = billboard(sigilTexture('sack'), 0xd0b0ff, 0.24); sig.position.set(0, 0.48, 0.02); g.add(sig);
    g.add(groundGlow(0xb197fc, 0.32, { opacity: 0.22 }));
    g.add(contactShadow(0.4));
    this.addGlints(g, 0xe0d0ff, [[0.15, 0.34, 0.02], [-0.13, 0.18, 0.02]], { size: 0.12 });
    this.finishGlints(g);
    bob(g, s, { amp: 0.022, speed: 1.8, t0: g.userData.anim.t });
    return g;
  }

  /** Treasure map: a rolled parchment tied with a red ribbon, lying across the tile. */
  scroll(g) {
    const s = pixelSprite('scroll', artScroll, PAL.scroll, { glow: 0.12 });
    g.add(s);
    g.add(groundGlow(0xffe0a0, 0.28, { opacity: 0.16 }));
    g.add(contactShadow(0.5));
    bob(g, s, { amp: 0.018, speed: 2, t0: g.userData.anim.t });
    return g;
  }

  /** Spellbook lying closed on the stone: a tooled cover in the spell's colour and a rising sigil. */
  spellbook(g, type) {
    const c = SPELL_COLORS[type] || 0xffffff;
    const s = pixelSprite('book:' + type, artBook, bookPal(type), { glow: 0.15, emissive: c });
    g.add(s);
    const pageGlow = billboard(glowTexture(), c, 0.2, { intensity: 0.4 }); pageGlow.position.set(0, 0.1, 0.02); g.add(pageGlow);
    const sig = billboard(sigilTexture(type), c, 0.26); sig.position.set(0, 0.46, 0.02); g.add(sig);
    g.add(groundGlow(c, 0.32, { opacity: 0.18 }));
    g.add(contactShadow(0.5));
    this.addGlints(g, 0xffffff, [[0.17, 0.18, 0.02], [-0.18, 0.18, 0.02], [0.02, 0.28, 0.02]], { size: 0.12 });
    this.finishGlints(g);
    const tick = g.userData.tick;
    animate(g, (dt, time, ctx, d) => {
      tick(dt, time, ctx, d);
      sig.position.y = 0.46 + 0.06 * Math.sin(time * 2.3 + g.userData.anim.t);
      const sc = 0.26 * (0.9 + 0.1 * Math.sin(time * 4.1)); sig.scale.set(sc, sc, 1);
      const pg = 0.2 * (0.85 + 0.15 * Math.sin(time * 3.1 + 1)); pageGlow.scale.set(pg, pg, 1);
      if (ctx.emit && d < 9) { g.userData.acc = (g.userData.acc || 0) + dt; while (g.userData.acc > 0.3) { g.userData.acc -= 0.3; ctx.emit({ x: g.position.x, y: 0.12, z: g.position.z, count: 1, color: [c, 0xffffff], speed: 0.1, spread: 1, up: 0.9, life: 1.3, size: 0.06, gravity: 0.15, drag: 1, radius: 0.15, kind: 2 }); } }
    });
    bob(g, s, { amp: 0.018, speed: 2, t0: g.userData.anim.t });
    return g;
  }

  /** An enchanted blade left standing point-first in the flagstone. */
  enchantedWeapon(g) {
    const s = pixelSprite('blade', artBlade, PAL.blade, { glow: 0.2, emissive: 0x9fd0ff });
    g.add(s);
    g.add(groundGlow(0x9fd0ff, 0.3, { opacity: 0.22 }));
    g.add(contactShadow(0.22));
    this.addGlints(g, 0xdff0ff, [[0.0, 0.62, 0.02]], { size: 0.16, rate: 2.2 });
    this.finishGlints(g);
    return g;   // driven into the stone: it does not bob
  }

  /** Beacon crystal: a standing shard, its base bedded in chipped stone. */
  beaconItem(g) {
    const s = pixelSprite('crystal', artCrystal, PAL.crystal, { glow: 0.4, emissive: 0x4bd66a });
    g.add(s);
    const b = billboard(glowTexture(), 0x4bd66a, 0.6, { intensity: 0.8 }); b.position.y = 0.34; g.add(b);
    g.add(groundGlow(0x4bd66a, 0.3, { opacity: 0.24 }));
    g.add(contactShadow(0.3));
    return g;
  }

  // ------------------------------------------------------------------ dungeon dressing
  /** Placed beacon marker. */
  beaconMarker() {
    const g = new THREE.Group();
    g.add(mesh(geo('beaconPole', () => new THREE.CylinderGeometry(0.03, 0.04, 0.6, 6)), this.mats.iron, 0, 0.3, 0));
    g.add(mesh(geo('crystal', () => new THREE.OctahedronGeometry(0.16, 0)), this.mats.beacon, 0, 0.75, 0));
    const b = billboard(glowTexture(), 0x4bd66a, 0.8, { intensity: 0.8 }); b.position.y = 0.75; g.add(b);
    g.add(groundGlow(0x4bd66a, 0.4, { opacity: 0.35 }));
    g.userData.anim = { y0: 0, amp: 0, speed: 0, spin: 1.5, t: 0, node: g.children[1] };
    return g;
  }

  /** Temple altar: marble steps, carved block, gold cross, candles with live flames and a holy haze. */
  altar() {
    const M = this.mats;
    const g = new THREE.Group();
    g.add(mesh(geo('altarStep', () => new THREE.BoxGeometry(0.96, 0.08, 0.96)), M.marble, 0, 0.04, 0));
    g.add(mesh(geo('altarStep2', () => new THREE.BoxGeometry(0.8, 0.06, 0.66)), M.marble, 0, 0.11, 0));
    g.add(mesh(geo('altarBase', () => new THREE.BoxGeometry(0.6, 0.34, 0.38)), M.marble, 0, 0.3, 0));
    g.add(mesh(geo('altarInset', () => new THREE.BoxGeometry(0.44, 0.2, 0.03)), M.gold, 0, 0.3, 0.19));
    g.add(mesh(geo('altarTop', () => new THREE.BoxGeometry(0.74, 0.06, 0.5)), M.marble, 0, 0.5, 0));
    g.add(mesh(geo('altarCloth', () => new THREE.BoxGeometry(0.5, 0.012, 0.56)), litMaterial('altarCloth', { color: 0x8a1c2c, roughness: 0.9 }), 0, 0.535, 0));
    // cross (refcard icon)
    g.add(mesh(geo('crossV', () => new THREE.BoxGeometry(0.06, 0.38, 0.06)), M.gold, 0, 0.73, 0));
    g.add(mesh(geo('crossH', () => new THREE.BoxGeometry(0.22, 0.06, 0.06)), M.gold, 0, 0.8, 0));
    const crossGlow = billboard(glowTexture(), 0xbfe6ff, 0.9, { intensity: 0.7 }); crossGlow.position.set(0, 0.78, 0); g.add(crossGlow);
    // candles
    for (const x of [-0.27, 0.27]) {
      g.add(mesh(geo('candleHolder', () => new THREE.CylinderGeometry(0.045, 0.06, 0.03, 8)), M.brass, x, 0.55, 0.13));
      g.add(mesh(geo('candle', () => new THREE.CylinderGeometry(0.03, 0.035, 0.15, 8)), M.candle, x, 0.64, 0.13));
      const fl = flame(0.085, 2.0); fl.position.set(x, 0.71, 0.13); g.add(fl);
      const gl = billboard(glowTexture(), 0xffb060, 0.2, { intensity: 0.45 }); gl.position.set(x, 0.76, 0.13); g.add(gl);
    }
    const glow = mesh(geo('altarGlow', () => new THREE.CylinderGeometry(0.5, 0.7, 1.4, 16, 1, true)), M.holyGlow, 0, 0.8, 0, { shadow: false });
    glow.userData.glow = true;
    g.add(glow);
    g.add(groundGlow(0xbfe6ff, 0.75, { opacity: 0.3, y: 0.085 }));
    animate(g, (dt, time) => { const s = 0.9 * (0.9 + 0.1 * Math.sin(time * 1.9)); crossGlow.scale.set(s, s, 1); });
    return g;
  }

  /** Wall torch: iron bracket, wrapped handle, layered flame billboards, ember glow, rising sparks. Faces +z. */
  torch() {
    const M = this.mats;
    const g = new THREE.Group();
    g.add(mesh(geo('torchPlate', () => new THREE.BoxGeometry(0.12, 0.16, 0.03)), M.iron, 0, 0, 0.015));
    g.add(mesh(geo('torchRing', () => new THREE.TorusGeometry(0.045, 0.012, 6, 12)), M.iron, 0, 0.1, 0.1, { rx: 0.5 }));
    g.add(mesh(geo('torchArm', () => new THREE.CylinderGeometry(0.012, 0.012, 0.14, 6)), M.iron, 0, 0.04, 0.06, { rx: 1.1 }));
    g.add(mesh(geo('torchHandle', () => new THREE.CylinderGeometry(0.024, 0.02, 0.34, 7)), M.wood, 0, 0.1, 0.13, { rx: 0.5 }));
    g.add(mesh(geo('torchHead', () => new THREE.CylinderGeometry(0.04, 0.032, 0.1, 8)), M.dark, 0, 0.25, 0.21, { rx: 0.5 }));
    const f1 = flame(0.4, 1.8); f1.position.set(0, 0.27, 0.22); g.add(f1);
    const f2 = flame(0.24, 1.5); f2.position.set(0, 0.29, 0.225); g.add(f2);
    const ember = billboard(glowTexture(), 0xff7a2a, 0.55, { intensity: 0.9 }); ember.position.set(0, 0.33, 0.22); g.add(ember);
    animate(g, (dt, time, ctx, d) => {
      const s = 0.55 * (0.85 + 0.15 * Math.sin(time * 9.1 + g.position.x) * Math.sin(time * 5.7 + g.position.z));
      ember.scale.set(s, s, 1);
      if (!ctx.emit || d > 11) return;
      g.userData.acc = (g.userData.acc || 0) + dt;
      while (g.userData.acc > 0.28) {
        g.userData.acc -= 0.28;
        // DungeonView rotates the group to face its room: derive the facing from the yaw.
        const nx = Math.sin(g.rotation.y), nz = Math.cos(g.rotation.y);
        const wx = g.position.x + nx * 0.22, wz = g.position.z + nz * 0.22;
        ctx.emit({ x: wx, y: g.position.y + 0.32, z: wz, count: 1, color: [0xffb060, 0xff7a2a], speed: 0.25, spread: 0.6, up: 1.6, life: 1.1, size: 0.045, gravity: 0.4, drag: 1.2, radius: 0.06, kind: 1 });
      }
    });
    return g;
  }

  /** Doorway columns + lintel for staircases (the original's "III" columns). */
  archway(mat) {
    const g = new THREE.Group();
    for (const x of [-0.36, 0.36]) g.add(mesh(geo('column', () => new THREE.CylinderGeometry(0.07, 0.09, 0.95, 8)), mat, x, 0.47, 0));
    g.add(mesh(geo('lintel', () => new THREE.BoxGeometry(0.98, 0.12, 0.26)), mat, 0, 0.98, 0));
    return g;
  }

  rubble(seed) {
    const r = createRng(seed);
    const g = new THREE.Group();
    const rock = geo('rock', () => new THREE.DodecahedronGeometry(0.1, 0));
    for (let i = 0; i < 6; i++) {
      const m = mesh(rock, this.mats.rock, r.float(-0.3, 0.3), 0.05, r.float(-0.3, 0.3), { ry: r.float(0, 3), s: r.float(0.5, 1.4) });
      g.add(m);
    }
    return g;
  }

  trapRune() {
    const g = new THREE.Group();
    const ring = mesh(geo('runeRing', () => new THREE.RingGeometry(0.22, 0.3, 24)), this.mats.rune, 0, 0.012, 0, { rx: -Math.PI / 2, shadow: false });
    g.add(ring);
    const inner = mesh(geo('runeInner', () => new THREE.RingGeometry(0.08, 0.12, 6)), this.mats.rune, 0, 0.012, 0, { rx: -Math.PI / 2, shadow: false });
    g.add(inner);
    g.add(groundGlow(PALETTE.magic, 0.38, { opacity: 0.25 }));
    g.userData.anim = { y0: 0, amp: 0, speed: 0, spin: 1.2, t: 0, node: inner };
    return g;
  }

  climbMarker() {
    const g = new THREE.Group();
    g.add(mesh(geo('ropeRing', () => new THREE.TorusGeometry(0.34, 0.03, 6, 20)), this.mats.rope, 0, 0.03, 0, { rx: Math.PI / 2 }));
    return g;
  }
}
