// The supplied Unity props: 64 prefabs out of Top-Down Dungeons, Top-Down Interiors and BitGem,
// turned into runtime-ready .glb + baked WebP in src/assets/supplied. The Freeport importer beside
// this one (tools/freeport-import/freeport.mjs) is the contract; this is the same six steps against
// a different kind of source.
//
//   node tools/supplied-import/supplied.mjs [--only <regex>] [outDir]
//
//   1. resolve the prefab through the catalog (jobs.json: node hierarchy, fbx + sub-mesh, material,
//      texture) and load its FBX(s) with three's FBXLoader in a headless page;
//   2. bake the prefab's own child transforms and the node transforms, Unity's frame turned into
//      three's (see the comment on the hierarchy below);
//   3. turn the front to +z, scale it to its footprint in tiles, stand it on y = 0, centre it on
//      its tile;
//   4. BAKE one albedo per asset: AO multiplied in where the pack ships one, and the normal map's
//      DETAIL under the house key light (top-left, AMBIENCE §1) — only the difference between the
//      mapped normal and the mesh normal, so the room's real lights still do the big shapes;
//   5. at the floor's density, about 32 texels per tile (CLAUDE.md rule 2), measured from the
//      mesh's own UV area against its world area — and a half-size copy for phones, both WebP;
//   6. write a glTF binary (POSITION, NORMAL, TEXCOORD_0 in image space, v down).
//
// WHAT IS DIFFERENT FROM FREEPORT, AND WHY
//
// Freeport ships one texture per prop, so it bakes the sheet where it stands. These packs ship ONE
// 2048/4096 ATLAS per pack — 41 of these 64 assets share `Addons.tif` — so baking the sheet per
// asset would store the whole atlas 41 times and give each prop about 15% of its pixels. Instead
// each material's UV bounding box is CROPPED out of the atlas, the crops are packed into one small
// per-asset chart, and the mesh's TEXCOORD_0 is remapped into it. The density maths is unchanged:
// the crop is rasterised at exactly the pixel size that gives 32 texels per world unit, measured
// from UV area over world area, and the GPU picks the mip level for the downsample because the bake
// rasterises in chart space, so the screen-space derivative of the atlas UV already IS the ratio.
//
// Facts about these sources that cost time to find (catalog.json's notes hold the rest):
//   - Unity bakes the FBX node's pivot into the mesh and FBXLoader does not, so `transformData`'s
//     scaling pivot has to be subtracted or a multi-part prefab scatters metres apart;
//   - Unity imports an FBX with the X axis negated, so a mesh needs rotateY(pi) — NOT a z mirror —
//     to sit in a node frame that was itself conjugated by the z flip. Both together are a
//     rotation, which is why winding and normals come out right;
//   - `*_alpha` in a material name does not mean cutout. Alpha is kept only where the baked chart
//     really has translucent texels, measured on readback (`keepAlpha` below);
//   - the albedo sources are TIFF/TGA and PIL drops a TIFF's 4th sample, so `sips` converts them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openPage } from '../freeport-import/page.mjs';
import { writeGlb } from '../freeport-import/mesh.mjs';
import { ASSETS, PACK_SCALE, CAP, TEXELS_PER_TILE } from './assets.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HERE = path.join(REPO, 'tools/supplied-import');
// read-only sources, hard-coded exactly as the Freeport importer hard-codes its Dropbox paths
const UNITY = '/Users/joshchudnovsky/My project/Assets';
const CATALOG = process.env.SUPPLIED_CATALOG
  || '/private/tmp/claude-501/-Users-joshchudnovsky-Desktop-ClaudeGames-Fargoal-Neural-Razz-Arena-fargoal/615ac0d8-20e6-4bf6-89e2-975caa4b4cc6/scratchpad/unityprops';
const AUX = path.join(os.tmpdir(), 'fargoal-supplied-tex');       // sips conversions, cached

const args = process.argv.slice(2);
const onlyIx = args.indexOf('--only');
const only = onlyIx >= 0 ? new RegExp(args[onlyIx + 1]) : null;
const rest = args.filter((a, i) => a !== '--only' && i !== onlyIx + 1);
const OUT = path.resolve(REPO, rest[0] || 'src/assets/supplied');

const jobs = new Map(JSON.parse(fs.readFileSync(path.join(CATALOG, 'jobs.json'), 'utf8')).map((j) => [j.id, j]));

