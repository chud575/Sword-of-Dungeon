// Minimap: 2D canvas overlay of explored tiles, stairs, temples, pits, water, treasure squares,
// buried gold, the beacon, the player and every monster standing on an explored tile (the original
// C64 rule). Toggle with M; hovering enlarges it.
import { TILE } from '../core/constants.js';

const VARS = ['floor', 'wall', 'stairs-down', 'stairs-up', 'temple', 'pit', 'water', 'player', 'monster', 'gold', 'trap', 'beacon'];

export class Minimap {
  /** @param {{root:HTMLElement, bus:import('../core/events.js').EventBus, getGame:()=>any, settings:object}} ctx */
  constructor(ctx) {
    this.ctx = ctx; this.bus = ctx.bus;
    this.scale = 3; this.bigScale = 7;
    this.big = false;
    this.visible = ctx.settings.minimap !== false;
    this.el = document.createElement('div');
    this.el.className = 'panel hud'; this.el.id = 'minimap';
    this.el.innerHTML = '<div class="corners"><i></i><i></i><i></i><i></i></div><div class="cap"><span class="label">Map</span><span class="hint">M</span></div>';
    this.canvas = document.createElement('canvas');
    this.el.appendChild(this.canvas);
    this.g2d = this.canvas.getContext('2d');
    this.el.addEventListener('mouseenter', () => { this.big = true; this.dirty = true; });
    this.el.addEventListener('mouseleave', () => { this.big = false; this.dirty = true; });
    this.el.addEventListener('click', () => this.bus.emit('sfx:ui', { kind: 'click' }));
    ctx.root.appendChild(this.el);
    this.el.hidden = !this.visible;
    this.colors = {};
    this.readColors();
    this.time = 0; this.acc = 0; this.dirty = true;
    this.unsub = [
      this.bus.on('settings:changed', () => { this.readColors(); this.dirty = true; }),
      this.bus.on('level:enter', () => { this.dirty = true; }),
      this.bus.on('game:start', () => { this.dirty = true; }),
    ];
  }

  readColors() {
    const cs = getComputedStyle(document.body);
    for (const v of VARS) this.colors[v] = (cs.getPropertyValue('--mm-' + v) || '').trim() || '#fff';
    this.colors.quest = (cs.getPropertyValue('--quest') || '').trim() || '#c58cff';
  }

  toggle(force) { this.visible = force === undefined ? !this.visible : !!force; this.el.hidden = !this.visible; this.dirty = true; return this.visible; }

  update(dt) {
    this.time += dt; this.acc += dt;
    if (!this.visible) return;
    if (this.acc < 0.08 && !this.dirty) return; // ~12 Hz is plenty; pulses read fine
    this.acc = 0; this.dirty = false;
    this.draw();
  }

