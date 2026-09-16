// A headless Chromium page with three.js on an import map, and a static server over a few roots.
// The importer's browser half: FBXLoader and canvas image work live in the page, the rest in node.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const THREE_DIR = path.join(REPO, 'node_modules/three');
const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.webp': 'image/webp' };

/**
 * @param {Record<string,string>} roots url prefix (no slashes) -> directory, e.g. { src: '/tmp/x' }
 * @returns {Promise<{page: import('playwright').Page, close: () => Promise<void>, base: string}>}
 */
export async function openPage(roots = {}, { width = 800, height = 800 } = {}) {
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    if (url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><meta charset="utf-8"><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script><body style="margin:0;background:#222"></body>');
      return;
    }
    let file = null;
    if (url.startsWith('/three/')) file = path.join(THREE_DIR, url.slice(7));
    else {
      const [, pre, ...rest] = url.split('/');
      if (roots[pre]) file = path.join(roots[pre], rest.join('/'));
    }
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    let body = fs.readFileSync(file);
    // three 0.170's FBXLoader dereferences a missing connection record on some Unity exports
    if (file.endsWith('FBXLoader.js')) {
      body = Buffer.from(body.toString('utf8')
        .replace('const parentConnections = connections.get( model.ID ).parents;', 'const parentConnections = ( connections.get( model.ID ) || { parents: [] } ).parents;')
        .replace('relationships.parents.forEach( function ( parent ) {', '( relationships || { parents: [] } ).parents.forEach( function ( parent ) {'));
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=8000'] });
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (e) => console.log('  pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('  console', m.text().slice(0, 200)); });
  await page.goto(base + '/', { waitUntil: 'load' });
  return { page, base, close: async () => { await browser.close(); srv.close(); } };
}
