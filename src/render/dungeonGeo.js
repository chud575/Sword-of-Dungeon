// Geometry helpers for the dungeon: a small merged-mesh builder (walls, caps, shafts, water)
// and the shared per-instance shapes (slabs, steps, arches, pillars, rocks). Pure geometry;
// no scene access. All randomness comes from the rng handed in.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Accumulates triangles with a fixed attribute set into one indexed BufferGeometry.
 * Every vertex is pushed as { p:[x,y,z], n:[x,y,z], uv:[u,v], c?:[r,g,b], t?:[u,v], s?:number }.
 */
export class MeshBuilder {
  /** @param {{color?:boolean, tile?:boolean, shore?:boolean}} attrs */
  constructor(attrs = {}) {
    this.pos = []; this.nrm = []; this.uv = []; this.col = attrs.color ? [] : null; this.tile = attrs.tile ? [] : null; this.shore = attrs.shore ? [] : null;
    this.idx = [];
    this.groups = [];
    this.groupStart = 0;
  }
  get vertexCount() { return this.pos.length / 3; }

  /** Push one vertex; returns its index. */
  vert(p, n, uv, c = [1, 1, 1], t = [0, 0], s = 1) {
    this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.uv.push(uv[0], uv[1]);
    if (this.col) this.col.push(c[0], c[1], c[2]);
    if (this.tile) this.tile.push(t[0], t[1]);
    if (this.shore) this.shore.push(s);
    return this.vertexCount - 1;
  }

