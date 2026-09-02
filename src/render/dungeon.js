// DungeonView: builds the diorama for a Level — instanced flagstone slabs (atlas cell, quarter
// turn, tilt and AO per instance), merged wall runs with capstones, water basins with a refracting
// surface, stairwells, pits with crumbling rims and a red glow, temple dressing (pillars, mosaic
// medallion, candles, light shaft), doorway arches and scattered rubble — plus wall torches and
// item props kept in sync with level.items. Everything per level is disposed in clear().
import * as THREE from 'three';
import { TILE, DIRS8, DIRS4 } from '../core/constants.js';
import { createRng } from '../core/rng.js';
import { createWaterMaterial, createShaftMaterial, CELLS, cellUV } from './materials.js';
import { MeshBuilder, slabGeometry, pushWornStep, archGeometry, pillarGeometry, rockGeometry, candleClusterGeometry } from './dungeonGeo.js';

const WALL_H = 0.82;      // body top; caps sit on top
const WALL_BOT = -0.3;    // buried below the floor so gaps never show through
const CAP_OVER = 0.045;   // capstone overhang on exposed sides
const MASONRY_U = 0.25;   // masonry strip spans 4 tiles
const MASONRY_V = 1 / 0.85;
const HOLE_TILES = new Set([TILE.PIT, TILE.TRAP_PIT, TILE.STAIRS_DOWN]);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color(), _e = new THREE.Euler();

export class DungeonView {
  /**
   * @param {THREE.Scene} scene
   * @param {ReturnType<import('./materials.js').createMaterials>} mats
   * @param {import('./props.js').PropFactory} props
   * @param {import('./lighting.js').FogOfWar} fog
   */
  constructor(scene, mats, props, fog) {
    this.scene = scene; this.mats = mats; this.props = props; this.fog = fog;
    this.root = new THREE.Group(); this.root.name = 'dungeon';
    scene.add(this.root);
    this.level = null;
    this.itemViews = new Map();
    this.animated = [];
    this.flames = [];
    this.water = null;
    this.time = 0;
    // shared geometry (lives for the renderer's lifetime)
    this.slabGeos = { full: slabGeometry(0.985, 0.985, 0.2, 0.045), half: slabGeometry(0.985, 0.478, 0.2, 0.04), quarter: slabGeometry(0.478, 0.478, 0.2, 0.035) };
    this.archGeo = archGeometry();
    this.pillarGeo = pillarGeometry();
    this.rockGeo = rockGeometry(createRng('fargoal-rocks'));
    this.shaftMats = { holy: createShaftMaterial(fog, 0xbfe6ff, 0.3, [0, 0.25, 0.5, 1]), ember: createShaftMaterial(fog, 0xff4a14, 0.55, [-1, -0.5, 0.05, 0.95]), stair: createShaftMaterial(fog, 0xdfe9ff, 0.14, [0, 0.2, 0.4, 1]) };
    this.markers = new THREE.Group();
    this.root.add(this.markers);
    this.beaconView = null; this.beaconKey = null;
    this.climbViews = [];
    this.swordDepth = -1;
    /** geometries created for the current level only (disposed on clear; shared ones live on the instance/prop cache) */
    this.ownedGeos = [];
    this.instanced = [];
  }

  /** Register a per-level geometry so clear() can dispose it. */
  own(geo) { this.ownedGeos.push(geo); return geo; }

  /** Tile lookup with out-of-bounds treated as rock. */
  tileAt(x, y) { return this.level.inBounds(x, y) ? this.level.get(x, y) : TILE.WALL; }

  /** Rebuild everything for a level. */
  build(level) {
    this.clear();
    this.level = level;
    const rng = createRng(level.seed * 17 + 3);
    const W = level.width, H = level.height;
    const sword = level.depth === this.swordDepth;
    const M = this.mats;
    const floorMat = sword ? M.obsidianFloor : M.floor;
    const capMat = sword ? M.obsidianCap : M.floorCap;
    const wallMat = sword ? M.obsidianWall : M.wall;
    const roomOf = new Int16Array(W * H).fill(-1);
    level.rooms.forEach((r, i) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (level.inBounds(x, y)) roomOf[y * W + x] = i; });
    this.roomOf = roomOf;
    const T = (x, y) => this.tileAt(x, y);

