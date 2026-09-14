// forest: the outdoor level. Not rooms and corridors — glades in a wood, joined by trails.
//
// The dungeon generator carves rectangles and bores tunnels between them, which is exactly right for a
// keep and exactly wrong for a forest: nothing outdoors is square, and nobody laid the paths out with a
// ruler. So this lays a level out the way a wood grows: open glades of irregular shape where the trees
// thin out, narrow trails worn between them along whatever way is easiest through the undergrowth, and
// sometimes a stream running across the lot.
//
// IT STILL SPEAKS THE GAME'S TILE VOCABULARY, so every system that reads a Level works unchanged:
// trees are WALL (they block movement and sight — which is what makes a wood somewhere you can be
// ambushed), glades are FLOOR, trails are CORRIDOR, the stream is WATER. `level.biome === 'forest'` is
// what tells the renderer to draw WALL as woods and to lay the forest's own ground sheet.
import { TILE, DIRS4 } from '../core/constants.js';

/** The ground a glade may lie on (render/tiles.js FOREST_STYLES); meadow is the common case. */
export const GLADE_STYLES = ['meadow', 'meadow', 'moss', 'litter'];

/** Smooth seeded value noise over the map, in [0,1]: a lattice of random values, smoothstepped. */
function noiseField(rng, W, H, cell) {
  const gw = Math.ceil(W / cell) + 2, gh = Math.ceil(H / cell) + 2;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  const at = (a, b) => g[Math.max(0, Math.min(gh - 1, b)) * gw + Math.max(0, Math.min(gw - 1, a))];
  return (x, y) => {
    const fx = x / cell, fy = y / cell, xi = Math.floor(fx), yi = Math.floor(fy);
    const tx = fx - xi, ty = fy - yi, u = tx * tx * (3 - 2 * tx), v = ty * ty * (3 - 2 * ty);
    const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * u;
    const bot = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * u;
    return top + (bot - top) * v;
  };
}

/** Glade centres at least `minDist` apart (dart throwing; a 48x32 map takes eight or nine). */
function pickCentres(rng, W, H, n, minDist, margin) {
  const out = [];
  for (let tries = 0; tries < 2000 && out.length < n; tries++) {
    const c = { x: rng.float(margin + 2, W - margin - 3), y: rng.float(margin + 1, H - margin - 2) };
    if (out.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= minDist)) out.push(c);
  }
  return out;
}

/** Cheapest 4-connected route between two tiles over `cost(x, y)` (Dijkstra on a binary heap). */
function cheapestPath(level, cost, from, to) {
  const W = level.width, H = level.height, N = W * H;
  const best = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1);
  const heap = [];
  const push = (c, i) => {
    heap.push([c, i]);
    for (let k = heap.length - 1; k > 0;) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) {
        const l = 2 * k + 1, r = l + 1; let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
      }
    }
    return top;
  };
  const s = from.y * W + from.x, t = to.y * W + to.x;
  best[s] = 0; push(0, s);
  while (heap.length) {
    const [c, i] = pop();
    if (i === t) break;
    if (c > best[i]) continue;
    const x = i % W, y = (i / W) | 0;
    for (const d of DIRS4) {
      const nx = x + d.dx, ny = y + d.dy;
      if (nx < 1 || ny < 1 || nx > W - 2 || ny > H - 2) continue;
      const j = ny * W + nx, nc = c + cost(nx, ny);
      if (nc < best[j]) { best[j] = nc; prev[j] = i; push(nc, j); }
    }
  }
  const path = [];
  for (let i = t; i !== -1 && i !== s; i = prev[i]) path.push({ x: i % W, y: (i / W) | 0 });
  return path;
}

/**
 * Lay out the wood: glades, trails, the stream and the way in. Stairs down and the temple come after
 * the generator has made the whole thing walkable end to end (`finishForest`).
 * @param {import('./level.js').Level} level @param {object} rng
 */
