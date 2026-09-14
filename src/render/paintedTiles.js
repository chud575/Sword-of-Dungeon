// paintedTiles: the hand-painted dungeon tiles (src/assets/tiles/painted), decoded once at startup
// into plain pixel arrays that floorField.js copies into the level's floor field.
//
// The field painter is pure and runs in node for the tests and tools/fieldpreview.mjs, where there is
// no image decoder. So nothing here runs at import time: the URLs are plain strings, and `PAINTED`
// stays null until `loadPaintedTiles()` has run in a browser. A null `PAINTED` means "paint the
// procedural stone", which is exactly what node gets.
//
// `?tiles=0` keeps the procedural stone in the browser too, for side-by-side comparison.

const SETS = {
  floor: ['floor_flagstone_01', 'floor_flagstone_02', 'floor_flagstone_03', 'floor_flagstone_04'],
  wall: ['walltop_01', 'walltop_02', 'walltop_03', 'walltop_04'],
  corridor: ['corridor_floor_01', 'corridor_floor_02', 'corridor_floor_03', 'corridor_floor_04'],
  overlay: ['overlay_bones_01', 'overlay_blood_01', 'overlay_crack_01', 'overlay_rubble_01'],
  // seamless flagstone fields that run continuously across a room, FIELD_TILES tiles to a repeat
  // (floor_field_05 and _06 show a seam when tiled, so they are left out until repaired)
  field: ['floor_field_01', 'floor_field_02', 'floor_field_03', 'floor_field_04'],
};

/** Tiles covered by one repeat of a `field` texture. At 3 its stones are about half a tile, as in the benchmark. */
export const FIELD_TILES = 3;

/**
 * THE DUNGEON CRAWLERS TILE SETS (`?tiles=dc`): the floor atlases from the user's earlier game, one per dungeon level.
 * Each strip (src/assets/tiles/dc/atlasN.png) is three rows of eight 128-pixel tiles — six floor materials, the left
 * and right four of each row, four variants apiece. `DC[n]` is `[material][variant] -> tile`, or null when atlas n
 * is not there; it stays null outside `?tiles=dc`.
 * @type {null | (null | object[][])[]}
 */
export let DC = null;
const DC_ATLASES = [1, 2, 3, 4, 5];
/**
 * Per-material tone, measured on the strips: materials ran from luminance 0.25 (dark planks, murky stone) to 0.59 and
 * chroma 0.004 to 0.44 (gold blocks, terracotta). `lum` is where a dark material is lifted toward, `maxGain` caps it,
 * `chroma` is the most saturation a material keeps.
 */
export const DC_TONE = { lum: 0.42, maxGain: 1.5, chroma: 0.24, warmChroma: 0.12 };
/** Material 5 in every atlas is a brick or cobble run (yellow, grey, mossy, cobble, blue brick): it paves the corridors. */
export const DC_CORRIDOR = 5;
/**
 * THE CIRCLE SETS: materials whose four variants are the four quarters of one circle, so they must be laid as a 2×2
 * block, never at random. `DC_CIRCLES[atlas][material]` is the variant index for [top-left, top-right, bottom-left,
 * bottom-right]. Found by measuring which corner each tile's rings are centred on (a quarter-circle tile's centre is
 * the corner it meets the other three at), confirmed by eye: atlas 1's mauve rosette mosaic is the only one — its
 * variant 1 has the centre bottom-right, 2 top-right, 3 top-left, 4 bottom-left.
 */
export const DC_CIRCLES = { 1: { 4: [0, 3, 1, 2] } };

const urlOf = (name) => new URL(`../assets/tiles/painted/${name}.png`, import.meta.url).href;

/**
 * The decoded tiles, or null when they are not loaded (node, `?tiles=0`, or a failed decode).
 * Each entry is `{ size, rgb: Float32Array(size*size*3) in 0..1 display space, a: Float32Array(size*size) }`.
 * @type {null | {size:number, floor:object[], wall:object[], corridor:object[], overlay:object[]}}
 */
export let PAINTED = null;

/**
 * Decode every painted tile at `size` texels a side (the field's texels per tile).
 * Resolves quietly to null on any failure, so the game falls back to procedural stone rather than
 * failing to start.
 * @param {number} size
 */
