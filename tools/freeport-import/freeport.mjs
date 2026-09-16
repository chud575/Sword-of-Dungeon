// The textured Freeport props: two braziers, the cupboard, the cloth table and the banquet table.
//
//   node tools/freeport-import/freeport.mjs [outDir]    (default src/assets/freeport)
//
// For each .unitypackage (a gzip tar of GUID folders, each with `pathname` and `asset`):
//   1. pull out the FBX and its _AL (albedo), _AO, _NM (OpenGL normal) maps — _MT is not used;
//   2. load the FBX with three's FBXLoader in a headless page and bake its node transforms;
//   3. turn the front to +z, scale it to its footprint in tiles, stand it on y = 0, centre it on its tile;
//   4. BAKE the albedo: AO multiplied in, and the normal map's DETAIL under the house key light (top-left,
//      AMBIENCE §1) — only the difference between the mapped normal and the mesh normal, so the room's
//      real lights still do the big shapes. That leaves one texture per prop and no normal map at runtime;
//   5. downsample it to the floor's density — about 32 texels per tile, measured from the mesh's own UV
//      area against its world area (CLAUDE.md rule 2: one pixel grid) — and a half-size copy for phones,
//      both WebP;
//   6. write a glTF binary of the geometry (POSITION, NORMAL, TEXCOORD_0 in image space, v down).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openPage } from './page.mjs';
import { writeGlb } from './mesh.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.resolve(REPO, process.argv[2] || 'src/assets/freeport');
const UNITY = '/Users/joshchudnovsky/Library/CloudStorage/Dropbox/Freeport/Art/Zealot_Assets/Unity Ready';
const TPU = 32;

/**
 * yaw: radians about y taking the model's front to +z. fit: one of
 *   {foot} largest plan dimension, {length} x extent, {height}, {depth} z extent — in tiles.
 * back: z of the back face (a piece that stands against a wall). stretch: final x extent (banquet run).
 */
const PROPS = [
  { id: 'brazier_a', pkg: 'PRP_Brazier_01', yaw: 0, fit: { foot: 0.7 } },
  { id: 'brazier_b', pkg: 'PRP_Brazier_02', yaw: 0, fit: { foot: 0.68 } },
  { id: 'cupboard', pkg: 'PRP_Cupboard_01', yaw: Math.PI / 2, fit: { height: 1.16 }, back: -0.3 },
  { id: 'table', pkg: 'PRP_Table_01', yaw: 0, fit: { length: 1.0 } },
  { id: 'banquet', pkg: 'PRP_BanquetTableCloth_01', yaw: 0, fit: { depth: 0.86 }, stretch: 3.0, segments: 3 },
];

function extract(pkg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeport-'));
  execFileSync('tar', ['xzf', path.join(UNITY, `${pkg}.unitypackage`), '-C', dir]);
  const files = {};
  for (const g of fs.readdirSync(dir)) {
    const pn = path.join(dir, g, 'pathname'), as = path.join(dir, g, 'asset');
    if (!fs.existsSync(pn) || !fs.existsSync(as)) continue;
    const name = fs.readFileSync(pn, 'utf8').split('\n')[0].trim();
    const m = name.match(/\.fbx$/i) ? 'fbx' : (name.match(/_(AL|AO|NM|MT)\.png$/) || [])[1];
    if (m) { const to = path.join(dir, path.basename(name)); fs.copyFileSync(as, to); files[m] = { path: to, name }; }
  }
  return { dir, files };
}

const f32 = (b64) => new Float32Array(Buffer.from(b64, 'base64').buffer.slice(0));

/** Sutherland-Hodgman clip of a triangle list against x >= lo and x <= hi, attributes interpolated. */
function clipX(tris, lo, hi) {
  const lerp = (a, b, t) => ({ p: a.p.map((v, i) => v + (b.p[i] - v) * t), n: a.n.map((v, i) => v + (b.n[i] - v) * t), uv: a.uv.map((v, i) => v + (b.uv[i] - v) * t) });
  const clip = (poly, keep, cross) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const ka = keep(a), kb = keep(b);
      if (ka) out.push(a);
      if (ka !== kb) out.push(lerp(a, b, cross(a, b)));
    }
    return out;
  };
  const res = [];
  for (const tri of tris) {
    let poly = clip(tri, (v) => v.p[0] >= lo, (a, b) => (lo - a.p[0]) / (b.p[0] - a.p[0]));
    if (poly.length >= 3) poly = clip(poly, (v) => v.p[0] <= hi, (a, b) => (hi - a.p[0]) / (b.p[0] - a.p[0]));
    for (let i = 1; i + 1 < poly.length; i++) res.push([poly[0], poly[i], poly[i + 1]]);
  }
  return res;
}

