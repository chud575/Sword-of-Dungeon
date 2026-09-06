// Import the Dungeon Crawlers "Static Objects / Furniture Etc" pieces into src/assets/furniture*.js.
//
//   node tools/props-import/furniture.mjs "<.../Static Objects/Furniture Etc>" Bookcase [Cupboard ...]
//
// A piece is either a NAME resolved under that root as `<root>/<Name>/<Name>.FBX`, which is how the
// Furniture Etc set is laid out, or a PATH to an .fbx anywhere on disk (its texture is the sibling
// .png). The second form is how the animated enemy models under `Dynamic/Enemies/` are pulled in,
// since they do not live under the furniture root at all.
//
// WHY THIS IS A SECOND LIBRARY AND NOT AN ADDITION TO THE FIRST
// The entourage set ships one 512 atlas whose UVs are already baked into props.glb, and the 4096
// source TGA is not in this repo. Growing that atlas would renormalise every UV in it, so these
// pieces get their own (much smaller) atlas and their own material instead. models.js loads both
// and merges the two into one mesh table, so nothing downstream knows there are two.
//
// WHY 128 TEXELS PER PIECE
// Same rule as the entourage import (see README, "512, not 4096"): one texture texel should land
// near one sprite texel at the play camera, or the props read as a second resolution pasted over
// the game. A piece fitted to ~30 texels of screen with its UV islands spread over a whole sheet
// wants roughly a 128 sheet; the source 512 is four times finer than the floor it stands on.
//
// These are ASCII FBX 6100 files, which three's FBXLoader rejects outright - ./fbx6100.mjs reads
// them. The browser is still used for the glTF export and for decoding the source PNGs.
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseFbx6100 } from './fbx6100.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TH = path.resolve(HERE, '../../node_modules/three');
const OUT = path.resolve(HERE, '../../src/assets');
const SRC = process.argv[2];
const PIECES = process.argv.slice(3);
const CELL = 128;   // texels per piece in the packed atlas
if (!SRC || !PIECES.length) {
  console.error('usage: furniture.mjs "<Furniture Etc dir>" <Piece> [Piece ...]');
  process.exit(1);
}

// ------------------------------------------------------------------- read the source off disk
const pieces = PIECES.map((spec) => {
  let dir, fbx, name;
  if (/\.fbx$/i.test(spec)) {
    const p = path.resolve(spec);
    dir = path.dirname(p); fbx = path.basename(p); name = fbx.replace(/\.fbx$/i, '');
  } else {
    name = spec; dir = path.join(SRC, spec);
    // The base export, not the _14x / _A5 variants: those are alternate UV cuts of the same shape.
    fbx = fs.readdirSync(dir).find((f) => f.toLowerCase() === spec.toLowerCase() + '.fbx');
    if (!fbx) throw new Error(`${spec}: no ${spec}.FBX in ${dir}`);
  }
  // Prefer the texture named after the model; otherwise the only png beside it.
  const pngs = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png'));
  const png = pngs.find((f) => f.toLowerCase() === name.toLowerCase() + '.png')
    || pngs.find((f) => f.toLowerCase().startsWith(name.toLowerCase()))
    || pngs[0];
  if (!png) throw new Error(`${name}: no texture png beside ${fbx}`);
  const buf = fs.readFileSync(path.join(dir, fbx));
  // FBX 6100 is ASCII and needs our own reader; 7.x is binary and goes through three's FBXLoader
  // in the browser, which also brings the skin and the bind pose with it.
  const legacy = buf.length > 32 && /FBXVersion:\s*6100/.test(buf.toString('latin1', 0, 512));
  const meshes = legacy ? parseFbx6100(buf.toString('latin1')) : null;
  if (legacy && !meshes.length) throw new Error(`${name}: no mesh in ${fbx}`);
  return { name, id: name.toLowerCase(), dir, fbx, png, meshes };
});

// ------------------------------------------------------------------------------ serve it up
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') {
    res.setHeader('content-type', 'text/html');
    return res.end('<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>');
  }
  if (p.startsWith('/three/')) {
    try { const b = fs.readFileSync(path.join(TH, p.slice(6)));
      res.setHeader('content-type', p.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
      return res.end(b); } catch { res.statusCode = 404; return res.end(); }
  }
  const tex = pieces.find((x) => p === `/tex/${x.id}.png`);
  if (tex) { res.setHeader('content-type', 'image/png'); return res.end(fs.readFileSync(path.join(tex.dir, tex.png))); }
  const model = pieces.find((x) => p === `/fbx/${x.id}.fbx`);
  if (model) { res.setHeader('content-type', 'application/octet-stream'); return res.end(fs.readFileSync(path.join(model.dir, model.fbx))); }
  res.statusCode = 404; res.end();
}).listen(0);
const port = srv.address().port;

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await b.newPage();
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://127.0.0.1:${port}/`);

