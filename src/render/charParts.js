// Character part library: shared low-poly primitives, a rig builder that bakes a painterly
// top-light gradient into vertex colours and smoothed normals for an inverted-hull outline,
// and the outline material. Everything is geometry-only and cached per monster type.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _c = new THREE.Color();

/** Bat/dragon wing membrane with three finger spars, spanning x 0..1, y -0.35..0.5 (flat in xy). */
function wingGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(0.28, 0.42); s.lineTo(0.62, 0.52); s.lineTo(1.0, 0.4);
  s.lineTo(0.92, 0.12); s.lineTo(0.68, -0.18); s.lineTo(0.42, -0.34); s.lineTo(0.18, -0.26); s.lineTo(0, -0.08);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.025, bevelEnabled: false });
  g.translate(0, 0, -0.0125);
  return g;
}

/** A flared, gently curved cape (x -0.5..0.5, y 0..-1 hanging down, z ~0), double-sided, tattered hem. */
function capeGeo() {
  const seg = 4, rows = 6;
  const g = new THREE.PlaneGeometry(1, 1, seg, rows);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i); // y in -0.5..0.5 (top = 0.5)
    const t = 0.5 - y; // 0 at top, 1 at hem
    const flare = 1 + t * 0.55;
    const nx = x * flare;
    const curve = -Math.cos(x * Math.PI) * 0.12 * (0.3 + t); // wraps around the back
    let ny = -t;
    if (t > 0.99) ny -= (Math.abs(((x * seg) % 2)) > 0.5 ? 0.09 : 0.0); // ragged hem
    p.setXYZ(i, nx, ny, curve - t * t * 0.18);
  }
  g.computeVertexNormals();
  const back = g.clone();
  const n = back.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  const idx = back.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  return mergeGeometries([g.toNonIndexed(), back.toNonIndexed()], false);
}

/** Beveled slab (armour plate / shield) of unit size with a chamfer on the front face. */
function plateGeo(bevel = 0.12) {
  const s = new THREE.Shape();
  const h = 0.5 - bevel;
  s.moveTo(-h, -0.5); s.lineTo(h, -0.5); s.lineTo(0.5, -h); s.lineTo(0.5, h); s.lineTo(h, 0.5); s.lineTo(-h, 0.5); s.lineTo(-0.5, h); s.lineTo(-0.5, -h); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: true, bevelThickness: 0.18, bevelSize: 0.08, bevelSegments: 1, steps: 1 });
  g.center();
  return g;
}

/** Kite shield silhouette (pointed bottom), unit box. */
function kiteGeo() {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0.5); s.lineTo(0.5, 0.5); s.lineTo(0.5, 0.05); s.lineTo(0, -0.5); s.lineTo(-0.5, 0.05); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.06, bevelSegments: 1, steps: 1 });
  g.center();
  return g;
}

/** Sword blade with a diamond cross-section: unit length along +y, tip at y=+0.5. */
function bladeGeo() {
  const g = new THREE.BufferGeometry();
  const w = 0.5, t = 0.5, tip = 0.5, base = -0.5, shoulder = 0.28;
  const v = [
    // left, right, front ridge, back ridge at base; same at shoulder; tip point
    [-w, base, 0], [w, base, 0], [0, base, t], [0, base, -t],
    [-w * 0.85, shoulder, 0], [w * 0.85, shoulder, 0], [0, shoulder, t * 0.9], [0, shoulder, -t * 0.9],
    [0, tip, 0],
  ];
  const faces = [
    // base quad strip -> shoulder (4 faces * 2 tris)
    [0, 2, 6], [0, 6, 4], [2, 1, 5], [2, 5, 6], [1, 3, 7], [1, 7, 5], [3, 0, 4], [3, 4, 7],
    // shoulder -> tip
    [4, 6, 8], [6, 5, 8], [5, 7, 8], [7, 4, 8],
    // base cap
    [0, 3, 1], [0, 1, 2],
  ];
  const pos = [];
  for (const f of faces) for (const i of f) pos.push(...v[i]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
  return g;
}

/** Axe head: a crescent blade in the xy plane, unit-ish. */
function axeGeo() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.5); s.quadraticCurveTo(0.55, 0.35, 0.5, 0); s.quadraticCurveTo(0.55, -0.35, 0, -0.5); s.lineTo(0, -0.28); s.quadraticCurveTo(0.2, 0, 0, 0.28); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.08, bevelEnabled: false, curveSegments: 3 });
  g.translate(0, 0, -0.04);
  return g;
}

