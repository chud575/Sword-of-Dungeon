// The chests, from the Zealot 3D-print plates — untextured, hundreds of thousands of triangles each.
//
//   node tools/freeport-import/chests.mjs [outDir]      (default src/assets/freeport)
//
// There is no textured, game-ready chest in the Freeport set (see README.md for what was searched and
// why the two textured chests in the older Dungeon Crawlers library were not used), so these are made
// here from the print meshes:
//   1. read and weld each plate, split it into its connected components (bodies, lids, coin pile...);
//   2. assemble each chest closed — lid centred on the body's rim — and turn its FRONT (the lock) to +z;
//   3. measure how proud every hi-poly vertex stands of a smoothed copy of the surface: iron bands, rivets,
//      corner brackets and spikes are raised off the planks, so that is what separates iron from wood;
//   4. decimate by normal-aware vertex clustering to a game budget, carrying that measure along;
//   5. bake hemisphere AO against the decimated closed chest and the floor;
//   6. write a glTF binary per chest: a `body` and a `lid` mesh, each vertex carrying its TEXEL position
//      in its box-projection chart (`TEXCOORD_0`, 32 texels per tile), its class (`_CLASS`: 0 wood,
//      1 iron) and its AO (`_AO`). The runtime (render/props/freeport.js) turns that into UVs on the prop
//      kit's own painted atlas, so a chest is textured at the floor's density from the house materials.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStl, components, bbox, transform, vertexNormals, prominence, decimate, buildBvh, bakeAo, writeGlb } from './mesh.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(REPO, process.argv[2] || 'src/assets/freeport');
const ZEALOT = '/Users/joshchudnovsky/Library/CloudStorage/Dropbox/Freeport/Art/Zealot_Assets';
const TPU = 32;

/** A plate's components in the order they lie along it (the print's own y, which Y-up turns into -z). */
function plate(file) {
  const t0 = Date.now();
  const comps = components(readStl(path.join(ZEALOT, file)), 2).reverse();
  console.log(`${file}: ${comps.length} components in ${Date.now() - t0} ms`);
  comps.forEach((c, i) => console.log(`  [${i}] tris=${c.idx.length / 3} size=${c.bbox.size.map((x) => x.toFixed(1)).join('x')}`));
  return comps;
}

/**
 * @param {object} spec
 *  body, lid: components; yaw: turns the lock side to +z; length: body rim length in tiles (x after yaw);
 *  tris: [body, lid] budgets; ironAt: prominence quantile above which a triangle is iron; rules: {body, lid} (fx, fy, z) -> iron by position
 */
