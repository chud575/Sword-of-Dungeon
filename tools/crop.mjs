// crop.mjs out.png "label|file|x|y|w|h" ... — nearest-neighbour zoomed crops, side by side.
import { chromium } from 'playwright';
import fs from 'node:fs'; import path from 'node:path';
const OUT = process.argv[2];
const specs = process.argv.slice(3).map(s => { const [label, file, x, y, w, h] = s.split('|');
  return { label, b64: fs.readFileSync(path.resolve(file)).toString('base64'), x:+x, y:+y, w:+w, h:+h }; });
const Z = Number(process.env.ZOOM || 5);
const b = await chromium.launch();
const page = await b.newPage();
await page.addInitScript((z) => { window.__Z = z; }, Z);
await page.goto("about:blank");
const png = await page.evaluate(async (specs) => {
  const Z = Number(window.__Z || 5), PAD = 14, LAB = 26;
  const imgs = await Promise.all(specs.map(s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s.b64; })));
  const cw = specs.map(s => s.w * Z), ch = specs.map(s => s.h * Z);
  const c = document.createElement('canvas');
  c.width = cw.reduce((a,x)=>a+x,0) + PAD * (specs.length + 1);
  c.height = Math.max(...ch) + PAD * 2 + LAB;
  const g = c.getContext('2d');
  g.fillStyle = '#15151b'; g.fillRect(0,0,c.width,c.height);
  g.imageSmoothingEnabled = false;
  let x = PAD;
  for (let i = 0; i < specs.length; i++) { const s = specs[i];
    g.drawImage(imgs[i], s.x, s.y, s.w, s.h, x, PAD, cw[i], ch[i]);
    g.strokeStyle = '#3b3b47'; g.strokeRect(x - 0.5, PAD - 0.5, cw[i] + 1, ch[i] + 1);
    g.fillStyle = '#ffd98f'; g.font = '600 16px system-ui, sans-serif'; g.textBaseline = 'top';
    g.fillText(s.label, x, PAD + Math.max(...ch) + 8);
    x += cw[i] + PAD; }
  return c.toDataURL('image/png').split(',')[1];
}, specs);
fs.writeFileSync(OUT, Buffer.from(png, 'base64'));
console.log('wrote', OUT);
await b.close();
