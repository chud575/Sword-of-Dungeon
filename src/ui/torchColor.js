// The hero's lantern colour: a swatch popup, opened by clicking the hero.
//
// WHY CLICKING THE HERO IS FREE
// Clicking your own tile already emits `interact` (core/input.js), and `Game.interact()` falls
// through every branch and returns false unless you are standing on stairs, an altar or a climbable
// pit — on ordinary floor it is a complete no-op. So this hangs on the dead half of an existing
// gesture: on stairs a click still descends exactly as before, and everywhere else the click that
// used to do nothing now opens this. Nothing is taken away, and the keyboard `interact` (Space,
// Enter, Numpad5, '.', 'c') never opens it — only a click does, because only a click has a position
// to put the popup at.
import { el, esc, uiRoot } from '../core/qolDom.js';

/**
 * The lantern palette. `light` is the carried point-light colour — the one that actually tints the
 * stone around you; the spot is derived from it (see lighting.js `setLanternColor`), so a swatch is
 * one decision, not two. The first entry is the shipping look and is what `torchColor: ''` means.
 */
export const TORCH_COLORS = [
  { id: 'lantern', name: 'Lantern', hex: 0xbfd8ff, blurb: 'cold steel-blue — the default' },
  { id: 'flame', name: 'Flame', hex: 0xffa04a, blurb: 'a real torch' },
  { id: 'candle', name: 'Candle', hex: 0xffe0a8, blurb: 'warm tallow' },
  { id: 'ember', name: 'Ember', hex: 0xff6a3a, blurb: 'low and red' },
  { id: 'gold', name: 'Gold', hex: 0xffd257, blurb: 'a rich man’s light' },
  { id: 'emerald', name: 'Emerald', hex: 0x7ce8a0, blurb: 'witchlight' },
  { id: 'violet', name: 'Violet', hex: 0xc9b0ff, blurb: 'the Sword’s own colour' },
  { id: 'ice', name: 'Ice', hex: 0xa8f0ff, blurb: 'pale and thin' },
];

const byId = new Map(TORCH_COLORS.map((c) => [c.id, c]));
/** The entry for a saved id, falling back to the default. */
export function torchColorFor(id) { return byId.get(id) || TORCH_COLORS[0]; }

export class TorchColorPicker {
  /**
   * @param {{bus:import('../core/events.js').EventBus, settings:object, onPick:(id:string)=>void}} ctx
   */
  constructor({ bus, settings, onPick }) {
    this.bus = bus; this.settings = settings; this.onPick = onPick;
    this.root = null;
    this._onDocDown = (e) => { if (this.root && !this.root.contains(e.target)) this.close(); };
    this._onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } };
  }

  get isOpen() { return !!this.root; }

  /** Open at a client-space point (the click), or toggle shut if already open. */
  toggle(cx, cy) { if (this.root) this.close(); else this.open(cx, cy); }

  open(cx = innerWidth / 2, cy = innerHeight / 2) {
    const host = uiRoot();
    if (!host || this.root) return;
    const cur = this.settings.torchColor || TORCH_COLORS[0].id;
    const root = el('div', 'torch-pick', `
      <div class="tp-box panel">
        <div class="tp-title">Lantern</div>
        <div class="tp-swatches">${TORCH_COLORS.map((c) => `
          <button class="tp-sw${c.id === cur ? ' on' : ''}" data-id="${c.id}" title="${esc(c.name)} — ${esc(c.blurb)}" aria-label="${esc(c.name)}">
            <span class="tp-dot" style="--c:#${c.hex.toString(16).padStart(6, '0')}"></span>
            <span class="tp-name">${esc(c.name)}</span>
          </button>`).join('')}</div>
      </div>`);
    // keep the whole box on screen: it is anchored to the click, which can be near an edge
    root.style.left = `${Math.round(cx)}px`;
    root.style.top = `${Math.round(cy)}px`;
    host.appendChild(root);
    const box = root.querySelector('.tp-box');
    const r = box.getBoundingClientRect();
    if (r.right > innerWidth - 8) root.style.left = `${Math.round(innerWidth - 8 - r.width / 2)}px`;
    if (r.left < 8) root.style.left = `${Math.round(8 + r.width / 2)}px`;
    if (r.bottom > innerHeight - 8) root.style.top = `${Math.round(cy - r.height - 18)}px`;
    root.querySelectorAll('.tp-sw').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.pick(b.dataset.id);
    }));
    this.root = root;
    // a pointerdown anywhere else closes it; registered next tick so the opening click does not
    setTimeout(() => { document.addEventListener('pointerdown', this._onDocDown, true); document.addEventListener('keydown', this._onKey, true); }, 0);
  }

  pick(id) {
    const c = torchColorFor(id);
    this.settings.torchColor = c.id;
    this.onPick(c.id);
    this.bus.emit('sfx:ui', { kind: 'click' });
    if (this.root) this.root.querySelectorAll('.tp-sw').forEach((b) => b.classList.toggle('on', b.dataset.id === c.id));
  }

  close() {
    if (!this.root) return;
    document.removeEventListener('pointerdown', this._onDocDown, true);
    document.removeEventListener('keydown', this._onKey, true);
    this.root.remove();
    this.root = null;
  }
}