export async function loadPaintedTiles(size = 64) {
  const tileSize = size;
  if (typeof document === 'undefined') return null;
  const params = new URLSearchParams(location.search);
  if (params.get('tiles') === '0') return null;
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const decode = async (name, keepAspect, size = tileSize) => {
      const img = new Image();
      img.src = urlOf(name);
      await img.decode();
      if (canvas.width !== size) { canvas.width = canvas.height = size; }
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, size, size);
      // a floor tile fills its square; an overlay keeps its proportions, centred with a clear margin
      if (keepAspect) {
        const k = size / Math.max(img.naturalWidth, img.naturalHeight);
        const w = img.naturalWidth * k, h = img.naturalHeight * k;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      } else ctx.drawImage(img, 0, 0, size, size);
      const d = ctx.getImageData(0, 0, size, size).data;
      const rgb = new Float32Array(size * size * 3), a = new Float32Array(size * size);
      for (let i = 0; i < size * size; i++) {
        rgb[i * 3] = d[i * 4] / 255; rgb[i * 3 + 1] = d[i * 4 + 1] / 255; rgb[i * 3 + 2] = d[i * 4 + 2] / 255;
        a[i] = d[i * 4 + 3] / 255;
      }
      return { size, rgb, a };
    };
    const out = { size };
    for (const [set, names] of Object.entries(SETS)) out[set] = [];
    for (const [set, names] of Object.entries(SETS)) for (const name of names) out[set].push(await decode(name, set === 'overlay', set === 'field' ? tileSize * FIELD_TILES : tileSize));
    PAINTED = out;
    if (params.get('tiles') !== 'painted') {
      canvas.width = canvas.height = tileSize;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      DC = [];
      for (const n of DC_ATLASES) {
        const img = new Image();
        img.src = new URL(`../assets/tiles/dc/atlas${n}.png`, import.meta.url).href;
        try { await img.decode(); } catch { DC[n] = null; continue; }
        // the atlas's own normal map, painted for the same cells; without it the relief falls back to the painted value
        const nimg = new Image();
        nimg.src = new URL(`../assets/tiles/dc/atlas${n}_nrm.png`, import.meta.url).href;
        let hasN = true;
        try { await nimg.decode(); } catch { hasN = false; }
        const N = tileSize * tileSize;
        const cell = (src, sx, sy) => {
          ctx.clearRect(0, 0, tileSize, tileSize);
          ctx.drawImage(src, sx, sy, 128, 128, 0, 0, tileSize, tileSize);
          return ctx.getImageData(0, 0, tileSize, tileSize).data;
        };
        const mats = [];
        for (let r = 0; r < 3; r++) for (let side = 0; side < 2; side++) {
          const vars = [];
          let lum = 0, chr = 0, warmth = 0;
          for (let v = 0; v < 4; v++) {
            const sx = (side * 4 + v) * 128, sy = r * 128;
            const d = cell(img, sx, sy);
            const rgb = new Float32Array(N * 3), a = new Float32Array(N).fill(1);
            for (let i = 0; i < N; i++) {
              const R = d[i * 4] / 255, G = d[i * 4 + 1] / 255, B = d[i * 4 + 2] / 255;
              rgb[i * 3] = R; rgb[i * 3 + 1] = G; rgb[i * 3 + 2] = B;
              lum += 0.2126 * R + 0.7152 * G + 0.0722 * B; chr += Math.max(R, G, B) - Math.min(R, G, B); warmth += R - B;
            }
            let nrm = null;
            if (hasN) {
              // painted OpenGL-style (green = facing up the image); the field's +v runs DOWN the image, so green flips
              const e = cell(nimg, sx, sy);
              nrm = new Uint8Array(N * 3);
              for (let i = 0; i < N; i++) { nrm[i * 3] = e[i * 4]; nrm[i * 3 + 1] = 255 - e[i * 4 + 1]; nrm[i * 3 + 2] = Math.max(1, e[i * 4 + 2]); }
            }
            vars.push({ size: tileSize, rgb, a, n: nrm });
          }
          // MATERIAL TONE: a murky material is lifted toward DC_TONE.lum (capped), and a very saturated one is pulled
          // back toward DC_TONE.chroma so a warm torch lights it as a pool rather than a solid orange block
          lum /= 4 * N; chr /= 4 * N; warmth /= 4 * N;
          const gain = Math.min(DC_TONE.maxGain, Math.max(1, Math.pow(DC_TONE.lum / Math.max(1e-3, lum), 0.8)));
          // a warm (orange / red) material sits under a warm torch, which doubles its colour: it keeps less of it
          const cap = warmth > 0.08 ? DC_TONE.warmChroma : DC_TONE.chroma;
          const sat = Math.min(1, cap / Math.max(1e-3, chr));
          if (gain !== 1 || sat !== 1) {
            for (const t of vars) for (let i = 0; i < N; i++) {
              const R = t.rgb[i * 3], G = t.rgb[i * 3 + 1], B = t.rgb[i * 3 + 2], y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
              t.rgb[i * 3] = Math.min(1, (y + (R - y) * sat) * gain);
              t.rgb[i * 3 + 1] = Math.min(1, (y + (G - y) * sat) * gain);
              t.rgb[i * 3 + 2] = Math.min(1, (y + (B - y) * sat) * gain);
            }
          }
          mats.push(vars);
        }
        DC[n] = mats;
      }
    }
  } catch (e) {
    console.warn('painted tiles failed to load; using procedural stone', e);
    PAINTED = null;
  }
  return PAINTED;
}
