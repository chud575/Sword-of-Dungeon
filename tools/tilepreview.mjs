// Renders every tile style as a 4x4 field with its name, so palettes and patterns can be judged
// against the HeroQuest board without running the game. Usage: node tools/tilepreview.mjs [out.png]
import { launchBrowser } from './browser.mjs';
import { TILE_STYLES, paintTile } from '../src/render/tiles.js';
import fs from 'node:fs';

const S = 32, FIELD = 4, ZOOM = 2;                 // each style shown as a 4x4 tile field at 2x
const ids = Object.keys(TILE_STYLES);
const COLS = 6, ROWS = Math.ceil(ids.length / COLS);
const CW = S * FIELD * ZOOM, CH = S * FIELD * ZOOM + 22;

// paint every style into its own RGBA block
const blocks = ids.map((id) => {
  const W = S * FIELD, H = S * FIELD;
  const alb = new Float32Array(W * H * 3), hgt = new Float32Array(W * H);
  for (let ty = 0; ty < FIELD; ty++) for (let tx = 0; tx < FIELD; tx++)
    paintTile({ alb, hgt, W, x0: tx * S, y0: ty * S, S, style: TILE_STYLES[id], seed: (ty * FIELD + tx) % 4 });
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = alb[i * 3] * 255; rgba[i * 4 + 1] = alb[i * 3 + 1] * 255;
    rgba[i * 4 + 2] = alb[i * 3 + 2] * 255; rgba[i * 4 + 3] = 255;
  }
  return { id, name: TILE_STYLES[id].name, W, H, rgba: Array.from(rgba) };
});

const b = await launchBrowser({ width: COLS * CW + 40, height: ROWS * CH + 40 });
await b.page.setContent('<body style="margin:0;background:#14121a"><canvas id=c></canvas></body>');
await b.page.evaluate(({ blocks, COLS, CW, CH, ZOOM }) => {
  const c = document.getElementById('c');
  c.width = COLS * CW + 40; c.height = Math.ceil(blocks.length / COLS) * CH + 40;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.fillStyle = '#14121a'; g.fillRect(0, 0, c.width, c.height);
  blocks.forEach((bl, i) => {
    const x = 20 + (i % COLS) * CW, y = 20 + Math.floor(i / COLS) * CH;
    const img = new ImageData(new Uint8ClampedArray(bl.rgba), bl.W, bl.H);
    const off = document.createElement('canvas'); off.width = bl.W; off.height = bl.H;
    off.getContext('2d').putImageData(img, 0, 0);
    g.drawImage(off, x, y, bl.W * ZOOM, bl.H * ZOOM);
    g.strokeStyle = '#ffffff'; g.lineWidth = 1; g.strokeRect(x + .5, y + .5, bl.W * ZOOM - 1, bl.H * ZOOM - 1);
    g.fillStyle = '#e8e2d2'; g.font = '12px monospace'; g.textAlign = 'center';
    g.fillText(bl.name, x + bl.W * ZOOM / 2, y + bl.H * ZOOM + 15);
  });
}, { blocks, COLS, CW, CH, ZOOM });
await b.page.screenshot({ path: process.argv[2] || 'shots/tile-styles.png', timeout: 120000 });
console.log('wrote', process.argv[2] || 'shots/tile-styles.png', `(${ids.length} styles)`);
await b.close();
