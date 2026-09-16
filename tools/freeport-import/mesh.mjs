// Mesh utilities for the Freeport importer, pure node: STL reading and welding, connected components,
// normal-aware vertex-clustering decimation with a quadric representative, a small BVH for baking
// ambient occlusion, and a minimal glTF-binary writer.

import fs from 'node:fs';

// ------------------------------------------------------------------------------------------ STL
/**
 * Binary STL -> welded indexed mesh. Print meshes are Z-up; `zup` turns them Y-up (x, z, -y).
 * @returns {{pos: Float32Array, idx: Uint32Array}}
 */
export function readStl(file, { zup = true } = {}) {
  const buf = fs.readFileSync(file);
  const nTri = buf.readUInt32LE(80);
  if (buf.length !== 84 + nTri * 50) throw new Error(`${file}: not a binary STL`);
  let cap = 1; while (cap < nTri * 3 * 1.6) cap <<= 1;
  const table = new Int32Array(cap).fill(-1);
  const pos = new Float32Array(nTri * 9);
  const idx = new Uint32Array(nTri * 3);
  const f32 = new Float32Array(3), u32 = new Uint32Array(f32.buffer);
  let nv = 0;
  for (let t = 0; t < nTri; t++) {
    for (let k = 0; k < 3; k++) {
      const o = 84 + t * 50 + 12 + k * 12;
      const x = buf.readFloatLE(o), y = buf.readFloatLE(o + 4), z = buf.readFloatLE(o + 8);
      if (zup) { f32[0] = x; f32[1] = z; f32[2] = -y; } else { f32[0] = x; f32[1] = y; f32[2] = z; }
      let h = (Math.imul(u32[0], 73856093) ^ Math.imul(u32[1], 19349663) ^ Math.imul(u32[2], 83492791)) & (cap - 1);
      let id;
      for (;;) {
        const e = table[h];
        if (e < 0) { id = nv++; table[h] = id; pos[id * 3] = f32[0]; pos[id * 3 + 1] = f32[1]; pos[id * 3 + 2] = f32[2]; break; }
        if (pos[e * 3] === f32[0] && pos[e * 3 + 1] === f32[1] && pos[e * 3 + 2] === f32[2]) { id = e; break; }
        h = (h + 1) & (cap - 1);
      }
      idx[t * 3 + k] = id;
    }
  }
  return { pos: pos.slice(0, nv * 3), idx };
}

/** Connected components (by shared vertex), each re-indexed, sorted by the centre of its bbox along `axis`. */
export function components(mesh, axis = 2) {
  const { pos, idx } = mesh;
  const nv = pos.length / 3, nt = idx.length / 3;
  const parent = new Int32Array(nv); for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < nt; t++) for (const k of [1, 2]) { const a = find(idx[t * 3]), b = find(idx[t * 3 + k]); if (a !== b) parent[a] = b; }
  const groups = new Map();
  for (let t = 0; t < nt; t++) { const r = find(idx[t * 3]); let g = groups.get(r); if (!g) groups.set(r, (g = [])); g.push(t); }
  const out = [];
  for (const tris of groups.values()) {
    const map = new Int32Array(nv).fill(-1);
    const P = []; const I = new Uint32Array(tris.length * 3); let n = 0;
    tris.forEach((t, j) => { for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; if (map[v] < 0) { map[v] = n++; P.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]); } I[j * 3 + k] = map[v]; } });
    const m = { pos: new Float32Array(P), idx: I };
    m.bbox = bbox(m.pos);
    out.push(m);
  }
  out.sort((a, b) => (a.bbox.min[axis] + a.bbox.max[axis]) - (b.bbox.min[axis] + b.bbox.max[axis]));
  return out;
}

export function bbox(pos) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let a = 0; a < 3; a++) { const v = pos[i + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/** Apply p' = R_y(yaw) * p * s + t in place. */
export function transform(pos, { yaw = 0, s = 1, t = [0, 0, 0] } = {}) {
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    pos[i] = (x * c + z * sn) * s + t[0];
    pos[i + 1] = y * s + t[1];
    pos[i + 2] = (-x * sn + z * c) * s + t[2];
  }
  return pos;
}

/** Area-weighted vertex normals of an indexed mesh. */
export function vertexNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { n[o] += fx; n[o + 1] += fy; n[o + 2] += fz; }
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}

