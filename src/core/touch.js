// Touch controls: an eight-way thumb pad (hold to keep walking, slide to change direction) and
// an action cluster (Act, Explore, Potion, Teleport, Rest). Shown on coarse-pointer devices, on the
// first touch, with ?touch=1, or when the setting forces it. Pure DOM; emits through callbacks so
// core/input.js stays the only thing that talks to the bus.
import { el, uiRoot } from './qolDom.js';

const DIRS = [
  { a: 0, dx: 0, dy: -1, g: '▲' }, { a: 45, dx: 1, dy: -1, g: '◥', diag: true }, { a: 90, dx: 1, dy: 0, g: '▶' }, { a: 135, dx: 1, dy: 1, g: '◢', diag: true },
  { a: 180, dx: 0, dy: 1, g: '▼' }, { a: 225, dx: -1, dy: 1, g: '◣', diag: true }, { a: 270, dx: -1, dy: 0, g: '◀' }, { a: 315, dx: -1, dy: -1, g: '◤', diag: true },
];
const BUTTONS = [
  { id: 'act', name: 'Act', glyph: '✦', action: { action: 'interact' } },
  { id: 'explore', name: 'Explore', glyph: '⌖', action: { action: 'explore' } },
  { id: 'potion', name: 'Potion', glyph: '⚗', action: { action: 'potion' } },
  { id: 'teleport', name: 'Teleport', glyph: '◎', action: { action: 'cast', spell: 'teleport' } },
  { id: 'rest', name: 'Rest', glyph: 'z', action: { action: 'wait' } },
];

export class TouchPad {
  /** @param {{onMove:(dx:number,dy:number)=>void, onHeld:(dx:number,dy:number)=>void, onAction:(payload:object)=>void}} cb */
  constructor(cb) {
    this.cb = cb;
    this.root = null; this.pad = null; this.thumb = null; this.arrows = [];
    this.pointerId = null; this.dir = null; this.visible = false;
    this.build();
  }

  build() {
    const host = uiRoot();
    if (!host) return;
    const root = el('div', 'qol-touch');
    const pad = el('div', 'pad');
    for (const d of DIRS) { const a = el('div', `arrow${d.diag ? ' diag' : ''}`, d.g); a.style.setProperty('--a', `${d.a}deg`); pad.appendChild(a); this.arrows.push({ el: a, d }); }
    const thumb = el('div', 'thumb'); pad.appendChild(thumb);
    root.appendChild(pad);
    const cluster = el('div', 'cluster');
    this.buttons = {};
    for (const b of BUTTONS) {
      const btn = el('button', `tb ${b.id}`, `<span class="g">${b.glyph}</span><span>${b.name}</span>`);
      btn.setAttribute('aria-label', b.name);
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); btn.classList.add('down'); this.cb.onAction({ ...b.action, source: 'touch' }); });
      const up = () => btn.classList.remove('down');
      btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('pointerleave', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
      cluster.appendChild(btn); this.buttons[b.id] = btn;
    }
    root.appendChild(cluster);
    root.appendChild(el('div', 'hint', 'Hold the pad to walk · tap the floor to travel · tap yourself to act'));
    host.appendChild(root);
    this.root = root; this.pad = pad; this.thumb = thumb;

    pad.addEventListener('pointerdown', (e) => { if (this.pointerId !== null) return; e.preventDefault(); this.pointerId = e.pointerId; try { pad.setPointerCapture(e.pointerId); } catch { /* ignore */ } pad.classList.add('active'); this.track(e); });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === this.pointerId) { e.preventDefault(); this.track(e); } });
    const end = (e) => { if (e.pointerId !== this.pointerId) return; this.pointerId = null; pad.classList.remove('active'); this.release(); };
    pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end); pad.addEventListener('lostpointercapture', end);
    pad.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Map a pointer position on the pad to an 8-way direction (centre dead zone releases). */
  track(e) {
    const r = this.pad.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const x = e.clientX - cx, y = e.clientY - cy;
    const radius = r.width / 2, dist = Math.hypot(x, y);
    const lim = Math.min(dist, radius * 0.42);
    const ang = Math.atan2(y, x);
    this.thumb.style.transform = dist > 1 ? `translate(${Math.cos(ang) * lim}px, ${Math.sin(ang) * lim}px)` : '';
    if (dist < radius * 0.16) { this.setDir(null); return; }
    const deg = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360; // 0 = up, clockwise
    const d = DIRS[Math.round(deg / 45) % 8];
    this.setDir(d);
  }

  setDir(d) {
    const same = (this.dir && d && this.dir.dx === d.dx && this.dir.dy === d.dy) || (!this.dir && !d);
    if (same) return;
    this.dir = d;
    for (const a of this.arrows) a.el.classList.toggle('lit', !!d && a.d.dx === d.dx && a.d.dy === d.dy);
    if (d) { this.cb.onMove(d.dx, d.dy); this.cb.onHeld(d.dx, d.dy); } else this.cb.onHeld(0, 0);
  }

  release() { this.thumb.style.transform = ''; this.setDir(null); }

  /** Show or hide the overlay (releasing any held direction). */
  show(on) {
    if (!this.root) return;
    on = !!on;
    if (this.visible === on) return;
    this.visible = on;
    this.root.classList.toggle('on', on);
    if (!on) { this.pointerId = null; this.pad.classList.remove('active'); this.release(); }
  }

  /** Reflect auto-explore state on its button. */
  setExploring(on) { if (this.buttons && this.buttons.explore) this.buttons.explore.classList.toggle('on', !!on); }

  /** Press a button programmatically (tests). */
  press(id) { const b = this.buttons && this.buttons[id]; if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); return !!b; }

  dispose() { if (this.root) this.root.remove(); this.root = null; }
}

let coarseDevice = null; // cached: media queries and the URL do not change while the page lives
/** Should the overlay show right now? */
export function wantsTouch(setting = 'auto', touched = false) {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  if (touched) return true;
  if (coarseDevice === null) {
    coarseDevice = false;
    try {
      if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('touch') === '1') coarseDevice = true;
      else if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) coarseDevice = true;
    } catch { /* ignore */ }
  }
  return coarseDevice;
}