  /** Quad from four vertices (a,b,c,d counter-clockwise as seen from the front). */
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }

  /**
   * Convenience: a quad from 4 corner positions with a shared normal; winding is fixed so the
   * face points along `n`. `uvs` are per corner; `cols` (optional) per corner; `t` shared.
   */
  face(corners, n, uvs, cols = null, t = [0, 0], shores = null) {
    const [p0, p1, p2, p3] = corners;
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
    const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const order = flip ? [0, 3, 2, 1] : [0, 1, 2, 3];
    const ids = order.map((i) => this.vert(corners[i], n, uvs[i], cols ? cols[i] : undefined, t, shores ? shores[i] : 1));
    this.quad(ids[0], ids[1], ids[2], ids[3]);
  }

  /** Close the current material group. */
  endGroup(materialIndex) {
    const count = this.idx.length - this.groupStart;
    if (count > 0) this.groups.push({ start: this.groupStart, count, materialIndex });
    this.groupStart = this.idx.length;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.tile) g.setAttribute('aTile', new THREE.Float32BufferAttribute(this.tile, 2));
    if (this.shore) g.setAttribute('aShore', new THREE.Float32BufferAttribute(this.shore, 1));
    g.setIndex(this.idx);
    if (this.groups.length) for (const gr of this.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * A chamfered flagstone slab centred at the origin, top face at y=0, footprint w x d, thickness h.
 * The top's UVs span the full footprint (0..1) so the atlas bevel lines up with the chamfer;
 * chamfer strips and sides sample the cell's edge. Includes an `aTile` attribute filled with 0
 * (instanced meshes override it with an InstancedBufferAttribute).
 */
export function slabGeometry(w, d, h, bevel = 0.045) {
  const b = new MeshBuilder({ tile: true });
  const hw = w / 2, hd = d / 2, bx = Math.min(bevel, hw * 0.4), bz = Math.min(bevel, hd * 0.4), by = bevel * 0.8;
  const iw = hw - bx, id = hd - bz;
  const U = (x) => (x + hw) / w, V = (z) => (z + hd) / d;
  // top
  b.face([[-iw, 0, -id], [iw, 0, -id], [iw, 0, id], [-iw, 0, id]], [0, 1, 0], [[U(-iw), V(-id)], [U(iw), V(-id)], [U(iw), V(id)], [U(-iw), V(id)]]);
  // chamfers (normals tilted outward+up)
  const s = Math.SQRT1_2;
  b.face([[-iw, 0, -id], [-iw, -by, -hd + 0.0], [iw, -by, -hd], [iw, 0, -id]], [0, s, -s], [[U(-iw), V(-id)], [U(-iw), 0], [U(iw), 0], [U(iw), V(-id)]]);
  b.face([[iw, 0, id], [iw, -by, hd], [-iw, -by, hd], [-iw, 0, id]], [0, s, s], [[U(iw), V(id)], [U(iw), 1], [U(-iw), 1], [U(-iw), V(id)]]);
  b.face([[-iw, 0, id], [-hw, -by, id], [-hw, -by, -id], [-iw, 0, -id]], [-s, s, 0], [[U(-iw), V(id)], [0, V(id)], [0, V(-id)], [U(-iw), V(-id)]]);
  b.face([[iw, 0, -id], [hw, -by, -id], [hw, -by, id], [iw, 0, id]], [s, s, 0], [[U(iw), V(-id)], [1, V(-id)], [1, V(id)], [U(iw), V(id)]]);
  // corner chamfer triangles
  const tri = (a, c, dd, n, uvs) => { const i0 = b.vert(a, n, uvs[0]), i1 = b.vert(c, n, uvs[1]), i2 = b.vert(dd, n, uvs[2]); b.idx.push(i0, i1, i2); };
  tri([-iw, 0, -id], [-iw, -by, -hd], [-hw, -by, -id], [-s, s, -s], [[U(-iw), V(-id)], [U(-iw), 0], [0, V(-id)]]);
  tri([iw, 0, -id], [hw, -by, -id], [iw, -by, -hd], [s, s, -s], [[U(iw), V(-id)], [1, V(-id)], [U(iw), 0]]);
  tri([iw, 0, id], [iw, -by, hd], [hw, -by, id], [s, s, s], [[U(iw), V(id)], [U(iw), 1], [1, V(id)]]);
  tri([-iw, 0, id], [-hw, -by, id], [-iw, -by, hd], [-s, s, s], [[U(-iw), V(id)], [0, V(id)], [U(-iw), 1]]);
  // vertical sides down to -h (sample the dark edge strip of the cell)
  const e0 = 0.015, e1 = 0.05;
  b.face([[-hw, -by, -hd], [-hw, -h, -hd], [hw, -h, -hd], [hw, -by, -hd]], [0, 0, -1], [[U(-hw), e1], [U(-hw), e0], [U(hw), e0], [U(hw), e1]]);
  b.face([[hw, -by, hd], [hw, -h, hd], [-hw, -h, hd], [-hw, -by, hd]], [0, 0, 1], [[U(hw), e1], [U(hw), e0], [U(-hw), e0], [U(-hw), e1]]);
  b.face([[-hw, -by, hd], [-hw, -h, hd], [-hw, -h, -hd], [-hw, -by, -hd]], [-1, 0, 0], [[V(hd), e1], [V(hd), e0], [V(-hd), e0], [V(-hd), e1]]);
  b.face([[hw, -by, -hd], [hw, -h, -hd], [hw, -h, hd], [hw, -by, hd]], [1, 0, 0], [[V(-hd), e1], [V(-hd), e0], [V(hd), e0], [V(hd), e1]]);
  return b.build();
}

/**
 * Push a worn stair step into an atlas builder: a box whose top sags in the middle (foot-worn),
 * with lighter, smoother-looking vertex colour along the tread centre. Local frame: x across,
 * z depth (front at +z), top at y=0; transformed by `m` (Matrix4).
 */
export function pushWornStep(b, m, w, d, h, cell, tint = 1, wear = 0.02) {
  const hw = w / 2, hd = d / 2;
  const P = new THREE.Vector3(), Nn = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const X = (x, y, z) => { P.set(x, y, z).applyMatrix4(m); return [P.x, P.y, P.z]; };
  const NN = (x, y, z) => { Nn.set(x, y, z).applyMatrix3(nm).normalize(); return [Nn.x, Nn.y, Nn.z]; };
  const c = (k) => [tint * k, tint * k, tint * k];
  const cols = [c(0.9), c(1.08), c(1.08), c(0.9)];
  // top as 3 strips across x: edge / centre / edge
  const xs = [-hw, -hw * 0.45, hw * 0.45, hw];
  const dip = [0, -wear, -wear, 0];
  for (let i = 0; i < 3; i++) {
    const x0 = xs[i], x1 = xs[i + 1], y0 = dip[i], y1 = dip[i + 1];
    const u0 = (x0 + hw) / w, u1 = (x1 + hw) / w;
    const nx = -(y1 - y0) / (x1 - x0);
    b.face([X(x0, y0, -hd), X(x1, y1, -hd), X(x1, y1, hd), X(x0, y0, hd)], NN(nx, 1, 0),
      [[u0, 0.1], [u1, 0.1], [u1, 0.9], [u0, 0.9]], [cols[i], cols[i + 1], cols[i + 1], cols[i]], cell);
  }
  // riser (front) and sides
  const dark = c(0.72);
  b.face([X(-hw, 0, hd), X(-hw, -h, hd), X(hw, -h, hd), X(hw, 0, hd)], NN(0, 0, 1), [[0.05, 0.4], [0.05, 0.1], [0.95, 0.1], [0.95, 0.4]], [c(0.85), dark, dark, c(0.85)], cell);
  b.face([X(-hw, 0, -hd), X(-hw, -h, -hd), X(-hw, -h, hd), X(-hw, 0, hd)], NN(-1, 0, 0), [[0.1, 0.4], [0.1, 0.1], [0.9, 0.1], [0.9, 0.4]], [c(0.8), dark, dark, c(0.8)], cell);
  b.face([X(hw, 0, hd), X(hw, -h, hd), X(hw, -h, -hd), X(hw, 0, -hd)], NN(1, 0, 0), [[0.1, 0.4], [0.1, 0.1], [0.9, 0.1], [0.9, 0.4]], [c(0.8), dark, dark, c(0.8)], cell);
}

/** Push an axis-aligned box (all 6 faces) with world-unit masonry UVs into a colour builder. */
export function pushBox(b, x0, y0, z0, x1, y1, z1, col, { uvScale = 0.25, vScale = 1 / 0.85 } = {}) {
  const c4 = [col, col, col, col];
  b.face([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], [0, 0, -1], [[x0 * uvScale, y0 * vScale], [x1 * uvScale, y0 * vScale], [x1 * uvScale, y1 * vScale], [x0 * uvScale, y1 * vScale]], c4);
  b.face([[x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1]], [0, 0, 1], [[x1 * uvScale, y0 * vScale], [x0 * uvScale, y0 * vScale], [x0 * uvScale, y1 * vScale], [x1 * uvScale, y1 * vScale]], c4);
  b.face([[x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1]], [-1, 0, 0], [[z1 * uvScale, y0 * vScale], [z0 * uvScale, y0 * vScale], [z0 * uvScale, y1 * vScale], [z1 * uvScale, y1 * vScale]], c4);
  b.face([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], [1, 0, 0], [[z0 * uvScale, y0 * vScale], [z1 * uvScale, y0 * vScale], [z1 * uvScale, y1 * vScale], [z0 * uvScale, y1 * vScale]], c4);
  b.face([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], [0, 1, 0], [[x0 * uvScale, z0 * uvScale], [x1 * uvScale, z0 * uvScale], [x1 * uvScale, z1 * uvScale], [x0 * uvScale, z1 * uvScale]], c4);
  b.face([[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]], [0, -1, 0], [[x0 * uvScale, z1 * uvScale], [x1 * uvScale, z1 * uvScale], [x1 * uvScale, z0 * uvScale], [x0 * uvScale, z0 * uvScale]], c4);
}

/** Stone doorway: two jambs on plinths, a lintel with a keystone. Spans x (-0.5..0.5), passage along z. */
export function archGeometry() {
  const parts = [];
  const add = (g, x, y, z, sx = 1, sy = 1, sz = 1) => { g.scale(sx, sy, sz); g.translate(x, y, z); parts.push(g); };
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.2, 0.1, 0.3), s * 0.42, 0.05, 0);       // plinth
    add(new THREE.BoxGeometry(0.15, 0.78, 0.22), s * 0.42, 0.49, 0);     // jamb
    add(new THREE.BoxGeometry(0.2, 0.08, 0.28), s * 0.42, 0.92, 0);      // capital
  }
  add(new THREE.BoxGeometry(1.02, 0.14, 0.26), 0, 1.03, 0);              // lintel
  add(new THREE.BoxGeometry(0.18, 0.2, 0.3), 0, 1.06, 0);                // keystone
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g;
}

