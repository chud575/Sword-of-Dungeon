// Emit the props as plain JS modules holding gzipped base64. No fetch and no data: URIs, so the
// single-file artifact build (which forbids both) can carry them unchanged.
import fs from 'node:fs'; import zlib from 'node:zlib';
const OUT = '/home/user/Neural-Razz-Arena/fargoal/src/assets';
fs.mkdirSync(OUT, { recursive: true });

const glb = fs.readFileSync('out/props.glb');
const glbGz = zlib.gzipSync(glb, { level: 9 });
fs.writeFileSync(`${OUT}/propsModel.js`,
`// GENERATED - do not edit by hand. See tools/props-import/ for the pipeline that produced it.
// 114 dungeon props (Dungeon Crawlers entourage set) as one glTF binary, gzipped then base64'd so
// it survives the single-file artifact build. Decompressed at runtime by render/props/models.js.
export const PROPS_GLB_GZ_B64 = '${glbGz.toString('base64')}';
export const PROPS_GLB_BYTES = ${glb.length};
`);

// The atlas ships as raw RGBA rather than a PNG: a DataTexture needs no Image element, no decode
// and no img-src permission, and gzip compresses the raw bytes about as well as PNG does.
const png = fs.readFileSync('out/atlas512.png');
// decode our own PNG (8-bit RGBA, one IDAT, filter bytes per row)
const idat = [];
let p = 8, W = 0, H = 0;
while (p < png.length) {
  const len = png.readUInt32BE(p), type = png.toString('ascii', p + 4, p + 8);
  if (type === 'IHDR') { W = png.readUInt32BE(p + 8); H = png.readUInt32BE(p + 12); }
  if (type === 'IDAT') idat.push(png.subarray(p + 8, p + 8 + len));
  p += 12 + len;
}
const raw = zlib.inflateSync(Buffer.concat(idat));
const rgba = Buffer.alloc(W * H * 4);
const stride = W * 4;
for (let y = 0; y < H; y++) {
  const f = raw[y * (stride + 1)];
  const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= 4 ? rgba[y * stride + x - 4] : 0;
    const b = y > 0 ? rgba[(y - 1) * stride + x] : 0;
    const c = (x >= 4 && y > 0) ? rgba[(y - 1) * stride + x - 4] : 0;
    let v = line[x];
    if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
    else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
      v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
    rgba[y * stride + x] = v & 255;
  }
}
const texGz = zlib.gzipSync(rgba, { level: 9 });
fs.writeFileSync(`${OUT}/propsAtlas.js`,
`// GENERATED - do not edit by hand.
// The prop atlas as raw RGBA, gzipped and base64'd, downscaled from the source 4096 to ${W} so one
// texture texel lands near one sprite texel at the play camera - the cast, the floor and these props
// then share one pixel grid (see docs/AMBIENCE.md).
export const ATLAS_W = ${W}, ATLAS_H = ${H};
export const ATLAS_RGBA_GZ_B64 = '${texGz.toString('base64')}';
`);

const names = JSON.parse(fs.readFileSync('out/props.json', 'utf8')).filter((r) => !r.error)
  .map((r) => ({ n: `${r.cat}/${r.name}`, s: r.size }));
fs.writeFileSync(`${OUT}/propsIndex.js`,
`// GENERATED - do not edit by hand. Name and metre-size of every prop inside propsModel.js.
export const PROP_INDEX = ${JSON.stringify(names)};
`);
const kb = (n) => (n / 1024).toFixed(0) + 'KB';
console.log(`propsModel.js  ${kb(glbGz.length * 1.34)} (glb ${kb(glb.length)} -> gz ${kb(glbGz.length)})`);
console.log(`propsAtlas.js  ${kb(texGz.length * 1.34)} (${W}x${H} rgba ${kb(rgba.length)} -> gz ${kb(texGz.length)})`);
console.log(`propsIndex.js  ${names.length} props`);
