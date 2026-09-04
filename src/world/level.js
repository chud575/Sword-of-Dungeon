// Level: tile grid + entities + items + fog-of-war masks. Plain data with helpers; serializable.
import { TILE, DIRS8, DIRS4 } from '../core/constants.js';

/** Run-length encode a Uint8Array into a compact string ("v*n,v*n,..."). */
export function rleEncode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v) n++;
    out.push(n > 1 ? `${v}*${n}` : `${v}`);
    i += n;
  }
  return out.join(',');
}

/** Decode a string produced by rleEncode into a Uint8Array of the given length. */
export function rleDecode(str, length) {
  const arr = new Uint8Array(length);
  if (!str) return arr;
  let i = 0;
  for (const tok of str.split(',')) {
    const star = tok.indexOf('*');
    const v = Number(star < 0 ? tok : tok.slice(0, star));
    const n = star < 0 ? 1 : Number(tok.slice(star + 1));
    arr.fill(v, i, i + n);
    i += n;
  }
  return arr;
}

/** Tiles the player can stand on (everything except solid rock). */
export function isWalkableTile(t) {
  return t !== TILE.WALL;
}

/** Tiles that block line of sight. */
export function isOpaqueTile(t) {
  return t === TILE.WALL;
}

export class Level {
  /**
   * @param {{depth:number, width:number, height:number, seed:number}} opts
   */
  constructor({ depth, width, height, seed = 0 }) {
    this.depth = depth;
    this.width = width;
    this.height = height;
    this.seed = seed;
    this.tiles = new Uint8Array(width * height); // TILE.WALL = 0
    this.explored = new Uint8Array(width * height);
    this.visible = new Uint8Array(width * height);
    /** @type {{x:number,y:number,w:number,h:number,type:string,cx:number,cy:number}[]} */
    this.rooms = [];
    /** @type {object[]} monsters (and the player while present) */
    this.entities = [];
    /** @type {object[]} */
    this.items = [];
    /** @type {{type:string,x:number,y:number,facing:string,variant:number,blocking:boolean}[]} ambience dressing (docs/AMBIENCE.md §4.1) */
    this.decor = [];
    /** movement mask for blocking decor, rebuilt by setDecor(); null while empty */
    this.decorBlock = null;
    this.stairsUp = null;
    this.stairsDown = null;
    /** every down staircase (stairsDown is the primary/farthest one) */
    this.stairsDownAll = [];
    /** @type {{x:number,y:number}[]} */
    this.temples = [];
    /** hidden traps: {x,y,type:'teleport'|'pit',revealed:boolean} */
    this.traps = [];
    /** climbable-pit-above markers: {x,y,levels} (interact to climb up `levels`) */
    this.climbable = [];
    /** buried gold caches created by the player this level (count for the 10-cache cap) */
    this.buriedCount = 0;
    this.beacon = null;
    this.visited = false;
    this.lit = false;            // Magic Map applied
    this.killsOnLevel = 0;
    this.wanderTimer = 0;
    this.wanderCount = 0;
    this.lastStairsDown = null;   // staircase used when the player last descended from here
    this.nextId = 1;
    this.debug = { connectivityFixes: 0 };
  }

  idx(x, y) { return y * this.width + x; }
  inBounds(x, y) { return x >= 0 && y >= 0 && x < this.width && y < this.height; }
  get(x, y) { return this.inBounds(x, y) ? this.tiles[y * this.width + x] : TILE.WALL; }
  set(x, y, t) { if (this.inBounds(x, y)) this.tiles[y * this.width + x] = t; }
  isWalkable(x, y) {
    if (!this.inBounds(x, y)) return false;
    const i = y * this.width + x;
    return isWalkableTile(this.tiles[i]) && !(this.decorBlock && this.decorBlock[i] === 1);
  }
  isOpaque(x, y) { return !this.inBounds(x, y) || isOpaqueTile(this.tiles[y * this.width + x]); }
  isExplored(x, y) { return this.inBounds(x, y) && this.explored[y * this.width + x] === 1; }
  isVisible(x, y) { return this.inBounds(x, y) && this.visible[y * this.width + x] === 1; }
  isTemple(x, y) { return this.get(x, y) === TILE.TEMPLE; }
  isStairs(x, y) { const t = this.get(x, y); return t === TILE.STAIRS_UP || t === TILE.STAIRS_DOWN; }
  /** Tiles that hurt or move you when stepped on (used by auto-explore / monster pathing). */
  isHazard(x, y) {
    const t = this.get(x, y);
    if (t === TILE.PIT || t === TILE.TRAP_TELEPORT || t === TILE.TRAP_PIT) return true;
    return this.items.some((it) => it.x === x && it.y === y && it.hidden && it.type === 'chest');
  }