const payload = pieces.map((p) => ({ id: p.id, name: p.name, meshes: p.meshes }));
const result = await page.evaluate(async ({ port, payload, CELL }) => {
  const THREE = await import('three');
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');

  // A square grid of CELL-sized cells, one per piece.
  const cols = Math.ceil(Math.sqrt(payload.length));
  const rows = Math.ceil(payload.length / cols);
  const atlas = document.createElement('canvas');
  atlas.width = cols * CELL; atlas.height = rows * CELL;
  const ctx = atlas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';

  const root = new THREE.Group(); root.name = 'furniture';
  // One shared material; the texture is attached at runtime, exactly as the entourage glb does.
  const mat = new THREE.MeshStandardMaterial({ name: 'furniture', roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide });
  const report = [];

  for (let i = 0; i < payload.length; i++) {
    const p = payload[i];
    const col = i % cols, row = Math.floor(i / cols);

    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = `http://127.0.0.1:${port}/tex/${p.id}.png`; });
    ctx.drawImage(img, col * CELL, row * CELL, CELL, CELL);

    // FBX 7.x comes through three's loader; 6100 arrives pre-parsed from node.
    let meshes = p.meshes;
    if (!meshes) {
      const obj = await new FBXLoader().loadAsync(`http://127.0.0.1:${port}/fbx/${p.id}.fbx`);
      obj.updateMatrixWorld(true);
      meshes = [];
      obj.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        // A SkinnedMesh is flattened to its BIND POSE here. The animation clips ship as separate
        // FBX files (Skeleton@Idle01.FBX and friends) and are not imported yet, so the pose is
        // whatever the modeller left the rig in - arms out, for this one.
        const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
        g.applyMatrix4(o.matrixWorld);
        meshes.push({
          positions: Array.from(g.attributes.position.array),
          normals: g.attributes.normal ? Array.from(g.attributes.normal.array) : null,
          uvs: g.attributes.uv ? Array.from(g.attributes.uv.array) : null,
        });
      });
    }
    const pos = [], nor = [], uv = [];
    for (const m of meshes) {
      pos.push(...m.positions);
      nor.push(...(m.normals || new Array(m.positions.length).fill(0)));
      const src = m.uvs || new Array((m.positions.length / 3) * 2).fill(0);
      // Into this piece's cell. V is flipped here because the atlas is written top-down (canvas
      // order) and shipped as a DataTexture with flipY=false, like the entourage atlas.
      for (let k = 0; k < src.length; k += 2) {
        uv.push((col + Math.min(1, Math.max(0, src[k]))) / cols,
                (row + (1 - Math.min(1, Math.max(0, src[k + 1])))) / rows);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));

    // Same normalisation as convert.mjs: source units are centimetres, feet on y=0, centred on x/z.
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    geo.scale(0.01, 0.01, 0.01);
    geo.computeBoundingBox();
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `furniture/${p.id}`;
    root.add(mesh);
    const s = geo.boundingBox.getSize(new THREE.Vector3());
    report.push({ n: `furniture/${p.id}`, s: [+s.x.toFixed(3), +s.y.toFixed(3), +s.z.toFixed(3)], tris: pos.length / 9, cell: [col, row] });
  }

  const glb = await new Promise((res, rej) => new GLTFExporter().parse(root, res, rej, { binary: true, onlyVisible: false }));
  let bin = ''; const u8 = new Uint8Array(glb); const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));

  const px = ctx.getImageData(0, 0, atlas.width, atlas.height).data;
  let rgba = ''; for (let i = 0; i < px.length; i += CH) rgba += String.fromCharCode.apply(null, px.subarray(i, i + CH));

  return { glb: btoa(bin), rgba: btoa(rgba), w: atlas.width, h: atlas.height, report };
}, { port, payload, CELL });

// ------------------------------------------------------------------------- emit the modules
const glb = Buffer.from(result.glb, 'base64');
const glbGz = zlib.gzipSync(glb, { level: 9 });
const rgba = Buffer.from(result.rgba, 'base64');
const texGz = zlib.gzipSync(rgba, { level: 9 });
const names = PIECES.join(', ');

fs.writeFileSync(`${OUT}/furnitureModel.js`,
`// GENERATED - do not edit by hand. See tools/props-import/furniture.mjs.
// Dungeon Crawlers "Static Objects / Furniture Etc" (${names}) as one glTF binary, gzipped then
// base64'd so it survives the single-file artifact build. Inflated by render/props/models.js.
export const FURNITURE_GLB_GZ_B64 = '${glbGz.toString('base64')}';
export const FURNITURE_GLB_BYTES = ${glb.length};
`);

fs.writeFileSync(`${OUT}/furnitureAtlas.js`,
`// GENERATED - do not edit by hand.
// ${result.w}x${result.h} raw RGBA (${CELL} per piece), gzipped and base64'd. Raw rather than PNG for
// the same reason as propsAtlas.js: a DataTexture needs no Image, no decode and no img-src.
export const FURN_ATLAS_W = ${result.w}, FURN_ATLAS_H = ${result.h};
export const FURN_ATLAS_RGBA_GZ_B64 = '${texGz.toString('base64')}';
`);

fs.writeFileSync(`${OUT}/furnitureIndex.js`,
`// GENERATED - do not edit by hand. Name and world-unit size of every piece in furnitureModel.js.
export const FURNITURE_INDEX = ${JSON.stringify(result.report.map((r) => ({ n: r.n, s: r.s })))};
`);

const kb = (n) => (n / 1024).toFixed(0) + 'KB';
for (const r of result.report) console.log(`  ${r.n.padEnd(24)} ${r.tris} tris  ${r.s.join(' x ')} tiles  cell ${r.cell}`);
console.log(`furnitureModel.js  ${kb(glbGz.length * 1.34)}  (glb ${kb(glb.length)} -> gz ${kb(glbGz.length)})`);
console.log(`furnitureAtlas.js  ${kb(texGz.length * 1.34)}  (${result.w}x${result.h} rgba ${kb(rgba.length)} -> gz ${kb(texGz.length)})`);

await b.close();
srv.close();
