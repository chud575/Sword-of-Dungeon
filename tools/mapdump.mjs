// ASCII dump of generated levels for eyeballing generator quality.
// Usage: node tools/mapdump.mjs [--seed 42] [--depth 3] [--depths 1,5,12,18] [--seeds 42,7,1234] [--stats-only]
// Legend: '#' rock face, ' ' deep rock, '.' room floor, ',' corridor, '+' doorway, '~' water, '%' rubble,
//         'O' pit, '<' up stairs, '>' down stairs, 'T' temple, '!' sword, '$' gold, '*' hidden gold,
//         '?' hidden treasure/trap square, 'C' chest, 'x' hidden trap, letters = monsters (first letter of type)
import { generateLevel } from '../src/world/generator.js';
import { TILE } from '../src/core/constants.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const seeds = String(args.seeds || args.seed || '42').split(',').map(Number);
const depths = String(args.depths || args.depth || '3').split(',').map(Number);

const GLYPH = { [TILE.FLOOR]: '.', [TILE.CORRIDOR]: ',', [TILE.STAIRS_DOWN]: '>', [TILE.STAIRS_UP]: '<', [TILE.PIT]: 'O', [TILE.TEMPLE]: 'T', [TILE.WATER]: '~', [TILE.DOOR]: '+', [TILE.RUBBLE]: '%' };

/** Analyse a level: corridor structure, loops, distances. */
export function levelStats(lv) {
  const W = lv.width, H = lv.height;
  let corridor = 0, floor = 0, deadEnds = 0, water = 0, rubble = 0, doors = 0, pillars = 0, edges = 0, nodes = 0, wide = 0;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const t = lv.get(x, y);
    if (t === TILE.WALL) {
      if (lv.isWalkable(x - 1, y) && lv.isWalkable(x + 1, y) && lv.isWalkable(x, y - 1) && lv.isWalkable(x, y + 1)) pillars++;
      continue;
    }
    nodes++;
    if (lv.isWalkable(x + 1, y)) edges++;
    if (lv.isWalkable(x, y + 1)) edges++;
    if (t === TILE.CORRIDOR || t === TILE.RUBBLE && lv.rooms.every((r) => x < r.x || y < r.y || x >= r.x + r.w || y >= r.y + r.h)) {
      corridor++;
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => lv.isWalkable(x + dx, y + dy)).length;
      if (open === 1) deadEnds++;
      if (t === TILE.CORRIDOR && lv.get(x + 1, y) === TILE.CORRIDOR && lv.get(x, y + 1) === TILE.CORRIDOR && lv.get(x + 1, y + 1) === TILE.CORRIDOR) wide++;
    } else if (t === TILE.WATER) water++;
    else if (t === TILE.RUBBLE) rubble++;
    else if (t === TILE.DOOR) doors++;
    else floor++;
  }
  // loops: cyclomatic number with every room (4-connected blob of non-corridor tiles) contracted to one node
  const comp = new Int32Array(W * H).fill(-1);
  let comps = 0;
  const isRoomTile = (x, y) => lv.isWalkable(x, y) && lv.get(x, y) !== TILE.CORRIDOR;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!isRoomTile(x, y) || comp[y * W + x] >= 0) continue;
    const stack = [[x, y]]; comp[y * W + x] = comps;
    while (stack.length) {
      const [cx, cy] = stack.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (isRoomTile(nx, ny) && comp[ny * W + nx] < 0) { comp[ny * W + nx] = comps; stack.push([nx, ny]); }
      }
    }
    comps++;
  }
  let gEdges = 0, gNodes = comps;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (lv.get(x, y) !== TILE.CORRIDOR) continue;
    gNodes++;
    const seen = new Set();
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!lv.isWalkable(nx, ny)) continue;
      if (lv.get(nx, ny) === TILE.CORRIDOR) { if (dx > 0 || dy > 0) gEdges++; }
      else { const c = comp[ny * W + nx]; if (!seen.has(c)) { seen.add(c); gEdges++; } }
    }
  }
  const loops = Math.max(0, gEdges - gNodes + 1);
  const dist = lv.stairsUp ? lv.distanceMap(lv.stairsUp.x, lv.stairsUp.y) : null;
  const stairsDist = dist && lv.stairsDown ? dist[lv.idx(lv.stairsDown.x, lv.stairsDown.y)] : -1;
  const shapes = {};
  for (const r of lv.rooms) shapes[r.shape || r.type] = (shapes[r.shape || r.type] || 0) + 1;
  return { rooms: lv.rooms.length, shapes, floor, corridor, deadEnds, loops, wide2x2: wide, water, rubble, doors, pillars, stairsDist,
    temples: lv.temples.length, alcoves: lv.rooms.filter((r) => r.type === 'alcove').length,
    monsters: lv.monsters.length, gold: lv.items.filter((i) => i.type === 'gold' && !i.hidden).length,
    hiddenGold: lv.items.filter((i) => i.type === 'gold' && i.hidden).length, squares: lv.items.filter((i) => i.type === 'chest' && i.hidden).length,
    chests: lv.items.filter((i) => i.type === 'chest' && !i.hidden).length, traps: lv.traps.length, fixes: lv.debug.connectivityFixes, style: lv.debug.style };
}

export function dump(lv) {
  const rows = [];
  for (let y = 0; y < lv.height; y++) {
    let row = '';
    for (let x = 0; x < lv.width; x++) {
      const t = lv.get(x, y);
      let ch;
      if (t === TILE.WALL) {
        let exposed = false;
        for (let dy = -1; dy <= 1 && !exposed; dy++) for (let dx = -1; dx <= 1; dx++) if (lv.isWalkable(x + dx, y + dy)) { exposed = true; break; }
        ch = exposed ? '#' : ' ';
      } else ch = GLYPH[t] || '?';
      const it = lv.items.find((i) => i.x === x && i.y === y);
      if (it) ch = it.type === 'sword' ? '!' : it.type === 'gold' ? (it.hidden ? '*' : '$') : it.type === 'chest' ? (it.hidden ? '?' : 'C') : 'i';
      if (lv.trapAt(x, y)) ch = 'x';
      const m = lv.monsterAt(x, y);
      if (m) ch = m.type[0].toUpperCase();
      row += ch;
    }
    rows.push(row);
  }
  return rows.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const seed of seeds) for (const depth of depths) {
    const lv = generateLevel(seed, depth);
    const st = levelStats(lv);
    console.log(`=== seed ${seed} depth ${depth} (${st.style}) rooms=${st.rooms} ${JSON.stringify(st.shapes)} floor=${st.floor} corridor=${st.corridor} deadEnds=${st.deadEnds} loops=${st.loops} wide2x2=${st.wide2x2} pillars=${st.pillars} water=${st.water} rubble=${st.rubble} doors=${st.doors} alcoves=${st.alcoves} temples=${st.temples} stairsDist=${st.stairsDist} monsters=${st.monsters} gold=${st.gold}+${st.hiddenGold}h squares=${st.squares} chests=${st.chests} traps=${st.traps} fixes=${st.fixes}`);
    if (!args['stats-only']) console.log(dump(lv));
  }
}
