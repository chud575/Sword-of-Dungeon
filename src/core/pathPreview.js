// Path preview: instanced floor markers for the hovered route, the committed click-to-move route
// (a pulse marches from the hero to the destination reticle) and the auto-explore route. Lives in
// the renderer's scene as one InstancedMesh + three destination reticles, so the whole overlay is
// a handful of draw calls drawn as a screen overlay (no depth test: routes stay readable behind walls
// and lit flagstones). Rebuilt lazily whenever the renderer swaps scenes; cleared on level change.
import * as THREE from 'three';

const MAX = 400;
const Y = 0.05;
const COLORS = {
  path: new THREE.Color(0xe8c15a), hover: new THREE.Color(0xb9a98b), route: new THREE.Color(0x4ee1ff), bad: new THREE.Color(0xff5a48), temple: new THREE.Color(0xffd866),
};
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();

function diamondGeometry() { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); g.rotateY(Math.PI / 4); return g; }
function flatRing(inner, outer, segments = 48) { const g = new THREE.RingGeometry(inner, outer, segments); g.rotateX(-Math.PI / 2); return g; }
/** Opaque-ish marker material (normal blending: stays readable on brightly lit floors, unlike additive). */
function markerMat(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide });
}
/** Dark underlay so markers keep contrast on bright flagstones. */
function shadowMat(opacity = 0.55) {
  return new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide });
}
const _white = new THREE.Color(0xffffff);

export class PathPreview {
  /** @param {{bus:import('./events.js').EventBus, getGame:()=>any, getRenderer:()=>any}} opts */
  constructor({ bus, getGame, getRenderer }) {
    this.bus = bus; this.getGame = getGame; this.getRenderer = getRenderer;
    this.enabled = true;
    this.scene = null; this.group = null;
    this.hover = null;      // {tile, path, target, ok}
    this.committed = null;  // {path, target, kind:'path'|'temple'}
    this.route = null;      // explore route {path, target}
    this.exploring = false;
    this.time = 0; this.idle = 0;
    this.unsub = [
      bus.on('level:enter', () => this.clearAll()),
      bus.on('game:start', () => this.clearAll()),
      bus.on('game:over', () => this.clearAll()),
      bus.on('entity:moved', (p) => { if (p.entity && p.entity.kind === 'player') this.onPlayerMoved(p.toX, p.toY); }),
      bus.on('monster:seen', () => this.clearCommitted()),
      bus.on('entity:attacked', () => this.clearCommitted()),
      bus.on('trap:triggered', () => this.clearCommitted()),
      bus.on('item:picked', () => { if (this.exploring) this.refreshRoute(); }),
      bus.on('ui:explore', (p) => { this.exploring = !!p.on; if (this.exploring) { this.committed = null; this.refreshRoute(); } else this.route = null; this.dirty = true; }),
      bus.on('fx:teleport', () => this.clearCommitted()),
    ];
    this.dirty = true;
  }

  dispose() { for (const u of this.unsub) u(); this.unsub = []; if (this.group && this.scene) this.scene.remove(this.group); this.group = null; this.scene = null; }

  /** Build (or rebind) the scene objects. Returns the group or null when no renderer exists yet. */
  ensure() {
    const r = this.getRenderer();
    if (!r || !r.scene) return null;
    if (this.group && this.scene === r.scene) return this.group;
    if (this.group && this.scene) this.scene.remove(this.group);
    this.scene = r.scene;
    const g = new THREE.Group(); g.name = 'pathPreview'; g.renderOrder = 5;
    // per-instance colour comes from instanceColor (no vertexColors: the geometry has no colour attribute)
    if (!this.dotGeo) { this.dotGeo = diamondGeometry(); this.dotMat = markerMat(0xffffff, 0.96); this.shadowDotMat = shadowMat(0.5); }
    const mkInst = (mat, order) => {
      const im = new THREE.InstancedMesh(this.dotGeo, mat, MAX);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0; im.frustumCulled = false; im.renderOrder = order;
      g.add(im); return im;
    };
    this.shadowDots = mkInst(this.shadowDotMat, 20);
    const dots = mkInst(this.dotMat, 21);
    dots.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    dots.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.dots = dots;
    // destination reticles: committed (circle + spinning square), hover (square), route (circle), each over a dark underlay
    const ret = (inner, outer, seg, color, opacity) => {
      const m = new THREE.Mesh(flatRing(inner, outer, seg), markerMat(color, opacity));
      const sh = new THREE.Mesh(flatRing(Math.max(0.02, inner - 0.035), outer + 0.035, seg), shadowMat(0.5));
      sh.position.y = -0.006; sh.renderOrder = 20; sh.frustumCulled = false; m.add(sh);
      m.visible = false; m.frustumCulled = false; m.renderOrder = 21; m.position.y = Y; g.add(m);
      return m;
    };
    this.destRing = ret(0.3, 0.36, 48, 0xe8c15a, 0.95);
    this.destSquare = ret(0.44, 0.48, 4, 0xe8c15a, 0.85);
    this.hoverSquare = ret(0.4, 0.44, 4, 0xb9a98b, 0.7);
    this.routeRing = ret(0.24, 0.3, 48, 0x4ee1ff, 0.9);
    this.destSquare.rotation.y = Math.PI / 4; this.hoverSquare.rotation.y = Math.PI / 4;
    this.scene.add(g);
    this.group = g;
    this.dirty = true;
    return g;
  }

