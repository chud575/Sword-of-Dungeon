// flatsheet: the board-piece set (render/props/flatArt.js) as one labelled PNG.
// Usage: node tools/flatsheet.mjs [--out shots/flat/set.png] [--zoom 4]
// Drawn in a headless page (node has no canvas), from the art module itself — no game, no scene.
import { startServer, launchBrowser, waitReady } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]] : []).filter(Boolean));
const out = args.out || 'shots/flat/set.png';
const zoom = Number(args.zoom || 4);
const server = await startServer();
const b = await launchBrowser({ width: 1200, height: 800 });
let code = 0;
try {
  await b.page.goto(server.url + '?debug=1', { waitUntil: 'load' });
  await waitReady(b.page);
  const url = await b.page.evaluate(async (Z) => {
    const { flatProp, FLAT_TYPES } = await import('/src/render/props/flatArt.js');
    const { toRGBA } = await import('/src/render/sprites/pixelPainter.js');
    // one row per distinct piece (aliases like tableLong -> table are listed with it)
    const byArt = new Map(), alias = new Map();
    for (const t of FLAT_TYPES) {
      const a = flatProp(t, 0); if (!a) continue;
      const id = a.pix.d.join(',');
      if (byArt.has(id)) { alias.set(byArt.get(id), (alias.get(byArt.get(id)) || []).concat(t)); continue; }
      byArt.set(id, t);
    }
    const types = [...byArt.values()];
    const V = 4, CW = 46 * Z, CH = 42 * Z + 26, LEFT = 150;
    const cv = document.createElement('canvas');
    cv.width = LEFT + CW * V + 20; cv.height = 60 + CH * types.length;
    const g = cv.getContext('2d');
    g.fillStyle = '#12100f'; g.fillRect(0, 0, cv.width, cv.height);
    g.textBaseline = 'top';
    g.fillStyle = '#ece1c6'; g.font = 'bold 22px Helvetica, Arial';
    g.fillText('BOARD PIECES — the 2D prop set for ?props=flat, variant 0 → 3', 14, 14);
    g.fillStyle = '#8a8378'; g.font = '13px Helvetica, Arial';
    g.fillText('drawn front-on, three tones a material, one-texel ink line · the art box is the size on screen (32 texels = 1 tile)', 14, 38);
    types.forEach((t, row) => {
      const y0 = 60 + row * CH;
      g.fillStyle = '#ffcf8a'; g.font = 'bold 15px Helvetica, Arial';
      g.fillText(t, 12, y0 + CH / 2 - 20);
      const also = alias.get(t);
      if (also) { g.fillStyle = '#6f6a62'; g.font = '11px Helvetica, Arial'; g.fillText('= ' + also.join(', '), 12, y0 + CH / 2); }
      for (let v = 0; v < V; v++) {
        const a = flatProp(t, v); if (!a) continue;
        const { pix, pal } = a;
        const img = new ImageData(new Uint8ClampedArray(toRGBA(pix, pal)), pix.w, pix.h);
        const tmp = document.createElement('canvas'); tmp.width = pix.w; tmp.height = pix.h;
        tmp.getContext('2d').putImageData(img, 0, 0);
        const x = LEFT + v * CW, y = y0;
        g.fillStyle = '#20 1d1a'.replace(' ', ''); g.fillRect(x, y, CW - 8, CH - 12);
        g.imageSmoothingEnabled = false;
        g.drawImage(tmp, Math.round(x + (CW - 8 - pix.w * Z) / 2), Math.round(y + (CH - 34 - pix.h * Z) / 2), pix.w * Z, pix.h * Z);
        g.fillStyle = '#8a8378'; g.font = '12px Helvetica, Arial';
        g.fillText(`v${v}   ${pix.w}×${pix.h} texels`, x + 6, y + CH - 28);
      }
    });
    return cv.toDataURL('image/png');
  }, zoom);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
  console.log('wrote ' + out);
  if (b.errors.length) { console.error('PAGE ERRORS:\n' + b.errors.slice(0, 8).join('\n')); code = 1; }
} catch (e) { console.error(e); code = 1; }
finally { await b.close(); server.stop(); }
process.exit(code);