/** Weld a triangle list into indexed arrays. */
function weld(tris) {
  const key = new Map(); const P = [], N = [], UV = [], I = [];
  for (const tri of tris) for (const v of tri) {
    const k = `${v.p.map((x) => x.toFixed(5))}|${v.n.map((x) => x.toFixed(3))}|${v.uv.map((x) => x.toFixed(5))}`;
    let id = key.get(k);
    if (id === undefined) { id = P.length / 3; key.set(k, id); P.push(...v.p); const l = Math.hypot(...v.n) || 1; N.push(v.n[0] / l, v.n[1] / l, v.n[2] / l); UV.push(...v.uv); }
    I.push(id);
  }
  return { P: new Float32Array(P), N: new Float32Array(N), UV: new Float32Array(UV), I: P.length / 3 > 65535 ? new Uint32Array(I) : new Uint16Array(I) };
}

function density(tris) {
  let wa = 0, ua = 0;
  for (const [a, b, c] of tris) {
    const u = a.p.map((v, i) => b.p[i] - v), w = a.p.map((v, i) => c.p[i] - v);
    wa += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2;
    ua += Math.abs((b.uv[0] - a.uv[0]) * (c.uv[1] - a.uv[1]) - (c.uv[0] - a.uv[0]) * (b.uv[1] - a.uv[1])) / 2;
  }
  return Math.sqrt(ua / wa);                                                   // uv units per world unit
}