// ------------------------------------------------------------------------------- texture sources
fs.mkdirSync(AUX, { recursive: true });
const texInfo = new Map();
/** albedo + AO + normal for one Unity texture path, converted to PNG at FULL source resolution. */
function prepareTexture(texSrc) {
  if (texInfo.has(texSrc)) return texInfo.get(texSrc);
  const dir = path.dirname(texSrc), stem = path.basename(texSrc).replace(/\.[^.]+$/, '');
  const flat = texSrc.replace(/[^A-Za-z0-9]+/g, '_');
  const conv = (src, name) => {
    const to = path.join(AUX, name);
    if (!fs.existsSync(to)) execFileSync('sips', ['-s', 'format', 'png', path.join(UNITY, src), '--out', to]);
    return to;
  };
  const size = (file) => {
    const s = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
    return [+s.match(/pixelWidth: (\d+)/)[1], +s.match(/pixelHeight: (\d+)/)[1]];
  };
  const col = conv(texSrc, `${flat}_col.png`);
  const aoSrc = path.join(dir, `${stem}_ao.png`);
  const nmSrc = path.join(dir, `${stem}_nmp.tif`);
  const info = {
    col: path.basename(col),
    ao: fs.existsSync(path.join(UNITY, aoSrc)) ? path.basename(conv(aoSrc, `${flat}_ao.png`)) : null,
    nm: fs.existsSync(path.join(UNITY, nmSrc)) ? path.basename(conv(nmSrc, `${flat}_nm.png`)) : null,
    size: size(col),
  };
  texInfo.set(texSrc, info);
  return info;
}

// -------------------------------------------------------------------------------------- geometry
// NOTE the byteOffset. node pools Buffers under 4 KB, so `Buffer.from(b64).buffer` is the whole 8 KB
// pool, not this buffer — reading it whole gave a 12-triangle carpet 227 triangles and a bbox 2500
// tiles wide. Every mesh here is small enough to be pooled; the Freeport importer's are not.
const f32 = (b64) => { const b = Buffer.from(b64, 'base64'); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };

/** Weld a triangle list (p / n / cuv) into indexed arrays. */
function weld(tris) {
  const key = new Map(); const P = [], N = [], UV = [], I = [];
  for (const tri of tris) for (const v of tri) {
    const k = `${v.p.map((x) => x.toFixed(5))}|${v.n.map((x) => x.toFixed(3))}|${v.cuv.map((x) => x.toFixed(5))}`;
    let id = key.get(k);
    if (id === undefined) {
      id = P.length / 3; key.set(k, id);
      P.push(...v.p);
      const l = Math.hypot(...v.n) || 1; N.push(v.n[0] / l, v.n[1] / l, v.n[2] / l);
      UV.push(...v.cuv);
    }
    I.push(id);
  }
  return { P: new Float32Array(P), N: new Float32Array(N), UV: new Float32Array(UV), I: P.length / 3 > 65535 ? new Uint32Array(I) : new Uint16Array(I) };
}

const triArea = (a, b, c) => {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
};
const uvArea = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;

/** Shelf-pack rects (tallest first) into an S x S chart; null if they do not fit. */
function shelf(rects, S) {
  if (rects.length === 1) {
    const q = rects[0];
    if (Math.max(q.w, q.h) > S) return null;
    const f = S / Math.max(q.w, q.h);                      // one material fills the chart: no waste
    return [{ x: 0, y: 0, w: Math.min(S, Math.round(q.w * f)), h: Math.min(S, Math.round(q.h * f)) }];
  }
  const order = rects.map((q, i) => ({ ...q, i })).sort((a, b) => b.h - a.h);
  const place = new Array(rects.length);
  let x = 0, y = 0, rowH = 0;
  for (const q of order) {
    if (q.w > S) return null;
    if (x + q.w > S) { x = 0; y += rowH; rowH = 0; }
    if (y + q.h > S) return null;
    place[q.i] = { x, y, w: q.w, h: q.h };
    x += q.w; rowH = Math.max(rowH, q.h);
  }
  return place;
}

/**
 * Pack one rect per material into the smallest power-of-two square chart that holds them all, so
 * the whole chart carries 32 texels per tile or better. Once a size fits, the rects are grown
 * together as far as they still fit, because a chart is a fixed number of bytes whether the crops
 * fill it or not — growing spends the spare room on detail instead of on black. Rects are shrunk —
 * and the density falls below the target, which the report flags — only if 512 will not hold them.
 */