  /** Is the renderer currently showing the game we preview for (not the title backdrop)? */
  active() {
    const g = this.getGame(), r = this.getRenderer();
    return !!(this.enabled && g && r && r.game === g && !g.over);
  }

  /** Hover a tile (or null): computes the would-be route. */
  setHover(tile) {
    const g = this.getGame();
    if (!tile || !this.active()) { if (this.hover) { this.hover = null; this.dirty = true; } return; }
    if (this.hover && this.hover.tile.x === tile.x && this.hover.tile.y === tile.y) return;
    const lv = g.level, p = g.player;
    let path = null, ok = false, kind = 'hover';
    if (lv.isExplored(tile.x, tile.y) && (tile.x !== p.x || tile.y !== p.y)) {
      const m = lv.monsterAt(tile.x, tile.y);
      if (!(m && Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= 1)) path = g.pathTo(tile.x, tile.y);
      ok = !!(path && path.length);
      if (ok && lv.isTemple(tile.x, tile.y)) kind = 'temple';
      if (!ok && !lv.isWalkable(tile.x, tile.y)) { this.hover = null; this.dirty = true; return; }
    } else { this.hover = null; this.dirty = true; return; }
    this.hover = { tile: { x: tile.x, y: tile.y }, path: ok ? path : null, target: ok ? path[path.length - 1] : { x: tile.x, y: tile.y }, ok, kind };
    this.flush();
  }

  /** Write the current state into the scene right away (the RAF loop may be stopped by QA bots). */
  flush() { this.dirty = true; if (this.ensure()) this.write(); }

  /** Commit a route (mirrors main.js click-to-move). */
  commit(path, kind = 'path') {
    if (!path || !path.length) { this.clearCommitted(); return; }
    this.committed = { path: path.map((s) => ({ x: s.x, y: s.y })), target: { x: path[path.length - 1].x, y: path[path.length - 1].y }, kind };
    this.hover = null; this.idle = 0; this.route = null;
    this.flush();
  }

  clearCommitted() { if (this.committed) { this.committed = null; this.flush(); } }
  clearAll() { this.committed = null; this.hover = null; this.route = null; this.flush(); }

  onPlayerMoved(x, y) {
    if (this.committed) {
      const c = this.committed;
      const i = c.path.findIndex((s) => s.x === x && s.y === y);
      if (i >= 0) { c.path.splice(0, i + 1); this.idle = 0; if (!c.path.length) this.committed = null; }
      else this.committed = null; // walked somewhere else: the route is stale
    }
    this.hover = null;
    if (this.exploring) this.refreshRoute(); else this.flush();
  }

  /** Recompute the auto-explore route from the player's tile. */
  refreshRoute() {
    const g = this.getGame();
    if (!g || !this.active()) { this.route = null; return; }
    const s = g.autoExplore();
    this.route = s ? { path: s.path.map((t) => ({ x: t.x, y: t.y })), target: { x: s.target.x, y: s.target.y }, goal: s.goal } : null;
    this.flush();
  }

