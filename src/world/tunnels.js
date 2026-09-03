// Tunnel digging for the level generator: the 1982 random-walk digger (segments of 5–9 tiles,
// never reversing, stop when the tunnel breaks from rock into open space) with two modern
// refinements — it refuses to hug alongside existing passages (no double-wide corridors) and it
// can be biased toward a target for loops and connectivity repairs. All randomness via rng.
import { TILE, DIRS4 } from '../core/constants.js';

const OPP = [2, 3, 0, 1]; // DIRS4 order is n, e, s, w

function inField(level, x, y) { return x >= 2 && y >= 2 && x <= level.width - 3 && y <= level.height - 3; }

/** Does rock tile (x,y) touch open space on a side other than the tile we came from? */
function sideTouch(level, x, y, fromDir) {
  for (let d = 0; d < 4; d++) {
    if (d === OPP[fromDir]) continue;
    if (level.get(x + DIRS4[d].dx, y + DIRS4[d].dy) !== TILE.WALL) return true;
  }
  return false;
}

/** Pick a direction: not the reverse of prev; biased toward target when given. */
function chooseDir(rng, prev, x, y, target, bias) {
  if (target && rng.chance(bias)) {
    const dx = target.x - x, dy = target.y - y;
    const horiz = Math.abs(dx) > Math.abs(dy) || (Math.abs(dx) === Math.abs(dy) && rng.chance(0.5));
    let d = horiz ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    if (d === OPP[prev]) d = horiz ? (dy > 0 ? 2 : 0) : (dx > 0 ? 1 : 3);
    if (d !== OPP[prev]) return d;
  }
  let d;
  let guard = 0;
  do { d = rng.int(0, 3); } while (d === OPP[prev] && prev >= 0 && ++guard < 8 && rng.chance(0.92));
  return d;
}

/**
 * Random-walk tunnel from (sx,sy).
 * @param {import('./level.js').Level} level
 * @param {object} rng
 * @param {number} sx
 * @param {number} sy
 * @param {{maxSteps?:number, target?:{x:number,y:number}|null, bias?:number, minLen?:number, maxLen?:number, tile?:number}} opts
 * @returns {{joined:boolean, carved:number[]}} whether it broke into open space, and the tiles it carved (idx)
 */
export function digTunnel(level, rng, sx, sy, opts = {}) {
  const maxSteps = opts.maxSteps ?? 400;
  const target = opts.target || null;
  const bias = opts.bias ?? 0;
  const minLen = opts.minLen ?? 4, maxLen = opts.maxLen ?? 8;
  const tile = opts.tile ?? TILE.CORRIDOR;
  let x = sx, y = sy, prev = -1, throughRock = 0, steps = 0, stalls = 0, bounced = false;
  const carved = [];
  const centre = { x: level.width >> 1, y: level.height >> 1 };
  while (steps < maxSteps && stalls < 40) {
    // a tunnel that ran into the map edge heads back inward instead of crawling along the rim
    const dir = bounced && rng.chance(0.8) ? chooseDir(rng, prev, x, y, centre, 1) : chooseDir(rng, prev, x, y, target, bias);
    bounced = false;
    const len = rng.int(minLen, maxLen);
    let moved = 0;
    for (let i = 0; i < len && steps < maxSteps; i++) {
      const nx = x + DIRS4[dir].dx, ny = y + DIRS4[dir].dy;
      if (!inField(level, nx, ny)) { bounced = true; break; }
      steps++;
      const t = level.get(nx, ny);
      if (t !== TILE.WALL) {
        if (throughRock) return { joined: true, carved };
        x = nx; y = ny; moved++;
        continue;
      }
      // rock: refuse to run alongside an existing passage (that is what makes 2-wide corridors)
      if (sideTouch(level, nx, ny, dir)) {
        if (throughRock === 0) break; // turn instead of clipping the room's own edge
        level.set(nx, ny, tile); carved.push(level.idx(nx, ny));
        return { joined: true, carved };
      }
      level.set(nx, ny, tile); carved.push(level.idx(nx, ny));
      throughRock++;
      x = nx; y = ny; moved++;
    }
    if (!moved) stalls++;
    prev = dir;
  }
  return { joined: false, carved };
}

/** Undo a tunnel (used when a speculative dig went nowhere). */
export function eraseTunnel(level, carved) {
  for (const i of carved) level.tiles[i] = TILE.WALL;
}

/**
 * Dead-end stub: a short passage into rock that never touches anything (2–6 tiles, one bend).
 * @returns {number} tiles carved
 */
export function digStub(level, rng, sx, sy, len) {
  let x = sx, y = sy, dir = -1, n = 0;
  const bendAt = rng.chance(0.55) ? rng.int(1, Math.max(1, len - 1)) : -1;
  const first = rng.shuffle([0, 1, 2, 3]);
  for (let i = 0; i < len; i++) {
    if (i === 0) {
      dir = first.find((d) => stubStep(level, x, y, x + DIRS4[d].dx, y + DIRS4[d].dy, d)) ?? -1;
      if (dir < 0) break;
    } else if (i === bendAt) {
      const turn = rng.chance(0.5) ? 1 : 3;
      dir = (dir + turn) % 4;
    }
    const nx = x + DIRS4[dir].dx, ny = y + DIRS4[dir].dy;
    if (!stubStep(level, x, y, nx, ny, dir)) break;
    level.set(nx, ny, TILE.CORRIDOR);
    x = nx; y = ny; n++;
  }
  return n;
}