function packChart(rects) {
  for (const S of [32, 64, 128, 256, 512]) {
    let p = shelf(rects, S);
    if (!p) continue;
    if (rects.length > 1) {
      let lo = 1, hi = 8;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        const q = shelf(rects.map((r) => ({ w: Math.max(4, Math.round(r.w * mid)), h: Math.max(4, Math.round(r.h * mid)) })), S);
        if (q) { lo = mid; p = q; } else hi = mid;
      }
    }
    return { S, place: p };
  }
  for (let f = 0.9; f > 0.15; f *= 0.9) {
    const p = shelf(rects.map((q) => ({ w: Math.max(4, Math.round(q.w * f)), h: Math.max(4, Math.round(q.h * f)) })), 512);
    if (p) return { S: 512, place: p };
  }
  throw new Error('chart does not fit 512');
}

/** Sutherland-Hodgman clip of a triangle list against y >= lo, attributes interpolated. */
function clipY(tris, lo) {
  const lerp = (a, b, t) => ({ p: a.p.map((v, i) => v + (b.p[i] - v) * t), n: a.n.map((v, i) => v + (b.n[i] - v) * t), su: a.su.map((v, i) => v + (b.su[i] - v) * t) });
  const res = [];
  for (const tri of tris) {
    const poly = [];
    for (let i = 0; i < tri.length; i++) {
      const a = tri[i], b = tri[(i + 1) % tri.length];
      const ka = a.p[1] >= lo, kb = b.p[1] >= lo;
      if (ka) poly.push(a);
      if (ka !== kb) poly.push(lerp(a, b, (lo - a.p[1]) / (b.p[1] - a.p[1])));
    }
    for (let i = 1; i + 1 < poly.length; i++) {
      const t = [poly[0], poly[i], poly[i + 1]];
      t.mat = tri.mat; t.node = tri.node; t.matPath = tri.matPath;
      res.push(t);
    }
  }
  return res;
}