/**
 * How far each vertex stands proud of a heavily smoothed copy of its own surface, along its normal.
 * Iron bands, rivets, corner brackets and spikes are raised off the planking on these sculpts, so this
 * is what tells iron from wood.
 */
export function prominence(pos, idx, iters = 24) {
  const nv = pos.length / 3;
  const deg = new Uint32Array(nv + 1);
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) deg[idx[t + k] + 1] += 2;
  for (let i = 0; i < nv; i++) deg[i + 1] += deg[i];
  const adj = new Uint32Array(deg[nv]); const fill = deg.slice(0, nv);
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const v = idx[t + k];
    adj[fill[v]++] = idx[t + (k + 1) % 3]; adj[fill[v]++] = idx[t + (k + 2) % 3];
  }
  let cur = pos.slice(), next = new Float32Array(pos.length);
  for (let it = 0; it < iters; it++) {
    for (let v = 0; v < nv; v++) {
      let sx = 0, sy = 0, sz = 0; const a0 = deg[v], a1 = deg[v + 1];
      for (let j = a0; j < a1; j++) { const u = adj[j] * 3; sx += cur[u]; sy += cur[u + 1]; sz += cur[u + 2]; }
      const k = a1 - a0 || 1, o = v * 3;
      next[o] = cur[o] + 0.6 * (sx / k - cur[o]); next[o + 1] = cur[o + 1] + 0.6 * (sy / k - cur[o + 1]); next[o + 2] = cur[o + 2] + 0.6 * (sz / k - cur[o + 2]);
    }
    [cur, next] = [next, cur];
  }
  const n = vertexNormals(pos, idx);
  const out = new Float32Array(nv);
  for (let v = 0; v < nv; v++) { const o = v * 3; out[v] = (pos[o] - cur[o]) * n[o] + (pos[o + 1] - cur[o + 1]) * n[o + 1] + (pos[o + 2] - cur[o + 2]) * n[o + 2]; }
  return out;
}

// ----------------------------------------------------------------------------------- decimation
function clusterOnce(mesh, n, h, attrs) {
  const { pos, idx } = mesh;
  const nv = pos.length / 3;
  const { min } = mesh.bbox || bbox(pos);
  const keyOf = new Map();
  const vc = new Int32Array(nv);
  let nc = 0;
  for (let v = 0; v < nv; v++) {
    const o = v * 3;
    const ix = Math.floor((pos[o] - min[0]) / h), iy = Math.floor((pos[o + 1] - min[1]) / h), iz = Math.floor((pos[o + 2] - min[2]) / h);
    // NORMAL-AWARE: the two faces of a thin wall share a cell but never a cluster, or the chest's sides
    // would collapse into their own inside
    const ax = Math.abs(n[o]), ay = Math.abs(n[o + 1]), az = Math.abs(n[o + 2]);
    const bin = ax >= ay && ax >= az ? (n[o] > 0 ? 0 : 1) : ay >= az ? (n[o + 1] > 0 ? 2 : 3) : (n[o + 2] > 0 ? 4 : 5);
    const key = ((ix * 1024 + iy) * 1024 + iz) * 6 + bin;
    let c = keyOf.get(key);
    if (c === undefined) { c = nc++; keyOf.set(key, c); }
    vc[v] = c;
  }
  const seen = new Set(); const tris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = vc[idx[t]], b = vc[idx[t + 1]], c = vc[idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    const s = [a, b, c].sort((p, q) => p - q); const k = `${s[0]},${s[1]},${s[2]}`;
    if (seen.has(k)) continue;
    seen.add(k); tris.push(t / 3);
  }
  return { vc, nc, tris };
}

/**
 * Decimate to about `target` triangles: vertices cluster on a grid (split by normal direction), each
 * cluster stands at the point minimising its faces' plane quadrics (pulled toward the centroid so a flat
 * cluster stays put), and per-vertex `attrs` (Float32Array, one value per vertex) are averaged.
 */
