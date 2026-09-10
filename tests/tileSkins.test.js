// The imported tile sheet, the families cast onto the board's fields, and the turn each field takes.
//
// The interesting tests here READ THE SHEET'S OWN PIXELS rather than trusting the table: a family
// claiming to share a hue is a claim about an image, and this project's standing lesson is that
// authored values lie. The sheet is gunzipped straight out of the asset module, so this runs in
// plain node with no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { TILE_SKINS, SKIN_IDS, FAMILIES, DIRECTIONAL, skinCells, validateSkins } from '../src/render/tileSkins.js';
import { SHEET } from '../src/render/tileSheet.js';
import { TILE_STYLES, PATTERN_TURNS, styleTurns, VARIANTS } from '../src/render/tiles.js';
import { SHEET_COLS, SHEET_ROWS, SHEET_CELL, SHEET_W, SHEET_H, SHEET_RGBA_GZ_B64 } from '../src/assets/tilesheet.js';
import { TEXELS_PER_TILE } from '../src/render/materials.js';

const px = zlib.gunzipSync(Buffer.from(SHEET_RGBA_GZ_B64, 'base64'));
const C = SHEET_CELL;

/** Mean linear-ish RGB of one sheet cell. */
function cellMean(col, row) {
  let r = 0, g = 0, b = 0;
  for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
    const i = ((row * C + y) * SHEET_W + col * C + x) * 4;
    r += px[i]; g += px[i + 1]; b += px[i + 2];
  }
  const n = C * C;
  return [r / n, g / n, b / n];
}
const sat = ([r, g, b]) => { const mx = Math.max(r, g, b); return mx < 1 ? 0 : (mx - Math.min(r, g, b)) / mx; };
function hue([r, g, b]) {
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  if (d < 1) return -1;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const hueGap = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/**
 * How much more a cell changes across one axis than the other. A plank run has strong vertical
 * seams and almost no horizontal ones, so it scores high; a cobble or a speckle scores near zero.
 * Measured over the cell's interior so the tile's own dark border does not dominate.
 */
function anisotropy(col, row) {
  const L = (x, y) => { const i = ((row * C + y) * SHEET_W + col * C + x) * 4; return 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; };
  let gx = 0, gy = 0;
  for (let y = 2; y < C - 2; y++) for (let x = 2; x < C - 2; x++) {
    gx += Math.abs(L(x + 1, y) - L(x - 1, y));
    gy += Math.abs(L(x, y + 1) - L(x, y - 1));
  }
  return Math.abs(gx - gy) / Math.max(1, gx + gy);
}

const HUE_SPREAD_MAX = 30;   // degrees; measured families sit at 0-20
const ANISO_DIRECTIONAL = 0.25;  // the plank runs measure 0.31-0.59, everything else <= 0.20

test('the imported sheet is on the game\'s one pixel grid', () => {
  // CLAUDE.md rule 2. If the importer ever emits cells at the sheet's native ~96px, the floor is
  // three times the resolution of the cast standing on it and the frame reads as two art sets.
  assert.equal(SHEET_CELL, TEXELS_PER_TILE, 'a sheet cell must be exactly TEXELS_PER_TILE');
  assert.equal(SHEET_W, SHEET_COLS * SHEET_CELL);
  assert.equal(SHEET_H, SHEET_ROWS * SHEET_CELL);
  assert.equal(SHEET.cols, SHEET_COLS);
  assert.equal(SHEET.rows, SHEET_ROWS);
  assert.equal(px.length, SHEET_W * SHEET_H * 4, 'the packed sheet must decode to exactly its own size');
});

test('every skin casts every field, from families that exist on the sheet', () => {
  assert.deepEqual(validateSkins(), []);
});

test('a family is several tiles, so a room is never one tile stamped across a grid', () => {
  for (const [name, cells] of Object.entries(FAMILIES)) {
    assert.ok(cells.length >= 2, `family '${name}' has ${cells.length} cell(s)`);
    const seen = new Set(cells.map((c) => String(c)));
    assert.equal(seen.size, cells.length, `family '${name}' repeats a cell`);
  }
  // and the whole chain holds: every field of every skin resolves to more than one tile
  for (const id of SKIN_IDS) for (const style of Object.keys(TILE_STYLES)) {
    const cells = skinCells(id, style);
    assert.ok(cells && cells.length >= 2, `${id}.${style} resolves to ${cells ? cells.length : 0} tile(s)`);
  }
});

test('a family measurably shares one hue — read off the sheet, not off the table', () => {
  const bad = [];
  for (const [name, cells] of Object.entries(FAMILIES)) {
    // a near-neutral cell has no meaningful hue, so it cannot disagree with one
    const tinted = cells.map(cellMean).filter((m) => sat(m) >= 0.10).map(hue);
    let spread = 0;
    for (let i = 0; i < tinted.length; i++) for (let j = i + 1; j < tinted.length; j++) spread = Math.max(spread, hueGap(tinted[i], tinted[j]));
    if (spread > HUE_SPREAD_MAX) bad.push(`${name}: hues spread ${Math.round(spread)} degrees (max ${HUE_SPREAD_MAX})`);
  }
  assert.deepEqual(bad, []);
});

test('directional art only lands on fields that take half turns', () => {
  // The failure this catches is invisible in the table and obvious on the floor: board planks
  // running four different ways inside one room.
  for (const name of DIRECTIONAL) {
    const worst = Math.max(...FAMILIES[name].map(([c, r]) => anisotropy(c, r)));
    assert.ok(worst >= ANISO_DIRECTIONAL, `family '${name}' is declared directional but measures ${worst.toFixed(2)} — the declaration is stale`);
  }
  for (const [id, skin] of Object.entries(TILE_SKINS)) {
    for (const [style, fam] of Object.entries(skin.fields)) {
      const worst = Math.max(...FAMILIES[fam].map(([c, r]) => anisotropy(c, r)));
      if (worst < ANISO_DIRECTIONAL) continue;
      assert.equal(styleTurns(style), 2, `${id}.${style} wears '${fam}', which measures ${worst.toFixed(2)} directional, on a field that takes ${styleTurns(style)} quarter turns`);
    }
  }
});

test('a family that is not declared directional really is safe to spin', () => {
  const bad = [];
  for (const [name, cells] of Object.entries(FAMILIES)) {
    if (DIRECTIONAL.has(name)) continue;
    const worst = Math.max(...cells.map(([c, r]) => anisotropy(c, r)));
    if (worst >= ANISO_DIRECTIONAL) bad.push(`${name} measures ${worst.toFixed(2)} but is not in DIRECTIONAL`);
  }
  assert.deepEqual(bad, []);
});

test('every field pattern declares how far it turns, and coursed patterns do not spin', () => {
  const patterns = new Set(Object.values(TILE_STYLES).map((s) => s.pattern));
  for (const p of patterns) assert.ok(PATTERN_TURNS[p], `pattern '${p}' has no PATTERN_TURNS entry`);
  for (const [p, t] of Object.entries(PATTERN_TURNS)) assert.ok(t === 2 || t === 4, `pattern '${p}' turns ${t}`);
  // the three the old blanket rule was actually written for
  for (const p of ['brick', 'bars', 'basketweave']) assert.equal(PATTERN_TURNS[p], 2, `'${p}' has a course and must not take quarter turns`);
  // and the ones it was holding still for no reason
  for (const p of ['cobble', 'crackedPoly', 'speckle', 'checker']) assert.equal(PATTERN_TURNS[p], 4);
});

test('the skins are distinct castings, not the same one renamed', () => {
  assert.ok(SKIN_IDS.length >= 2);
  const key = (id) => Object.entries(TILE_SKINS[id].fields).sort().map(([k, f]) => `${k}:${f}`).join('|');
  const seen = new Map();
  for (const id of SKIN_IDS) {
    const k = key(id);
    assert.ok(!seen.has(k), `skin '${id}' is identical to '${seen.get(k)}'`);
    seen.set(k, id);
  }
});

test('a skin gives a level a spread of fields, not one family repeated', () => {
  for (const id of SKIN_IDS) {
    const fams = new Set(Object.values(TILE_SKINS[id].fields));
    assert.ok(fams.size >= 12, `skin '${id}' uses only ${fams.size} families across ${Object.keys(TILE_STYLES).length} fields`);
  }
});

test('VARIANTS is what decides how many of a family reach the atlas', () => {
  assert.ok(VARIANTS >= 2, 'a field with one variant cell cannot show a family');
});