  /** Whether a move from (x,y) by (dx,dy) is legal (no wall corner cutting). */
  canStep(x, y, dx, dy) {
    const nx = x + dx, ny = y + dy;
    if (!this.isWalkable(nx, ny)) return false;
    if (dx !== 0 && dy !== 0 && (!this.isWalkable(x + dx, y) || !this.isWalkable(x, y + dy))) return false;
    return true;
  }

  entityAt(x, y) { return this.entities.find((e) => e.x === x && e.y === y && e.state !== 'dead') || null; }
  monsterAt(x, y) { return this.entities.find((e) => e.kind === 'monster' && e.x === x && e.y === y && e.state !== 'dead') || null; }
  itemsAt(x, y) { return this.items.filter((it) => it.x === x && it.y === y); }
  trapAt(x, y) { return this.traps.find((t) => t.x === x && t.y === y) || null; }
  climbableAt(x, y) { return this.climbable.find((c) => c.x === x && c.y === y) || null; }
  /** Every decor entry on a tile (usually 0 or 1; a decal plus a standing prop is legal). */
  decorAt(x, y) { return this.decor.filter((d) => d.x === x && d.y === y); }
  /** Is a piece of decor standing here that blocks movement? */
  decorBlocked(x, y) {
    if (!this.decorBlock || !this.inBounds(x, y)) return false;
    return this.decorBlock[y * this.width + x] === 1;
  }
  /**
   * Install the level's decor and rebuild the movement mask (AMBIENCE.md §4.3).
   * @param {object[]} list Decor entries
   */
  setDecor(list) {
    this.decor = list;
    let mask = null;
    for (const d of list) {
      if (!d.blocking) continue;
      if (!mask) mask = new Uint8Array(this.width * this.height);
      if (this.inBounds(d.x, d.y)) mask[d.y * this.width + d.x] = 1;
    }
    this.decorBlock = mask;
    return list;
  }
  /**
   * Tiles decor may never occupy (AMBIENCE.md §4.4). Wall-mounted pieces are the one exception:
   * they name the WALL tile they hang on, and are checked through their viewer tile instead.
   * @param {number} x @param {number} y
   * @param {boolean} standing true for a standing prop (rubble takes decals only)
   */
  decorForbidden(x, y, standing = false) {
    if (!this.inBounds(x, y)) return true;
    const t = this.get(x, y);
    if (t === TILE.WALL || t === TILE.DOOR || t === TILE.STAIRS_UP || t === TILE.STAIRS_DOWN
      || t === TILE.TEMPLE || t === TILE.PIT || t === TILE.WATER
      || t === TILE.TRAP_TELEPORT || t === TILE.TRAP_PIT) return true;
    if (standing && t === TILE.RUBBLE) return true;
    if (this.trapAt(x, y)) return true;
    if (this.itemsAt(x, y).length) return true;
    if (this.entityAt(x, y)) return true;
    // the door throat: a doorway and the walkable tile on each side of it
    for (const d of DIRS4) if (this.get(x + d.dx, y + d.dy) === TILE.DOOR) return true;
    // nothing crowds a staircase
    for (const d of DIRS8) {
      const n = this.get(x + d.dx, y + d.dy);
      if (n === TILE.STAIRS_UP || n === TILE.STAIRS_DOWN) return true;
    }
    return false;
  }
  get monsters() { return this.entities.filter((e) => e.kind === 'monster' && e.state !== 'dead'); }

  addEntity(e) { if (!this.entities.includes(e)) this.entities.push(e); return e; }
  removeEntity(e) {
    const id = typeof e === 'object' ? e.id : e;
    const i = this.entities.findIndex((x) => x.id === id);
    if (i >= 0) this.entities.splice(i, 1);
  }
  addItem(it) { if (!it.id) it.id = `i${this.depth}-${this.nextId++}`; this.items.push(it); return it; }
  removeItem(it) {
    const id = typeof it === 'object' ? it.id : it;
    const i = this.items.findIndex((x) => x.id === id);
    if (i >= 0) this.items.splice(i, 1);
  }

