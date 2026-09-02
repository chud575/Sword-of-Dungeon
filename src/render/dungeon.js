// DungeonView: builds instanced tile geometry for a Level (floors, walls, water, stairs, pits,
// temples, traps, rubble), wall torches, and keeps item props in sync with level.items.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { TILE, DIRS8, DIRS4 } from '../core/constants.js';
import { createRng } from '../core/rng.js';
import { createWaterMaterial } from './materials.js';

const FLOOR_TILES = new Set([TILE.FLOOR, TILE.CORRIDOR, TILE.DOOR, TILE.TEMPLE, TILE.TRAP_TELEPORT, TILE.RUBBLE, TILE.STAIRS_UP]);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();

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
    this.floorGeo = new RoundedBoxGeometry(0.985, 0.16, 0.985, 2, 0.018);
    this.floorGeo.translate(0, -0.08, 0);
    this.wallGeo = new RoundedBoxGeometry(1.0, 0.85, 1.0, 2, 0.05);
    this.wallGeo.translate(0, 0.425, 0);
    this.stepGeo = new THREE.BoxGeometry(0.9, 0.16, 0.24);
    this.markers = new THREE.Group();
    this.root.add(this.markers);
    this.beaconView = null; this.beaconKey = null;
    this.climbViews = [];
    this.swordDepth = -1;
    /** geometries created for the current level only (disposed on clear; shared ones live on the instance/prop cache) */
    this.ownedGeos = [];
  }

  /** Register a per-level geometry so clear() can dispose it. */
  own(geo) { this.ownedGeos.push(geo); return geo; }

  /** Rebuild everything for a level. */
  build(level) {
    this.clear();
    this.level = level;
    const rng = createRng(level.seed * 17 + 3);
    const W = level.width, H = level.height;
    const sword = level.depth === this.swordDepth;
    const floorMat = sword ? this.mats.obsidianFloor : this.mats.floor;
    const wallMat = sword ? this.mats.obsidianWall : this.mats.wall;
    const roomOf = new Int16Array(W * H).fill(-1);
    level.rooms.forEach((r, i) => { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (level.inBounds(x, y)) roomOf[y * W + x] = i; });

    const floors = [], walls = [], waterTiles = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = level.get(x, y);
      if (t === TILE.WALL) {
        let exposed = false;
        for (const d of DIRS8) if (level.inBounds(x + d.dx, y + d.dy) && level.get(x + d.dx, y + d.dy) !== TILE.WALL) { exposed = true; break; }
        if (exposed) walls.push({ x, y });
        continue;
      }
      if (t === TILE.WATER) { waterTiles.push({ x, y }); floors.push({ x, y, t, sunk: true }); continue; }
      if (t === TILE.PIT || t === TILE.TRAP_PIT || t === TILE.STAIRS_DOWN) continue; // holes
      floors.push({ x, y, t });
    }

    // Floors (instanced, per-instance AO/variation colour, random quarter-turn).
    const floorMesh = new THREE.InstancedMesh(this.floorGeo, floorMat, Math.max(1, floors.length));
    floorMesh.receiveShadow = true; floorMesh.castShadow = false;
    floors.forEach((f, i) => {
      let ao = 0;
      for (const d of DIRS8) if (level.get(f.x + d.dx, f.y + d.dy) === TILE.WALL) ao += d.dx && d.dy ? 0.5 : 1;
      const room = roomOf[f.y * W + f.x];
      const rt = room >= 0 ? level.rooms[room].type : null;
      let base = 0.86 + rng.float(-0.08, 0.08);
      if (f.t === TILE.CORRIDOR) base *= 0.78;
      if (f.t === TILE.TEMPLE) base = 1.35;
      if (rt === 'crypt') base *= 0.85; else if (rt === 'cistern') base *= 0.9; else if (rt === 'library') base *= 1.05; else if (rt === 'vault') base *= 1.1;
      let r = base, g = base, b = base;
      if (rt === 'cistern') { r *= 0.85; b *= 1.15; }
      if (rt === 'crypt') { r *= 0.95; g *= 0.92; }
      if (rt === 'temple' || rt === 'shrine') { r *= 1.05; g *= 1.05; b *= 1.12; }
      if (f.t === TILE.CORRIDOR && rng.chance(0.25)) { g *= 1.12; r *= 0.9; } // mossy patches
      const shade = 1 - Math.min(0.35, ao * 0.07);
      _c.setRGB(r * shade, g * shade, b * shade);
      _p.set(f.x, f.sunk ? -0.32 : 0, f.y);
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.int(0, 3) * Math.PI / 2);
      _m4.compose(_p, _q, _s);
      floorMesh.setMatrixAt(i, _m4);
      floorMesh.setColorAt(i, _c);
    });
    floorMesh.count = floors.length;
    floorMesh.instanceMatrix.needsUpdate = true;
    if (floorMesh.instanceColor) floorMesh.instanceColor.needsUpdate = true;
    this.root.add(floorMesh);
    this.floorMesh = floorMesh;

    // Walls.
    const wallMesh = new THREE.InstancedMesh(this.wallGeo, wallMat, Math.max(1, walls.length));
    wallMesh.castShadow = true; wallMesh.receiveShadow = true;
    walls.forEach((w, i) => {
      let open = 0;
      for (const d of DIRS4) if (level.get(w.x + d.dx, w.y + d.dy) !== TILE.WALL) open++;
      const v = 0.8 + rng.float(-0.1, 0.1) + open * 0.05;
      _c.setRGB(v, v * (0.97 + rng.float(-0.03, 0.03)), v * 0.95);
      _p.set(w.x, 0, w.y);
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.int(0, 3) * Math.PI / 2);
      _s.set(1, 0.92 + rng.float(0, 0.16), 1);
      _m4.compose(_p, _q, _s);
      _s.set(1, 1, 1);
      wallMesh.setMatrixAt(i, _m4);
      wallMesh.setColorAt(i, _c);
    });
    wallMesh.count = walls.length;
    wallMesh.instanceMatrix.needsUpdate = true;
    if (wallMesh.instanceColor) wallMesh.instanceColor.needsUpdate = true;
    this.root.add(wallMesh);
    this.wallMesh = wallMesh;

    // A black floor far below so holes read as depth (and pits are dark).
    const abyss = new THREE.Mesh(this.own(new THREE.PlaneGeometry(W + 4, H + 4)), this.mats.dark);
    abyss.rotation.x = -Math.PI / 2; abyss.position.set(W / 2 - 0.5, -1.6, H / 2 - 0.5);
    abyss.receiveShadow = false;
    this.root.add(abyss);

    // Water surface: one merged plane.
    if (waterTiles.length) {
      const g = this.own(new THREE.BufferGeometry());
      const pos = [], uv = [], idx = [];
      waterTiles.forEach((w, i) => {
        const x0 = w.x - 0.5, z0 = w.y - 0.5, y = -0.14;
        pos.push(x0, y, z0, x0 + 1, y, z0, x0 + 1, y, z0 + 1, x0, y, z0 + 1);
        uv.push(0, 0, 1, 0, 1, 1, 0, 1);
        const b = i * 4; idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
      });
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      this.waterMat = this.waterMat || createWaterMaterial(this.fog);
      this.water = new THREE.Mesh(g, this.waterMat);
      this.root.add(this.water);
    }

    // Special tiles.
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = level.get(x, y);
      if (t === TILE.STAIRS_DOWN) this.addStairsDown(x, y, level);
      else if (t === TILE.STAIRS_UP) this.addStairsUp(x, y, level);
      else if (t === TILE.PIT || t === TILE.TRAP_PIT) this.addPit(x, y);
      else if (t === TILE.TEMPLE) this.addTemple(x, y);
      else if (t === TILE.TRAP_TELEPORT) this.addAt(this.props.trapRune(), x, y);
      else if (t === TILE.RUBBLE) this.addAt(this.props.rubble(level.seed + x * 131 + y), x, y);
    }
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

  /** Same placement rule as Lighting.setLevel so flames and lights coincide. */
  torchSpotsFor(level) { return this._torchSpots || []; }
  setTorchSpots(spots) { this._torchSpots = spots; }

  addAt(obj, x, y) { obj.position.set(x, 0, y); this.root.add(obj); if (obj.userData.anim) this.animated.push(obj); obj.traverse((o) => { if (o.userData.flame) this.flames.push(o); }); return obj; }

  /** Direction (dx,dy) of a wall neighbour to lean stairs against, defaulting north. */
  wallSide(x, y, level) {
    for (const d of [DIRS4[0], DIRS4[2], DIRS4[1], DIRS4[3]]) if (level.get(x + d.dx, y + d.dy) === TILE.WALL) return d;
    return DIRS4[0];
  }

  addStairsDown(x, y, level) {
    const d = this.wallSide(x, y, level);
    const g = new THREE.Group();
    g.position.set(x, 0, y);
    g.rotation.y = Math.atan2(d.dx, d.dy) + Math.PI; // steps descend toward the wall side
    // shaft walls
    const shaft = new THREE.Mesh(this.own(new THREE.BoxGeometry(1, 1.6, 1)), this.mats.pitWall);
    shaft.position.y = -0.8; shaft.material = this.mats.pitWall;
    const inner = new THREE.Mesh(this.own(new THREE.BoxGeometry(0.92, 1.6, 0.92)), this.mats.dark);
    inner.position.y = -0.82;
    g.add(shaft); g.add(inner);
    for (let i = 0; i < 4; i++) {
      const step = new THREE.Mesh(this.stepGeo, this.mats.rim);
      step.position.set(0, -0.08 - i * 0.2, 0.36 - i * 0.24);
      step.castShadow = true; step.receiveShadow = true;
      g.add(step);
    }
    const arch = this.props.archway(this.mats.rim);
    arch.position.set(0, 0, -0.42);
    g.add(arch);
    this.root.add(g);
  }

  addStairsUp(x, y, level) {
    const d = this.wallSide(x, y, level);
    const g = new THREE.Group();
    g.position.set(x, 0, y);
    g.rotation.y = Math.atan2(d.dx, d.dy) + Math.PI;
    for (let i = 0; i < 4; i++) {
      const step = new THREE.Mesh(this.stepGeo, this.mats.marble);
      step.position.set(0, 0.08 + i * 0.14, 0.34 - i * 0.22);
      step.scale.z = 1 + i * 0.4;
      step.castShadow = true; step.receiveShadow = true;
      g.add(step);
    }
    const arch = this.props.archway(this.mats.marble);
    arch.position.set(0, 0.45, -0.42);
    g.add(arch);
    this.stairGlow = this.stairGlow || (() => { const m = this.mats.holyGlow.clone(); m.opacity = 0.16; return m; })();
    const glow = new THREE.Mesh(this.own(new THREE.PlaneGeometry(0.7, 0.8)), this.stairGlow);
    glow.position.set(0, 0.9, -0.4);
    g.add(glow);
    this.root.add(g);
  }

  addPit(x, y) {
    const g = new THREE.Group();
    g.position.set(x, 0, y);
    const wall = new THREE.Mesh(this.own(new THREE.CylinderGeometry(0.42, 0.38, 1.5, 14, 1, true)), this.mats.pitWall);
    wall.position.y = -0.75; wall.material.side = THREE.BackSide;
    g.add(wall);
    const rim = new THREE.Mesh(this.own(new THREE.TorusGeometry(0.44, 0.07, 8, 18)), this.mats.rim);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.0; rim.castShadow = true; rim.receiveShadow = true;
    g.add(rim);
    // floor ring around the hole (fills the tile)
    const ring = new THREE.Mesh(this.own(new THREE.RingGeometry(0.44, 0.75, 24)), this.mats.dirt);
    ring.rotation.x = -Math.PI / 2; ring.position.y = -0.005; ring.receiveShadow = true;
    g.add(ring);
    this.root.add(g);
  }

  addTemple(x, y) {
    const altar = this.props.altar();
    this.addAt(altar, x, y);
    altar.traverse((o) => { if (o.userData.glow) this.animated.push(o); });
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

  /** Per-frame: item bobbing, flames, water, pickups. */
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
    if (this.floorMesh) { this.floorMesh.dispose(); this.floorMesh = null; }
    if (this.wallMesh) { this.wallMesh.dispose(); this.wallMesh = null; }
    for (const g of this.ownedGeos) g.dispose();
    this.ownedGeos = [];
    this.itemViews.clear(); this.animated = []; this.flames = []; this.water = null; this.pickups = [];
    this.beaconView = null; this.beaconKey = null; this.climbViews = [];
    this.level = null;
  }
}