/** Marble column with base and capital (height 1.05). */
export function pillarGeometry() {
  const parts = [];
  const add = (g, y) => { g.translate(0, y, 0); parts.push(g); };
  add(new THREE.BoxGeometry(0.3, 0.08, 0.3), 0.04);
  add(new THREE.CylinderGeometry(0.11, 0.13, 0.86, 10), 0.51);
  add(new THREE.CylinderGeometry(0.16, 0.11, 0.06, 10), 0.97);
  add(new THREE.BoxGeometry(0.3, 0.06, 0.3), 1.03);
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g;
}

/** Irregular rock (radius ~0.1): a dodecahedron with seeded vertex jitter, flat shaded. */
export function rockGeometry(rng) {
  const g = new THREE.DodecahedronGeometry(0.1, 0).toNonIndexed();
  const p = g.attributes.position;
  // jitter shared corners consistently: hash on the rounded position
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let j = seen.get(k);
    if (!j) { j = [rng.float(-0.03, 0.03), rng.float(-0.03, 0.03), rng.float(-0.03, 0.03)]; seen.set(k, j); }
    p.setXYZ(i, p.getX(i) + j[0], p.getY(i) * 0.75 + j[1], p.getZ(i) + j[2]);
  }
  g.computeVertexNormals();
  return g;
}

/** Candle cluster (3 candles of varied height) merged into one geometry; flame tips returned. */
export function candleClusterGeometry(rng) {
  const parts = [], tips = [];
  const spots = [[0, 0], [0.07, 0.04], [-0.05, 0.07]];
  for (const [x, z] of spots) {
    const h = rng.float(0.08, 0.2);
    const g = new THREE.CylinderGeometry(0.022, 0.026, h, 7);
    g.translate(x, h / 2, z); parts.push(g);
    tips.push([x, h + 0.035, z]);
  }
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return { geometry: g, tips };
}