  /** Per-frame animation + instance refresh. */
  update(dt) {
    this.time += dt;
    const g = this.getGame();
    if (!this.ensure()) return;
    if (!this.active()) { if (this.dots.count || this.destRing.visible || this.hoverSquare.visible || this.routeRing.visible) { this.clearAll(); this.write(); } return; }
    if (this.committed && !g.paused) { this.idle += dt; if (this.idle > 1.5) this.clearCommitted(); }
    this.write();
  }

  /** Push everything into the instanced mesh and reticles. */
  write() {
    const dots = this.dots;
    let n = 0;
    const t = this.time;
    const shadow = this.shadowDots;
    // k < 1 dims the marker towards its own colour; k > 1 lifts it towards white (the marching pulse)
    const put = (x, y, size, color, k) => {
      if (n >= MAX) return;
      _p.set(x, Y, y); _s.setScalar(size); _m.compose(_p, _q, _s);
      dots.setMatrixAt(n, _m);
      _p.y = Y - 0.006; _s.setScalar(size * 1.55); _m.compose(_p, _q, _s);
      shadow.setMatrixAt(n, _m);
      if (k >= 1) _c.copy(color).lerp(_white, Math.min(1, (k - 1) * 1.6)); else _c.copy(color).multiplyScalar(0.55 + 0.45 * k);
      dots.setColorAt(n, _c);
      n++;
    };
    if (this.route && this.exploring) {
      const path = this.route.path;
      for (let i = 0; i < path.length; i++) {
        const w = Math.max(0, Math.cos(i * 0.5 - t * 3.2)); const k = 0.28 + 0.5 * w * w * w;
        put(path[i].x, path[i].y, 0.16 + 0.06 * w, COLORS.route, k);
      }
    }
    if (this.committed) {
      const path = this.committed.path, col = this.committed.kind === 'temple' ? COLORS.temple : COLORS.path;
      for (let i = 0; i < path.length; i++) {
        const w = Math.max(0, Math.cos(i * 0.55 - t * 4.2)); const k = 0.45 + 0.65 * w * w * w;
        put(path[i].x, path[i].y, 0.19 + 0.07 * w, col, k);
      }
    }
    if (this.hover && this.hover.path && !this.committed) {
      const path = this.hover.path, col = this.hover.kind === 'temple' ? COLORS.temple : COLORS.hover;
      for (let i = 0; i < path.length; i++) put(path[i].x, path[i].y, 0.13, col, 0.5);
    }
    dots.count = n; shadow.count = n;
    dots.instanceMatrix.needsUpdate = true; shadow.instanceMatrix.needsUpdate = true;
    if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
    // reticles
    const pulse = 1 + 0.07 * Math.sin(t * 3.4);
    const setRet = (mesh, target, scale) => { mesh.visible = !!target; if (target) { mesh.position.set(target.x, Y, target.y); mesh.scale.setScalar(scale); } };
    setRet(this.destRing, this.committed && this.committed.target, pulse);
    setRet(this.destSquare, this.committed && this.committed.target, 1 / pulse);
    if (this.committed) { this.destSquare.rotation.y = Math.PI / 4 + t * 0.9; this.destRing.material.color.copy(this.committed.kind === 'temple' ? COLORS.temple : COLORS.path); this.destSquare.material.color.copy(this.destRing.material.color); }
    const hv = this.hover && !this.committed ? this.hover : null;
    setRet(this.hoverSquare, hv && hv.target, hv && hv.ok ? 1 : 0.85);
    if (hv) this.hoverSquare.material.color.copy(hv.ok ? (hv.kind === 'temple' ? COLORS.temple : COLORS.hover) : COLORS.bad);
    setRet(this.routeRing, this.route && this.exploring && !this.committed ? this.route.target : null, pulse);
    this.dirty = false;
  }

  /** Snapshot for tests. */
  state() {
    return {
      hover: this.hover ? { tile: this.hover.tile, len: this.hover.path ? this.hover.path.length : 0, ok: this.hover.ok } : null,
      committed: this.committed ? { len: this.committed.path.length, target: this.committed.target, kind: this.committed.kind } : null,
      route: this.route ? { len: this.route.path.length, target: this.route.target, goal: this.route.goal } : null,
      exploring: this.exploring, dots: this.dots ? this.dots.count : 0, inScene: !!(this.group && this.group.parent),
    };
  }
}
