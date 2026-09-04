// ASCII dump of a generated level with its ambience marked, so placement can be judged without a
// renderer (docs/AMBIENCE.md §10 still requires the frame; this is for reading the grammar).
// Usage: node tools/decordump.mjs [--seed 42] [--depth 3] [--seeds 42,7] [--depths 1,9] [--stats-only] [--legend]
// Terrain: '#' rock face, ' ' deep rock, '.' floor, ',' corridor, '+' door, '~' water, '%' rubble,
//          'O' pit, '<' up, '>' down, 'T' temple, '$' gold, '?' hidden square, 'x' trap.
// Decor:   UPPERCASE = standing prop, lowercase = floor decal, '"' = wall-mounted piece,
//          a boxed letter (inverse in the legend) marks a BLOCKING prop.
import { generateLevel } from '../src/world/generator.js';
import { TILE } from '../src/core/constants.js';
import { DECOR_TYPES } from '../src/world/generator.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--')
  ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const seeds = String(args.seeds || args.seed || '42').split(',').map(Number);
const depths = String(args.depths || args.depth || '3').split(',').map(Number);

const TERRAIN = { [TILE.FLOOR]: '.', [TILE.CORRIDOR]: ',', [TILE.STAIRS_DOWN]: '>', [TILE.STAIRS_UP]: '<',
  [TILE.PIT]: 'O', [TILE.TEMPLE]: 'T', [TILE.WATER]: '~', [TILE.DOOR]: '+', [TILE.RUBBLE]: '%' };

/** One glyph per decor type: props get a letter, decals a lowercase letter, wall pieces a quote. */
export const DECOR_GLYPH = {
  // standing props: capitals, digits and a few brackets (never a terrain or item glyph)
  strongbox: 'X', bookcase: 'B', cupboard: 'P', lectern: 'L', table: 'A', tableLong: 'A', bench: 'E',
  stool: 'e', throne: 'H', sarcophagus: 'S', tombSlab: 'D', urn: 'U', alchemyBench: '{', retortStand: 'R',
  scales: '}', cauldron: 'Q', brazier: 'Z', hearth: 'F', forge: 'G', anvil: 'N', weaponRack: 'W',
  shieldStand: 'V', armourStand: 'M', barrel: 'J', crate: 'K', sackPile: 'Y', bunk: 'I', footlocker: ']',
  rack: '&', chainPost: '|', cage: '[', wellHead: '0', pillarBroken: '1', fallenColumn: '2',
  rubbleMound: '3', stalagmite: '4', dripstone: '5', mushroomCluster: '6', candlestick: 'i',
  candelabra: 'y', skull: '9', skullPile: '8', bonePile: '7', rat: 'r', bottles: 'b', tankards: 'u', dice: 'd',
  // floor decals: lower case and punctuation
  bones: ':', scree: '\u00b7', puddle: 'w', bloodstain: ';', scorch: '^', crackedFlags: '/', mosaic: 'm',
  rug: '=', runner: '-', chalkSigil: '@', spill: 's', ashBed: 'z', coins: 'c', sporePatch: 'g',
  lichen: 'l', rime: 'v', drainGrate: 'n',
};

export function decorDump(lv) {
  const grid = [];
  for (let y = 0; y < lv.height; y++) {
    const row = [];
    for (let x = 0; x < lv.width; x++) {
      const t = lv.get(x, y);
      let ch;
      if (t === TILE.WALL) {
        let exposed = false;
        for (let dy = -1; dy <= 1 && !exposed; dy++) for (let dx = -1; dx <= 1; dx++) if (lv.isWalkable(x + dx, y + dy) || lv.decorBlocked(x + dx, y + dy)) { exposed = true; break; }
        ch = exposed ? '#' : ' ';
      } else ch = TERRAIN[t] || '?';
      const it = lv.items.find((i) => i.x === x && i.y === y);
      if (it) ch = it.type === 'sword' ? '!' : it.type === 'gold' ? (it.hidden ? '*' : '$') : it.type === 'chest' ? (it.hidden ? '?' : 'C') : 'i';
      if (lv.trapAt(x, y)) ch = 'x';
      row.push(ch);
    }
    grid.push(row);
  }
  // decor last so it wins the tile; a blocking piece is shown in [brackets] by the stats line
  for (const d of lv.decor) {
    const cls = DECOR_TYPES[d.type].cls;
    const g = DECOR_GLYPH[d.type] || (cls === 'wall' ? '"' : '?');
    grid[d.y][d.x] = cls === 'wall' ? '"' : g;
  }
  return grid.map((r) => r.join('')).join('\n');
}

/** Per-room and per-level ambience stats. */
export function decorStats(lv) {
  const byClass = { prop: 0, decal: 0, wall: 0 };
  for (const d of lv.decor) byClass[DECOR_TYPES[d.type].cls]++;
  const corridor = lv.decor.filter((d) => lv.get(d.x, d.y) === TILE.CORRIDOR
    || (DECOR_TYPES[d.type].cls === 'wall' && !lv.rooms.some((r) => d.x >= r.x - 1 && d.y >= r.y - 1 && d.x <= r.x + r.w && d.y <= r.y + r.h))).length;
  const archetypes = {};
  for (const r of lv.rooms) archetypes[r.archetype] = (archetypes[r.archetype] || 0) + 1;
  return { pieces: lv.decor.length, ...byClass, blocking: lv.decor.filter((d) => d.blocking).length,
    corridor, archetypes, rooms: lv.rooms.length, debug: lv.debug.decor };
}

/** One line per room: what it is, how ruined, and what stands in it. */
export function roomLines(lv) {
  return lv.rooms.map((r) => {
    const inside = lv.decor.filter((d) => d.x >= r.x - 1 && d.y >= r.y - 1 && d.x <= r.x + r.w && d.y <= r.y + r.h);
    const counts = {};
    for (const d of inside) counts[d.type] = (counts[d.type] || 0) + 1;
    const list = Object.entries(counts).map(([t, n]) => (n > 1 ? `${t}x${n}` : t)).join(' ');
    return `  ${String(r.type).padEnd(9)} ${String(r.archetype).padEnd(12)} ${String(r.lightMood).padEnd(9)} `
      + `decay=${r.decay.toFixed(2)} area=${String(r.area ?? r.w * r.h).padStart(3)}  ${list}`;
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (args.legend) {
    const rows = Object.entries(DECOR_GLYPH).map(([t, g]) => `${g} ${t} (${DECOR_TYPES[t].cls})`);
    console.log(rows.join('\n'));
  }
  for (const seed of seeds) for (const depth of depths) {
    const lv = generateLevel(seed, depth);
    const st = decorStats(lv);
    console.log(`=== seed ${seed} depth ${depth} (${lv.debug.style || 'surface'}) pieces=${st.pieces} `
      + `props=${st.prop} decals=${st.decal} wall=${st.wall} blocking=${st.blocking} corridor=${st.corridor} `
      + `components=${lv.componentCount()} ${JSON.stringify(st.debug)}`);
    console.log(`    ${JSON.stringify(st.archetypes)}`);
    if (!args['stats-only']) {
      console.log(decorDump(lv));
      console.log(roomLines(lv).join('\n'));
    }
  }
}
