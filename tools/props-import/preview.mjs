// Contact sheet for source props, so a model can be looked at before anything is imported.
// Three views per model: studio three-quarter, the game's own play camera (orthographic, 17 deg
// tilt), and a flat front. The 1x1 pad under each piece is one dungeon tile.
//
//   node tools/props-import/preview.mjs <dir with name.fbx (+ optional name.png)> <out.png>
//
// Reads ASCII FBX 6100 via ./fbx6100.mjs and FBX 7.x via three's FBXLoader, so it covers both the
// 2012 furniture and the newer entourage set.
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFbx6100 } from './fbx6100.mjs';

const DIR = path.resolve(process.argv[2]);
const OUT = path.resolve(process.argv[3] || 'preview.png');
const TH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../node_modules/three');

const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') {
    res.setHeader('content-type', 'text/html');
    return res.end('<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>');
  }
  const f = p.startsWith('/three/') ? path.join(TH, p.slice(6)) : path.join(DIR, p.slice(1));
  try {
    const b = fs.readFileSync(f);
    res.setHeader('content-type', f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.end(b);
  } catch { res.statusCode = 404; res.end(); }
}).listen(0);
const port = srv.address().port;

const files = fs.readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.fbx')).sort();
const models = files.map(f => {
  const name = f.replace(/\.fbx$/i, '');
  const text = fs.readFileSync(path.join(DIR, f), 'latin1');
  const legacy = /FBXVersion:\s*6100/.test(text);
  const png = fs.readdirSync(DIR).find(x => x.toLowerCase() === name.toLowerCase() + '.png');
  return { name, url: f, tex: png || null, meshes: legacy ? parseFbx6100(text) : null };
});
for (const m of models) console.log(`${m.name}: ${m.meshes ? `FBX 6100, ${m.meshes.length} mesh(es), ${m.meshes.reduce((a, x) => a + x.tris, 0)} tris` : 'FBX 7.x (loader)'}${m.tex ? ` + ${m.tex}` : ' (untextured)'}`);

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage();
page.on('pageerror', e => console.log('ERR', e.message));
await page.goto(`http://127.0.0.1:${port}/`);

const result = await page.evaluate(async ({ port, models }) => {
  const THREE = await import('three');
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const CELL = 460, COLS = 3;
  const sheet = document.createElement('canvas');
  sheet.width = CELL * COLS; sheet.height = CELL * models.length;
  const ctx = sheet.getContext('2d');
  const gl = new THREE.WebGLRenderer({ antialias: true });
  gl.setSize(CELL, CELL); gl.setClearColor(0x22222a);
  gl.outputColorSpace = THREE.SRGBColorSpace;
  const texLoader = new THREE.TextureLoader();
  const report = [];

  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    let geo;
    if (m.meshes) {
      const pos = [], nor = [], uv = [];
      for (const mesh of m.meshes) {
        pos.push(...mesh.positions);
        nor.push(...(mesh.normals || new Array(mesh.positions.length).fill(0)));
        uv.push(...(mesh.uvs || new Array((mesh.positions.length / 3) * 2).fill(0)));
      }
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    } else {
      const obj = await new FBXLoader().loadAsync(`http://127.0.0.1:${port}/${m.url}`);
      const gs = []; obj.updateMatrixWorld(true);
      obj.traverse(o => { if (o.isMesh && o.geometry) { const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); gs.push(g.index ? g.toNonIndexed() : g); } });
      const pos = [], nor = [], uv = [];
      for (const g of gs) {
        pos.push(...g.attributes.position.array);
        nor.push(...(g.attributes.normal ? g.attributes.normal.array : new Float32Array(g.attributes.position.count * 3)));
        uv.push(...(g.attributes.uv ? g.attributes.uv.array : new Float32Array(g.attributes.position.count * 2)));
      }
      geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    }

    // Same normalisation the prop pipeline uses: centimetres -> world units, feet on y=0, centred.
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    geo.scale(0.01, 0.01, 0.01);
    geo.computeBoundingBox();
    const size = geo.boundingBox.getSize(new THREE.Vector3());

    let tex = null;
    if (m.tex) {
      tex = await texLoader.loadAsync(`http://127.0.0.1:${port}/${m.tex}`);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = true;
    }
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: tex, color: tex ? 0xffffff : 0xb0a48c, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide,
    }));

    const scene = new THREE.Scene();
    scene.add(mesh);
    scene.add(new THREE.HemisphereLight(0xc4d6ff, 0x3a3228, 1.4));
    const key = new THREE.DirectionalLight(0xfff2dc, 2.0); key.position.set(3, 5, 4); scene.add(key);
    const fill = new THREE.DirectionalLight(0x93a9d2, 0.6); fill.position.set(-4, 2.5, -3); scene.add(fill);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x6d6455 }));
    pad.rotation.x = -Math.PI / 2; pad.position.y = -0.002; scene.add(pad);
    const grid = new THREE.GridHelper(1, 1, 0x141414, 0x141414); grid.position.y = 0.001; scene.add(grid);

    const r = Math.max(size.x, size.z, size.y, 1) * 0.72 + 0.14;
    const tilt = 17 * Math.PI / 180;
    const dirs = [[1, 0.9, 1.4], [0, Math.cos(tilt), Math.sin(tilt)], [0, 0.12, 1]];
    for (let c = 0; c < dirs.length; c++) {
      const d = new THREE.Vector3(...dirs[c]).normalize();
      const cam = new THREE.OrthographicCamera(-r, r, r, -r, 0.01, 100);
      cam.position.copy(d.multiplyScalar(8)).add(new THREE.Vector3(0, size.y / 2, 0));
      cam.lookAt(0, size.y / 2, 0);
      gl.render(scene, cam);
      ctx.drawImage(gl.domElement, c * CELL, i * CELL);
    }
    report.push({ name: m.name, tris: geo.attributes.position.count / 3, size: [+size.x.toFixed(2), +size.y.toFixed(2), +size.z.toFixed(2)], tex: tex ? [tex.image.width, tex.image.height] : null });
  }

  const labels = ['three-quarter', 'play camera (17° tilt)', 'front'];
  for (let i = 0; i < report.length; i++) {
    const r = report[i];
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(10, i * CELL + 10, 430, 50);
    ctx.textBaseline = 'top';
    ctx.font = '600 18px system-ui, sans-serif'; ctx.fillStyle = '#ffd98f';
    ctx.fillText(`${r.name}   ${r.tris} tris${r.tex ? `   ${r.tex[0]}×${r.tex[1]} tex` : '   no texture'}`, 20, i * CELL + 16);
    ctx.font = '400 14px system-ui, sans-serif'; ctx.fillStyle = '#c9cede';
    ctx.fillText(`${r.size[0]} × ${r.size[2]} tiles on the floor, ${r.size[1]} tall`, 20, i * CELL + 38);
    ctx.font = '400 13px system-ui, sans-serif'; ctx.fillStyle = '#8b92a4';
    for (let c = 0; c < 3; c++) ctx.fillText(labels[c], c * CELL + 16, i * CELL + CELL - 24);
  }
  return { png: sheet.toDataURL('image/png').split(',')[1], report };
}, { port, models });

fs.writeFileSync(OUT, Buffer.from(result.png, 'base64'));
console.log(JSON.stringify(result.report, null, 1));
console.log('wrote', OUT);
await b.close();
srv.close();