function buildChest(id, spec) {
  const parts = { body: spec.body, lid: spec.lid };
  // --- assemble closed, in millimetres, Y up, front +z
  for (const p of Object.values(parts)) { p.pos = transform(p.pos.slice(), { yaw: spec.yaw }); p.bbox = bbox(p.pos); }
  const band = (m, y0, y1) => {           // bbox of the vertices in a height band (fractions of the part's height)
    const b = m.bbox, lo = b.min[1] + b.size[1] * y0, hi = b.min[1] + b.size[1] * y1, P = [];
    for (let i = 0; i < m.pos.length; i += 3) if (m.pos[i + 1] >= lo && m.pos[i + 1] <= hi) P.push(m.pos[i], m.pos[i + 1], m.pos[i + 2]);
    return bbox(P);
  };
  const rim = band(parts.body, 0.9, 1);   // the rim, clear of the ring handles and the feet
  const lidTop = band(parts.lid, 0.35, 1); // the lid's barrel, clear of the hinge tabs and the lock plate
  const bx = (rim.min[0] + rim.max[0]) / 2, bz = (rim.min[2] + rim.max[2]) / 2;
  const s = spec.length / rim.size[0];
  transform(parts.body.pos, { s, t: [-bx * s, -parts.body.bbox.min[1] * s, -bz * s] });
  const lx = (lidTop.min[0] + lidTop.max[0]) / 2, lz = (lidTop.min[2] + lidTop.max[2]) / 2;
  const bodyTop = (parts.body.bbox.max[1] - parts.body.bbox.min[1]) * s;
  const seat = (spec.seat ?? 0) * (parts.lid.bbox.size[1] * s);
  transform(parts.lid.pos, { s, t: [-lx * s, bodyTop - seat - parts.lid.bbox.min[1] * s, -lz * s] });
  for (const p of Object.values(parts)) p.bbox = bbox(p.pos);

  // --- prominence on the hi-poly, then decimate
  const lo = {};
  for (const [name, p] of Object.entries(parts)) {
    const t0 = Date.now();
    const diag = Math.hypot(...p.bbox.size);
    const prom = prominence(p.pos, p.idx, 60);
    for (let i = 0; i < prom.length; i++) prom[i] /= diag;
    const d = decimate(p, spec.tris[name], { prom });
    console.log(`  ${id}.${name}: ${p.idx.length / 3} -> ${d.idx.length / 3} tris (cell ${(d.cell * 32).toFixed(2)} texels) in ${Date.now() - t0} ms`);
    lo[name] = d;
  }

  // --- AO against the closed chest and the floor
  const allPos = new Float32Array(lo.body.pos.length + lo.lid.pos.length);
  allPos.set(lo.body.pos); allPos.set(lo.lid.pos, lo.body.pos.length);
  const nb = lo.body.pos.length / 3;
  const allIdx = new Uint32Array(lo.body.idx.length + lo.lid.idx.length);
  allIdx.set(lo.body.idx); for (let i = 0; i < lo.lid.idx.length; i++) allIdx[lo.body.idx.length + i] = lo.lid.idx[i] + nb;
  const bvh = buildBvh(allPos, allIdx);

  const meshes = [];
  const total = bbox(allPos);
  for (const [name, d] of Object.entries(lo)) {
    const vn = vertexNormals(d.pos, d.idx);
    const ao = bakeAo(d.pos, vn, bvh, { rays: 40, reach: 0.3, eps: 0.004 });
    meshes.push(chart(name, d, ao, spec.ironAt, total, spec));
  }
  const body = lo.body.bbox, lid = lo.lid.bbox;
  const extras = {
    source: spec.source, foot: [+total.size[0].toFixed(3), +total.size[2].toFixed(3)], height: +total.max[1].toFixed(3),
    rimY: +body.max[1].toFixed(3),
    // the hinge: the lid's back bottom edge, where it swings open about the x axis
    hinge: [+lid.min[1].toFixed(3), +lid.min[2].toFixed(3)],
    inner: innerFloor(lo.body),
  };
  const bytes = writeGlb(path.join(OUT, `${id}.glb`), meshes, extras);
  const tris = meshes.reduce((a, m) => a + m.index.length / 3, 0);
  console.log(`  wrote ${id}.glb ${(bytes / 1024).toFixed(1)} KB, ${tris} tris, foot ${extras.foot.join('x')} h ${extras.height}`);
  return { id, bytes, tris, ...extras };
}

/** The height of the floor inside an open body: the lowest up-facing surface near its middle. */
function innerFloor(d) {
  const b = d.bbox; let best = b.max[1];
  for (let t = 0; t < d.idx.length; t += 3) {
    const a = d.idx[t] * 3, c = d.idx[t + 1] * 3, e = d.idx[t + 2] * 3;
    const cx = (d.pos[a] + d.pos[c] + d.pos[e]) / 3, cy = (d.pos[a + 1] + d.pos[c + 1] + d.pos[e + 1]) / 3, cz = (d.pos[a + 2] + d.pos[c + 2] + d.pos[e + 2]) / 3;
    if (Math.abs(cx) > b.size[0] * 0.25 || Math.abs(cz) > b.size[2] * 0.2) continue;
    const ux = d.pos[c] - d.pos[a], uy = d.pos[c + 1] - d.pos[a + 1], uz = d.pos[c + 2] - d.pos[a + 2];
    const vx = d.pos[e] - d.pos[a], vy = d.pos[e + 1] - d.pos[a + 1], vz = d.pos[e + 2] - d.pos[a + 2];
    const ny = uz * vx - ux * vz, len = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx) || 1;
    if (ny / len > 0.8 && cy > b.min[1] + b.size[1] * 0.05) best = Math.min(best, cy);
  }
  return +best.toFixed(3);
}

/**
 * Split a decimated part into box-projection charts and write its attributes. A triangle's chart is its
 * dominant axis and sign; a vertex is duplicated per (chart, class) it takes part in.
 */
