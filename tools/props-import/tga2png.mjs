// Decode the uncompressed 32-bit TGA atlas and box-filter it down to a PNG we can look at.
import fs from 'node:fs';
import zlib from 'node:zlib';
const buf = fs.readFileSync('x/Models/Textures/entourage_set_01_atlas_4096.tga');
const idLen = buf[0], type = buf[2];
const W = buf.readUInt16LE(12), H = buf.readUInt16LE(14), bpp = buf[16], desc = buf[17];
console.log(`TGA type=${type} ${W}x${H} ${bpp}bpp descriptor=0x${desc.toString(16)}`);
const off = 18 + idLen, px = bpp / 8;
const topDown = (desc & 0x20) !== 0;
const OUT = Number(process.argv[2] || 1024), s = W / OUT;
const rows = [];
for (let y = 0; y < OUT; y++) {
  const row = Buffer.alloc(1 + OUT * 4); row[0] = 0; // filter: none (RGBA)
  for (let x = 0; x < OUT; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let sy = 0; sy < s; sy += 2) for (let sx = 0; sx < s; sx += 2) {
      const srcY = topDown ? (y * s + sy) : (H - 1 - (y * s + sy));
      const i = off + ((srcY * W) + (x * s + sx)) * px;
      b += buf[i]; g += buf[i + 1]; r += buf[i + 2]; a += (px === 4 ? buf[i + 3] : 255); n++;   // TGA is BGRA
    }
    row[1 + x * 4] = r / n; row[2 + x * 4] = g / n; row[3 + x * 4] = b / n; row[4 + x * 4] = a / n;
  }
  rows.push(row);
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(td) >>> 0 : crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
};
function crc32(b){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c;}let x=-1;for(let i=0;i<b.length;i++)x=t[(x^b[i])&255]^(x>>>8);return(x^-1)>>>0;}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(OUT,0); ihdr.writeUInt32BE(OUT,4); ihdr[8]=8; ihdr[9]=6; // 8-bit RGBA
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',ihdr),
  chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), {level:9})), chunk('IEND', Buffer.alloc(0))]);
fs.writeFileSync(process.argv[3] || 'atlas.png', png);
console.log('wrote', process.argv[3] || 'atlas.png', png.length, 'bytes');