  /** Walkable neighbours (8-way by default, no corner cutting). */
  neighbors(x, y, diagonal = true) {
    const out = [];
    for (const d of diagonal ? DIRS8 : DIRS4) {
      if (this.canStep(x, y, d.dx, d.dy)) out.push({ x: x + d.dx, y: y + d.dy, dx: d.dx, dy: d.dy });
    }
    return out;
  }

  /** Is a tile free of blocking entities and special tiles for placement? */
  isEmptyFloor(x, y) {
    const t = this.get(x, y);
    if (t !== TILE.FLOOR && t !== TILE.CORRIDOR && t !== TILE.WATER && t !== TILE.RUBBLE) return false;
    if (this.entityAt(x, y)) return false;
    if (this.itemsAt(x, y).length) return false;
    if (this.trapAt(x, y)) return false;
    if (this.decorBlocked(x, y)) return false;
    return true;
  }

  /**
   * Pick a random empty floor tile. opts: {minDist:{x,y,d}, unexplored:boolean, rooms:boolean, tries}
   * @returns {{x:number,y:number}|null}
   */
  randomFloorTile(rng, opts = {}) {
    const tries = opts.tries ?? 400;
    for (let i = 0; i < tries; i++) {
      const x = rng.int(1, this.width - 2), y = rng.int(1, this.height - 2);
      if (!this.isEmptyFloor(x, y)) continue;
      if (opts.plainOnly && this.get(x, y) !== TILE.FLOOR && this.get(x, y) !== TILE.CORRIDOR) continue;
      if (opts.rooms && this.get(x, y) !== TILE.FLOOR) continue;
      if (opts.unexplored && this.explored[this.idx(x, y)]) continue;
      if (opts.minDist && Math.max(Math.abs(x - opts.minDist.x), Math.abs(y - opts.minDist.y)) < opts.minDist.d) continue;
      if (opts.filter && !opts.filter(x, y)) continue;
      return { x, y };
    }
    // deterministic fallback: scan
    const cells = [];
    for (let y = 1; y < this.height - 1; y++) for (let x = 1; x < this.width - 1; x++) {
      if (!this.isEmptyFloor(x, y)) continue;
      if (opts.rooms && this.get(x, y) !== TILE.FLOOR) continue;
      if (opts.filter && !opts.filter(x, y)) continue;
      cells.push({ x, y });
    }
    return cells.length ? rng.pick(cells) : null;
  }

  /** Flood fill over walkable tiles from (sx,sy). Returns Uint8Array reach mask. */
  floodFill(sx, sy, diagonal = false) {
    const reach = new Uint8Array(this.width * this.height);
    if (!this.isWalkable(sx, sy)) return reach;
    const stack = [sx, sy];
    reach[this.idx(sx, sy)] = 1;
    const dirs = diagonal ? DIRS8 : DIRS4;
    while (stack.length) {
      const y = stack.pop(), x = stack.pop();
      for (const d of dirs) {
        const nx = x + d.dx, ny = y + d.dy;
        if (!this.isWalkable(nx, ny)) continue;
        const i = this.idx(nx, ny);
        if (reach[i]) continue;
        reach[i] = 1;
        stack.push(nx, ny);
      }
    }
    return reach;
  }

  /** BFS distance map (-1 unreachable) over walkable tiles. */
  distanceMap(sx, sy, diagonal = false, passable = null) {
    const dist = new Int32Array(this.width * this.height).fill(-1);
    if (!this.isWalkable(sx, sy)) return dist;
    const q = [sx, sy];
    dist[this.idx(sx, sy)] = 0;
    let head = 0;
    while (head < q.length) {
      const x = q[head++], y = q[head++];
      const d0 = dist[this.idx(x, y)];
      for (const d of diagonal ? DIRS8 : DIRS4) {
        const nx = x + d.dx, ny = y + d.dy;
        if (!this.canStep(x, y, d.dx, d.dy)) continue;
        if (passable && !passable(nx, ny)) continue;
        const i = this.idx(nx, ny);
        if (dist[i] >= 0) continue;
        dist[i] = d0 + 1;
        q.push(nx, ny);
      }
    }
    return dist;
  }