export function decimate(mesh, target, attrs = {}) {
  const { pos, idx } = mesh;
  mesh.bbox = mesh.bbox || bbox(pos);
  const n = vertexNormals(pos, idx);
  const diag = Math.hypot(...mesh.bbox.size);
  let lo = diag / 2000, hi = diag / 8, best = null;
  for (let i = 0; i < 18; i++) {
    const h = Math.sqrt(lo * hi);
    const r = clusterOnce(mesh, n, h, attrs);
    if (!best || Math.abs(r.tris.length - target) < Math.abs(best.tris.length - target)) best = { ...r, h };
    if (r.tris.length > target) lo = h; else hi = h;
  }
  const { vc, nc, tris } = best;
  const Q = new Float64Array(nc * 10), cen = new Float64Array(nc * 3), cnt = new Float64Array(nc);
  const A = {}; for (const k in attrs) A[k] = new Float64Array(nc);
  for (let v = 0; v < pos.length / 3; v++) {
    const c = vc[v]; cen[c * 3] += pos[v * 3]; cen[c * 3 + 1] += pos[v * 3 + 1]; cen[c * 3 + 2] += pos[v * 3 + 2]; cnt[c]++;
    for (const k in attrs) A[k][c] += attrs[k][v];
  }
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const area = Math.hypot(fx, fy, fz); if (area < 1e-12) continue;
    fx /= area; fy /= area; fz /= area;
    const d = -(fx * pos[a] + fy * pos[a + 1] + fz * pos[a + 2]);
    const q = [fx * fx, fx * fy, fx * fz, fx * d, fy * fy, fy * fz, fy * d, fz * fz, fz * d, d * d];
    for (const vi of [idx[t], idx[t + 1], idx[t + 2]]) { const o = vc[vi] * 10; for (let j = 0; j < 10; j++) Q[o + j] += q[j] * area; }
  }
  const out = new Float32Array(nc * 3);
  const h = best.h;
  for (let c = 0; c < nc; c++) {
    const mx = cen[c * 3] / cnt[c], my = cen[c * 3 + 1] / cnt[c], mz = cen[c * 3 + 2] / cnt[c];
    const o = c * 10;
    const tr = Q[o] + Q[o + 4] + Q[o + 7];
    const w = tr * 0.02 + 1e-12;
    // (A + wI) x = -b + w m
    const a11 = Q[o] + w, a12 = Q[o + 1], a13 = Q[o + 2], a22 = Q[o + 4] + w, a23 = Q[o + 5], a33 = Q[o + 7] + w;
    const b1 = -Q[o + 3] + w * mx, b2 = -Q[o + 6] + w * my, b3 = -Q[o + 8] + w * mz;
    const det = a11 * (a22 * a33 - a23 * a23) - a12 * (a12 * a33 - a23 * a13) + a13 * (a12 * a23 - a22 * a13);
    let x = mx, y = my, z = mz;
    if (Math.abs(det) > 1e-18) {
      x = (b1 * (a22 * a33 - a23 * a23) - a12 * (b2 * a33 - a23 * b3) + a13 * (b2 * a23 - a22 * b3)) / det;
      y = (a11 * (b2 * a33 - a23 * b3) - b1 * (a12 * a33 - a23 * a13) + a13 * (a12 * b3 - b2 * a13)) / det;
      z = (a11 * (a22 * b3 - b2 * a23) - a12 * (a12 * b3 - b2 * a13) + b1 * (a12 * a23 - a22 * a13)) / det;
      if (Math.abs(x - mx) > h || Math.abs(y - my) > h || Math.abs(z - mz) > h) { x = mx; y = my; z = mz; }
    }
    out[c * 3] = x; out[c * 3 + 1] = y; out[c * 3 + 2] = z;
    for (const k in attrs) A[k][c] /= cnt[c];
  }
  const I = new Uint32Array(tris.length * 3);
  tris.forEach((t, j) => { I[j * 3] = vc[idx[t * 3]]; I[j * 3 + 1] = vc[idx[t * 3 + 1]]; I[j * 3 + 2] = vc[idx[t * 3 + 2]]; });
  const attrOut = {}; for (const k in A) attrOut[k] = Float32Array.from(A[k]);
  const m = { pos: out, idx: I, attrs: attrOut, cell: h };
  m.bbox = bbox(out);
  return m;
}