// ---------------------------------------------------------------------------------- the importer
fs.mkdirSync(OUT, { recursive: true });
const list = ASSETS.filter((a) => !only || only.test(a.id));
const { page, close } = await openPage({ unity: UNITY, aux: AUX }, { width: 64, height: 64 });
await page.evaluate(async () => {
  const THREE = await import('three');
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  window.THREE = THREE;
  const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
  const loader = new FBXLoader();
  // the loader would otherwise try to fetch the FBX's own texture references
  loader.manager.setURLModifier((u) => (u.startsWith('data:') || u.includes('/unity/') || u.includes('/aux/') ? u
    : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='));
  const fbxCache = new Map();
  window.b64 = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };

  /**
   * Assemble one prefab and hand back a world-space triangle soup per (node, material).
   * Unity is left-handed with +z forward, three right-handed: a node transform is conjugated by the
   * z flip (position z negated, quaternion x and y negated) and each MESH gets rotateY(pi), because
   * Unity's FBX importer negates X. The two together are a rotation, so winding survives.
   */
  window.extract = async (job) => {
    const objs = [], holder = new THREE.Group(), recs = [], anchors = [];
    for (const n of job.nodes) {
      const o = new THREE.Group();
      o.position.set(n.pos[0], n.pos[1], -n.pos[2]);
      o.quaternion.set(-n.rot[0], -n.rot[1], n.rot[2], n.rot[3]);
      o.scale.set(n.scale[0], n.scale[1], n.scale[2]);
      (n.parent >= 0 ? objs[n.parent] : holder).add(o);
      objs.push(o);
      if (/fire|flame|light|torch_l/i.test(n.name) && !n.mesh) anchors.push({ name: n.name, obj: o });
      if (!n.mesh) continue;
      if (!fbxCache.has(n.mesh.fbx)) {
        const buf = await (await fetch('/unity/' + enc(n.mesh.fbx))).arrayBuffer();
        let root = null;
        try { root = loader.parse(buf, ''); root.updateMatrixWorld(true); } catch (e) { console.log('[s] fbx parse fail ' + n.mesh.fbx + ' ' + e.message); }
        fbxCache.set(n.mesh.fbx, root);
      }
      const root = fbxCache.get(n.mesh.fbx);
      if (!root) throw new Error('fbx failed: ' + n.mesh.fbx);
      const meshes = []; root.traverse((m) => { if (m.isMesh) meshes.push(m); });
      const san = (s) => (s || '').replace(/[\s[\].:/]/g, '_');
      let pick = meshes.filter((m) => n.mesh.meshName && (m.name === n.mesh.meshName || m.geometry.name === n.mesh.meshName));
      if (!pick.length) pick = meshes.filter((m) => n.mesh.meshName && san(m.name) === san(n.mesh.meshName));
      let whole = false;
      if (!pick.length) {
        pick = meshes; whole = meshes.length > 1;
        console.log(`[s] ${n.name}: sub-mesh ${n.mesh.meshName} not in ${n.mesh.fbx} (${meshes.length} meshes: ${meshes.slice(0, 6).map((m) => m.name).join(',')})`);
      } else if (pick.length > 1) pick = [pick[0]];
      const unit = n.mesh.useFileScale ? (root.userData.unitScaleFactor || 1) / 100 : 1;
      const s = n.mesh.globalScale * unit;
      for (const src of pick) {
        const g = src.geometry.clone();
        if (whole) g.applyMatrix4(src.matrixWorld);
        else {
          const td = src.userData.transformData || {};
          const p = td.scalingPivot || td.rotationPivot;      // Unity bakes it in, FBXLoader does not
          if (p) g.translate(-p[0], -p[1], -p[2]);
        }
        g.scale(s, s, s);
        g.rotateY(Math.PI);
        const mesh = new THREE.Mesh(g);
        o.add(mesh);
        recs.push({ node: n.name, mats: n.materials, geo: g, mesh });
      }
    }
    holder.updateMatrixWorld(true);
    const out = [];
    for (const r of recs) {
      const g = r.geo.clone();
      g.applyMatrix4(r.mesh.matrixWorld);
      const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
      const idx = g.index;
      const nIdx = idx ? idx.count : pos.count;
      const groups = g.groups.length ? g.groups : [{ start: 0, count: nIdx, materialIndex: 0 }];
      for (const gr of groups) {
        const P = [], N = [], U = [];
        for (let k = 0; k < gr.count; k++) {
          const v = idx ? idx.getX(gr.start + k) : gr.start + k;
          P.push(pos.getX(v), pos.getY(v), pos.getZ(v));
          N.push(nrm ? nrm.getX(v) : 0, nrm ? nrm.getY(v) : 1, nrm ? nrm.getZ(v) : 0);
          U.push(uv ? uv.getX(v) : 0, uv ? uv.getY(v) : 0);
        }
        const mi = Math.min(gr.materialIndex || 0, r.mats.length - 1);
        out.push({ node: r.node, mat: r.mats[mi] ? r.mats[mi].mat : null, tex: r.mats[mi] ? r.mats[mi].texSrc : null,
          color: r.mats[mi] ? r.mats[mi].color : [1, 1, 1], alphaMat: r.mats[mi] ? !!(r.mats[mi].cutout || r.mats[mi].blend) : false,
          p: window.b64(new Float32Array(P)), n: window.b64(new Float32Array(N)), uv: window.b64(new Float32Array(U)) });
      }
    }
    const anchorOut = anchors.map((a) => { const v = new THREE.Vector3().setFromMatrixPosition(a.obj.matrixWorld); return { name: a.name, p: [v.x, v.y, v.z] }; });
    return { recs: out, anchors: anchorOut };
  };
});

const report = [];
for (const spec of list) {
  const job = jobs.get(spec.job);
  if (!job) { console.log(`SKIP ${spec.id}: ${spec.job} not in the catalog`); continue; }
  const { recs, anchors } = await page.evaluate((j) => window.extract(j), job);

  // --- triangles in the game's frame -------------------------------------------------------
  const c = Math.cos(spec.yaw || 0), s0 = Math.sin(spec.yaw || 0);
  const rot = (x, y, z) => [x * c + z * s0, y, -x * s0 + z * c];
  const mats = [];                                                   // per-asset material list
  let tris = [];
  for (const r of recs) {
    if (!r.tex) { console.log(`  ${spec.id}: node ${r.node} has no texture, skipped`); continue; }
    let mi = mats.findIndex((m) => m.tex === r.tex && m.mat === r.mat);
    if (mi < 0) { mats.push({ mat: r.mat, tex: r.tex, color: r.color, alphaMat: r.alphaMat, ...prepareTexture(r.tex) }); mi = mats.length - 1; }
    const P = f32(r.p), N = f32(r.n), U = f32(r.uv);
    for (let i = 0; i + 2 < P.length / 3; i += 3) {
      const tri = [];
      for (let k = 0; k < 3; k++) {
        const j = i + k;
        tri.push({ p: rot(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]), n: rot(N[j * 3], N[j * 3 + 1], N[j * 3 + 2]), su: [U[j * 2], 1 - U[j * 2 + 1]] });
      }
      tri.mat = mi; tri.node = r.node; tri.matPath = r.mat;
      tris.push(tri);
    }
  }
  if (!tris.length) { console.log(`SKIP ${spec.id}: no geometry`); continue; }

  // --- orient, scale, stand on y = 0, centre on the tile -----------------------------------
  const box = () => {
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const t of tris) for (const v of t) for (let a = 0; a < 3; a++) { b.min[a] = Math.min(b.min[a], v.p[a]); b.max[a] = Math.max(b.max[a], v.p[a]); }
    return b;
  };
  let bb = box();
  // some prefabs are built to sit IN the floor (a furnace is a pit, a wall torch a bracket): the
  // part below the prefab's own ground plane was never meant to be seen, and standing the bbox on
  // y = 0 instead would lift it into the room. `sink` trims it at the prefab floor.
  const buriedRaw = -bb.min[1];
  if (spec.sink && bb.min[1] < -1e-4) { tris = clipY(tris, 0); bb = box(); bb.min[1] = 0; }
  const raw = bb.min.map((m, a) => bb.max[a] - m);
  const pack = spec.job.split('_')[0];
  const k0 = (PACK_SCALE[pack] ?? 1) * (spec.scale || 1);
  const cap = spec.cap ?? CAP;
  const plan = Math.max(raw[0], raw[2]) * k0;
  const k = plan > cap ? k0 * cap / plan : k0;
  const cx = (bb.min[0] + bb.max[0]) / 2, cz = (bb.min[2] + bb.max[2]) / 2;
  for (const t of tris) for (const v of t) v.p = [(v.p[0] - cx) * k, (v.p[1] - bb.min[1]) * k, (v.p[2] - cz) * k];
  const sizeTiles = raw.map((v) => +(v * k).toFixed(4));
  const buried = +(buriedRaw * k).toFixed(3);                        // geometry the prefab hid under its floor

  // --- one chart per asset: crop each material's UV box, pack, remap ------------------------
  const per = mats.map(() => ({ wa: 0, ua: 0, u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity }));
  for (const t of tris) {
    const m = per[t.mat];
    m.wa += triArea(t[0].p, t[1].p, t[2].p);
    m.ua += uvArea(t[0].su, t[1].su, t[2].su);
    for (const v of t) { m.u0 = Math.min(m.u0, v.su[0]); m.u1 = Math.max(m.u1, v.su[0]); m.v0 = Math.min(m.v0, v.su[1]); m.v1 = Math.max(m.v1, v.su[1]); }
  }
  const rects = per.map((m, i) => {
    m.d = Math.sqrt(m.ua / m.wa) || 0.001;                           // atlas uv per world unit
    const mg = 2 / Math.min(...mats[i].size);                        // two source pixels of gutter
    m.u0 -= mg; m.u1 += mg; m.v0 -= mg; m.v1 += mg;
    m.su = Math.max(1e-4, m.u1 - m.u0); m.sv = Math.max(1e-4, m.v1 - m.v0);
    return { w: Math.max(4, Math.ceil(m.su * TEXELS_PER_TILE / m.d)), h: Math.max(4, Math.ceil(m.sv * TEXELS_PER_TILE / m.d)) };
  });
  const { S, place } = packChart(rects);
  per.forEach((m, i) => {
    const r = place[i];
    m.rect = r;
    m.uvPerTile = m.d * (r.w / S) / m.su;                            // chart uv per world unit
  });
  for (const t of tris) {
    const m = per[t.mat], r = m.rect;
    for (const v of t) v.cuv = [(r.x + (v.su[0] - m.u0) / m.su * r.w) / S, (r.y + (v.su[1] - m.v0) / m.sv * r.h) / S];
  }
  // per-triangle tangent, from the v-UP source uv: the normal maps are OpenGL (green up)
  for (const t of tris) {
    const [a, b, d] = t;
    const e1 = [b.p[0] - a.p[0], b.p[1] - a.p[1], b.p[2] - a.p[2]], e2 = [d.p[0] - a.p[0], d.p[1] - a.p[1], d.p[2] - a.p[2]];
    const w1 = [b.su[0] - a.su[0], -(b.su[1] - a.su[1])], w2 = [d.su[0] - a.su[0], -(d.su[1] - a.su[1])];
    const det = w1[0] * w2[1] - w2[0] * w1[1];
    let T = [1, 0, 0], W = 1;
    if (Math.abs(det) > 1e-12) {
      const r = 1 / det;
      T = [(e1[0] * w2[1] - e2[0] * w1[1]) * r, (e1[1] * w2[1] - e2[1] * w1[1]) * r, (e1[2] * w2[1] - e2[2] * w1[1]) * r];
      const B = [(e2[0] * w1[0] - e1[0] * w2[0]) * r, (e2[1] * w1[0] - e1[1] * w2[0]) * r, (e2[2] * w1[0] - e1[2] * w2[0]) * r];
      const n = a.n;
      const cr = [n[1] * T[2] - n[2] * T[1], n[2] * T[0] - n[0] * T[2], n[0] * T[1] - n[1] * T[0]];
      W = cr[0] * B[0] + cr[1] * B[1] + cr[2] * B[2] < 0 ? -1 : 1;
    }
    t.T = T; t.W = W;
  }

  // --- bake the albedo ---------------------------------------------------------------------
  const byMat = mats.map((m, i) => {
    const sel = tris.filter((t) => t.mat === i);
    const P = [], N = [], SU = [], CU = [], TG = [];
    for (const t of sel) for (const v of t) {
      P.push(...v.p); N.push(...v.n); SU.push(...v.su); CU.push(...v.cuv); TG.push(t.T[0], t.T[1], t.T[2], t.W);
    }
    return { ...m, rect: per[i].rect, crop: [per[i].u0, per[i].v0, per[i].su, per[i].sv], P, N, SU, CU, TG };
  });
  const baked = await page.evaluate(async ({ S, mats: MS }) => {
    const THREE = window.THREE;
    const load = (u) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('img ' + u)); im.src = u; });
    const gl = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, alpha: true });
    gl.setSize(S, S); gl.setPixelRatio(1); gl.autoClear = false;
    const rt = new THREE.WebGLRenderTarget(S, S, { type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace });
    gl.setRenderTarget(rt);
    gl.setClearColor(0x000000, 0); gl.clear(true, true, true);
    const cam = new THREE.Camera();
    const tex = async (name) => {
      if (!name) return null;
      const t = new THREE.Texture(await load('/aux/' + name));
      t.flipY = false; t.colorSpace = THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = true; t.needsUpdate = true;
      return t;
    };
    const COMMON = `uniform sampler2D al, ao, nm; uniform float hasAo, hasNm, uAlphaMat; uniform vec3 uCol;`;
    const SHADE = `
      float shadeOf(vec3 n, vec3 t, float w, vec2 su){
        if (hasNm < 0.5) return 1.0;
        vec3 nn = normalize(n), tt = normalize(t - nn * dot(nn, t)); vec3 bb = cross(nn, tt) * w;
        vec3 m = texture2D(nm, su).xyz * 2.0 - 1.0;
        vec3 mapped = normalize(tt * m.x + bb * m.y + nn * m.z);
        vec3 key = normalize(vec3(-0.45, 0.8, -0.4));
        return clamp(1.0 + 0.6 * (dot(mapped, key) - dot(nn, key)), 0.62, 1.3);
      }`;
    const scene = new THREE.Scene();
    for (const m of MS) {
      const [tAl, tAo, tNm] = await Promise.all([tex(m.col), tex(m.ao), tex(m.nm)]);
      // Addons1.tif and Alphas.tif CARRY an alpha channel that Unity ignores on their opaque material
      // (_Surface 0), and it is not a coverage mask: the basin's own body came back at alpha 0 and
      // vanished under alphaTest. Alpha is taken from the sheet only where Unity itself does.
      const uni = { al: { value: tAl }, ao: { value: tAo }, nm: { value: tNm }, hasAo: { value: tAo ? 1 : 0 }, hasNm: { value: tNm ? 1 : 0 }, uAlphaMat: { value: m.alphaMat ? 1 : 0 }, uCol: { value: new THREE.Vector3(...m.color) } };
      const [u0, v0, su, sv] = m.crop, r = m.rect;
      // pass 1: the whole crop, AL x AO — what the gutters round every UV island keep
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        uniforms: { ...uni, uCrop: { value: new THREE.Vector4(u0, v0, su, sv) }, uRect: { value: new THREE.Vector4(r.x / S, r.y / S, r.w / S, r.h / S) } },
        vertexShader: `uniform vec4 uCrop, uRect; varying vec2 vSu;
          void main(){ vSu = uCrop.xy + uv * uCrop.zw;
            vec2 c = uRect.xy + uv * uRect.zw; gl_Position = vec4(c.x * 2.0 - 1.0, (1.0 - c.y) * 2.0 - 1.0, 0.0, 1.0); }`,
        fragmentShader: `${COMMON} varying vec2 vSu;
          void main(){ vec4 c = texture2D(al, vSu); float o = hasAo > 0.5 ? texture2D(ao, vSu).r : 1.0;
            gl_FragColor = vec4(clamp(c.rgb * uCol * mix(1.0, o, 0.85), 0.0, 1.0), mix(1.0, c.a, uAlphaMat)); }`,
        depthTest: false, depthWrite: false,
      }));
      // PlaneGeometry's uv runs v up; the crop is in image space, so flip it in the attribute
      const pu = quad.geometry.attributes.uv; for (let i = 0; i < pu.count; i++) pu.setY(i, 1 - pu.getY(i));
      scene.add(quad); gl.render(scene, cam); scene.remove(quad);
      // pass 2: every triangle in its own chart space, with the normal map's detail under the key
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(m.P), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(m.N), 3));
      geo.setAttribute('asu', new THREE.BufferAttribute(new Float32Array(m.SU), 2));
      geo.setAttribute('acu', new THREE.BufferAttribute(new Float32Array(m.CU), 2));
      geo.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array(m.TG), 4));
      const bake = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms: uni,
        vertexShader: `attribute vec2 asu; attribute vec2 acu; attribute vec4 tangent;
          varying vec2 vSu; varying vec3 vN, vT; varying float vW;
          void main(){ vSu = asu; vN = normal; vT = tangent.xyz; vW = tangent.w;
            gl_Position = vec4(acu.x * 2.0 - 1.0, (1.0 - acu.y) * 2.0 - 1.0, 0.0, 1.0); }`,
        fragmentShader: `${COMMON} ${SHADE} varying vec2 vSu; varying vec3 vN, vT; varying float vW;
          void main(){ vec4 c = texture2D(al, vSu); float o = hasAo > 0.5 ? texture2D(ao, vSu).r : 1.0;
            gl_FragColor = vec4(clamp(c.rgb * uCol * mix(1.0, o, 0.85) * shadeOf(vN, vT, vW, vSu), 0.0, 1.0), mix(1.0, c.a, uAlphaMat)); }`,
        side: THREE.DoubleSide, depthTest: false, depthWrite: false,
      }));
      scene.add(bake); gl.render(scene, cam); scene.remove(bake);
      geo.dispose(); bake.material.dispose(); quad.geometry.dispose(); quad.material.dispose();
      for (const t of [tAl, tAo, tNm]) if (t) { t.image = null; t.dispose(); }
    }
    const px = new Uint8Array(S * S * 4); gl.readRenderTargetPixels(rt, 0, 0, S, S, px);
    // readPixels hands rows back bottom-up; both passes put chart v = 0 at the target's top
    const img = new Uint8ClampedArray(S * S * 4);
    for (let y = 0; y < S; y++) img.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
    // how translucent each material's own rect really is — `*_alpha` in the name is not evidence
    const stats = MS.map((m) => {
      let soft = 0, n = 0;
      for (let y = m.rect.y; y < m.rect.y + m.rect.h; y++) for (let x = m.rect.x; x < m.rect.x + m.rect.w; x++) { n++; if (img[(y * S + x) * 4 + 3] < 250) soft++; }
      return { alphaMat: m.alphaMat, softFrac: n ? soft / n : 0 };
    });
    const keepAlpha = stats.some((s) => s.alphaMat && s.softFrac > 0.005);
    if (keepAlpha) {
      // bleed colour outward into the transparent texels, or filtering fringes them black
      for (let pass = 0; pass < 3; pass++) {
        const src = img.slice();
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          const o = (y * S + x) * 4;
          if (src[o + 3] >= 16) continue;
          let r = 0, g = 0, b = 0, w = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
            const q = (ny * S + nx) * 4; if (src[q + 3] < 16) continue;
            r += src[q]; g += src[q + 1]; b += src[q + 2]; w++;
          }
          if (w) { img[o] = r / w; img[o + 1] = g / w; img[o + 2] = b / w; }
        }
      }
    } else for (let i = 3; i < img.length; i += 4) img[i] = 255;
    const full = document.createElement('canvas'); full.width = S; full.height = S;
    full.getContext('2d').putImageData(new ImageData(img, S, S), 0, 0);
    const half = document.createElement('canvas'); half.width = Math.max(16, S / 2); half.height = Math.max(16, S / 2);
    const hx = half.getContext('2d'); hx.imageSmoothingEnabled = true; hx.imageSmoothingQuality = 'high';
    hx.drawImage(full, 0, 0, half.width, half.height);
    const encode = (cv, type) => new Promise((res) => cv.toBlob(async (bl) => res(window.b64(new Uint8Array(await bl.arrayBuffer()))), type, 0.9));
    rt.dispose(); gl.dispose();
    return { desk: await encode(full, 'image/webp'), small: await encode(half, 'image/webp'), png: await encode(full, 'image/png'), keepAlpha, stats, smallS: half.width };
  }, { S, mats: byMat });

  // --- parts, and the glb ------------------------------------------------------------------
  const rules = spec.parts || [{ name: spec.id }];
  const buckets = rules.map((r) => ({ name: r.name, tris: [] }));
  for (const t of tris) {
    let bi = rules.findIndex((r) => (r.node && r.node.test(t.node)) || (r.mat && r.mat.test(t.matPath || '')));
    if (bi < 0) bi = rules.length - 1;
    buckets[bi].tris.push(t);
  }
  const meshes = [];
  for (const b of buckets) {
    if (!b.tris.length) continue;
    const w = weld(b.tris);
    meshes.push({ name: b.name, attributes: { POSITION: { array: w.P, size: 3 }, NORMAL: { array: w.N, size: 3 }, TEXCOORD_0: { array: w.UV, size: 2 } }, index: w.I });
  }
  const uvPerTile = +(per.reduce((a, m) => a + m.uvPerTile * m.wa, 0) / per.reduce((a, m) => a + m.wa, 0)).toFixed(5);
  const texelsPerTile = +Math.min(...per.map((m) => m.uvPerTile * S)).toFixed(1);
  const extras = {
    source: { pack: job.pack === 'I' ? 'Top-Down Interiors' : job.pack === 'B' ? 'BitGem Dungeon_Set_01' : 'Top-Down Dungeons', prefab: job.prefabPath },
    foot: [sizeTiles[0], sizeTiles[2]], height: sizeTiles[1], scale: +k.toFixed(4),
    uvPerTile, tex: { desk: S, small: baked.smallS }, cutout: baked.keepAlpha,
  };
  // the prefab's own fire / point-light children, in the FINAL frame — so they go through the same
  // yaw as the geometry before they are centred, or a turned piece lights its neighbour's tile
  if (anchors.length) extras.anchors = anchors.map((a) => { const q = rot(a.p[0], a.p[1], a.p[2]); return { name: a.name, p: [+((q[0] - cx) * k).toFixed(3), +((q[1] - bb.min[1]) * k).toFixed(3), +((q[2] - cz) * k).toFixed(3)] }; });
  const glbBytes = writeGlb(path.join(OUT, `${spec.id}.glb`), meshes, extras);

  const write = (name, b64, dir = OUT) => { const b = Buffer.from(b64, 'base64'); fs.writeFileSync(path.join(dir, name), b); return b.length; };
  const texBytes = write(`${spec.id}.webp`, baked.desk);
  const smallBytes = write(`${spec.id}_small.webp`, baked.small);
  fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
  write(`${spec.id}_baked.png`, baked.png, path.join(HERE, 'out'));

  const r = {
    id: spec.id, job: spec.job, ...extras,
    sizeTiles, triangles: meshes.reduce((a, m) => a + m.index.length / 3, 0),
    parts: meshes.map((m) => m.name), materials: mats.map((m) => m.mat),
    rawSize: raw.map((v) => +v.toFixed(3)), buried, capped: plan > cap,
    chart: per.map((m, i) => ({ mat: path.basename(mats[i].mat), src: mats[i].size, crop: [+m.u0.toFixed(4), +m.v0.toFixed(4), +m.su.toFixed(4), +m.sv.toFixed(4)], rect: m.rect, want: rects[i], tpt: +(m.uvPerTile * S).toFixed(1) })),
    texelsPerTile, glbBytes, texBytes, smallBytes, alpha: baked.stats,
  };
  console.log(`${r.id.padEnd(20)} ${sizeTiles.map((v) => v.toFixed(2)).join(' x ')}  k=${r.scale.toFixed(3)}${r.capped ? '*' : ' '} tris=${String(r.triangles).padStart(4)} tex=${S}^2 tpt=${texelsPerTile} parts=${r.parts.join('+')} ${r.cutout ? 'ALPHA' : ''}${buried > 0.02 ? ` buried=${buried}` : ''}`);
  report.push(r);
}
await close();
// `--only` re-imports a few assets; keep the rows for the others, or preview.mjs loses their numbers
const jsonPath = path.join(OUT, 'supplied.json');
const prev = only && fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : [];
const merged = [...prev.filter((p) => !report.some((r) => r.id === p.id)), ...report];
merged.sort((a, b) => ASSETS.findIndex((s) => s.id === a.id) - ASSETS.findIndex((s) => s.id === b.id));
fs.writeFileSync(jsonPath, JSON.stringify(merged, null, 1));
console.log(`\n${report.length} assets -> ${OUT}`);
const bad = report.filter((r) => r.triangles > 1200 || r.texelsPerTile < 16);
if (bad.length) console.log('FLAGGED:', bad.map((r) => `${r.id}(tris ${r.triangles}, tpt ${r.texelsPerTile})`).join(', '));
