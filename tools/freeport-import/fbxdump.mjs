// FBX 7.x -> a plain geometry dump, via three's FBXLoader in a headless page. World transforms are baked
// in, so what comes out is the model as the Unity prefab placed it (centimetres, Y up).
//   node fbxdump.mjs <dir with name.fbx> <out.json>
import fs from 'node:fs';
import path from 'node:path';
import { openPage } from './page.mjs';

const DIR = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3]);
const fbx = fs.readdirSync(DIR).find((f) => f.toLowerCase().endsWith('.fbx'));
const { page, close } = await openPage({ src: DIR });
const dump = await page.evaluate(async (file) => {
  const THREE = await import('three');
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const buf = await (await fetch('/src/' + file)).arrayBuffer();
  const root = new FBXLoader().parse(buf, '');
  root.updateMatrixWorld(true);
  const meshes = [];
  const b64 = (a) => { const u = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  root.traverse((o) => {
    if (!o.isMesh) return;
    let g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    const mats = Array.isArray(o.material) ? o.material.map((m) => m.name) : [o.material.name];
    meshes.push({
      name: o.name, mats, visible: o.visible,
      position: b64(g.attributes.position.array),
      normal: g.attributes.normal ? b64(new Float32Array(g.attributes.normal.array)) : null,
      uv: g.attributes.uv ? b64(new Float32Array(g.attributes.uv.array)) : null,
      count: g.attributes.position.count,
      groups: g.groups,
    });
  });
  return { file, meshes };
}, fbx);
fs.writeFileSync(OUT, JSON.stringify(dump));
const decode = (s) => new Float32Array(Buffer.from(s, 'base64').buffer.slice(0));
for (const m of dump.meshes) {
  const p = decode(m.position); const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p[i + a]); max[a] = Math.max(max[a], p[i + a]); }
  let umin = [1e9, 1e9], umax = [-1e9, -1e9];
  if (m.uv) { const u = decode(m.uv); for (let i = 0; i < u.length; i += 2) for (let a = 0; a < 2; a++) { umin[a] = Math.min(umin[a], u[i + a]); umax[a] = Math.max(umax[a], u[i + a]); } }
  console.log(`${dump.file} mesh=${m.name} mats=${m.mats} tris=${m.count / 3} min=${min.map((x) => x.toFixed(1))} max=${max.map((x) => x.toFixed(1))} uv=${umin.map((x) => x.toFixed(2))}..${umax.map((x) => x.toFixed(2))} groups=${m.groups.length} vis=${m.visible}`);
}
await close();