function chart(name, d, ao, ironAt, total, spec) {
  const nt = d.idx.length / 3;
  // per-triangle class from the carried prominence, then two majority passes over edge neighbours
  const cls = new Uint8Array(nt);
  const prom = d.attrs.prom;
  const tp = new Float32Array(nt);
  for (let t = 0; t < nt; t++) tp[t] = (prom[d.idx[t * 3]] + prom[d.idx[t * 3 + 1]] + prom[d.idx[t * 3 + 2]]) / 3;
  const sorted = Float32Array.from(tp).sort();
  const q = (f) => sorted[Math.min(nt - 1, Math.floor(f * nt))];
  // `ironAt` is a QUANTILE of this part's own prominence: the share of its surface that is raised metal
  const thr = Number.isFinite(ironAt) ? q(ironAt) : Infinity;
  console.log(`    ${name} prominence x1000: p10 ${(q(0.1) * 1e3).toFixed(2)} p50 ${(q(0.5) * 1e3).toFixed(2)} p70 ${(q(0.7) * 1e3).toFixed(2)} p90 ${(q(0.9) * 1e3).toFixed(2)} p99 ${(q(0.99) * 1e3).toFixed(2)}`);
  // IRON IS STRUCTURE FIRST. Prominence alone came out as grey confetti across the planks (the grain is
  // carved as deep as a strap is raised), so the big iron — rim, base band, corner posts, the lid's end
  // arches, its lip and any straps — comes from where it is on the piece, and prominence only adds the
  // most strongly raised details on top (ring handles, spikes, lock plate).
  const bb = d.bbox, hx = Math.max(Math.abs(bb.min[0]), Math.abs(bb.max[0]));
  const rule = spec.rules && spec.rules[name];
  for (let t = 0; t < nt; t++) {
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 3; k++) { const v = d.idx[t * 3 + k] * 3; cx += d.pos[v] / 3; cy += d.pos[v + 1] / 3; cz += d.pos[v + 2] / 3; }
    const fx = cx / hx, fy = (cy - bb.min[1]) / bb.size[1];
    cls[t] = tp[t] > thr || (rule ? rule(fx, fy, cz) : false) ? 1 : 0;
  }
  const edges = new Map();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const a = d.idx[t * 3 + k], b = d.idx[t * 3 + (k + 1) % 3]; const key = a < b ? `${a},${b}` : `${b},${a}`;
    const e = edges.get(key); if (e) e.push(t); else edges.set(key, [t]);
  }
  const nbr = Array.from({ length: nt }, () => []);
  for (const tri of edges.values()) for (const a of tri) for (const b of tri) if (a !== b) nbr[a].push(b);
  for (let pass = 0; pass < (spec.smooth ?? 3); pass++) {
    const next = cls.slice();
    for (let t = 0; t < nt; t++) { const n = nbr[t]; if (n.length < 2) continue; let iron = 0; for (const u of n) iron += cls[u]; if (iron * 2 > n.length) next[t] = 1; else if (iron === 0) next[t] = 0; }
    cls.set(next);
  }
  const P = [], N = [], UV = [], C = [], AO = [], I = [];
  const key = new Map();
  const fn = [0, 0, 0];
  for (let t = 0; t < nt; t++) {
    const a = d.idx[t * 3] * 3, b = d.idx[t * 3 + 1] * 3, c = d.idx[t * 3 + 2] * 3;
    const ux = d.pos[b] - d.pos[a], uy = d.pos[b + 1] - d.pos[a + 1], uz = d.pos[b + 2] - d.pos[a + 2];
    const vx = d.pos[c] - d.pos[a], vy = d.pos[c + 1] - d.pos[a + 1], vz = d.pos[c + 2] - d.pos[a + 2];
    fn[0] = uy * vz - uz * vy; fn[1] = uz * vx - ux * vz; fn[2] = ux * vy - uy * vx;
    const ax = Math.abs(fn[0]), ay = Math.abs(fn[1]), az = Math.abs(fn[2]);
    const ch = ax >= ay && ax >= az ? (fn[0] > 0 ? 0 : 1) : ay >= az ? (fn[1] > 0 ? 2 : 3) : (fn[2] > 0 ? 4 : 5);
    for (let k = 0; k < 3; k++) {
      const v = d.idx[t * 3 + k];
      const kk = `${v}|${ch}|${cls[t]}`;
      let id = key.get(kk);
      if (id === undefined) {
        id = P.length / 3; key.set(kk, id);
        const x = d.pos[v * 3], y = d.pos[v * 3 + 1], z = d.pos[v * 3 + 2];
        P.push(x, y, z); N.push(0, 0, 0); C.push(cls[t]); AO.push(Math.round(Math.max(0, Math.min(1, ao[v])) * 255));
        // texel position in the chart: planks run along the chest (x) on its top, front and back, and
        // along its depth (z) on its ends
        const sx = (x - total.min[0]) * TPU, sy = (y - total.min[1]) * TPU, sz = (z - total.min[2]) * TPU;
        if (ch <= 1) UV.push(sz, sy); else if (ch <= 3) UV.push(sx, sz); else UV.push(sx, sy);
      }
      N[id * 3] += fn[0]; N[id * 3 + 1] += fn[1]; N[id * 3 + 2] += fn[2];
      I.push(id);
    }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1; N[i] /= l; N[i + 1] /= l; N[i + 2] /= l; }
  const nv = P.length / 3;
  const iron = cls.reduce((a, x) => a + x, 0) / nt;
  console.log(`    ${name}: ${nv} verts after chart split, iron ${(iron * 100).toFixed(0)}% of triangles`);
  return {
    name,
    attributes: {
      POSITION: { array: new Float32Array(P), size: 3 },
      NORMAL: { array: new Float32Array(N), size: 3 },
      TEXCOORD_0: { array: new Float32Array(UV), size: 2 },
      _CLASS: { array: new Uint8Array(C), size: 1 },
      _AO: { array: new Uint8Array(AO), size: 1, normalized: true },
    },
    index: nv > 65535 ? new Uint32Array(I) : new Uint16Array(I),
  };
}