export function generateForest(level, rng) {
  const W = level.width, H = level.height;
  const inner = (x, y) => x > 0 && y > 0 && x < W - 1 && y < H - 1;
  const shape = noiseField(rng, W, H, 3);   // warps the glades' outlines
  const brush = noiseField(rng, W, H, 5);   // how thick the undergrowth is: trails find the thin parts
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) level.set(x, y, TILE.WALL);

  // 1. GLADES — noise-warped ellipses, never rectangles
  for (const c of pickCentres(rng, W, H, rng.int(7, 10), 8, 4)) {
    // Big enough, and warped hard enough, that cutting the outline into whole tiles cannot square it off:
    // below ~2.5 tiles of radius a warped ellipse rounds to a rectangle with its corners nicked.
    const rx = rng.float(2.8, 4.6), ry = rng.float(2.4, 3.6);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const carved = [];
    for (let y = Math.floor(c.y - ry - 2); y <= Math.ceil(c.y + ry + 2); y++) for (let x = Math.floor(c.x - rx - 2); x <= Math.ceil(c.x + rx + 2); x++) {
      if (x < 2 || y < 2 || x > W - 3 || y > H - 3) continue;
      const dx = (x - c.x) / rx, dy = (y - c.y) / ry;
      if (dx * dx + dy * dy + (shape(x, y) - 0.5) * 1.4 >= 1) continue;
      if (level.get(x, y) !== TILE.FLOOR) { level.set(x, y, TILE.FLOOR); carved.push({ x, y }); }
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (x1 < 0) continue;
    const cx = Math.round(c.x), cy = Math.round(c.y);
    // ROUND IT OFF. However hard the outline is warped, cutting it into whole tiles can still fill its
    // bounding box nearly edge to edge — a square with its corners nicked. Clipping to the ellipse that
    // box inscribes takes the corners every time, so no glade reads as a room.
    const bcx = (x0 + x1 + 1) / 2, bcy = (y0 + y1 + 1) / 2, hx = (x1 - x0 + 1) / 2, hy = (y1 - y0 + 1) / 2;
    let area = 0;
    for (const t of carved) {
      const ex = (t.x + 0.5 - bcx) / hx, ey = (t.y + 0.5 - bcy) / hy;
      if (ex * ex + ey * ey > 1 && !(t.x === cx && t.y === cy)) level.set(t.x, t.y, TILE.WALL);
      else area++;
    }
    if (level.get(cx, cy) !== TILE.FLOOR) { level.set(cx, cy, TILE.FLOOR); area++; }   // the warp can pull the outline off its own centre
    level.rooms.push({ x: Math.min(x0, cx), y: Math.min(y0, cy), w: Math.max(x1, cx) - Math.min(x0, cx) + 1, h: Math.max(y1, cy) - Math.min(y0, cy) + 1, type: 'glade', shape: 'glade', cx, cy, area, tileStyle: rng.pick(GLADE_STYLES) });
  }
  const rooms = level.rooms;

  // 2. TRAILS — a spanning tree over the glades, nearest first, and a loop or two so it is not a maze
  const edges = [], linked = new Set([0]);
  const gap = (a, b) => Math.hypot(rooms[a].cx - rooms[b].cx, rooms[a].cy - rooms[b].cy);
  while (linked.size < rooms.length) {
    let bestEdge = null;
    for (const a of linked) for (let b = 0; b < rooms.length; b++) if (!linked.has(b) && (!bestEdge || gap(a, b) < bestEdge.d)) bestEdge = { a, b, d: gap(a, b) };
    linked.add(bestEdge.b); edges.push([bestEdge.a, bestEdge.b]);
  }
  for (let k = rng.int(1, 2); k > 0 && rooms.length > 2; k--) {
    const a = rng.int(0, rooms.length - 1);
    const near = rooms.map((_, b) => b).filter((b) => b !== a && !edges.some(([p, q]) => (p === a && q === b) || (p === b && q === a))).sort((p, q) => gap(a, p) - gap(a, q));
    if (near.length) edges.push([a, near[0]]);
  }
  // A trail is worn where walking is easiest: open ground is cheap, and the thinner the undergrowth,
  // the cheaper the wood — which is what bends a trail round the thick patches instead of down a ruler.
  const cost = (x, y) => (level.get(x, y) === TILE.WALL ? 3 + brush(x, y) * 9 : 1);
  for (const [a, b] of edges) {
    for (const p of cheapestPath(level, cost, { x: rooms[a].cx, y: rooms[a].cy }, { x: rooms[b].cx, y: rooms[b].cy })) {
      if (inner(p.x, p.y) && level.get(p.x, p.y) === TILE.WALL) level.set(p.x, p.y, TILE.CORRIDOR);
    }
  }

  // 3. THE STREAM, most of the time: north to south, meandering, a tile or two wide
  if (rng.chance(0.7)) {
    const flow = noiseField(rng, W, H, 6);
    const nearCentre = (x, y) => rooms.some((r) => Math.abs(r.cx - x) <= 1 && Math.abs(r.cy - y) <= 1);
    const wet = (x, y) => {
      // a trail crossing the stream is a ford — it stays dry, so the water never cuts the wood in two
      if (!inner(x, y) || nearCentre(x, y) || level.get(x, y) === TILE.CORRIDOR) return;
      level.set(x, y, TILE.WATER);
    };
    const x0 = rng.int(Math.floor(W * 0.25), Math.floor(W * 0.75));
    // A MEANDER, NOT A CANAL. The centreline swings on a slow wave (10-16 rows, 1.2-2.5 tiles either way)
    // with the flow noise bending it further, and the width runs 1-2 tiles. Every shape parameter is
    // read out of the noise field already drawn, so the stream costs the level's rng stream nothing
    // more than it always did and nothing placed after it moves.
    const period = 10 + flow(3.5, 7.5) * 6, amp = 1.2 + flow(20.5, 4.5) * 1.3, phase = flow(9.5, 17.5) * Math.PI * 2;
    const rows = [];
    for (let y = 1; y < H - 1; y++) {
      let c = Math.max(2.5, Math.min(W - 3.5, x0 + Math.sin((y / period) * Math.PI * 2 + phase) * amp + (flow(x0, y) - 0.5) * 2.2));
      // no more than 3/4 of a tile sideways per row: a sharper swing laid a straight bank and a 90-degree bend (review-03 G7)
      if (rows.length) { const pc = rows[rows.length - 1].c; c = pc + Math.max(-0.75, Math.min(0.75, c - pc)); }
      const width = flow(x0 + 11, y * 1.3) > 0.55 ? 2 : 1;
      const a0 = Math.round(c - width / 2);
      rows.push({ y, a0, b0: a0 + width - 1, c });
    }
    // A glade's centre stays dry and cuts the stream (render/floorField.js lays a ford there). TAPER to one
    // tile over the two rows either side of every cut, so the water narrows into the ford instead of
    // ending in a squared-off pool (review-02 G4). Reads only the rows already laid out: no rng.
    const cut = new Set(rows.filter((r) => { for (let x = r.a0; x <= r.b0; x++) if (nearCentre(x, r.y)) return true; return false; }).map((r) => r.y));
    let prev = null;
    for (const r of rows) {
      let a0 = r.a0, b0 = r.b0;
      if (b0 > a0 && [1, 2].some((d) => cut.has(r.y - d) || cut.has(r.y + d))) b0 = a0;
      let a = a0, b = b0;
      // keep the water 4-connected round a bend: overlap the row above
      if (prev) { if (a > prev[1]) a = prev[1]; if (b < prev[0]) b = prev[0]; }
      for (let sx = Math.max(2, a); sx <= Math.min(W - 3, b); sx++) wet(sx, r.y);
      prev = [a0, b0];
    }
  }

  // 4. THE WAY IN, in the westernmost glade
  const west = rooms.reduce((a, r) => (r.cx < a.cx ? r : a), rooms[0]);
  level.set(west.cx, west.cy, TILE.STAIRS_UP);
  level.stairsUp = { x: west.cx, y: west.cy };
  return level;
}

