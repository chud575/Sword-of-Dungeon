// floorField: the level's ground is ONE painted picture laid in world space (render/floorField.js).
// What has to hold for that to be worth doing: it is deterministic, it does not draw the 1m tile grid
// (the whole reason the floor stopped being a slab per tile), rooms and corridors still read as
// different fields, and the forest's ground is only ever cut away where there is water under it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLevel } from '../src/world/generator.js';
import { TILE } from '../src/core/constants.js';
import { paintFloorField, FIELD_S, streamFords } from '../src/render/floorField.js';
import { TEXELS_PER_TILE } from '../src/render/materials.js';
import { TILE_STYLES } from '../src/render/tiles.js';

const lum = (f, i) => f.alb[i * 3] * 0.2126 + f.alb[i * 3 + 1] * 0.7152 + f.alb[i * 3 + 2] * 0.0722;

test('the field is painted on the one pixel grid', () => {
  // The clean stone is painted at a whole MULTIPLE of the texel grid (64 = 2 x 32 texels a tile): the shader
  // snaps its lookup to the same multiple (materials.js uFieldScale), so a field texel is still a whole number
  // of device pixels. The atlas cell (FIELD_S) stays one tile of TEXELS_PER_TILE.
  assert.equal(FIELD_S, TEXELS_PER_TILE);
  const lv = generateLevel(42, 3);
  const f = paintFloorField(lv);
  assert.ok(f.S % TEXELS_PER_TILE === 0 && f.S >= TEXELS_PER_TILE, `field density ${f.S} is not a whole multiple of ${TEXELS_PER_TILE}`);
  assert.equal(f.TW, lv.width * f.S);
  assert.equal(f.TH, lv.height * f.S);
});

test('a seed paints the same field every time', () => {
  for (const [seed, depth, biome] of [[42, 1], [907, 14], [5, 1, 'forest']]) {
    const a = paintFloorField(generateLevel(seed, depth, biome ? { biome } : {}));
    const b = paintFloorField(generateLevel(seed, depth, biome ? { biome } : {}));
    assert.deepEqual(a.alb, b.alb, `albedo differs seed=${seed}`);
    assert.deepEqual(a.alpha, b.alpha, `alpha differs seed=${seed}`);
    for (let i = 0; i < a.alb.length; i += 997) assert.ok(Number.isFinite(a.alb[i]) && a.alb[i] >= 0 && a.alb[i] <= 1.2);
  }
});

test('the 1m tile grid is not drawn: a tile edge is no darker than the body of the floor, in columns or rows', () => {
  // Fold the luminance of every interior room/corridor texel by its position inside its tile. A slab
  // per tile put a dark joint on every edge (seam dip 30-58% measured off the frame); stones laid over
  // the whole room put their joints anywhere, so the fold is flat.
  for (const [seed, depth] of [[42, 1], [42, 4], [1, 9], [88888, 18]]) {
    const lv = generateLevel(seed, depth);
    const f = paintFloorField(lv);
    const S = f.S, acc = new Float64Array(S), n = new Float64Array(S), accR = new Float64Array(S), nR = new Float64Array(S);
    for (let y = 1; y < lv.height - 1; y++) for (let x = 1; x < lv.width - 1; x++) {
      const t = lv.get(x, y);
      if (t === TILE.WALL || t === TILE.WATER) continue;
      let inner = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (lv.get(x + dx, y + dy) !== t) inner = false;
      if (!inner) continue;
      for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
        const i = (y * S + py) * f.TW + x * S + px;
        const l = lum(f, i);
        acc[px] += l; n[px]++; accR[py] += l; nR[py]++;
      }
    }
    // Courses that all end on the tile line show up in the ROW fold only (review-01 F3), so both are held.
    for (const [axis, a, c] of [['columns', acc, n], ['rows', accR, nR]]) {
      const prof = Array.from(a, (v, i) => v / Math.max(1, c[i]));
      const body = [...prof].sort((p, q) => p - q)[S >> 1];
      const edge = Math.min(prof[0], prof[S - 1]);
      assert.ok((body - edge) / body <= 0.12, `seed=${seed} depth=${depth} ${axis}: tile edge ${(100 * (body - edge) / body).toFixed(1)}% darker than the floor`);
    }
  }
});