// ------------------------------------------------------------------------------------------ BVH
export function buildBvh(pos, idx) {
  const nt = idx.length / 3;
  const cx = new Float32Array(nt), cy = new Float32Array(nt), cz = new Float32Array(nt);
  const tmin = new Float32Array(nt * 3), tmax = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    for (let a = 0; a < 3; a++) { tmin[t * 3 + a] = Infinity; tmax[t * 3 + a] = -Infinity; }
    for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k] * 3; for (let a = 0; a < 3; a++) { tmin[t * 3 + a] = Math.min(tmin[t * 3 + a], pos[v + a]); tmax[t * 3 + a] = Math.max(tmax[t * 3 + a], pos[v + a]); } }
    cx[t] = (tmin[t * 3] + tmax[t * 3]) / 2; cy[t] = (tmin[t * 3 + 1] + tmax[t * 3 + 1]) / 2; cz[t] = (tmin[t * 3 + 2] + tmax[t * 3 + 2]) / 2;
  }
  const order = Array.from({ length: nt }, (_, i) => i);
  const nodes = [];
  const build = (s, e) => {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < e; i++) { const t = order[i]; for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], tmin[t * 3 + a]); max[a] = Math.max(max[a], tmax[t * 3 + a]); } }
    const node = { min, max, s, e, l: null, r: null };
    nodes.push(node);
    if (e - s > 6) {
      const sz = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
      const ax = sz[0] > sz[1] && sz[0] > sz[2] ? cx : sz[1] > sz[2] ? cy : cz;
      const part = order.slice(s, e).sort((p, q) => ax[p] - ax[q]);
      for (let i = s; i < e; i++) order[i] = part[i - s];
      const m = (s + e) >> 1;
      node.l = build(s, m); node.r = build(m, e);
    }
    return node;
  };
  const root = build(0, nt);
  /** Does the ray from o along d (unit) hit anything closer than tMax? */
  const occluded = (o, d, tMax) => {
    const inv = [1 / d[0], 1 / d[1], 1 / d[2]];
    const stack = [root];
    while (stack.length) {
      const nd = stack.pop();
      let t0 = 0, t1 = tMax;
      for (let a = 0; a < 3; a++) {
        let ta = (nd.min[a] - o[a]) * inv[a], tb = (nd.max[a] - o[a]) * inv[a];
        if (ta > tb) { const x = ta; ta = tb; tb = x; }
        t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
        if (t0 > t1) break;
      }
      if (t0 > t1) continue;
      if (nd.l) { stack.push(nd.l, nd.r); continue; }
      for (let i = nd.s; i < nd.e; i++) {
        const t = order[i];
        const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
        const e1x = pos[b] - pos[a], e1y = pos[b + 1] - pos[a + 1], e1z = pos[b + 2] - pos[a + 2];
        const e2x = pos[c] - pos[a], e2y = pos[c + 1] - pos[a + 1], e2z = pos[c + 2] - pos[a + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const id = 1 / det;
        const sx = o[0] - pos[a], sy = o[1] - pos[a + 1], sz = o[2] - pos[a + 2];
        const u = (sx * px + sy * py + sz * pz) * id; if (u < 0 || u > 1) continue;
        const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
        const v = (d[0] * qx + d[1] * qy + d[2] * qz) * id; if (v < 0 || u + v > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * id;
        if (tt > 1e-6 && tt < tMax) return true;
      }
    }
    return false;
  };
  return { occluded };
}

/**
 * Hemisphere ambient occlusion per vertex against the mesh itself and the floor (y < floorY).
 * Deterministic: a fixed spherical-Fibonacci set of directions, no random numbers.
 */
export function bakeAo(pos, normals, bvh, { rays = 48, reach = 1, floorY = 0, eps = 1e-3 } = {}) {
  const nv = pos.length / 3;
  const dirs = [];
  for (let i = 0; i < rays * 2; i++) {
    const y = 1 - (i + 0.5) / rays; if (y < 0) break;                       // upper hemisphere of a unit sphere
    const r = Math.sqrt(1 - y * y), phi = i * 2.399963229728653;
    dirs.push([Math.cos(phi) * r, y, Math.sin(phi) * r]);
  }
  const ao = new Float32Array(nv);
  for (let v = 0; v < nv; v++) {
    const n = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
    // tangent frame
    const tx = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    let b1 = [n[1] * tx[2] - n[2] * tx[1], n[2] * tx[0] - n[0] * tx[2], n[0] * tx[1] - n[1] * tx[0]];
    const bl = Math.hypot(...b1); b1 = b1.map((x) => x / bl);
    const b2 = [n[1] * b1[2] - n[2] * b1[1], n[2] * b1[0] - n[0] * b1[2], n[0] * b1[1] - n[1] * b1[0]];
    const o = [pos[v * 3] + n[0] * eps, pos[v * 3 + 1] + n[1] * eps, pos[v * 3 + 2] + n[2] * eps];
    let open = 0, total = 0;
    for (const [lx, ly, lz] of dirs) {
      const d = [b1[0] * lx + n[0] * ly + b2[0] * lz, b1[1] * lx + n[1] * ly + b2[1] * lz, b1[2] * lx + n[2] * ly + b2[2] * lz];
      const w = ly;                                                            // cosine weight
      total += w;
      if (d[1] < 0 && (o[1] - floorY) / -d[1] < reach) continue;              // the floor
      if (!bvh.occluded(o, d, reach)) open += w;
    }
    ao[v] = total ? open / total : 1;
  }
  return ao;
}

// ------------------------------------------------------------------------------------------ GLB
const CT = { f32: 5126, u8: 5121, u16: 5123, u32: 5125, i8: 5120, i16: 5122 };
/**
 * Write a glTF 2.0 binary with one node + mesh per entry. Attributes are passed as
 * `{ name: {array, size, normalized?} }`; custom attributes must start with an underscore.
 * @param {Array<{name:string, attributes:object, index:Uint16Array|Uint32Array, extras?:object}>} meshes
 */
export function writeGlb(file, meshes, extras = {}) {
  const chunks = []; let offset = 0;
  const bufferViews = [], accessors = [];
  const add = (arr, target, size, normalized, isIndex) => {
    const bytes = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    const pad = (4 - (bytes.length % 4)) % 4;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes, Buffer.alloc(pad)); offset += bytes.length + pad;
    const ct = arr instanceof Float32Array ? CT.f32 : arr instanceof Uint8Array ? CT.u8 : arr instanceof Uint16Array ? CT.u16 : arr instanceof Uint32Array ? CT.u32 : arr instanceof Int8Array ? CT.i8 : CT.i16;
    const count = arr.length / size;
    const acc = { bufferView: bufferViews.length - 1, componentType: ct, count, type: { 1: 'SCALAR', 2: 'VEC2', 3: 'VEC3', 4: 'VEC4' }[size] };
    if (normalized) acc.normalized = true;
    if (!isIndex && arr instanceof Float32Array && size <= 4) {
      const mn = new Array(size).fill(Infinity), mx = new Array(size).fill(-Infinity);
      for (let i = 0; i < arr.length; i++) { const a = i % size; mn[a] = Math.min(mn[a], arr[i]); mx[a] = Math.max(mx[a], arr[i]); }
      acc.min = mn; acc.max = mx;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const gltfMeshes = [], nodes = [];
  for (const m of meshes) {
    const attributes = {};
    for (const [name, a] of Object.entries(m.attributes)) attributes[name] = add(a.array, 34962, a.size, a.normalized, false);
    const indices = add(m.index, 34963, 1, false, true);
    gltfMeshes.push({ name: m.name, primitives: [{ attributes, indices, mode: 4 }], ...(m.extras ? { extras: m.extras } : {}) });
    nodes.push({ name: m.name, mesh: gltfMeshes.length - 1 });
  }
  const bin = Buffer.concat(chunks);
  const json = {
    asset: { version: '2.0', generator: 'fargoal tools/freeport-import' },
    scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes: gltfMeshes,
    accessors, bufferViews, buffers: [{ byteLength: bin.length }], extras,
  };
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  const out = Buffer.concat([header, jh, js, bh, bin]);
  fs.writeFileSync(file, out);
  return out.length;
}