/**
 * Once the wood is walkable end to end: the way down goes in the glade FARTHEST from the way in along
 * the ground, and the temple — a stone circle — in the glade nearest halfway along that walk.
 * @param {import('./level.js').Level} level @param {object} rng
 */
export function finishForest(level, rng) {
  const W = level.width, H = level.height, up = level.stairsUp;
  const dist = new Int32Array(W * H).fill(-1);
  const q = [up];
  dist[level.idx(up.x, up.y)] = 0;
  for (let i = 0; i < q.length; i++) {
    const { x, y } = q[i], here = dist[level.idx(x, y)];
    for (const d of DIRS4) {
      const nx = x + d.dx, ny = y + d.dy;
      if (!level.inBounds(nx, ny) || !level.isWalkable(nx, ny)) continue;
      const j = level.idx(nx, ny);
      if (dist[j] >= 0) continue;
      dist[j] = here + 1; q.push({ x: nx, y: ny });
    }
  }
  const glades = level.rooms.filter((r) => level.get(r.cx, r.cy) === TILE.FLOOR && dist[level.idx(r.cx, r.cy)] > 0);
  const far = glades.reduce((a, r) => (!a || dist[level.idx(r.cx, r.cy)] > dist[level.idx(a.cx, a.cy)] ? r : a), null);
  const down = far ? { x: far.cx, y: far.cy } : level.randomFloorTile(rng, { plainOnly: true, minDist: { x: up.x, y: up.y, d: 10 } });
  if (down) {
    level.set(down.x, down.y, TILE.STAIRS_DOWN);
    level.stairsDown = { x: down.x, y: down.y };
    level.stairsDownAll = [{ x: down.x, y: down.y }];
  }
  const mid = down ? dist[level.idx(down.x, down.y)] / 2 : 0;
  const circle = glades.filter((r) => r !== far).sort((a, b) => Math.abs(dist[level.idx(a.cx, a.cy)] - mid) - Math.abs(dist[level.idx(b.cx, b.cy)] - mid))[0];
  if (circle) {
    level.set(circle.cx, circle.cy, TILE.TEMPLE);
    level.temples.push({ x: circle.cx, y: circle.cy });
    circle.sacred = true;
  }
  return level;
}