test('laid stone reads as flags, not brick laid flat: no long bed joints, no full-width courses', () => {
  // review-04. The r4 coursed bond (which the test here used to pin, as "vertical continuation <= 1.25") read as
  // brick laid flat: horizontal joint runs 2-2.4x the vertical ones and full-width courses on a fifth of the rows.
  // The references sit at a run ratio of 0.85-1.45 with no full courses, and so does the restored ashlar. Checked on
  // the laid-stone patterns only; planks, bar fields, checkers and crossed squares are directional by design.
  const LAID = new Set(['grid', 'bigSlab', 'speckle', 'brick', 'cobble', 'diamond']);
  for (const [seed, depth] of [[42, 1], [42, 3], [42, 9], [42, 18], [1, 9], [88888, 14], [7, 4]]) {
    const lv = generateLevel(seed, depth), f = paintFloorField(lv), S = f.S, TW = f.TW;
    for (const r of lv.rooms) {
      const st = TILE_STYLES[r.tileStyle];
      if (!st || !LAID.has(st.pattern) || r.w < 5 || r.h < 4) continue;
      const x0 = (r.x + 1) * S, y0 = (r.y + 1) * S, w = (r.w - 2) * S, h = (r.h - 2) * S;
      const J = (i, j) => f.hgt[(y0 + j) * TW + x0 + i] < 0.2;
      const runs = (len, get) => { const out = []; let k = 0; for (let t = 0; t <= len; t++) { if (t < len && get(t)) k++; else { if (k >= 2) out.push(k); k = 0; } } return out; };
      const hj = [], vj = [];
      let full = 0;
      for (let j = 0; j < h; j++) { hj.push(...runs(w, (i) => J(i, j))); let c = 0; for (let i = 0; i < w; i++) c += J(i, j); if (c >= 0.55 * w) full++; }
      for (let i = 0; i < w; i++) vj.push(...runs(h, (j) => J(i, j)));
      const mean = (a) => a.reduce((p, q) => p + q, 0) / Math.max(1, a.length);
      if (!hj.length || !vj.length) continue;
      const hv = mean(hj) / mean(vj);
      assert.ok(hv <= 1.5, `seed=${seed} depth=${depth} ${r.tileStyle}: horizontal joint runs ${hv.toFixed(2)}x the vertical`);
      assert.ok(full / h <= 0.05, `seed=${seed} depth=${depth} ${r.tileStyle}: ${(100 * full / h).toFixed(1)}% of rows are a full-width course`);
    }
  }
});

test('stones have joints: the floor is laid stone, not a flat fill', () => {
  const lv = generateLevel(42, 4);
  const f = paintFloorField(lv);
  let dark = 0, total = 0;
  for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) {
    if (lv.get(x, y) !== TILE.CORRIDOR) continue;
    for (let py = 0; py < f.S; py++) for (let px = 0; px < f.S; px++) {
      const i = (y * f.S + py) * f.TW + x * f.S + px;
      total++; if (f.hgt[i] < 0.2) dark++;
    }
  }
  // several stones a tile: joints are a real share of the floor, but never most of it
  assert.ok(dark / total > 0.08 && dark / total < 0.4, `joint share ${(dark / total).toFixed(3)}`);
});

test('the forest ground is cut away only over water and its fords', () => {
  for (const seed of [3, 4, 5, 6, 7]) {
    const lv = generateLevel(seed, 1, { biome: 'forest' });
    const f = paintFloorField(lv);
    const S = f.S;
    // a ford (streamFords) is shallow water with stepping stones over the dry cut a glade makes in the stream
    const fords = new Set(streamFords(lv).map((t) => t.y * lv.width + t.x));
    let cut = 0;
    for (let ty = 0; ty < f.TH; ty++) for (let tx = 0; tx < f.TW; tx++) {
      if (f.alpha[ty * f.TW + tx]) continue;
      cut++;
      const x = (tx / S) | 0, y = (ty / S) | 0;
      let wet = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (lv.inBounds(x + dx, y + dy) && (lv.get(x + dx, y + dy) === TILE.WATER || fords.has((y + dy) * lv.width + x + dx))) wet = true;
      assert.ok(wet, `seed ${seed}: ground cut at tile ${x},${y} with no water beside it`);
    }
    const water = lv.tiles.filter((t) => t === TILE.WATER).length;
    if (water) assert.ok(cut > water * S * S * 0.4, `seed ${seed}: the stream barely shows (${cut} texels for ${water} water tiles)`);
  }
});
