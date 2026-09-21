// Contact sheet of the imported supplied props, straight from src/assets/supplied — before the game.
//
//   node tools/supplied-import/preview.mjs            -> src/assets/supplied/preview.png
//   node tools/supplied-import/preview.mjs --views    -> out/views.png, four views per piece
//   node tools/supplied-import/preview.mjs --only <re> [out.png]
//
// The default sheet is AT THE PLAY CAMERA: orthographic, 17 degrees off vertical looking from +z
// (render/camera.js's BASE_ELEV), the house key light from the top-left and behind at the angle
// render/lighting.js gives `moon`, and its hemisphere fill. Every cell is drawn at the SAME scale
// over the same 3x3 tile grid and one-tile pad, so a piece that came in at the wrong size shows up
// against its neighbours rather than being hidden by an auto-fit. `--views` adds a three-quarter
// view and the front (+z) and back (-z) elevations, which is what the `yaw` column in assets.mjs
// was set from.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from '../freeport-import/page.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(REPO, 'src/assets/supplied');
const HERE = path.join(REPO, 'tools/supplied-import');
const args = process.argv.slice(2);
const views = args.includes('--views');
const sides = args.includes('--sides');
const onlyIx = args.indexOf('--only');
const only = onlyIx >= 0 ? new RegExp(args[onlyIx + 1]) : null;
const outArg = args.filter((a, i) => !a.startsWith('--') && i !== onlyIx + 1)[0];
const OUT = path.resolve(outArg || (views || sides ? path.join(HERE, `out/${sides ? 'sides' : 'views'}.png`) : path.join(DIR, 'preview.png')));

const meta = new Map(JSON.parse(fs.readFileSync(path.join(DIR, 'supplied.json'), 'utf8')).map((r) => [r.id, r]));
const ids = fs.readdirSync(DIR).filter((f) => f.endsWith('.glb')).map((f) => f.replace('.glb', '')).filter((id) => !only || only.test(id)).sort();

