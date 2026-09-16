// Contact sheet of the imported Freeport props, straight from src/assets/freeport — before the game.
//
//   node tools/freeport-import/preview.mjs [out.png]
//
// Per piece: a three-quarter studio view, the play camera (orthographic, 17 degrees off vertical) and
// views from the front (+z) and back (-z), on a one-tile pad. Chests are drawn by class (wood brown,
// iron grey) times their baked AO, closed and open; textured props with their baked WebP.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openPage } from './page.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = path.join(REPO, 'src/assets/freeport');
const OUT = path.resolve(process.argv[2] || path.join(REPO, 'tools/freeport-import/out/preview.png'));
const glbs = fs.readdirSync(DIR).filter((f) => f.endsWith('.glb')).sort();
const { page, close } = await openPage({ fp: DIR }, { width: 400, height: 400 });
const png = await page.evaluate(async (glbs) => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const C = 260, V = 4;
  const rows = [];
  for (const f of glbs) {
    const gltf = await new GLTFLoader().loadAsync('/fp/' + f);
    const id = f.replace('.glb', '');
    const meshes = []; gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const extras = gltf.parser.json.extras || {};
    if (meshes[0].geometry.attributes._class) {
      const build = (open) => {
        const g = new THREE.Group();
        for (const m of meshes) {
          const geo = m.geometry.clone();
          const cls = geo.attributes._class, ao = geo.attributes._ao;
          const col = new Float32Array(cls.count * 3);
          for (let i = 0; i < cls.count; i++) { const a = ao.getX(i); const c = id === 'coins' ? [0.9, 0.7, 0.2] : cls.getX(i) ? [0.45, 0.47, 0.52] : [0.62, 0.38, 0.2]; col[i * 3] = c[0] * a; col[i * 3 + 1] = c[1] * a; col[i * 3 + 2] = c[2] * a; }
          geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
          const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
          if (open && m.name === 'lid' && extras.hinge) {
            const piv = new THREE.Group(); piv.position.set(0, extras.hinge[0], extras.hinge[1]);
            mesh.position.set(0, -extras.hinge[0], -extras.hinge[1]); piv.add(mesh); piv.rotation.x = -1.9; g.add(piv);
          } else g.add(mesh);
        }
        return g;
      };
      rows.push({ id, obj: build(false) });
      if (extras.hinge) rows.push({ id: id + ' open', obj: build(true) });
    } else {
      const tex = await new THREE.TextureLoader().loadAsync(`/fp/${id}.webp`);
      tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.magFilter = THREE.NearestFilter;
      const g = new THREE.Group();
      meshes.forEach((m, i) => { const mesh = new THREE.Mesh(m.geometry, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })); if (meshes.length > 1) mesh.position.x = (i - 1) * (extras.segment || 1) * 1.08; g.add(mesh); });
      rows.push({ id, obj: g });
    }
  }
  const sheet = document.createElement('canvas'); sheet.width = C * V; sheet.height = C * rows.length;
  const ctx = sheet.getContext('2d');
  const gl = new THREE.WebGLRenderer({ antialias: true }); gl.setSize(C, C); gl.setClearColor(0x22222a); gl.outputColorSpace = THREE.SRGBColorSpace;
  rows.forEach((r, i) => {
    const scene = new THREE.Scene(); scene.add(r.obj);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-2, 4, 1.5); scene.add(key);
    const box = new THREE.Box3().setFromObject(r.obj); const s = box.getSize(new THREE.Vector3());
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0x5a554c })); pad.rotation.x = -Math.PI / 2; pad.position.y = -0.001; scene.add(pad);
    const grid = new THREE.GridHelper(3, 3, 0x111111, 0x111111); grid.position.y = 0.001; scene.add(grid);
    const rad = Math.max(0.75, Math.max(s.x, s.y, s.z) * 0.7);
    const t = 17 * Math.PI / 180;
    const dirs = [[1, 0.9, 1.4], [0, Math.cos(t), Math.sin(t)], [0, 0.15, 1], [0, 0.15, -1]];
    const lab = ['3/4', 'play cam', 'front +z', 'back -z'];
    dirs.forEach((d, k) => {
      const cam = new THREE.OrthographicCamera(-rad, rad, rad, -rad, 0.01, 100);
      cam.position.copy(new THREE.Vector3(...d).normalize().multiplyScalar(10)).add(new THREE.Vector3(0, s.y / 2, 0)); cam.lookAt(0, s.y / 2, 0);
      gl.render(scene, cam); ctx.drawImage(gl.domElement, k * C, i * C);
      ctx.fillStyle = '#fff'; ctx.font = '12px sans-serif'; ctx.fillText(`${r.id}  ${lab[k]}  ${s.x.toFixed(2)}x${s.y.toFixed(2)}x${s.z.toFixed(2)}`, k * C + 4, i * C + 14);
    });
  });
  return sheet.toDataURL('image/png').split(',')[1];
}, glbs);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(png, 'base64'));
console.log('wrote', OUT);
await close();