/** Shared primitives (unit sized, centred unless noted). */
export const P = {
  box: new THREE.BoxGeometry(1, 1, 1),
  plate: plateGeo(),
  kite: kiteGeo(),
  sphere: new THREE.SphereGeometry(0.5, 8, 6),
  lowSphere: new THREE.SphereGeometry(0.5, 6, 4),
  ico: new THREE.IcosahedronGeometry(0.5, 0),
  cone: new THREE.ConeGeometry(0.5, 1, 6),
  cone4: new THREE.ConeGeometry(0.5, 1, 4),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 7),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  taper: new THREE.CylinderGeometry(0.34, 0.5, 1, 7),   // narrow top (torsos seen upside down, feet)
  taperUp: new THREE.CylinderGeometry(0.5, 0.34, 1, 7), // narrow bottom (limbs)
  capsule: new THREE.CapsuleGeometry(0.5, 1, 2, 7),     // height 2: scale sy = h/2
  capsuleShort: new THREE.CapsuleGeometry(0.5, 0.4, 2, 7), // height 1.4
  oct: new THREE.OctahedronGeometry(0.5, 0),
  tet: new THREE.TetrahedronGeometry(0.5, 0),
  ring: new THREE.TorusGeometry(0.5, 0.08, 4, 8),
  wing: wingGeo(),
  cape: capeGeo(),
  blade: bladeGeo(),
  axe: axeGeo(),
};

/** Fast float hash for smooth-normal grouping. */
function key(x, y, z) { return `${Math.round(x * 2000)},${Math.round(y * 2000)},${Math.round(z * 2000)}`; }

/**
 * Smoothed normals (`aSmooth`) for an inverted-hull outline: vertices sharing a position blend
 * their normals, but only across faces on the same side (keeps double-sided planes from cancelling).
 */
function computeSmoothNormals(geom) {
  const pos = geom.attributes.position, nor = geom.attributes.normal;
  const n = pos.count;
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const k = key(pos.getX(i), pos.getY(i), pos.getZ(i));
    let g = groups.get(k); if (!g) { g = []; groups.set(k, g); }
    g.push(i);
  }
  const out = new Float32Array(n * 3);
  for (const g of groups.values()) {
    for (const i of g) {
      const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
      let sx = 0, sy = 0, sz = 0;
      for (const j of g) {
        const mx = nor.getX(j), my = nor.getY(j), mz = nor.getZ(j);
        if (nx * mx + ny * my + nz * mz > -0.15) { sx += mx; sy += my; sz += mz; }
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      out[i * 3] = sx / l; out[i * 3 + 1] = sy / l; out[i * 3 + 2] = sz / l;
    }
  }
  geom.setAttribute('aSmooth', new THREE.BufferAttribute(out, 3));
}

/**
 * Collects coloured geometry into named rig nodes (pivots). Every part gets a baked vertical
 * light gradient (lighter on top, darker underneath) so the flat-shaded meshes read as painted.
 */
export class RigBuilder {
  constructor() { this.nodes = new Map(); this.order = []; }

  /** Declare a node with a parent and local rest transform. */
  node(name, { parent = null, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 } = {}) {
    if (!this.nodes.has(name)) { this.nodes.set(name, { name, parent, pos: [x, y, z], rot: [rx, ry, rz], geos: [] }); this.order.push(name); }
    return this;
  }