/** Can a stub step from (x,y) onto rock (nx,ny) without touching any other open tile (even diagonally)? */
function stubStep(level, x, y, nx, ny, dir) {
  if (!inField(level, nx, ny) || level.get(nx, ny) !== TILE.WALL) return false;
  if (sideTouch(level, nx, ny, dir)) return false;
  for (const ddx of [-1, 1]) for (const ddy of [-1, 1]) {
    const qx = nx + ddx, qy = ny + ddy;
    if (qx === x || qy === y) continue; // shares a row/column with the tile behind: allowed
    if (level.get(qx, qy) !== TILE.WALL) return false;
  }
  return true;
}

/**
 * Remove 2x2 blocks of corridor (double-wide artifacts) where doing so keeps the tiles connected.
 * @returns {number} tiles removed
 */
export function thinCorridors(level, rng) {
  let removed = 0;
  const W = level.width;
  for (let y = 1; y < level.height - 2; y++) for (let x = 1; x < W - 2; x++) {
    const quad = [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]];
    if (!quad.every(([qx, qy]) => level.get(qx, qy) === TILE.CORRIDOR)) continue;
    // try removing the corner with the fewest open neighbours first
    const order = quad.map(([qx, qy]) => ({ qx, qy, open: DIRS4.filter((d) => level.isWalkable(qx + d.dx, qy + d.dy)).length + rng.next() * 0.5 }))
      .sort((a, b) => a.open - b.open);
    for (const c of order) {
      level.set(c.qx, c.qy, TILE.WALL);
      const rest = quad.filter(([qx, qy]) => qx !== c.qx || qy !== c.qy);
      if (locallyConnected(level, rest, 60)) { removed++; break; }
      level.set(c.qx, c.qy, TILE.CORRIDOR);
    }
  }
  return removed;
}

/** Are all the given tiles reachable from the first one within `limit` BFS expansions? */
function locallyConnected(level, tiles, limit) {
  const start = tiles[0];
  const want = new Set(tiles.slice(1).map(([x, y]) => level.idx(x, y)));
  const seen = new Set([level.idx(start[0], start[1])]);
  const q = [start];
  let head = 0;
  while (head < q.length && seen.size < limit) {
    const [x, y] = q[head++];
    for (const d of DIRS4) {
      const nx = x + d.dx, ny = y + d.dy;
      if (!level.isWalkable(nx, ny)) continue;
      const i = level.idx(nx, ny);
      if (seen.has(i)) continue;
      seen.add(i);
      want.delete(i);
      if (!want.size) return true;
      q.push([nx, ny]);
    }
  }
  return !want.size;
}

/** Carve an L-shaped passage with one random jog (last-resort connector). */
export function carveL(level, rng, a, b) {
  const carve = (cx, cy) => { if (level.get(cx, cy) === TILE.WALL) level.set(cx, cy, TILE.CORRIDOR); };
  let x = a.x, y = a.y;
  const goX = (tx) => { while (x !== tx) { x += Math.sign(tx - x); carve(x, y); } };
  const goY = (ty) => { while (y !== ty) { y += Math.sign(ty - y); carve(x, y); } };
  if (rng.chance(0.5)) {
    const mx = Math.abs(b.x - a.x) > 3 ? a.x + Math.sign(b.x - a.x) * rng.int(1, Math.abs(b.x - a.x) - 1) : b.x;
    goX(mx); goY(b.y); goX(b.x);
  } else {
    const my = Math.abs(b.y - a.y) > 3 ? a.y + Math.sign(b.y - a.y) * rng.int(1, Math.abs(b.y - a.y) - 1) : b.y;
    goY(my); goX(b.x); goY(b.y);
  }
}

/**
 * Join every walkable component to the main one (the one containing `from`) with twisting
 * passages; falls back to a jogged L when the digger wanders. Returns the number of repairs.
 */
export function ensureConnectivity(level, rng, from) {
  let fixes = 0;
  for (let guard = 0; guard < 60; guard++) {
    const main = level.floodFill(from.x, from.y);
    // nearest (component tile, main tile) pair by manhattan distance — sample the component
    let target = null;
    outer: for (let y = 1; y < level.height - 1; y++) for (let x = 1; x < level.width - 1; x++) {
      if (level.isWalkable(x, y) && !main[level.idx(x, y)]) { target = { x, y }; break outer; }
    }
    if (!target) return fixes;
    const comp = level.floodFill(target.x, target.y);
    // multi-source BFS through rock from the main component: nearest main tile for every cell
    const W = level.width, N = W * level.height;
    const dist = new Int32Array(N).fill(-1), src = new Int32Array(N).fill(-1);
    const q = [];
    for (let i = 0; i < N; i++) if (main[i]) { dist[i] = 0; src[i] = i; q.push(i); }
    let head = 0, bestA = null, bestB = null;
    while (head < q.length && !bestA) {
      const i = q[head++], x = i % W, y = (i / W) | 0;
      for (const d of DIRS4) {
        const nx = x + d.dx, ny = y + d.dy;
        if (!inField(level, nx, ny)) continue;
        const j = ny * W + nx;
        if (dist[j] >= 0) continue;
        dist[j] = dist[i] + 1; src[j] = src[i];
        if (comp[j]) { bestA = { x: nx, y: ny }; bestB = { x: src[j] % W, y: (src[j] / W) | 0 }; break; }
        q.push(j);
      }
    }
    if (!bestA) { bestA = target; bestB = from; }
    let joined = false;
    for (let attempt = 0; attempt < 3 && !joined; attempt++) {
      const res = digTunnel(level, rng, bestA.x, bestA.y, { target: bestB, bias: 0.75, maxSteps: 200, minLen: 3, maxLen: 7 });
      const reach = level.floodFill(from.x, from.y);
      joined = !!reach[level.idx(bestA.x, bestA.y)];
      if (!joined) eraseTunnel(level, res.carved);
    }
    if (!joined) carveL(level, rng, bestA, bestB);
    fixes++;
  }
  return fixes;
}
