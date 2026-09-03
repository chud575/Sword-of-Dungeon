// Minimap: an "ink on parchment" 2D canvas of the explored level — floors, wall outlines, stairs /
// temple / pit / trap glyphs, gold, buried caches, hidden squares, the beacon, the Sword, every
// monster standing on an explored tile (the original C64 rule) plus a fading memory of monsters
// that slipped back into the dark, and the player with a heading wedge. Toggle with M; hovering
// zooms it smoothly (wheel over it for finer zoom). Static tiles are cached in an offscreen canvas
// and only rebuilt when exploration, zoom or the level changes. Styles live in ./panels.css.
import './panels.css';
import { TILE } from '../core/constants.js';
import { icon } from './icons.js';

const VARS = ['floor', 'wall', 'stairs-down', 'stairs-up', 'temple', 'pit', 'water', 'player', 'monster', 'gold', 'trap', 'beacon'];
const SMALL = 3.4, BIG = 7.6;
const GHOST_TTL = 25; // seconds a monster's last known position stays on the map

export class Minimap {
  /** @param {{root:HTMLElement, bus:import('../core/events.js').EventBus, getGame:()=>any, settings:object, renderer?:any}} ctx */
  constructor(ctx) {
    this.ctx = ctx; this.bus = ctx.bus;
    this.scale = SMALL; this.bigScale = BIG; // kept for callers that poke them
    this.big = false; this.userZoom = 1; this.cur = SMALL;
    this.visible = ctx.settings.minimap !== false;
    this.el = document.createElement('div');
    this.el.className = 'panel hud px'; this.el.id = 'minimap';
    this.el.innerHTML = `<div class="corners"><i></i><i></i><i></i><i></i></div><div class="filet"></div>
      <div class="cap"><span class="label">${icon('maps')}Map</span><span class="meta"></span><span class="hint">M</span></div>
      <div class="wrap"><canvas></canvas><div class="toast"></div></div>
      <div class="legend">
        <span><i class="tri" style="--c:var(--mm-stairs-down)"></i>Down</span><span><i class="ring" style="--c:var(--mm-stairs-up)"></i>Up</span>
        <span><i class="sq" style="--c:var(--mm-temple)"></i>Temple</span><span><i style="--c:var(--mm-gold)"></i>Gold</span>
        <span><i class="sq" style="--c:var(--mm-trap)"></i>Hidden</span><span><i style="--c:var(--mm-monster)"></i>Monster</span>
        <span><i style="--c:var(--mm-beacon)"></i>Beacon</span><span><i class="ring" style="--c:var(--mm-player)"></i>You</span>
      </div>`;
    this.canvas = this.el.querySelector('canvas');
    this.meta = this.el.querySelector('.meta');
    this.toastEl = this.el.querySelector('.toast');
    this.g2d = this.canvas.getContext('2d');
    this.layer = document.createElement('canvas'); this.l2d = this.layer.getContext('2d');
    this.layerKey = '';
    this.el.addEventListener('mouseenter', () => { this.big = true; this.dirty = true; });
    this.el.addEventListener('mouseleave', () => { this.big = false; this.dirty = true; });
    this.el.addEventListener('click', () => this.bus.emit('sfx:ui', { kind: 'click' }));
    this.el.addEventListener('wheel', (e) => {
      e.preventDefault(); e.stopPropagation();
      this.userZoom = Math.max(0.7, Math.min(1.8, this.userZoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      this.toast(`${Math.round(this.userZoom * 100)}%`); this.dirty = true;
    }, { passive: false });
    ctx.root.appendChild(this.el);
    this.el.hidden = !this.visible;
    this.colors = {};
    this.readColors();
    this.time = 0; this.acc = 0; this.dirty = true; this.toastT = 0;
    this.seen = new Map(); // monster id -> {x, y, t}
    this.dpr = 1;
    this.unsub = [
      this.bus.on('settings:changed', () => { this.readColors(); this.layerKey = ''; this.dirty = true; }),
      this.bus.on('level:enter', () => { this.seen.clear(); this.layerKey = ''; this.dirty = true; }),
      this.bus.on('game:start', () => { this.seen.clear(); this.layerKey = ''; this.dirty = true; }),
    ];
  }

  readColors() {
    const cs = getComputedStyle(document.body);
    for (const v of VARS) this.colors[v] = (cs.getPropertyValue('--mm-' + v) || '').trim() || '#fff';
    this.colors.quest = (cs.getPropertyValue('--quest') || '').trim() || '#c58cff';
    this.colors.gold2 = (cs.getPropertyValue('--gold') || '').trim() || '#e8c15a';
  }

  toggle(force) { this.visible = force === undefined ? !this.visible : !!force; this.el.hidden = !this.visible; this.dirty = true; return this.visible; }

  toast(text) { this.toastEl.textContent = text; this.toastEl.classList.add('show'); this.toastT = 1.1; }

  update(dt) {
    this.time += dt; this.acc += dt;
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastEl.classList.remove('show'); }
    if (!this.visible) return;
    // smooth zoom toward the target scale (critically damped-ish lerp)
    const target = (this.big ? this.bigScale : this.scale) * (this.big ? this.userZoom : 1);
    const zooming = Math.abs(this.cur - target) > 0.02;
    if (zooming) { this.cur += (target - this.cur) * Math.min(1, dt * 14); if (Math.abs(this.cur - target) <= 0.02) this.cur = target; }
    if (!zooming && this.acc < 0.08 && !this.dirty) return; // ~12 Hz is plenty; pulses read fine
    this.acc = 0; this.dirty = false;
    this.el.classList.toggle('big', this.big);
    this.draw();
  }

  /** Rebuild the cached tile layer if exploration / zoom / level changed. Returns explored %. */
  buildLayer(lv, s, allLit) {
    const W = lv.width, H = lv.height, C = this.colors;
    let explored = 0, open = 0;
    for (let i = 0; i < lv.tiles.length; i++) { if (lv.tiles[i] === TILE.WALL) continue; open++; if (allLit || lv.explored[i]) explored++; }
    const key = `${lv.depth}:${lv.seed}:${s.toFixed(2)}:${explored}:${allLit ? 1 : 0}:${this.dpr}:${lv.climbable.length}`;
    if (key === this.layerKey) return this.pct;
    this.layerKey = key; this.pct = open ? Math.round(100 * explored / open) : 0;
    const pw = Math.ceil(W * s * this.dpr), ph = Math.ceil(H * s * this.dpr);
    if (this.layer.width !== pw || this.layer.height !== ph) { this.layer.width = pw; this.layer.height = ph; }
    const c = this.l2d;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W * s, H * s);
    const seen = (x, y) => allLit || lv.isExplored(x, y);
    const at = (x, y) => (lv.inBounds(x, y) ? lv.tiles[y * W + x] : TILE.WALL);
    const floorCol = C.floor, corrCol = shade(C.floor, 0.78), wallCol = C.wall;
    // pass 1: fills
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!seen(x, y)) continue;
      const t = at(x, y), px = x * s, py = y * s;
      switch (t) {
        case TILE.WALL: c.fillStyle = wallCol; c.fillRect(px, py, s, s); break;
        case TILE.CORRIDOR: c.fillStyle = corrCol; c.fillRect(px, py, s, s); break;
        case TILE.RUBBLE: c.fillStyle = shade(C.floor, 0.62); c.fillRect(px, py, s, s); break;
        case TILE.WATER: c.fillStyle = floorCol; c.fillRect(px, py, s, s); c.fillStyle = C.water; c.globalAlpha = 0.85; c.fillRect(px, py, s, s); c.globalAlpha = 1; break;
        default: c.fillStyle = floorCol; c.fillRect(px, py, s, s);
      }
    }
    // pass 2: wall outlines — a hairline wherever explored open floor meets rock (the C64 rule)
    const lw = s >= 6 ? 1.5 : 1;
    c.strokeStyle = shade(C.floor, 1.55); c.lineWidth = lw; c.lineCap = 'butt';
    c.beginPath();
    const half = lw / 2;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!seen(x, y) || at(x, y) === TILE.WALL) continue;
      const px = x * s, py = y * s;
      if (at(x, y - 1) === TILE.WALL) { c.moveTo(px, py + half); c.lineTo(px + s, py + half); }
      if (at(x, y + 1) === TILE.WALL) { c.moveTo(px, py + s - half); c.lineTo(px + s, py + s - half); }
      if (at(x - 1, y) === TILE.WALL) { c.moveTo(px + half, py); c.lineTo(px + half, py + s); }
      if (at(x + 1, y) === TILE.WALL) { c.moveTo(px + s - half, py); c.lineTo(px + s - half, py + s); }
    }
    c.globalAlpha = 0.75; c.stroke(); c.globalAlpha = 1;
    // pass 3: glyphs
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!seen(x, y)) continue;
      const t = at(x, y), px = x * s, py = y * s, cx = px + s / 2, cy = py + s / 2;
      if (t === TILE.STAIRS_DOWN) { glow(c, cx, cy, s * 1.2, C['stairs-down']); c.fillStyle = C['stairs-down']; c.fillRect(px, py, s, s); chevron(c, cx, cy, s, 1, '#0a1220'); }
      else if (t === TILE.STAIRS_UP) { glow(c, cx, cy, s * 1.2, C['stairs-up']); c.fillStyle = C['stairs-up']; c.fillRect(px, py, s, s); chevron(c, cx, cy, s, -1, '#1a1612'); }
      else if (t === TILE.TEMPLE) { glow(c, cx, cy, s * 1.6, C.temple); c.fillStyle = C.temple; c.fillRect(px, py, s, s); cross(c, cx, cy, s * 0.36, '#3a2a08', Math.max(1, s * 0.18)); }
      else if (t === TILE.PIT || t === TILE.TRAP_PIT) { c.fillStyle = C.pit; c.fillRect(px, py, s, s); ring(c, cx, cy, s * 0.36, shade(C.floor, 1.35), 0.9, Math.max(1, s * 0.14)); }
      else if (t === TILE.TRAP_TELEPORT) { diamond(c, cx, cy, s * 0.42, C.trap); }
      else if (t === TILE.RUBBLE) { c.fillStyle = shade(C.floor, 1.2); c.fillRect(cx - s * 0.12, cy - s * 0.12, s * 0.24, s * 0.24); }
    }
    for (const cl of lv.climbable) ring(c, cl.x * s + s / 2, cl.y * s + s / 2, s * 0.4, C['stairs-up'], 0.9, Math.max(1, s * 0.14));
    return this.pct;
  }

  draw() {
    const g = this.ctx.getGame(); if (!g || !g.level) return;
    const lv = g.level, p = g.player, C = this.colors;
    const s = this.cur;
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    if (dpr !== this.dpr) { this.dpr = dpr; this.layerKey = ''; }
    const W = lv.width * s, H = lv.height * s;
    const pw = Math.ceil(W * dpr), ph = Math.ceil(H * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    const cssW = Math.round(W), cssH = Math.round(H);
    if (this.cssW !== cssW || this.cssH !== cssH) { this.cssW = cssW; this.cssH = cssH; this.canvas.style.width = cssW + 'px'; this.canvas.style.height = cssH + 'px'; }
    const allLit = !!(this.ctx.renderer && this.ctx.renderer.fog && this.ctx.renderer.fog.override === 'all');
    const pct = this.buildLayer(lv, s, allLit);
    const c = this.g2d;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#060504'; c.fillRect(0, 0, W, H);
    // the C64's yellow/black checkerboard for unexplored rock, whispered
    if (!this.dither) { const d = document.createElement('canvas'); d.width = d.height = 4; const x = d.getContext('2d'); x.fillStyle = 'rgba(208,220,113,.09)'; x.fillRect(0, 0, 2, 2); x.fillRect(2, 2, 2, 2); this.dither = c.createPattern(d, 'repeat'); }
    c.fillStyle = this.dither; c.fillRect(0, 0, W, H);
    // parchment vignette under the ink
    const grad = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
    grad.addColorStop(0, 'rgba(46, 36, 24, .55)'); grad.addColorStop(1, 'rgba(10, 8, 5, 0)');
    c.fillStyle = grad; c.fillRect(0, 0, W, H);
    // cached tiles, dimmed to "memory" except where the player currently sees
    c.drawImage(this.layer, 0, 0, W, H);
    if (!allLit) {
      c.fillStyle = 'rgba(4, 3, 2, .5)'; c.fillRect(0, 0, W, H);
      const sx = this.layer.width / W, sy = this.layer.height / H;
      for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) {
        if (!lv.isVisible(x, y)) continue;
        c.drawImage(this.layer, x * s * sx, y * s * sy, s * sx, s * sy, x * s, y * s, s, s);
      }
    }
    const seen = (x, y) => allLit || lv.isExplored(x, y);
    const t = this.time;
    // items
    for (const it of lv.items) {
      if (!seen(it.x, it.y)) continue;
      const cx = it.x * s + s / 2, cy = it.y * s + s / 2, r = Math.max(1.1, s * 0.3);
      if (it.type === 'gold' && !it.hidden) { glow(c, cx, cy, s * 0.9, C.gold, 0.5); dot(c, cx, cy, r, C.gold); }
      else if (it.type === 'gold' && it.hidden) ring(c, cx, cy, r + 0.6, C.gold, 0.9, 1, true);
      else if (it.type === 'chest') checker(c, it.x * s, it.y * s, s, C.trap);
      else if (it.type === 'sword') { const k = 0.5 + 0.5 * Math.sin(t * 5); glow(c, cx, cy, s * (1.6 + k), C.quest, 0.7); star(c, cx, cy, s * (0.55 + 0.15 * k), C.quest); }
      else if (it.type === 'beacon') cross(c, cx, cy, s * 0.34, C.beacon, Math.max(1, s * 0.16));
      else dot(c, cx, cy, r, '#ffffff');
    }
    if (lv.beacon) { const bx = lv.beacon.x * s + s / 2, by = lv.beacon.y * s + s / 2; glow(c, bx, by, s * 1.3, C.beacon, 0.6); cross(c, bx, by, s * 0.4, C.beacon, Math.max(1, s * 0.18)); ring(c, bx, by, s * 0.62 + 0.4 * Math.sin(t * 3), C.beacon, 0.6); }
    // monsters: drawn wherever they stand on an explored tile; assassins need Light; the rest is memory
    const light = g.lightOn();
    const live = new Set();
    for (const m of lv.monsters) {
      if (!seen(m.x, m.y) || (m.invisible && !light)) continue;
      live.add(m.id);
      this.seen.set(m.id, { x: m.x, y: m.y, t, hunt: m.state === 'hunt' });
      const cx = m.x * s + s / 2, cy = m.y * s + s / 2;
      const hunting = m.state === 'hunt' || m.state === 'attack';
      const pulse = hunting ? 0.5 + 0.5 * Math.sin(t * 8) : 0;
      if (hunting) { glow(c, cx, cy, s * (1.2 + pulse * 0.6), C.monster, 0.55); ring(c, cx, cy, s * 0.75 + pulse * 2, C.monster, 0.55 - pulse * 0.3, 1); }
      dot(c, cx, cy, Math.max(1.3, s * 0.36) + pulse * 0.6, C.monster);
    }
    for (const [id, m] of this.seen) {
      if (live.has(id)) continue;
      const age = t - m.t;
      if (age > GHOST_TTL || !seen(m.x, m.y)) { this.seen.delete(id); continue; }
      ring(c, m.x * s + s / 2, m.y * s + s / 2, Math.max(1.4, s * 0.36), C.monster, 0.55 * (1 - age / GHOST_TTL), 1, true);
    }
    // player: heading wedge + pulse ring + dot
    const px = p.x * s + s / 2, py = p.y * s + s / 2;
    const f = p.facing && (p.facing.dx || p.facing.dy) ? p.facing : { dx: 0, dy: 1 };
    const fl = Math.hypot(f.dx, f.dy) || 1, fx = f.dx / fl, fy = f.dy / fl;
    glow(c, px, py, s * 1.5, C.player, 0.45);
    ring(c, px, py, s * (0.8 + 0.3 * (0.5 + 0.5 * Math.sin(t * 3))), C.player, 0.5, 1);
    c.fillStyle = C.player; c.globalAlpha = 0.95;
    c.beginPath();
    c.moveTo(px + fx * s * 1.05, py + fy * s * 1.05);
    c.lineTo(px - fy * s * 0.42 + fx * s * 0.1, py + fx * s * 0.42 + fy * s * 0.1);
    c.lineTo(px + fy * s * 0.42 + fx * s * 0.1, py - fx * s * 0.42 + fy * s * 0.1);
    c.closePath(); c.fill(); c.globalAlpha = 1;
    dot(c, px, py, Math.max(1.5, s * 0.42), C.player);
    // compass + border vignette
    if (s >= 5) { c.fillStyle = 'rgba(232,193,90,.55)'; c.font = `600 ${Math.max(7, s * 1.2)}px ${'Cinzel, Palatino, Georgia, serif'}`; c.textAlign = 'left'; c.textBaseline = 'top'; c.fillText('N', 4, 3); chevron(c, 4 + s * 0.4, 3 + s * 1.8, s * 0.7, -1, 'rgba(232,193,90,.55)'); }
    // caption
    const meta = `Lv <b>${lv.depth}</b> · <b>${pct}%</b>${this.big && this.userZoom !== 1 ? ` · <b>${Math.round(this.userZoom * 100)}%</b>` : ''}`;
    if (this.metaHtml !== meta) { this.metaHtml = meta; this.meta.innerHTML = meta; }
  }

  dispose() { for (const u of this.unsub) u(); this.el.remove(); }
}