  draw() {
    const g = this.ctx.getGame(); if (!g || !g.level) return;
    const lv = g.level, p = g.player;
    const s = this.big ? this.bigScale : this.scale;
    const W = lv.width * s, H = lv.height * s;
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; this.canvas.style.width = W + 'px'; this.canvas.style.height = H + 'px'; }
    const c = this.g2d, C = this.colors;
    c.clearRect(0, 0, W, H);
    c.fillStyle = '#050403'; c.fillRect(0, 0, W, H);
    const allLit = this.ctx.renderer && this.ctx.renderer.fog && this.ctx.renderer.fog.override === 'all';
    const seen = (x, y) => allLit || lv.isExplored(x, y);
    // tiles
    for (let y = 0; y < lv.height; y++) for (let x = 0; x < lv.width; x++) {
      if (!seen(x, y)) continue;
      const t = lv.tiles[y * lv.width + x];
      const vis = lv.isVisible(x, y);
      let col = null;
      switch (t) {
        case TILE.WALL: col = C.wall; break;
        case TILE.FLOOR: case TILE.DOOR: col = C.floor; break;
        case TILE.CORRIDOR: col = shade(C.floor, 0.8); break;
        case TILE.RUBBLE: col = shade(C.floor, 0.6); break;
        case TILE.WATER: col = C.water; break;
        case TILE.STAIRS_DOWN: col = C['stairs-down']; break;
        case TILE.STAIRS_UP: col = C['stairs-up']; break;
        case TILE.TEMPLE: col = C.temple; break;
        case TILE.PIT: case TILE.TRAP_PIT: col = C.pit; break;
        case TILE.TRAP_TELEPORT: col = C.trap; break;
        default: col = C.floor;
      }
      c.globalAlpha = vis || allLit ? 1 : 0.62;
      c.fillStyle = col;
      c.fillRect(x * s, y * s, s, s);
      if (t === TILE.PIT || t === TILE.TRAP_PIT) { c.strokeStyle = shade(C.floor, 1.3); c.lineWidth = 1; c.strokeRect(x * s + 0.5, y * s + 0.5, s - 1, s - 1); }
      if (t === TILE.STAIRS_DOWN || t === TILE.STAIRS_UP || t === TILE.TEMPLE) { c.globalAlpha = 0.35; c.fillRect(x * s - 1, y * s - 1, s + 2, s + 2); }
    }
    c.globalAlpha = 1;
    // items
    for (const it of lv.items) {
      if (!seen(it.x, it.y)) continue;
      const cx = it.x * s + s / 2, cy = it.y * s + s / 2, r = Math.max(1, s * 0.32);
      if (it.type === 'gold' && !it.hidden) dot(c, cx, cy, r, C.gold);
      else if (it.type === 'gold' && it.hidden) ring(c, cx, cy, r + 0.5, C.gold);
      else if (it.type === 'chest') { c.fillStyle = C.trap; c.fillRect(it.x * s, it.y * s, Math.ceil(s / 2), Math.ceil(s / 2)); c.fillRect(it.x * s + Math.floor(s / 2), it.y * s + Math.floor(s / 2), Math.ceil(s / 2), Math.ceil(s / 2)); }
      else if (it.type === 'sword') { const k = 0.6 + 0.4 * Math.sin(this.time * 5); dot(c, cx, cy, r + k, C.quest); }
      else if (it.type === 'beacon') dot(c, cx, cy, r, C.beacon);
      else dot(c, cx, cy, r, '#ffffff');
    }
    if (lv.beacon) ring(c, lv.beacon.x * s + s / 2, lv.beacon.y * s + s / 2, s * 0.6, C.beacon);
    for (const cl of lv.climbable) ring(c, cl.x * s + s / 2, cl.y * s + s / 2, s * 0.45, C['stairs-up']);
    // monsters: drawn wherever they stand on an explored tile; assassins need Light
    const light = g.lightOn();
    for (const m of lv.monsters) {
      if (!seen(m.x, m.y)) continue;
      if (m.invisible && !light) continue;
      const cx = m.x * s + s / 2, cy = m.y * s + s / 2;
      const pulse = m.state === 'hunt' ? 0.5 + 0.5 * Math.sin(this.time * 8) : 0;
      dot(c, cx, cy, Math.max(1.2, s * 0.42) + pulse, C.monster);
      if (m.state === 'hunt') ring(c, cx, cy, s * 0.8 + pulse * 1.5, C.monster, 0.5);
    }
    // player
    const px = p.x * s + s / 2, py = p.y * s + s / 2;
    ring(c, px, py, s * (0.9 + 0.35 * (0.5 + 0.5 * Math.sin(this.time * 3))), C.player, 0.5);
    dot(c, px, py, Math.max(1.5, s * 0.45), C.player);
    // sanity: keep the enlarged map on screen
    this.el.classList.toggle('big', this.big);
  }

  dispose() { for (const u of this.unsub) u(); this.el.remove(); }
}

function dot(c, x, y, r, col) { c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
function ring(c, x, y, r, col, alpha = 0.85) { c.globalAlpha = alpha; c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1; }
/** Multiply a #rrggbb colour's brightness. */
function shade(hex, k) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim()); if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
