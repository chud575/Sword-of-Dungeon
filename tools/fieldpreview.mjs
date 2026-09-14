// fieldpreview: paint a level's floor field (render/floorField.js) in node and write it as a PNG,
// with no browser — the fast loop for judging the stone and the ground BEFORE checking them at the
// play camera (which is still the only evidence about the screen: CLAUDE.md rule 5).
// Usage: node tools/fieldpreview.mjs --seed 42 --depth 1 [--biome forest] [--crop x,y,w,h (tiles)] [--zoom 3] [--out shots/field.png]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { generateLevel } from '../src/world/generator.js';
import { paintFloorField } from '../src/render/floorField.js';
import { stoneFamily } from '../src/render/materials.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const seed = Number(args.seed || 42), depth = Number(args.depth ?? 1);
const lv = generateLevel(seed, depth, args.biome ? { biome: args.biome } : {});
const t0 = Date.now();
const f = paintFloorField(lv, { tint: lv.biome === 'forest' ? [1, 1, 1] : stoneFamily(depth).tint, moss: stoneFamily(depth).moss });
console.log(`painted ${f.TW}x${f.TH} in ${Date.now() - t0} ms`);
const [cx, cy, cw, ch] = (args.crop || `0,0,${lv.width},${lv.height}`).split(',').map(Number);
const zoom = Number(args.zoom || 1), S = f.S;
const W = cw * S * zoom, H = ch * S * zoom;
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W; x++) {
    const sx = cx * S + Math.floor(x / zoom), sy = cy * S + Math.floor(y / zoom);
    const i = sy * f.TW + sx, o = y * (W * 3 + 1) + 1 + x * 3;
    const cut = f.alpha[i] === 0;
    for (let c = 0; c < 3; c++) {
      let v = f.alb[i * 3 + c];
      if (cut) v = v * [0.35, 0.6, 1.1][c];     // show the cut-away bed as water-ish
      raw[o + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
  }
}
const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([len, td, cr]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
const out = args.out || 'shots/field.png';
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('wrote ' + out);