function dot(c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
function ring(c, x, y, r, col, alpha = 0.85, lw = 1, dashed = false) { c.globalAlpha = alpha; c.strokeStyle = col; c.lineWidth = lw; if (dashed) c.setLineDash([Math.max(1, r * 0.8), Math.max(1, r * 0.6)]); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke(); if (dashed) c.setLineDash([]); c.globalAlpha = 1; }
function glow(c, x, y, r, col, alpha = 0.45) { const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); c.globalAlpha = alpha; c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2); c.globalAlpha = 1; }
function chevron(c, cx, cy, s, dir, col) { c.strokeStyle = col; c.lineWidth = Math.max(1, s * 0.18); c.lineCap = 'round'; c.lineJoin = 'round'; const w = s * 0.3, h = s * 0.18 * dir; c.beginPath(); c.moveTo(cx - w, cy - h); c.lineTo(cx, cy + h); c.lineTo(cx + w, cy - h); c.stroke(); }
function cross(c, cx, cy, r, col, lw) { c.strokeStyle = col; c.lineWidth = lw; c.lineCap = 'butt'; c.beginPath(); c.moveTo(cx - r, cy); c.lineTo(cx + r, cy); c.moveTo(cx, cy - r); c.lineTo(cx, cy + r); c.stroke(); }
function diamond(c, cx, cy, r, col) { c.fillStyle = col; c.beginPath(); c.moveTo(cx, cy - r); c.lineTo(cx + r, cy); c.lineTo(cx, cy + r); c.lineTo(cx - r, cy); c.closePath(); c.fill(); }
function checker(c, x, y, s, col) { const h = s / 2; c.fillStyle = col; c.fillRect(x, y, Math.ceil(h), Math.ceil(h)); c.fillRect(x + h, y + h, Math.ceil(h), Math.ceil(h)); c.fillStyle = 'rgba(0,0,0,.55)'; c.fillRect(x + h, y, Math.ceil(h), Math.ceil(h)); c.fillRect(x, y + h, Math.ceil(h), Math.ceil(h)); }
function star(c, cx, cy, r, col) { c.fillStyle = col; c.beginPath(); for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 - Math.PI / 2, rr = i % 2 ? r * 0.38 : r; c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } c.closePath(); c.fill(); }
/** Multiply a #rrggbb colour's brightness. */
function shade(hex, k) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