/** The coin pile off the chest plate, for the inside of an opened treasure chest: one gold mesh. */
function buildCoins(comp, width) {
  comp.pos = comp.pos.slice(); comp.bbox = bbox(comp.pos);
  const b = comp.bbox, s = width / b.size[0];
  transform(comp.pos, { s, t: [-(b.min[0] + b.max[0]) / 2 * s, -b.min[1] * s, -(b.min[2] + b.max[2]) / 2 * s] });
  comp.bbox = bbox(comp.pos);
  const d = decimate(comp, 700, { prom: new Float32Array(comp.pos.length / 3) });
  const vn = vertexNormals(d.pos, d.idx);
  const ao = bakeAo(d.pos, vn, buildBvh(d.pos, d.idx), { rays: 32, reach: 0.15, eps: 0.003 });
  const m = chart('coins', d, ao, Infinity, d.bbox, { smooth: 0 });
  const bytes = writeGlb(path.join(OUT, 'coins.glb'), [m], { source: 'ChestsPrinting1.STL component 7', size: d.bbox.size.map((x) => +x.toFixed(3)) });
  console.log(`  wrote coins.glb ${(bytes / 1024).toFixed(1)} KB, ${m.index.length / 3} tris`);
  return { id: 'coins', bytes, tris: m.index.length / 3 };
}

fs.mkdirSync(OUT, { recursive: true });
const small = plate('ChestsPrinting1.STL');
const long = plate('LongChest_Printing1.STL');
const report = [];
const IRON = Number(process.env.IRON_AT || 0.93);
const band = (x, c, w) => Math.abs(x - c) < w;
const BODY = (fx, fy) => fy > 0.86 || fy < 0.16 || Math.abs(fx) > 0.84;
const LID = (straps) => (fx, fy) => fy < 0.2 || Math.abs(fx) > 0.8 || straps.some((c) => band(fx, c, 0.07));
report.push(buildChest('chest_a', { source: 'ChestsPrinting1.STL components 2 (body) + 3 (lid)', body: small[2], lid: small[3], yaw: -Math.PI / 2, length: 0.74, tris: { body: 1500, lid: 1300 }, ironAt: IRON, rules: { body: BODY, lid: LID([]) } }));
report.push(buildChest('chest_b', { source: 'ChestsPrinting1.STL components 4 (body) + 5 (lid)', body: small[4], lid: small[5], yaw: -Math.PI / 2, length: 0.74, tris: { body: 1500, lid: 1300 }, ironAt: IRON, rules: { body: BODY, lid: LID([0]) } }));
report.push(buildChest('chest_long', { source: 'LongChest_Printing1.STL components 1 (body) + 2 (lid)', body: long[1], lid: long[2], yaw: Number(process.env.LONG_YAW ?? Math.PI), length: 0.88, tris: { body: 2000, lid: 1700 }, ironAt: 0.97, rules: { body: (fx, fy) => fy > 0.86 || fy < 0.14 || Math.abs(fx) > 0.9, lid: LID([-0.4, 0.4]) } }));
report.push(buildCoins(small[7], 0.5));
fs.writeFileSync(path.join(OUT, 'chests.json'), JSON.stringify(report, null, 1));