  /** Number of connected components among walkable tiles (4-connectivity). */
  componentCount() {
    const seen = new Uint8Array(this.width * this.height);
    let count = 0;
    for (let y = 0; y < this.height; y++) for (let x = 0; x < this.width; x++) {
      if (!this.isWalkable(x, y) || seen[this.idx(x, y)]) continue;
      count++;
      const reach = this.floodFill(x, y);
      for (let i = 0; i < reach.length; i++) if (reach[i]) seen[i] = 1;
    }
    return count;
  }

  countWalkable() { let n = 0; for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i] !== TILE.WALL) n++; return n; }

  /** Reveal the whole level (Magic Map / death). */
  revealAll() { this.explored.fill(1); this.lit = true; }
  /** Forget the map ("LOST YOUR MAP!"). */
  forget() { this.explored.fill(0); this.visible.fill(0); this.lit = false; }

  /** Plain-data snapshot (monsters only; the player is stored by the game). */
  serialize() {
    return {
      depth: this.depth, width: this.width, height: this.height, seed: this.seed,
      tiles: rleEncode(this.tiles), explored: rleEncode(this.explored), visible: rleEncode(this.visible),
      rooms: this.rooms.map((r) => ({ ...r })),
      entities: this.entities.filter((e) => e.kind !== 'player').map((e) => JSON.parse(JSON.stringify(e))),
      items: this.items.map((it) => ({ ...it })),
      decor: this.decor.map((d) => ({ ...d })),
      stairsUp: this.stairsUp ? { ...this.stairsUp } : null,
      stairsDown: this.stairsDown ? { ...this.stairsDown } : null,
      stairsDownAll: this.stairsDownAll.map((s) => ({ ...s })),
      temples: this.temples.map((t) => ({ ...t })),
      traps: this.traps.map((t) => ({ ...t })),
      climbable: this.climbable.map((c) => ({ ...c })),
      buriedCount: this.buriedCount, beacon: this.beacon ? { ...this.beacon } : null,
      visited: this.visited, lit: this.lit, killsOnLevel: this.killsOnLevel,
      wanderTimer: this.wanderTimer, wanderCount: this.wanderCount,
      lastStairsDown: this.lastStairsDown ? { ...this.lastStairsDown } : null,
      nextId: this.nextId, debug: { ...this.debug },
    };
  }

  /** Rebuild a Level from serialize() output. */
  static deserialize(d) {
    const lv = new Level({ depth: d.depth, width: d.width, height: d.height, seed: d.seed });
    lv.tiles = rleDecode(d.tiles, d.width * d.height);
    lv.explored = rleDecode(d.explored, d.width * d.height);
    lv.visible = rleDecode(d.visible, d.width * d.height);
    lv.rooms = d.rooms.map((r) => ({ ...r }));
    lv.entities = d.entities.map((e) => JSON.parse(JSON.stringify(e)));
    lv.items = d.items.map((it) => ({ ...it }));
    lv.setDecor((d.decor || []).map((x) => ({ ...x })));
    lv.stairsUp = d.stairsUp ? { ...d.stairsUp } : null;
    lv.stairsDown = d.stairsDown ? { ...d.stairsDown } : null;
    lv.stairsDownAll = (d.stairsDownAll || []).map((s) => ({ ...s }));
    lv.temples = d.temples.map((t) => ({ ...t }));
    lv.traps = (d.traps || []).map((t) => ({ ...t }));
    lv.climbable = (d.climbable || []).map((c) => ({ ...c }));
    lv.buriedCount = d.buriedCount || 0;
    lv.beacon = d.beacon ? { ...d.beacon } : null;
    lv.visited = !!d.visited; lv.lit = !!d.lit; lv.killsOnLevel = d.killsOnLevel || 0;
    lv.wanderTimer = d.wanderTimer || 0; lv.wanderCount = d.wanderCount || 0;
    lv.lastStairsDown = d.lastStairsDown ? { ...d.lastStairsDown } : null;
    lv.nextId = d.nextId || 1;
    lv.debug = { connectivityFixes: 0, ...(d.debug || {}) };
    return lv;
  }
}
