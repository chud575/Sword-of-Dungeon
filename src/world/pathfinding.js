// A* over level tiles (8-way, no corner cutting) and BFS flow fields for monsters.
import { DIRS8, DIRS4 } from '../core/constants.js';

class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node) {
    const a = this.a; a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

/**
 * A* path search.
 * @param {import('./level.js').Level} level
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 * @param {{diagonal?:boolean, passable?:(x:number,y:number)=>boolean, maxNodes?:number, cost?:(x:number,y:number)=>number}} opts
 *   passable: extra predicate (the goal tile is always allowed, so a path can end on a monster).
 * @returns {{x:number,y:number}[]|null} steps from the tile after `from` up to and including `to`; null if unreachable
 */
export function aStar(level, from, to, opts = {}) {
  const diagonal = opts.diagonal !== false;
  const maxNodes = opts.maxNodes ?? 4000;
  const passable = opts.passable || null;
  const costFn = opts.cost || null;
  const W = level.width;
  if (!level.isWalkable(to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) return [];
  const g = new Float64Array(level.width * level.height).fill(Infinity);
  const parent = new Int32Array(level.width * level.height).fill(-1);
  const closed = new Uint8Array(level.width * level.height);
  const h = (x, y) => { const dx = Math.abs(x - to.x), dy = Math.abs(y - to.y); return diagonal ? Math.max(dx, dy) + 0.41 * Math.min(dx, dy) : dx + dy; };
  const heap = new MinHeap();
  const si = from.y * W + from.x;
  g[si] = 0;
  heap.push({ i: si, f: h(from.x, from.y) });
  let expanded = 0;
  const dirs = diagonal ? DIRS8 : DIRS4;
  while (heap.size) {
    const cur = heap.pop();
    if (closed[cur.i]) continue;
    closed[cur.i] = 1;
    const cx = cur.i % W, cy = (cur.i - cx) / W;
    if (cx === to.x && cy === to.y) {
      const path = [];
      let i = cur.i;
      while (i !== si) { path.push({ x: i % W, y: (i - (i % W)) / W }); i = parent[i]; }
      return path.reverse();
    }
    if (++expanded > maxNodes) return null;
    for (const d of dirs) {
      if (!level.canStep(cx, cy, d.dx, d.dy)) continue;
      const nx = cx + d.dx, ny = cy + d.dy;
      const isGoal = nx === to.x && ny === to.y;
      if (!isGoal && passable && !passable(nx, ny)) continue;
      const ni = ny * W + nx;
      if (closed[ni]) continue;
      const step = (d.dx !== 0 && d.dy !== 0 ? 1.41 : 1) + (costFn ? costFn(nx, ny) : 0);
      const ng = g[cur.i] + step;
      if (ng < g[ni]) { g[ni] = ng; parent[ni] = cur.i; heap.push({ i: ni, f: ng + h(nx, ny) }); }
    }
  }
  return null;
}

/**
 * BFS flow field from one or more targets. Result[i] = steps to nearest target (-1 unreachable).
 * @param {import('./level.js').Level} level
 * @param {{x:number,y:number}[]} targets
 * @param {{diagonal?:boolean, passable?:(x:number,y:number)=>boolean, maxDist?:number}} opts
 * @returns {Int16Array}
 */
export function flowField(level, targets, opts = {}) {
  const W = level.width;
  const field = new Int16Array(level.width * level.height).fill(-1);
  const q = [];
  for (const t of targets) {
    if (!level.isWalkable(t.x, t.y)) continue;
    field[t.y * W + t.x] = 0; q.push(t.x, t.y);
  }
  const dirs = opts.diagonal !== false ? DIRS8 : DIRS4;
  const maxDist = opts.maxDist ?? 1e9;
  let head = 0;
  while (head < q.length) {
    const x = q[head++], y = q[head++];
    const d0 = field[y * W + x];
    if (d0 >= maxDist) continue;
    for (const d of dirs) {
      if (!level.canStep(x, y, d.dx, d.dy)) continue;
      const nx = x + d.dx, ny = y + d.dy;
      if (opts.passable && !opts.passable(nx, ny)) continue;
      const i = ny * W + nx;
      if (field[i] >= 0) continue;
      field[i] = d0 + 1; q.push(nx, ny);
    }
  }
  return field;
}

/** Best downhill step on a flow field from (x,y); null if none. */
export function flowStep(level, field, x, y, diagonal = true) {
  const W = level.width;
  let best = null, bestD = field[y * W + x];
  if (bestD < 0) bestD = Infinity;
  for (const d of diagonal ? DIRS8 : DIRS4) {
    if (!level.canStep(x, y, d.dx, d.dy)) continue;
    const v = field[(y + d.dy) * W + x + d.dx];
    if (v >= 0 && v < bestD) { bestD = v; best = { x: x + d.dx, y: y + d.dy, dx: d.dx, dy: d.dy }; }
  }
  return best;
}

/**
 * BFS from `from` to the nearest tile satisfying `goal`. Returns the full path (excluding start) or null.
 * @param {{passable?:(x:number,y:number)=>boolean, diagonal?:boolean, maxDist?:number}} opts
 */
export function bfsNearest(level, from, goal, opts = {}) {
  const W = level.width;
  const parent = new Int32Array(level.width * level.height).fill(-2);
  const si = from.y * W + from.x;
  parent[si] = -1;
  const q = [from.x, from.y];
  let head = 0;
  const dirs = opts.diagonal !== false ? DIRS8 : DIRS4;
  while (head < q.length) {
    const x = q[head++], y = q[head++];
    if (!(x === from.x && y === from.y) && goal(x, y)) {
      const path = [];
      let i = y * W + x;
      while (i !== si) { path.push({ x: i % W, y: (i - (i % W)) / W }); i = parent[i]; }
      return path.reverse();
    }
    for (const d of dirs) {
      if (!level.canStep(x, y, d.dx, d.dy)) continue;
      const nx = x + d.dx, ny = y + d.dy;
      const ni = ny * W + nx;
      if (parent[ni] !== -2) continue;
      const isGoal = goal(nx, ny);
      if (!isGoal && opts.passable && !opts.passable(nx, ny)) continue;
      parent[ni] = y * W + x;
      q.push(nx, ny);
    }
  }
  return null;
}