fs.mkdirSync(OUT, { recursive: true });
const report = [];
for (const spec of PROPS) {
  const { dir, files } = extract(spec.pkg);
  const { page, close } = await openPage({ pkg: dir }, { width: 1100, height: 1100 });
  const dump = await page.evaluate(async (file) => {
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    const root = new FBXLoader().parse(await (await fetch('/pkg/' + file)).arrayBuffer(), '');
    root.updateMatrixWorld(true);
    const b64 = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    const out = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      let g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); if (g.index) g = g.toNonIndexed();
      out.push({ name: o.name, p: b64(new Float32Array(g.attributes.position.array)), n: b64(new Float32Array(g.attributes.normal.array)), uv: b64(new Float32Array(g.attributes.uv.array)) });
    });
    return out;
  }, path.basename(files.fbx.path));

  // --- geometry in the game's frame
  let tris = [];
  const c = Math.cos(spec.yaw), s0 = Math.sin(spec.yaw);
  const rot = (x, y, z) => [x * c + z * s0, y, -x * s0 + z * c];
  for (const m of dump) {
    const P = f32(m.p), Nn = f32(m.n), U = f32(m.uv);
    for (let i = 0; i < P.length / 3; i += 3) {
      const tri = [];
      for (let k = 0; k < 3; k++) {
        const j = i + k;
        tri.push({ p: rot(P[j * 3], P[j * 3 + 1], P[j * 3 + 2]), n: rot(Nn[j * 3], Nn[j * 3 + 1], Nn[j * 3 + 2]), uv: [U[j * 2], 1 - U[j * 2 + 1]] });
      }
      tris.push(tri);
    }
  }
  const bb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (const t of tris) for (const v of t) for (let a = 0; a < 3; a++) { bb.min[a] = Math.min(bb.min[a], v.p[a]); bb.max[a] = Math.max(bb.max[a], v.p[a]); }
  const size = bb.min.map((m, a) => bb.max[a] - m);
  const f = spec.fit;
  const k = f.foot ? f.foot / Math.max(size[0], size[2]) : f.length ? f.length / size[0] : f.height ? f.height / size[1] : f.depth / size[2];
  const sx = spec.stretch ? spec.stretch / (size[0] * k) : 1;
  const zOff = spec.back !== undefined ? spec.back - (bb.min[2] - (bb.min[2] + bb.max[2]) / 2) * k : 0;
  for (const t of tris) for (const v of t) {
    v.p = [(v.p[0] - (bb.min[0] + bb.max[0]) / 2) * k * sx, (v.p[1] - bb.min[1]) * k, (v.p[2] - (bb.min[2] + bb.max[2]) / 2) * k + zOff];
  }
  // one world unit of texture: uv per tile, measured before the banquet's stretch changes it along x
  const d1 = density(tris);
  const texDesk = Math.min(512, Math.max(64, 2 ** Math.ceil(Math.log2(TPU / d1))));
  const texPhone = TPU / (d1 * texDesk / 2) <= 1.4 ? texDesk / 2 : texDesk;   // halve when that stays within 1.4x of the grid
  const gsize = [size[0] * k * sx, size[1] * k, size[2] * k];

  // --- bake the albedo (browser)
  const all = weld(tris);
  const baked = await page.evaluate(async ({ P, N, UV, I, files, sizes }) => {
    const THREE = await import('three');
    const load = (u) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = u; });
    const [al, ao, nm] = await Promise.all([load('/pkg/' + files.AL), files.AO ? load('/pkg/' + files.AO) : null, files.NM ? load('/pkg/' + files.NM) : null]);
    const W = al.width, H = al.height;
    const gl = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    gl.setSize(W, H); gl.setPixelRatio(1);
    const tex = (im) => { const t = new THREE.Texture(im); t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true; return t; };
    const tAl = tex(al), tAo = ao ? tex(ao) : null, tNm = nm ? tex(nm) : null;
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, colorSpace: THREE.NoColorSpace });
    // pass 1: the whole sheet, AO only — what the gutters round every UV island keep
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { al: { value: tAl }, ao: { value: tAo }, hasAo: { value: tAo ? 1 : 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = vec2(uv.x, 1.0 - uv.y); gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D al, ao; uniform float hasAo; varying vec2 vUv; void main(){ vec3 c = texture2D(al, vUv).rgb; float o = hasAo > 0.5 ? texture2D(ao, vUv).r : 1.0; gl_FragColor = vec4(c * mix(1.0, o, 0.85), 1.0); }',
      depthTest: false,
    }));
    const cam = new THREE.Camera();
    const sq = new THREE.Scene(); sq.add(quad);
    gl.setRenderTarget(rt); gl.render(sq, cam);
    // pass 2: every triangle drawn in its own UV space, with the normal map's detail under the key light
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
    const uvGl = new Float32Array(UV.length); for (let i = 0; i < UV.length; i += 2) { uvGl[i] = UV[i]; uvGl[i + 1] = 1 - UV[i + 1]; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uvGl, 2));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1));
    geo.computeTangents();
    const bake = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { al: { value: tAl }, ao: { value: tAo }, nm: { value: tNm }, hasAo: { value: tAo ? 1 : 0 }, hasNm: { value: tNm ? 1 : 0 } },
      vertexShader: `attribute vec4 tangent; varying vec2 vUv; varying vec3 vN; varying vec3 vT; varying float vW;
        void main(){ vUv = vec2(uv.x, 1.0 - uv.y); vN = normal; vT = tangent.xyz; vW = tangent.w;
          gl_Position = vec4(uv.x * 2.0 - 1.0, uv.y * 2.0 - 1.0, 0.0, 1.0); }`,
      fragmentShader: `uniform sampler2D al, ao, nm; uniform float hasAo, hasNm; varying vec2 vUv; varying vec3 vN; varying vec3 vT; varying float vW;
        void main(){
          vec3 n = normalize(vN), t = normalize(vT - n * dot(n, vT)); vec3 b = cross(n, t) * vW;
          vec3 c = texture2D(al, vUv).rgb;
          float o = hasAo > 0.5 ? texture2D(ao, vUv).r : 1.0;
          float shade = 1.0;
          if (hasNm > 0.5) {
            vec3 m = texture2D(nm, vUv).xyz * 2.0 - 1.0;
            vec3 nn = normalize(t * m.x + b * m.y + n * m.z);
            vec3 key = normalize(vec3(-0.45, 0.8, -0.4));
            shade = clamp(1.0 + 0.6 * (dot(nn, key) - dot(n, key)), 0.62, 1.3);
          }
          gl_FragColor = vec4(clamp(c * mix(1.0, o, 0.85) * shade, 0.0, 1.0), 1.0);
        }`,
      side: THREE.DoubleSide, depthTest: false,
    }));
    const sb = new THREE.Scene(); sb.add(bake);
    gl.autoClear = false; gl.render(sb, cam); gl.autoClear = true;
    const px = new Uint8Array(W * H * 4); gl.readRenderTargetPixels(rt, 0, 0, W, H, px);
    // both passes put the image's top row (v = 0) at the TOP of the target, and readPixels hands rows
    // back bottom-up, so they are flipped into image order here
    const full = document.createElement('canvas'); full.width = W; full.height = H;
    const fctx = full.getContext('2d'); const id = fctx.createImageData(W, H);
    for (let y = 0; y < H; y++) id.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    fctx.putImageData(id, 0, 0);
    const down = (src, S) => {
      let cur = src;
      while (cur.width / 2 >= S) { const n = document.createElement('canvas'); n.width = cur.width / 2; n.height = cur.height / 2; const x = n.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, n.width, n.height); cur = n; }
      return cur;
    };
    const enc = (cv, type, q) => new Promise((res) => cv.toBlob(async (bl) => { const u = new Uint8Array(await bl.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); res(btoa(s)); }, type, q));
    const out = {};
    for (const [name, S] of Object.entries(sizes)) out[name] = await enc(down(full, S), 'image/webp', 0.9);
    out.previewPng = await enc(down(full, 256), 'image/png');
    return out;
  }, { P: [...all.P], N: [...all.N], UV: [...all.UV], I: [...all.I], files: { AL: path.basename(files.AL.path), AO: files.AO && path.basename(files.AO.path), NM: files.NM && path.basename(files.NM.path) }, sizes: { desk: texDesk, phone: texPhone } });
  await close();

  const write = (name, b64, dir = OUT) => { const b = Buffer.from(b64, 'base64'); fs.writeFileSync(path.join(dir, name), b); return b.length; };
  const texBytes = write(`${spec.id}.webp`, baked.desk) + (texPhone !== texDesk ? write(`${spec.id}_phone.webp`, baked.phone) : 0);
  fs.mkdirSync(path.join(REPO, 'tools/freeport-import/out'), { recursive: true });
  write(`${spec.id}_baked.png`, baked.previewPng, path.join(REPO, 'tools/freeport-import/out'));

  // --- geometry: whole, or the banquet cut into run segments of one tile (v0 end, v1 middle, v2 end)
  const meshes = [];
  const extras = { source: `${spec.pkg}.unitypackage -> ${files.fbx.name}`, foot: [+gsize[0].toFixed(3), +gsize[2].toFixed(3)], height: +gsize[1].toFixed(3), uvPerTile: +d1.toFixed(5), tex: { desk: texDesk, phone: texPhone } };
  if (spec.segments) {
    const n = spec.segments;
    for (let i = 0; i < n; i++) {
      const lo = -gsize[0] / 2 + i * gsize[0] / n, hi = lo + gsize[0] / n, mid = (lo + hi) / 2;
      const seg = clipX(tris, i === 0 ? -1e9 : lo, i === n - 1 ? 1e9 : hi).map((t) => t.map((v) => ({ ...v, p: [v.p[0] - mid, v.p[1], v.p[2]] })));
      const w = weld(seg);
      meshes.push({ name: `seg${i}`, attributes: { POSITION: { array: w.P, size: 3 }, NORMAL: { array: w.N, size: 3 }, TEXCOORD_0: { array: w.UV, size: 2 } }, index: w.I });
    }
    extras.segment = +(gsize[0] / n).toFixed(3);
  } else {
    meshes.push({ name: spec.id, attributes: { POSITION: { array: all.P, size: 3 }, NORMAL: { array: all.N, size: 3 }, TEXCOORD_0: { array: all.UV, size: 2 } }, index: all.I });
  }
  if (spec.id.startsWith('brazier')) {
    // where the fire sits: the top of the coals, measured as the highest geometry inside the rim's middle
    let top = 0;
    for (const t of tris) for (const v of t) if (Math.hypot(v.p[0], v.p[2]) < gsize[0] * 0.18) top = Math.max(top, v.p[1]);
    extras.flame = [0, +top.toFixed(3), 0];
  }
  const glbBytes = writeGlb(path.join(OUT, `${spec.id}.glb`), meshes, extras);
  const triCount = meshes.reduce((a, m) => a + m.index.length / 3, 0);
  const r = { id: spec.id, tris: triCount, glbBytes, texBytes, ...extras, texelsPerTile: +(d1 * texDesk).toFixed(1) };
  console.log(JSON.stringify(r));
  report.push(r);
  fs.rmSync(dir, { recursive: true, force: true });
}
fs.writeFileSync(path.join(OUT, 'freeport.json'), JSON.stringify(report, null, 1));
