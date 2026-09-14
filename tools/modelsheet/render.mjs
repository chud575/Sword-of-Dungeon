// Render every FBX in an asset tree to a thumbnail, then composite a contact sheet.
//
// Usage: node tools/modelsheet/render.mjs --root "<assets dir>" --out shots/models [--size 192]
//        [--limit N] [--filter substring] [--cols N]
//
// The models are somebody else's library (a 2015 Unity project), so nothing here assumes the game's
// conventions: it reads the texture filename OUT OF each FBX, finds that file anywhere in the tree,
// and falls back to an untextured grey render so a model with a missing atlas still shows its
// SHAPE rather than vanishing from the catalogue. Thumbnails are cached on disk, so a re-run after
// a crash costs only what it did not finish.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { parseFbx6100 } from '../props-import/fbx6100.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const ROOT = args.root;
const OUT = path.resolve(REPO, args.out || 'shots/models');
const SIZE = Number(args.size || 192);
if (!ROOT) { console.error('--root is required'); process.exit(2); }

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.tga': 'application/octet-stream', '.fbx': 'application/octet-stream', '.json': 'application/json' };
/** Serve three from the repo and the asset tree from wherever it lives. */
function serve() {
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    let file = null;
    if (url.startsWith('/three/')) file = path.join(REPO, 'node_modules/three', url.slice(7));
    else if (url.startsWith('/assets/')) file = path.join(ROOT, url.slice(8));
    else if (url === '/' || url === '/page.html') file = path.join(HERE, 'page.html');
    if (!file) { res.writeHead(404).end(); return; }
    fs.readFile(file, (e, buf) => {
      if (e) { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'access-control-allow-origin': '*' });
      res.end(buf);
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

const BAD = /shadow|_n\.|_normal|_spec|_gloss|_mask|lightmap|_ao\./i;
function index(root) {
  const models = [], byName = new Map();
  (function walk(d) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (/\.fbx$/i.test(e.name)) models.push(p);
      else if (/\.(png|tga|jpg|jpeg)$/i.test(e.name)) {
        const k = e.name.toLowerCase();
        if (!byName.has(k)) byName.set(k, []);
        byName.get(k).push(p);
      }
    }
  })(root);
  models.sort();
  const refsIn = (f) => {
    let s; try { s = fs.readFileSync(f).toString('latin1'); } catch { return []; }
    const out = []; const re = /([A-Za-z0-9_\-. ]+\.(?:tga|png|jpg|jpeg))/gi; let m;
    while ((m = re.exec(s))) { const n = m[1].trim().toLowerCase(); if (!out.includes(n)) out.push(n); }
    return out;
  };
  return models.map((mp) => {
    let tex = null;
    for (const want of refsIn(mp)) {
      if (BAD.test(want)) continue;
      const hits = byName.get(want);
      if (hits && hits.length) {
        hits.sort((a, b) => path.relative(path.dirname(mp), a).split(path.sep).length - path.relative(path.dirname(mp), b).split(path.sep).length);
        tex = hits[0]; break;
      }
    }
    if (!tex) {
      const base = path.basename(mp).replace(/\.fbx$/i, '').toLowerCase();
      for (const ext of ['png', 'tga', 'jpg', 'jpeg']) { const h = byName.get(`${base}.${ext}`); if (h && h.length) { tex = h[0]; break; } }
    }
    return { abs: mp, rel: path.relative(root, mp), tex: tex ? path.relative(root, tex) : null };
  });
}

const { srv, port } = await serve();
const base = `http://127.0.0.1:${port}`;
let list = index(ROOT);
if (args.filter) list = list.filter((m) => m.rel.toLowerCase().includes(String(args.filter).toLowerCase()));
if (args.limit) list = list.slice(0, Number(args.limit));
fs.mkdirSync(path.join(OUT, 'thumbs'), { recursive: true });
console.log(`${list.length} models | ${list.filter((m) => m.tex).length} with a texture`);

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: SIZE + 40, height: SIZE + 40 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)));
await page.goto(`${base}/page.html?size=${SIZE}`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__READY === true, null, { timeout: 60000 });

const meta = [];
let ok = 0, fail = 0;
for (let i = 0; i < list.length; i++) {
  const m = list[i];
  const key = m.rel.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  const png = path.join(OUT, 'thumbs', key + '.png');
  // A cached thumb must carry the SAME metadata a fresh one does. It used to push only
  // `{png, cached}`, so a second run silently dropped `textured`/`tris` for every model it had
  // already done — and the sheet, which coloured names by `textured`, then reported 761 of 904
  // models as untextured when the pictures plainly were not.
  const side = png.replace(/\.png$/, '.json');
  if (fs.existsSync(png)) {
    let info = {};
    try { info = JSON.parse(fs.readFileSync(side, 'utf8')); } catch { /* pre-sidecar thumb */ }
    meta.push({ ...m, png, cached: true, ...info });
    ok++; continue;
  }
  let r;
  try {
    r = await page.evaluate(([mu, tu]) => window.shot(mu, tu), [`/assets/${m.rel.split(path.sep).join('/')}`, m.tex ? `/assets/${m.tex.split(path.sep).join('/')}` : null]);
  } catch (e) { r = { error: String(e.message).slice(0, 120) }; }
  // three refuses FileVersion 6100 outright; the repo already has a reader for those, so parse the
  // file here and hand the raw arrays to the same render path.
  if (r && r.error && /6100/.test(r.error)) {
    try {
      const meshes = parseFbx6100(fs.readFileSync(m.abs, 'utf8'))
        .map((x) => ({ name: x.name, positions: x.positions, normals: x.normals, uvs: x.uvs }));
      r = await page.evaluate(([ms, tu]) => window.shotRaw(ms, tu), [meshes, m.tex ? `/assets/${m.tex.split(path.sep).join('/')}` : null]);
    } catch (e) { r = { error: '6100: ' + String(e.message).slice(0, 100) }; }
  }
  if (r && r.url) {
    fs.writeFileSync(png, Buffer.from(r.url.split(',')[1], 'base64'));
    const info = { tris: r.tris, meshes: r.meshes, textured: !!r.textured, via: r.via || 'fbx' };
    fs.writeFileSync(png.replace(/\.png$/, '.json'), JSON.stringify(info));
    meta.push({ ...m, png, ...info });
    ok++;
  } else { meta.push({ ...m, png: null, error: (r && r.error) || 'unknown' }); fail++; }
  if ((i + 1) % 25 === 0 || i === list.length - 1) process.stdout.write(`\r  ${i + 1}/${list.length}  ok ${ok}  failed ${fail}   `);
  // the page holds one model at a time, but a long run still drifts; reload periodically
  if ((i + 1) % 150 === 0) { await page.reload({ waitUntil: 'load' }); await page.waitForFunction(() => window.__READY === true); }
}
console.log('');
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(meta, null, 1));
await browser.close(); srv.close();
console.log(`thumbs: ${ok} ok, ${fail} failed -> ${OUT}/thumbs`);
if (fail) {
  const byErr = {};
  for (const m of meta) if (m.error) byErr[m.error] = (byErr[m.error] || 0) + 1;
  console.log(Object.entries(byErr).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([e, n]) => `  ${String(n).padStart(4)}  ${e}`).join('\n'));
}