    const floors = [], walls = [], waterTiles = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = level.get(x, y);
      if (t === TILE.WALL) {
        let exposed = false;
        for (const d of DIRS8) if (T(x + d.dx, y + d.dy) !== TILE.WALL) { exposed = true; break; }
        if (exposed) walls.push({ x, y });
        continue;
      }
      if (t === TILE.WATER) { waterTiles.push({ x, y }); continue; }
      if (HOLE_TILES.has(t)) continue;
      floors.push({ x, y, t });
    }

    // Instanced slab pieces, rocks, arches and pillars are collected first, built once.
    const pieces = { full: [], half: [], quarter: [] };
    const rocks = [], arches = [], pillars = [], posts = [];
    this.pieces = pieces; this.rocks = rocks; this.arches = arches; this.pillars = pillars; this.posts = posts;
    const grout = new MeshBuilder();          // dirt bed under the slabs (shows in the gaps)
    const detail = new MeshBuilder({ color: true, tile: true }); // atlas-textured merged details (pit lips, steps)
    const shafts = new MeshBuilder({ color: true }); // masonry-lined holes: basins, pits, stairwells
    this.detail = detail; this.shafts = shafts;

    // ---------------------------------------------------------------- floors
    for (const f of floors) {
      const room = roomOf[f.y * W + f.x];
      const rt = room >= 0 ? level.rooms[room].type : null;
      let ao = 0, nearWater = false, nearHole = false;
      for (const d of DIRS8) {
        const n = T(f.x + d.dx, f.y + d.dy);
        if (n === TILE.WALL) ao += d.dx && d.dy ? 0.5 : 1;
        else if (n === TILE.WATER) nearWater = true;
        else if (HOLE_TILES.has(n)) nearHole = true;
      }
      const corridor = f.t === TILE.CORRIDOR;
      const templeRoom = rt === 'temple' || rt === 'shrine';
      // layout: whole slab, two halves or four cobbles
      let layout = 'full';
      const lr = rng.next();
      if (f.t === TILE.RUBBLE) layout = 'quarter';
      else if (templeRoom) layout = 'full';
      else if (corridor) layout = lr < 0.3 ? 'quarter' : lr < 0.5 ? 'half' : 'full';
      else layout = lr < 0.05 ? 'quarter' : lr < 0.19 ? 'half' : 'full';
      // base tint
      let base = 0.9 + rng.float(-0.07, 0.07);
      if (corridor) base *= 0.8;
      if (rt === 'crypt') base *= 0.86; else if (rt === 'cistern') base *= 0.9; else if (rt === 'library') base *= 1.04; else if (rt === 'vault') base *= 1.08;
      let r = base, g = base, b = base;
      if (rt === 'cistern') { r *= 0.86; b *= 1.14; }
      if (rt === 'crypt') { r *= 0.96; g *= 0.93; }
      if (templeRoom) { r *= 1.08; g *= 1.08; b *= 1.12; }
      if (nearWater) { r *= 0.7; g *= 0.78; b *= 0.86; }
      if (f.t === TILE.TEMPLE) { r *= 1.1; g *= 1.1; b *= 1.1; }
      const shade = (1 - Math.min(0.38, ao * 0.075)) * (nearHole ? 0.92 : 1);
      const color = [r * shade, g * shade, b * shade];
      // cell choice
      const pickCell = () => {
        if (f.t === TILE.RUBBLE) return rng.pick(CELLS.cracked);
        if (templeRoom) {
          const t2 = T(f.x, f.y);
          if (t2 === TILE.TEMPLE) return CELLS.mosaic;
          let adj = false;
          for (const d of DIRS8) if (T(f.x + d.dx, f.y + d.dy) === TILE.TEMPLE) adj = true;
          return adj ? CELLS.mosaic : CELLS.marble;
        }
        if (nearWater) return rng.pick(CELLS.wet);
        const p = rng.next();
        if (corridor) return p < 0.22 ? rng.pick(CELLS.mossy) : p < 0.34 ? rng.pick(CELLS.cracked) : rng.pick(CELLS.plain);
        const mossP = rt === 'cistern' ? 0.28 : rt === 'crypt' ? 0.14 : 0.06;
        if (p < mossP) return rng.pick(CELLS.mossy);
        if (p < mossP + 0.08) return rng.pick(CELLS.cracked);
        return rng.pick(CELLS.plain);
      };
      const cell = pickCell();
      const yJ = () => rng.float(-0.006, 0.004);
      const tilt = () => rng.float(-0.014, 0.014);
      const push = (kind, x, z, rot, c) => pieces[kind].push({ x, y: yJ(), z, rot, tx: tilt(), tz: tilt(), cell: c, color });
      if (layout === 'full') push('full', f.x, f.y, rng.int(0, 3) * Math.PI / 2, cell);
      else if (layout === 'half') {
        const along = rng.int(0, 1);
        for (const s of [-1, 1]) {
          const c2 = rng.chance(0.5) ? cell : pickCell();
          if (along) push('half', f.x + s * 0.25, f.y, Math.PI / 2 + (rng.chance(0.5) ? Math.PI : 0), c2);
          else push('half', f.x, f.y + s * 0.25, rng.chance(0.5) ? Math.PI : 0, c2);
        }
      } else {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) push('quarter', f.x + sx * 0.25, f.y + sz * 0.25, rng.int(0, 3) * Math.PI / 2, rng.chance(0.4) ? cell : pickCell());
      }
      // dirt bed under the slab
      const x0 = f.x - 0.5, z0 = f.y - 0.5;
      grout.face([[x0, -0.05, z0], [x0 + 1, -0.05, z0], [x0 + 1, -0.05, z0 + 1], [x0, -0.05, z0 + 1]], [0, 1, 0], [[x0 * 0.5, z0 * 0.5], [x0 * 0.5 + 0.5, z0 * 0.5], [x0 * 0.5 + 0.5, z0 * 0.5 + 0.5], [x0 * 0.5, z0 * 0.5 + 0.5]]);
      // rubble: a spill of rocks; corridors: occasional pebbles
      if (f.t === TILE.RUBBLE) for (let i = 0; i < rng.int(7, 11); i++) rocks.push({ x: f.x + rng.float(-0.4, 0.4), y: 0.02, z: f.y + rng.float(-0.4, 0.4), s: rng.float(0.5, 1.5), ry: rng.float(0, 6), tilt: rng.float(-0.5, 0.5), tint: rng.float(0.8, 1.1) });
      else if (corridor && rng.chance(0.09)) for (let i = 0; i < rng.int(1, 3); i++) { const side = rng.chance(0.5) ? -1 : 1; rocks.push({ x: f.x + rng.float(-0.42, 0.42), y: 0.0, z: f.y + side * rng.float(0.25, 0.42), s: rng.float(0.25, 0.5), ry: rng.float(0, 6), tilt: 0, tint: rng.float(0.75, 1.05) }); }
    }

    // ---------------------------------------------------------------- walls (merged: body + caps)
    this.buildWalls(walls, wallMat, capMat, rng);
    const groutMesh = new THREE.Mesh(this.own(grout.build()), M.dirt);
    groutMesh.receiveShadow = true;
    this.root.add(groutMesh);

    // A black floor far below so holes read as depth.
    const abyss = new THREE.Mesh(this.own(new THREE.PlaneGeometry(W + 4, H + 4)), M.dark);
    abyss.rotation.x = -Math.PI / 2; abyss.position.set(W / 2 - 0.5, -1.75, H / 2 - 0.5);
    this.root.add(abyss);

    // ---------------------------------------------------------------- water
    if (waterTiles.length) this.buildWater(waterTiles, shafts);

    // ---------------------------------------------------------------- special tiles
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = level.get(x, y);
      if (t === TILE.STAIRS_DOWN) this.addStairsDown(x, y, rng);
      else if (t === TILE.STAIRS_UP) this.addStairsUp(x, y, rng);
      else if (t === TILE.PIT || t === TILE.TRAP_PIT) this.addPit(x, y, rng);
      else if (t === TILE.TEMPLE) this.addTemple(x, y, rng);
      else if (t === TILE.TRAP_TELEPORT) this.addAt(this.props.trapRune(), x, y);
    }
    this.addDoorways(rng);
    this.addTempleRooms(rng);

    // ---------------------------------------------------------------- merged + instanced meshes
    const detailMesh = new THREE.Mesh(this.own(detail.build()), capMat);
    detailMesh.castShadow = true; detailMesh.receiveShadow = true;
    this.root.add(detailMesh);
    const shaftMesh = new THREE.Mesh(this.own(shafts.build()), M.pitWall);
    shaftMesh.receiveShadow = true;
    this.root.add(shaftMesh);
    this.buildSlabs(floorMat);
    this.buildInstances(rocks, this.rockGeo, M.rock, (r, i, mesh) => {
      _p.set(r.x, r.y, r.z); _e.set(r.tilt, r.ry, r.tilt * 0.6); _q.setFromEuler(_e); _s.set(r.s * (r.sx || 1), r.s * 0.85, r.s * (r.sz || 1));
      _m4.compose(_p, _q, _s); mesh.setMatrixAt(i, _m4); _s.set(1, 1, 1);
      _c.setRGB(r.tint, r.tint * 0.97, r.tint * 0.93); mesh.setColorAt(i, _c);
    }, true);
    this.buildInstances(arches, this.archGeo, M.cutStone, (a, i, mesh) => {
      _p.set(a.x, a.y || 0, a.z); _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), a.ry); _s.set(a.s || 1, a.s || 1, a.s || 1);
      _m4.compose(_p, _q, _s); mesh.setMatrixAt(i, _m4); _s.set(1, 1, 1);
      _c.setRGB(a.tint, a.tint * 0.97, a.tint * 0.94); mesh.setColorAt(i, _c);
    }, true);
    const fillPillar = (p, i, mesh) => {
      _p.set(p.x, 0, p.z); _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry); _s.set(1, p.h || 1, 1);
      _m4.compose(_p, _q, _s); mesh.setMatrixAt(i, _m4); _s.set(1, 1, 1);
      _c.setRGB(p.tint, p.tint, p.tint); mesh.setColorAt(i, _c);
    };
    this.buildInstances(pillars, this.pillarGeo, M.marble, fillPillar, true);
    this.buildInstances(posts, this.pillarGeo, M.cutStone, fillPillar, true);

    // Torches (visual part; lights are in Lighting).
    for (const sp of this.torchSpotsFor(level)) {
      const tch = this.props.torch();
      tch.position.set(sp.x, sp.y, sp.z);
      tch.rotation.y = Math.atan2(sp.nx, sp.nz);
      this.root.add(tch);
      tch.traverse((o) => { if (o.userData.flame) this.flames.push(o); });
    }
    this.syncItems(level, true);
    this.syncMarkers(level, true);
  }

  /** Generic InstancedMesh from a list + fill callback. */
  buildInstances(list, geo, mat, fill, shadows = false) {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => fill(it, i, mesh));
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = shadows; mesh.receiveShadow = true;
    this.root.add(mesh); this.instanced.push(mesh);
    return mesh;
  }

  /** Floor slabs: one InstancedMesh per piece kind, atlas cell through an instanced `aTile`. */
  buildSlabs(mat) {
    for (const kind of ['full', 'half', 'quarter']) {
      const list = this.pieces[kind];
      if (!list.length) continue;
      const geo = this.own(this.slabGeos[kind].clone());
      const tiles = new Float32Array(list.length * 2);
      list.forEach((p, i) => { const [u, v] = cellUV(p.cell); tiles[i * 2] = u; tiles[i * 2 + 1] = v; });
      geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(tiles, 2));
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => {
        _p.set(p.x, p.y, p.z); _e.set(p.tx, p.rot, p.tz); _q.setFromEuler(_e);
        _m4.compose(_p, _q, _s); mesh.setMatrixAt(i, _m4);
        _c.setRGB(p.color[0], p.color[1], p.color[2]); mesh.setColorAt(i, _c);
      });
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
      mesh.receiveShadow = true; mesh.castShadow = false;
      this.root.add(mesh); this.instanced.push(mesh);
    }
  }

  /**
   * Merged wall runs. Group 0 (masonry, world-space UVs) = exposed body faces; group 1 (flagstone
   * atlas) = capstones with overhang. Vertex colours carry per-block tint, foot AO and concave
   * corner AO so long runs read as individually laid stone.
   */
  buildWalls(walls, wallMat, capMat, rng) {
    const b = new MeshBuilder({ color: true, tile: true });
    const T = (x, y) => this.tileAt(x, y);
    // body faces
    for (const w of walls) {
      const tint = 0.84 + rng.float(0, 0.26), warm = rng.float(-0.03, 0.03);
      const col = (k) => [tint * k * (1 + warm), tint * k, tint * k * (1 - warm * 0.5)];
      w.tint = tint; w.warm = warm;
      for (const d of DIRS4) {
        if (T(w.x + d.dx, w.y + d.dy) === TILE.WALL) continue;
        const cx = w.x + d.dx * 0.5, cz = w.y + d.dy * 0.5, px = -d.dy, pz = d.dx;
        const A = [cx - px * 0.5, WALL_BOT, cz - pz * 0.5], B = [cx + px * 0.5, WALL_BOT, cz + pz * 0.5];
        const C = [B[0], WALL_H, B[2]], D = [A[0], WALL_H, A[2]];
        const along = (p) => (d.dy !== 0 ? p[0] : p[2]) * MASONRY_U;
        // concave-corner AO at each end
        const endAO = (e) => { const wx = w.x + px * e, wy = w.y + pz * e; return T(wx, wy) === TILE.WALL && T(wx + d.dx, wy + d.dy) === TILE.WALL ? 0.68 : 1; };
        const aoA = endAO(-1), aoB = endAO(1);
        b.face([A, B, C, D], [d.dx, 0, d.dy],
          [[along(A), WALL_BOT * MASONRY_V], [along(B), WALL_BOT * MASONRY_V], [along(C), WALL_H * MASONRY_V], [along(D), WALL_H * MASONRY_V]],
          [col(0.58 * aoA), col(0.58 * aoB), col(0.97 * aoB), col(0.97 * aoA)]);
      }
    }
    b.endGroup(0);
    // caps
    for (const w of walls) {
      const ex = { n: T(w.x, w.y - 1) !== TILE.WALL, s: T(w.x, w.y + 1) !== TILE.WALL, w: T(w.x - 1, w.y) !== TILE.WALL, e: T(w.x + 1, w.y) !== TILE.WALL };
      const x0 = w.x - 0.5 - (ex.w ? CAP_OVER : 0), x1 = w.x + 0.5 + (ex.e ? CAP_OVER : 0);
      const z0 = w.y - 0.5 - (ex.n ? CAP_OVER : 0), z1 = w.y + 0.5 + (ex.s ? CAP_OVER : 0);
      const capT = 0.06 + rng.float(0, 0.06), top = WALL_H + capT, bot = WALL_H - 0.02;
      const cellIdx = rng.chance(0.12) ? rng.pick(CELLS.cracked) : rng.chance(0.1) ? rng.pick(CELLS.mossy) : rng.pick(CELLS.plain);
      const cell = cellUV(cellIdx);
      const t = w.tint * 0.8, warm = w.warm - 0.04;
      const col = (k) => [t * k * (1 + warm), t * k, t * k * (1 - warm * 0.5)];
      const rot = rng.int(0, 3);
      const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const ruv = uvs.map((_, i) => uvs[(i + rot) % 4]);
      b.face([[x0, top, z0], [x1, top, z0], [x1, top, z1], [x0, top, z1]], [0, 1, 0], ruv, [col(1), col(1), col(1), col(1)], cell);
      const e0 = 0.02, e1 = 0.06, sc = col(0.78), sb = col(0.62);
      b.face([[x0, top, z0], [x0, bot, z0], [x1, bot, z0], [x1, top, z0]], [0, 0, -1], [[0, e1], [0, e0], [1, e0], [1, e1]], [sc, sb, sb, sc], cell);
      b.face([[x1, top, z1], [x1, bot, z1], [x0, bot, z1], [x0, top, z1]], [0, 0, 1], [[0, e1], [0, e0], [1, e0], [1, e1]], [sc, sb, sb, sc], cell);
      b.face([[x0, top, z1], [x0, bot, z1], [x0, bot, z0], [x0, top, z0]], [-1, 0, 0], [[0, e1], [0, e0], [1, e0], [1, e1]], [sc, sb, sb, sc], cell);
      b.face([[x1, top, z0], [x1, bot, z0], [x1, bot, z1], [x1, top, z1]], [1, 0, 0], [[0, e1], [0, e0], [1, e0], [1, e1]], [sc, sb, sb, sc], cell);
    }
    b.endGroup(1);
    const geo = this.own(b.build());
    const mesh = new THREE.Mesh(geo, [wallMat, capMat]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.root.add(mesh);
    this.wallMesh = mesh;
  }

  /** Water: opaque refracting surface (aShore for foam) plus masonry basin walls. */
  buildWater(waterTiles, shafts) {
    const T = (x, y) => this.tileAt(x, y);
    const wb = new MeshBuilder({ shore: true });
    const isWater = (x, y) => T(x, y) === TILE.WATER;
    const cornerShore = (x, y, sx, sz) => (isWater(x + sx, y) && isWater(x, y + sz) && isWater(x + sx, y + sz)) ? 1 : 0;
    const Y = -0.13;
    for (const w of waterTiles) {
      const x0 = w.x - 0.5, z0 = w.y - 0.5;
      const s = [cornerShore(w.x, w.y, -1, -1), cornerShore(w.x, w.y, 1, -1), cornerShore(w.x, w.y, 1, 1), cornerShore(w.x, w.y, -1, 1)];
      wb.face([[x0, Y, z0], [x0 + 1, Y, z0], [x0 + 1, Y, z0 + 1], [x0, Y, z0 + 1]], [0, 1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], null, [0, 0], s);
      // basin walls facing into the water
      for (const d of DIRS4) {
        if (isWater(w.x + d.dx, w.y + d.dy)) continue;
        const inset = 0.012;
        const cx = w.x + d.dx * (0.5 - inset), cz = w.y + d.dy * (0.5 - inset), px = -d.dy, pz = d.dx;
        const A = [cx - px * 0.5, 0.02, cz - pz * 0.5], B = [cx + px * 0.5, 0.02, cz + pz * 0.5];
        const C = [B[0], -0.6, B[2]], D = [A[0], -0.6, A[2]];
        const along = (p) => (d.dy !== 0 ? p[0] : p[2]) * MASONRY_U;
        const top = [0.62, 0.66, 0.68], bot = [0.16, 0.22, 0.26];
        shafts.face([A, B, C, D], [-d.dx, 0, -d.dy], [[along(A), 0.02 * MASONRY_V], [along(B), 0.02 * MASONRY_V], [along(C), -0.6 * MASONRY_V], [along(D), -0.6 * MASONRY_V]], [top, top, bot, bot]);
      }
    }
    this.waterMat = this.waterMat || createWaterMaterial(this.fog);
    this.water = new THREE.Mesh(this.own(wb.build()), this.waterMat);
    this.water.receiveShadow = false;
    this.root.add(this.water);
  }

  /** Same placement rule as Lighting.setLevel so flames and lights coincide. */
  torchSpotsFor(level) { return this._torchSpots || []; }
  setTorchSpots(spots) { this._torchSpots = spots; }

  addAt(obj, x, y) { obj.position.set(x, 0, y); this.root.add(obj); if (obj.userData.anim) this.animated.push(obj); obj.traverse((o) => { if (o.userData.flame) this.flames.push(o); }); return obj; }

  /** Direction (dx,dy) of a wall neighbour to lean stairs against, defaulting north. */
  wallSide(x, y, level) {
    for (const d of [DIRS4[0], DIRS4[2], DIRS4[1], DIRS4[3]]) if (this.tileAt(x + d.dx, y + d.dy) === TILE.WALL) return d;
    return DIRS4[0];
  }

  /** Local frame for a tile leaning on wall side d: local -z points at the wall. */
  frameFor(x, y, d) { return new THREE.Matrix4().compose(new THREE.Vector3(x, 0, y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(d.dx, d.dy) + Math.PI), new THREE.Vector3(1, 1, 1)); }

  /** Square shaft lining for a hole tile (inner faces from y=top down to y=bottom). */
  pushSquareShaft(x, y, top, bottom, colTop, colBot, glow = null) {
    const inset = 0.01;
    for (const d of DIRS4) {
      const cx = x + d.dx * (0.5 - inset), cz = y + d.dy * (0.5 - inset), px = -d.dy, pz = d.dx;
      const A = [cx - px * 0.5, top, cz - pz * 0.5], B = [cx + px * 0.5, top, cz + pz * 0.5];
      const C = [B[0], bottom, B[2]], D = [A[0], bottom, A[2]];
      const along = (p) => (d.dy !== 0 ? p[0] : p[2]) * MASONRY_U;
      const cb = glow || colBot;
      this.shafts.face([A, B, C, D], [-d.dx, 0, -d.dy], [[along(A), top * MASONRY_V], [along(B), top * MASONRY_V], [along(C), bottom * MASONRY_V], [along(D), bottom * MASONRY_V]], [colTop, colTop, cb, cb]);
    }
  }

  addStairsDown(x, y, rng) {
    const d = this.wallSide(x, y, this.level);
    const frame = this.frameFor(x, y, d);
    this.pushSquareShaft(x, y, 0.01, -1.6, [0.8, 0.78, 0.75], [0.1, 0.1, 0.12]);
    const cell = cellUV(rng.pick(CELLS.plain));
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Matrix4().makeTranslation(0, -0.045 - i * 0.2, 0.38 - i * 0.19).premultiply(frame);
      pushWornStep(this.detail, m, 0.94, 0.21, 0.26, cell, 1 - i * 0.1, 0.022);
    }
    // squat newel posts at the top of the flight (a tall arch here would hide the treads from the camera)
    const ry = Math.atan2(d.dx, d.dy) + Math.PI;
    for (const sx of [-0.44, 0.44]) {
      const p = new THREE.Vector3(sx, 0, 0.44).applyMatrix4(frame);
      this.posts.push({ x: p.x, z: p.z, ry, tint: 0.9 + rng.float(0, 0.15), h: 0.42 });
    }
    // the passage continues under the wall: a dark tunnel mouth in the far shaft wall
    const mouth = new THREE.Mesh(this.own(new THREE.PlaneGeometry(0.7, 0.75)), this.mats.dark);
    mouth.position.copy(new THREE.Vector3(0, -0.9, -0.475).applyMatrix4(frame));
    mouth.rotation.y = ry;
    this.root.add(mouth);
    // faint cool light rising from below (the level beneath)
    const shaft = new THREE.Mesh(this.own(new THREE.CylinderGeometry(0.28, 0.36, 1.2, 12, 1, true)), this.shaftMats.stair);
    shaft.position.set(x, -0.9, y);
    this.root.add(shaft);
  }

  addStairsUp(x, y, rng) {
    const d = this.wallSide(x, y, this.level);
    const frame = this.frameFor(x, y, d);
    const cell = cellUV(CELLS.marble);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Matrix4().makeTranslation(0, 0.12 + i * 0.15, 0.34 - i * 0.2).premultiply(frame);
      pushWornStep(this.detail, m, 0.96, 0.22 + (i === 3 ? 0.14 : 0), 0.12 + i * 0.15 + 0.06, cell, 1.05, 0.02);
    }
    const g = new THREE.Group();
    g.applyMatrix4(frame);
    // dark doorway recess cut into the wall face, with the light of the level above spilling out
    const recess = new THREE.Mesh(this.own(new THREE.PlaneGeometry(0.62, 0.9)), this.mats.dark);
    recess.position.set(0, 0.62 + 0.45, -0.485);
    g.add(recess);
    this.stairGlow = this.stairGlow || (() => { const m = this.mats.holyGlow.clone(); m.opacity = 0.22; return m; })();
    const glow = new THREE.Mesh(this.own(new THREE.PlaneGeometry(0.58, 0.8)), this.stairGlow);
    glow.position.set(0, 1.05, -0.46);
    g.add(glow);
    const shaft = new THREE.Mesh(this.own(new THREE.CylinderGeometry(0.22, 0.42, 1.6, 12, 1, true)), this.shaftMats.stair);
    shaft.position.set(0, 1.3, -0.25); shaft.rotation.x = 0.35;
    g.add(shaft);
    this.root.add(g);
    this.arches.push({ x: x - d.dx * 0.12, z: y - d.dy * 0.12, y: 0.55, ry: Math.atan2(d.dx, d.dy), tint: 1.25, s: 0.9 });
  }

  /** Pit: crumbling flagstone lip, masonry shaft, rocks on the rim and a red glow from far below. */
  addPit(x, y, rng) {
    const N = 20;
    const radii = [];
    for (let i = 0; i < N; i++) radii.push(0.36 + rng.float(0, 0.09));
    const cell = cellUV(rng.pick(CELLS.cracked));
    const ang = (i) => (i / N) * Math.PI * 2;
    // lip: from the ragged hole edge (sagging) out to the tile square
    for (let i = 0; i < N; i++) {
      const i1 = (i + 1) % N;
      const a0 = ang(i), a1 = ang(i1);
      const rIn0 = radii[i], rIn1 = radii[i1];
      const rOut = (a) => 0.495 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
      const P = (r, a, yy) => [x + Math.cos(a) * r, yy, y + Math.sin(a) * r];
      const uv = (p) => [p[0] - x + 0.5, p[2] - y + 0.5];
      const q = [P(rIn0, a0, -0.035), P(rOut(a0), a0, 0), P(rOut(a1), a1, 0), P(rIn1, a1, -0.035)];
      const cin = [0.5, 0.47, 0.45], cout = [0.92, 0.9, 0.88];
      this.detail.face(q, [0, 1, 0], q.map(uv), [cin, cout, cout, cin], cell);
    }
    // shaft: three rings, darkening then warming to ember red at the bottom
    const rings = [[0.0, 1.0, [0.55, 0.5, 0.48]], [-0.55, 1.03, [0.2, 0.17, 0.16]], [-1.1, 0.98, [0.12, 0.06, 0.05]], [-1.6, 0.9, [0.55, 0.12, 0.04]]];
    for (let k = 0; k < rings.length - 1; k++) {
      const [y0, s0, c0] = rings[k], [y1, s1, c1] = rings[k + 1];
      for (let i = 0; i < N; i++) {
        const i1 = (i + 1) % N, a0 = ang(i), a1 = ang(i1);
        const P = (r, a, yy) => [x + Math.cos(a) * r, yy, y + Math.sin(a) * r];
        const u0 = (i / N) * 2.6 * MASONRY_U * 4, u1 = ((i + 1) / N) * 2.6 * MASONRY_U * 4;
        const q = [P(radii[i] * s0, a0, y0), P(radii[i1] * s0, a1, y0), P(radii[i1] * s1, a1, y1), P(radii[i] * s1, a0, y1)];
        const n = [-Math.cos((a0 + a1) / 2), 0, -Math.sin((a0 + a1) / 2)];
        this.shafts.face(q, n, [[u0, y0 * MASONRY_V], [u1, y0 * MASONRY_V], [u1, y1 * MASONRY_V], [u0, y1 * MASONRY_V]], [c0, c0, c1, c1]);
      }
    }
    // rim rocks
    for (let i = 0; i < rng.int(7, 10); i++) {
      const a = rng.float(0, Math.PI * 2), r = rng.float(0.4, 0.5);
      this.rocks.push({ x: x + Math.cos(a) * r, y: 0.0, z: y + Math.sin(a) * r, s: rng.float(0.35, 0.75), ry: rng.float(0, 6), tilt: rng.float(-0.6, 0.6), tint: rng.float(0.75, 1.05) });
    }
    // ember glow: emissive disc far below + additive haze rising in the shaft
    const disc = new THREE.Mesh(this.own(new THREE.CircleGeometry(0.34, 20)), this.mats.emberFloor);
    disc.rotation.x = -Math.PI / 2; disc.position.set(x, -1.62, y);
    this.root.add(disc);
    const haze = new THREE.Mesh(this.own(new THREE.CylinderGeometry(0.3, 0.34, 1.35, 14, 1, true)), this.shaftMats.ember);
    haze.position.set(x, -0.95, y);
    this.root.add(haze);
  }

  /** The temple tile: the prop altar plus a mosaic medallion, candle clusters and a light shaft. */
  addTemple(x, y, rng) {
    const altar = this.props.altar();
    this.addAt(altar, x, y);
    altar.traverse((o) => { if (o.userData.glow) this.animated.push(o); });
    const med = new THREE.Mesh(this.own(new THREE.RingGeometry(0.5, 1.42, 40)), this.mats.medallion);
    med.rotation.x = -Math.PI / 2; med.position.set(x, 0.012, y); med.receiveShadow = true;
    this.root.add(med);
    const shaft = new THREE.Mesh(this.own(new THREE.CylinderGeometry(0.3, 0.55, 3.4, 16, 1, true)), this.shaftMats.holy);
    shaft.position.set(x, 1.75, y);
    this.root.add(shaft);
    for (const [sx, sz] of [[-0.62, 0.62], [0.62, 0.62], [-0.62, -0.62], [0.62, -0.62]]) {
      if (!this.level.isWalkable(x + Math.sign(sx), y + Math.sign(sz))) continue;
      const { geometry, tips } = candleClusterGeometry(rng);
      const g = new THREE.Group();
      g.position.set(x + sx, 0, y + sz);
      const body = new THREE.Mesh(this.own(geometry), this.mats.candle);
      body.castShadow = true;
      g.add(body);
      for (const [tx, ty, tz] of tips) {
        const fl = new THREE.Mesh(this.flameGeo || (this.flameGeo = new THREE.ConeGeometry(0.02, 0.06, 6)), this.mats.flame);
        fl.position.set(tx, ty, tz); fl.userData.flame = true;
        g.add(fl); this.flames.push(fl);
      }
      this.root.add(g);
    }
  }

  /** Temple / shrine rooms get marble pillars in their inner corners. */
  addTempleRooms(rng) {
    for (const r of this.level.rooms) {
      if (r.type !== 'temple' && r.type !== 'shrine') continue;
      if (r.w < 3 || r.h < 3) continue;
      const corners = [[r.x, r.y, 1, 1], [r.x + r.w - 1, r.y, -1, 1], [r.x, r.y + r.h - 1, 1, -1], [r.x + r.w - 1, r.y + r.h - 1, -1, -1]];
      for (const [cx, cy, sx, sz] of corners) {
        if (this.tileAt(cx, cy) === TILE.WALL || this.tileAt(cx - sx, cy) !== TILE.WALL || this.tileAt(cx, cy - sz) !== TILE.WALL) continue;
        this.pillars.push({ x: cx - sx * 0.33, z: cy - sz * 0.33, ry: rng.int(0, 3) * Math.PI / 2, tint: 0.95 + rng.float(0, 0.1), h: 1 });
      }
    }
  }

  /** Lintelled doorways where a corridor (or door tile) enters a room between two wall stubs. */
  addDoorways(rng) {
    const lv = this.level, T = (x, y) => this.tileAt(x, y);
    for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) {
      const t = lv.get(x, y);
      if (t !== TILE.CORRIDOR && t !== TILE.DOOR) continue;
      if (HOLE_TILES.has(t)) continue;
      for (const d of DIRS4) {
        const px = -d.dy, pz = d.dx;
        if (T(x + px, y + pz) !== TILE.WALL || T(x - px, y - pz) !== TILE.WALL) continue;
        const ahead = T(x + d.dx, y + d.dy), behind = T(x - d.dx, y - d.dy);
        if (behind === TILE.WALL || ahead === TILE.WALL) continue;
        const room = this.roomOf[(y + d.dy) * lv.width + x + d.dx];
        const enters = t === TILE.DOOR || (ahead === TILE.FLOOR && room >= 0 && this.roomOf[y * lv.width + x] < 0);
        if (!enters) continue;
        this.arches.push({ x, z: y, ry: Math.atan2(d.dx, d.dy), tint: 0.82 + rng.float(0, 0.2) });
        break;
      }
    }
  }

  /** Add/remove item props to match level.items. */
  syncItems(level, force = false) {
    const seen = new Set();
    for (const it of level.items) {
      seen.add(it.id);
      if (this.itemViews.has(it.id)) continue;
      const v = this.props.item(it);
      v.position.set(it.x, 0, it.y);
      v.userData.item = it;
      this.root.add(v);
      this.itemViews.set(it.id, v);
    }
    for (const [id, v] of this.itemViews) {
      if (seen.has(id)) continue;
      this.itemViews.delete(id);
      if (force) { this.root.remove(v); continue; }
      // pickup animation: rise, shrink, vanish
      v.userData.pickup = 0;
      this.pickups = this.pickups || [];
      this.pickups.push(v);
    }
  }

  syncMarkers(level) {
    const key = level.beacon ? `${level.beacon.x},${level.beacon.y}` : null;
    if (key !== this.beaconKey) {
      if (this.beaconView) { this.markers.remove(this.beaconView); this.beaconView = null; }
      if (level.beacon) { this.beaconView = this.props.beaconMarker(); this.beaconView.position.set(level.beacon.x, 0, level.beacon.y); this.markers.add(this.beaconView); }
      this.beaconKey = key;
    }
    if (this.climbViews.length !== level.climbable.length) {
      for (const c of this.climbViews) this.markers.remove(c);
      this.climbViews = level.climbable.map((c) => { const m = this.props.climbMarker(); m.position.set(c.x, 0, c.y); this.markers.add(m); return m; });
    }
  }

  /** Per-frame: item bobbing, flames, water, light shafts, pickups. */
  update(dt) {
    this.time += dt;
    const t = this.time;
    if (!this.level) return;
    this.syncItems(this.level);
    this.syncMarkers(this.level);
    for (const v of this.itemViews.values()) {
      const a = v.userData.anim; if (!a) continue;
      a.t += dt;
      const node = a.node || v;
      if (a.amp) node.position.y = a.y0 + Math.sin(a.t * a.speed) * a.amp + (a.node ? 0.55 : 0);
      if (a.spin) node.rotation.y += a.spin * dt;
      if (a.halo) { a.halo.rotation.z += dt * 0.6; a.halo.material.opacity = 0.6 + 0.3 * Math.sin(a.t * 2.5); }
    }
    for (const o of this.animated) {
      const a = o.userData.anim;
      if (a && a.node && a.spin) a.node.rotation.y += a.spin * dt;
      if (o.userData.glow) { o.material.opacity = 0.07 + 0.03 * Math.sin(t * 1.9); o.rotation.y += dt * 0.3; }
    }
    if (this.beaconView) this.beaconView.userData.anim.node.rotation.y += dt * 1.5;
    for (let i = 0; i < this.flames.length; i++) {
      const f = this.flames[i];
      const s = 0.85 + 0.25 * Math.sin(t * 13 + i * 1.7) * Math.sin(t * 7.3 + i);
      f.scale.set(1 + 0.2 * Math.sin(t * 11 + i), s, 1 + 0.2 * Math.cos(t * 9 + i));
      f.rotation.z = 0.15 * Math.sin(t * 6 + i);
    }
    if (this.water) this.waterMat.uniforms.uTime.value = t;
    for (const k in this.shaftMats) this.shaftMats[k].uniforms.uTime.value = t;
    if (this.pickups && this.pickups.length) {
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const v = this.pickups[i];
        v.userData.pickup += dt;
        const k = v.userData.pickup / 0.45;
        if (k >= 1) { this.root.remove(v); this.pickups.splice(i, 1); continue; }
        v.position.y = k * 0.9;
        v.scale.setScalar(1 - k * 0.9);
        v.rotation.y += dt * 8;
      }
    }
  }

  /** Remove everything from the scene. */
  clear() {
    for (const child of [...this.root.children]) { if (child !== this.markers) this.root.remove(child); }
    for (const c of [...this.markers.children]) this.markers.remove(c);
    // free GPU buffers owned by the old level (instance attributes + per-level geometry); shared geometry/materials stay
    for (const m of this.instanced) m.dispose();
    this.instanced = [];
    this.wallMesh = null;
    for (const g of this.ownedGeos) g.dispose();
    this.ownedGeos = [];
    this.itemViews.clear(); this.animated = []; this.flames = []; this.water = null; this.pickups = [];
    this.beaconView = null; this.beaconKey = null; this.climbViews = [];
    this.level = null;
  }
}
