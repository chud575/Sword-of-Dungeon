// App icon: renders the vellum-theme "F" plate in headless Chromium and writes the icon set.
//   node tools/appicon.mjs
// Writes a 1024x1024 opaque PNG into the iOS AppIcon asset catalog, and the 180/192/512 PNGs the
// home-screen web app uses into public/icons/. No transparency anywhere: iOS rejects an alpha icon.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataUri = (rel, mime) => `data:${mime};base64,${fs.readFileSync(path.join(ROOT, rel)).toString('base64')}`;
const font = dataUri('src/assets/fonts/PirataOne-Regular.woff2', 'font/woff2');
const wear = dataUri('src/assets/ui/vellum-wear.png', 'image/png');
const burn = dataUri('src/assets/ui/vellum-burn.png', 'image/png');

const html = `<!doctype html><html><head><style>
@font-face { font-family: 'Pirata One'; src: url(${font}) format('woff2'); }
html, body { margin: 0; width: 1024px; height: 1024px; background: #1a120a; overflow: hidden; }
.plate { position: absolute; inset: 0; background: #1a120a; }
/* the vellum scrap: paper colour, the burn vignette stretched over it, the wear texture tiled */
.vellum {
  position: absolute; inset: 58px;
  background-color: #c9ad76;
  background-image: url(${burn}), url(${wear}), radial-gradient(ellipse at 30% 25%, rgba(255, 240, 205, .35), transparent 60%);
  background-size: 100% 100%, 100% 100%, 100% 100%;
  background-position: center, center, center;
  box-shadow: inset 0 0 90px 14px rgba(58, 30, 10, .55);
  clip-path: polygon(0 3%, 4% 0, 28% 1.2%, 52% 0, 77% 1.6%, 96% 0, 100% 4%, 98.8% 30%, 100% 55%, 98.6% 80%, 100% 96%, 96% 100%, 72% 98.6%, 48% 100%, 24% 98.8%, 4% 100%, 0 96%, 1.4% 70%, 0 45%, 1.2% 20%);
}
.rule { position: absolute; left: 150px; right: 150px; height: 6px; background: #3a2a16; opacity: .85; }
.rule.t { top: 168px; } .rule.b { bottom: 176px; }
.f {
  position: absolute; inset: 0; display: grid; place-items: center;
  font: 400 760px/1 'Pirata One', serif; color: #8a2f1c;
  text-shadow: 0 0 2px rgba(46, 33, 18, .55), 0 6px 0 rgba(46, 33, 18, .18);
  transform: translate(8px, 18px) rotate(-2deg);
}
.sword { position: absolute; left: 50%; top: 110px; bottom: 120px; width: 0; }
</style></head><body><div class="plate"></div><div class="vellum"></div><div class="rule t"></div><div class="rule b"></div><div class="f">F</div></body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.evaluate(() => document.fonts.check("400 100px 'Pirata One'"));
  if (!ok) throw new Error('Pirata One did not load');
  // JPEG round trip is not needed: omitBackground false + an opaque body gives an opaque PNG
  const png = await page.screenshot({ type: 'png', omitBackground: false });
  const ios = path.join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
  if (fs.existsSync(path.dirname(ios))) { fs.writeFileSync(ios, png); console.log('wrote', path.relative(ROOT, ios)); }
  fs.mkdirSync(path.join(ROOT, 'public/icons'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'public/icons/icon-1024.png'), png);
  for (const s of [180, 192, 512]) {
    const p = await browser.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 });
    await p.setContent(`<html><body style="margin:0;background:#1a120a"><img src="data:image/png;base64,${png.toString('base64')}" style="width:${s}px;height:${s}px;display:block"></body></html>`, { waitUntil: 'load' });
    const out = path.join(ROOT, `public/icons/icon-${s}.png`);
    fs.writeFileSync(out, await p.screenshot({ type: 'png' }));
    console.log('wrote', path.relative(ROOT, out));
    await p.close();
  }
} finally { await browser.close(); }