const { page, close } = await openPage({ sup: DIR }, { width: 400, height: 500 });
const res = await page.evaluate(async ({ ids, meta, views, sides }) => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const COLS = 6, CW = views ? 200 : 208, CH = views ? 200 : 272, LAB = 18;
  const HALF_W = 1.25, HALF_H = 1.7;                     // tiles the cell shows, fixed for every cell
  const gl = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  gl.setPixelRatio(2); gl.setClearColor(0x23252b); gl.outputColorSpace = THREE.SRGBColorSpace;

  const cells = [];
  for (const id of ids) {
    const gltf = await new GLTFLoader().loadAsync('/sup/' + id + '.glb');
    const tex = await new THREE.TextureLoader().loadAsync(`/sup/${id}.webp`);
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
    const cutout = !!(meta[id] && meta[id].cutout);
    const group = new THREE.Group();
    const parts = [];
    gltf.scene.traverse((o) => { if (o.isMesh) parts.push(o); });
    for (const m of parts) {
      group.add(new THREE.Mesh(m.geometry, new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.9, metalness: 0,
        ...(cutout ? { transparent: false, alphaTest: 0.35, side: THREE.DoubleSide } : {}),
      })));
    }
    cells.push({ id, obj: group, names: parts.map((p) => p.name) });
  }

  const scene = new THREE.Scene();
  // the game's own key and fill COLOURS, at a review exposure: the play frame's brightness is set
  // by torch pools, a lantern and the depth grade, none of which belong on a contact sheet, and at
  // the game's raw intensities every cell came back at a mean of 50/255 and nothing could be judged
  scene.add(new THREE.HemisphereLight(0x7d6b55, 0x1a1512, 4.2));
  const key = new THREE.DirectionalLight(0xfff2de, 5.2);
  key.position.set(-13.5, 8.2, -6.2).normalize();                     // render/lighting.js `moon`
  scene.add(key);
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x6b6459 }));
  pad.rotation.x = -Math.PI / 2; pad.position.y = -0.002; scene.add(pad);
  const grid = new THREE.GridHelper(4, 4, 0x8a8478, 0x3b3a36); grid.position.y = -0.001; scene.add(grid);
  const holder = new THREE.Group(); scene.add(holder);

  const t = 17 * Math.PI / 180;
  // `--sides` is the yaw check: four elevations, so the face carrying the lock / the shelf opening /
  // the pegs can simply be read off instead of inferred from a three-quarter view
  const DIRS = sides
    ? [[0, 0.18, 1], [0, 0.18, -1], [1, 0.18, 0], [-1, 0.18, 0]]
    : views
      ? [[1, 0.9, 1.4], [0, Math.cos(t), Math.sin(t)], [0, 0.18, 1], [0, 0.18, -1]]
      : [[0, Math.cos(t), Math.sin(t)]];
  const LABS = sides ? ['front +z', 'back -z', 'right +x', 'left -x'] : views ? ['3/4', 'play', '+z', '-z'] : [''];
  const V = DIRS.length;
  const rows = Math.ceil(cells.length / COLS);
  const sheet = document.createElement('canvas');
  sheet.width = CW * V * COLS; sheet.height = (CH + LAB) * rows;
  const ctx = sheet.getContext('2d');
  ctx.fillStyle = '#15161a'; ctx.fillRect(0, 0, sheet.width, sheet.height);
  const stats = [];
  gl.setSize(CW, CH);

  cells.forEach((c, i) => {
    holder.add(c.obj);
    const cx = (i % COLS) * CW * V, cy = Math.floor(i / COLS) * (CH + LAB);
    const m = meta[c.id] || {};
    const s = m.sizeTiles || [0, 0, 0];
    DIRS.forEach((d, k) => {
      const aspect = CW / CH;
      let hw = HALF_W, hh = HALF_H;
      if (hw / hh > aspect) hh = hw / aspect; else hw = hh * aspect;
      const cam = new THREE.OrthographicCamera(-hw, hw, hh, -hh, 0.01, 100);
      const look = new THREE.Vector3(0, Math.min(0.45, s[1] / 2), 0);
      cam.position.copy(new THREE.Vector3(...d).normalize().multiplyScalar(20)).add(look);
      cam.lookAt(look);
      gl.render(scene, cam);
      ctx.drawImage(gl.domElement, cx + k * CW, cy + LAB, CW, CH);
      if (V > 1) { ctx.fillStyle = '#9fb4d8'; ctx.font = '11px sans-serif'; ctx.fillText(LABS[k], cx + k * CW + 4, cy + LAB + 12); }
    });
    ctx.fillStyle = '#f2e3c0'; ctx.font = 'bold 12px sans-serif';
    ctx.fillText(c.id, cx + 5, cy + 13);
    ctx.fillStyle = '#9aa7b8'; ctx.font = '11px sans-serif';
    const lab = `${s[0].toFixed(2)}x${s[1].toFixed(2)}x${s[2].toFixed(2)}  ${m.triangles || '?'}t  ${(m.tex && m.tex.desk) || '?'}²`;
    ctx.fillText(lab, cx + 5 + ctx.measureText(c.id).width + 44, cy + 13);
    // how much of the play-camera cell the piece covers, and how grey/magenta it came out
    const px = ctx.getImageData(cx + (V > 1 ? CW : 0), cy + LAB, CW, CH).data;
    let fg = 0, pink = 0, r = 0, g = 0, b = 0;
    for (let p = 0; p < px.length; p += 4) {
      const dr = px[p] - 0x23, dg = px[p + 1] - 0x25, db = px[p + 2] - 0x2b;
      if (Math.abs(dr) + Math.abs(dg) + Math.abs(db) > 14) { fg++; r += px[p]; g += px[p + 1]; b += px[p + 2]; }
      if (px[p] > 190 && px[p + 1] < 90 && px[p + 2] > 190) pink++;
    }
    stats.push({ id: c.id, fg: fg / (CW * CH), pink: pink / (CW * CH), mean: fg ? [r / fg | 0, g / fg | 0, b / fg | 0] : [0, 0, 0], parts: c.names });
    holder.remove(c.obj);
  });
  const b64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const blob = await new Promise((r2) => sheet.toBlob(r2, 'image/png'));
  return { png: b64(new Uint8Array(await blob.arrayBuffer())), stats, size: [sheet.width, sheet.height] };
}, { ids, meta: Object.fromEntries(meta), views: views || sides, sides });

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(res.png, 'base64'));
console.log(`wrote ${OUT}  ${res.size.join('x')}  ${ids.length} cells`);
console.log('\nid                     tris   tex  tpt  cover  mean          parts');
for (const s of res.stats) {
  const m = meta.get(s.id) || {};
  const flag = [s.fg < 0.02 ? 'BLANK' : '', s.pink > 0.01 ? 'MAGENTA' : '',
    (m.triangles || 0) > 1200 ? 'TRIS' : '', (m.texelsPerTile || 99) < 16 ? 'TPT' : ''].filter(Boolean).join(' ');
  console.log(`${s.id.padEnd(20)} ${String(m.triangles).padStart(5)} ${String((m.tex || {}).desk).padStart(5)} ${String(m.texelsPerTile).padStart(5)} ${(s.fg * 100).toFixed(1).padStart(5)}% ${s.mean.map((v) => String(v).padStart(3)).join(',')}  ${s.parts.join('+').padEnd(12)} ${flag}`);
}
await close();