  /**
   * Add a primitive (node-local space). `grad` is the top/bottom brightness spread, `shade` a flat
   * multiplier (e.g. 0.8 for parts in the figure's own shadow), `tint` a secondary colour blended at the bottom.
   */
  add(node, g, color, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, grad = 0.42, shade = 1, tint = null, frame = null } = {}) {
    if (!this.nodes.has(node)) this.node(node);
    const geom = g.index ? g.toNonIndexed() : g.clone();
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _v.set(x, y, z); _s.set(sx, sy, sz);
    _m.compose(_v, _q, _s);
    if (frame) _m.premultiply(frame);
    geom.applyMatrix4(_m);
    if (!geom.attributes.uv) geom.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geom.attributes.position.count * 2), 2));
    const c = _c.set(color);
    const pos = geom.attributes.position;
    const n = pos.count;
    let yMin = Infinity, yMax = -Infinity;
    for (let i = 0; i < n; i++) { const py = pos.getY(i); if (py < yMin) yMin = py; if (py > yMax) yMax = py; }
    const span = Math.max(1e-4, yMax - yMin);
    const col = new Float32Array(n * 3);
    const tr = tint !== null ? new THREE.Color(tint) : null;
    for (let i = 0; i < n; i++) {
      const t = (pos.getY(i) - yMin) / span;
      const k = (1 - grad * 0.5 + grad * t) * shade;
      let r = c.r, gg = c.g, b = c.b;
      if (tr) { const w = 1 - t; r = r * (1 - w) + tr.r * w; gg = gg * (1 - w) + tr.g * w; b = b * (1 - w) + tr.b * w; }
      col[i * 3] = r * k; col[i * 3 + 1] = gg * k; col[i * 3 + 2] = b * k;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    for (const k of Object.keys(geom.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color' && k !== 'uv') geom.deleteAttribute(k);
    computeSmoothNormals(geom);
    this.nodes.get(node).geos.push(geom);
    return this;
  }

  /** Mirror helper: run fn(sx) for sx = -1 and +1. */
  both(fn) { fn(-1); fn(1); return this; }

  /**
   * Bake the rig: one merged geometry in root-relative bind space, skinned to one bone per node
   * (skinIndex = bone order), with material groups 0 = body, 1 = outline hull, 2 = glow parts.
   * @returns {{bones:{name:string,parent:string|null,pos:number[],rot:number[]}[], geometry:THREE.BufferGeometry}}
   */
  build() {
    const bones = this.order.filter((n) => n !== 'root').map((name) => { const n = this.nodes.get(name); return { name, parent: n.parent, pos: n.pos, rot: n.rot }; });
    const index = new Map(bones.map((b, i) => [b.name, i]));
    const world = new Map([['root', new THREE.Matrix4()]]);
    const local = new THREE.Matrix4();
    for (const b of bones) {
      _e.set(b.rot[0], b.rot[1], b.rot[2]); _q.setFromEuler(_e); _v.set(b.pos[0], b.pos[1], b.pos[2]); _s.set(1, 1, 1);
      local.compose(_v, _q, _s);
      world.set(b.name, new THREE.Matrix4().multiplyMatrices(world.get(b.parent) || world.get('root'), local));
    }
    const body = [], glow = [];
    for (const b of bones) {
      const n = this.nodes.get(b.name);
      if (!n.geos.length) continue;
      const g = mergeGeometries(n.geos, false);
      const m = world.get(b.name);
      g.applyMatrix4(m);
      // applyMatrix4 transformed `normal`; do the same for the smoothed normals
      const sm = g.attributes.aSmooth, nm = new THREE.Matrix3().getNormalMatrix(m);
      for (let i = 0; i < sm.count; i++) { _v.set(sm.getX(i), sm.getY(i), sm.getZ(i)).applyMatrix3(nm).normalize(); sm.setXYZ(i, _v.x, _v.y, _v.z); }
      const count = g.attributes.position.count;
      const si = new Uint16Array(count * 4), sw = new Float32Array(count * 4);
      const bi = index.get(b.name);
      for (let i = 0; i < count; i++) { si[i * 4] = bi; sw[i * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
      g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
      (b.name.includes('glow') ? glow : body).push(g);
    }
    const geometry = mergeGeometries([...body, ...glow], false);
    const bodyCount = body.reduce((a, g) => a + g.attributes.position.count, 0);
    const total = geometry.attributes.position.count;
    geometry.clearGroups();
    geometry.addGroup(0, bodyCount, 0);
    geometry.addGroup(0, bodyCount, 1);
    if (total > bodyCount) geometry.addGroup(bodyCount, total - bodyCount, 2);
    geometry.computeBoundingSphere();
    return { bones, geometry };
  }
}

/** Shared outline width (object units, before the root scale). */
export const OUTLINE = { width: { value: 0.011 } };

/**
 * Inverted-hull outline: back faces pushed out along the smoothed normal. Per-view opacity so it
 * fades with death/invisibility.
 */
export function createOutlineMaterial(color = 0x0a0608) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uWidth: OUTLINE.width, uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } },
    vertexShader: `
      #include <common>
      #include <skinning_pars_vertex>
      attribute vec3 aSmooth; uniform float uWidth;
      void main() {
        vec3 transformed = position + aSmooth * uWidth;
        #include <skinbase_vertex>
        #include <skinning_vertex>
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uOpacity;
      void main() { if (uOpacity < 0.02) discard; gl_FragColor = vec4(uColor, uOpacity); }`,
    side: THREE.BackSide, transparent: true, depthWrite: true,
  });
  m.toneMapped = false;
  return m;
}
