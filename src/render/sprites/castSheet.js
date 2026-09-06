// castSheet: the imported character sheet, served to the renderer as ordinary sprite builders.
//
// WHY THIS LOOKS LIKE THE PAINTED BUILDERS BUT ISN'T ONE
// Every other sprite in this game is painted here in code as a PALETTE-INDEXED buffer: `pix.d` holds
// one key byte per texel and `spriteSheet.toRGBA` looks each key up. That is what makes the ramp
// discipline in sprites/style.js enforceable. An imported bitmap has no palette — the source is an
// anti-aliased illustration with thousands of colours (measured: 99.4% of its horizontal colour runs
// are one pixel long) — so these frames carry their own `rgba` and `packSheet` uses it directly.
// `pix.d` is still filled in, as a 0/1 occupancy mask, because `footMetrics` reads it to place the
// contact shadow under the figure's actual feet.
//
// WHY THE ATLAS IS NOT GZIPPED
// `CharacterFactory` calls a builder synchronously the first time an entity of that type appears.
// The gzipped assets elsewhere in src/assets are inflated behind an async loader, which a builder
// cannot await, so this atlas ships as plain base64 and is decoded once with atob().
//
// ONE POSE. The source sheet has a single drawing per character, so every clip and every facing is
// that one frame: the cast no longer animates. That is a property of the art, not of this file —
// give it more frames per row and the same builders will play them.
import { CAST_ATLAS_W, CAST_RECTS, CAST_RGBA_B64 } from '../../assets/castSheet.js';
import { CAST_MAP } from './castMap.js';
import { MONSTERS_BY_TYPE } from '../../game/monsters.js';

/** Clips the character factory asks for; all of them get the same still. */
const CLIPS = ['idle', 'walk', 'attack', 'hurt', 'cast'];
/** Facings the sheet packer lays out (west is mirrored from east downstream). */
const FACINGS = ['S', 'E', 'N'];
/** `toRGBA` is never reached for these frames, but `packSheet` still reads `built.palette`. */
const NO_PALETTE = { get: () => [255, 0, 255] };

let atlas = null;
const cache = new Map();

/** Decode the atlas once. */
function pixels() {
  if (atlas) return atlas;
  const bin = atob(CAST_RGBA_B64);
  const out = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  atlas = out;
  return atlas;
}

/** One sprite lifted out of the atlas as a frame `packSheet` understands. @returns {object|null} */
function frameFor(name) {
  if (cache.has(name)) return cache.get(name);
  const r = CAST_RECTS.find((q) => q.n === name);
  if (!r) { cache.set(name, null); return null; }
  const src = pixels();
  const rgba = new Uint8ClampedArray(r.w * r.h * 4);
  const d = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const si = ((r.y + y) * CAST_ATLAS_W + (r.x + x)) * 4, di = (y * r.w + x) * 4;
      rgba[di] = src[si]; rgba[di + 1] = src[si + 1]; rgba[di + 2] = src[si + 2]; rgba[di + 3] = src[si + 3];
      d[y * r.w + x] = src[si + 3] > 8 ? 1 : 0;
    }
  }
  const frame = { w: r.w, h: r.h, d, rgba };
  cache.set(name, frame);
  return frame;
}

/**
 * A builder for one entity type, in the shape `packSheet` and `SpriteBillboard` already take.
 * @param {string} type a key of CAST_MAP
 * @returns {(() => object)|null} null when the sheet has no sprite for this type
 */
export function castBuilder(type) {
  const name = CAST_MAP[type];
  const frame = name ? frameFor(name) : null;
  if (!frame) return null;
  return () => {
    const anims = {};
    for (const clip of CLIPS) {
      anims[clip] = {};
      for (const f of FACINGS) anims[clip][f] = { frames: [frame], durations: [200], loop: true };
    }
    // The pivot is the bottom-centre texel, so `footMetrics` reports drop 0 and the contact shadow
    // lands under the feet rather than under the middle of the figure.
    return {
      anims, palette: NO_PALETTE, w: frame.w, h: frame.h,
      pivot: { x: (frame.w / 2) | 0, y: frame.h }, emissive: '',
      // The sheet draws every character at roughly one cell, so the size relationships the game
      // already balances (MONSTER_TABLE `size`, 0.8 for a wolf to 1.6 for a drake) have to come
      // from the table rather than from the art.
      scale: (MONSTERS_BY_TYPE[type] && MONSTERS_BY_TYPE[type].size) || 1,
    };
  };
}

/** Every monster type the sheet can draw, as a MONSTER_SPRITES-shaped map. */
export const CAST_SPRITES = Object.fromEntries(
  Object.keys(CAST_MAP)
    .filter((t) => t !== 'player')
    .map((t) => [t, castBuilder(t)])
    .filter(([, b]) => !!b),
);

/** The hero's builder, or null if the sheet has no `player` sprite. */
export const castHeroBuilder = castBuilder('player');
