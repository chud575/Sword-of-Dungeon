// Key-rebinding sheet (F2). Every action is listed by group with its keys; pick a row and press
// the new key — it becomes the primary key and is stolen from any other action. Backspace resets a
// row, the button in the footer resets everything. Escape stays locked to the pause menu.
import { el, esc, uiRoot, setModal } from './qolDom.js';
import { actionGroups, keyId, keyLabel } from './keybinds.js';

const LOCKED_ACTIONS = new Set(['pause']);
const PAD_NOTE = '<b>Gamepad</b>: left stick / D-pad walk, <b>A</b> act, <b>B</b> potion, <b>X</b> teleport, <b>Y</b> shield, <b>LB</b> explore, <b>RB</b> rest, <b>LT / RT</b> zoom, <b>Back</b> inventory, <b>Start</b> pause. <b>Touch</b>: the pad walks, the cluster acts, tap the floor to travel.';

export class ControlsSheet {
  /** @param {{bus:import('./events.js').EventBus, keybinds:import('./keybinds.js').Keybinds, onChanged?:Function}} opts */
  constructor({ bus, keybinds, onChanged = null }) {
    this.bus = bus; this.keybinds = keybinds; this.onChanged = onChanged;
    this.root = null; this.rows = []; this.sel = 0; this.listening = null; this.modal = false;
  }

  get isOpen() { return !!this.root; }

  open() {
    if (this.root) return;
    const host = uiRoot(); if (!host) return;
    const root = el('div', 'qol-sheet qol-controls', `
      <div class="box panel">
        <div class="head"><div class="eyebrow">Bind the keys to your hand</div><h1>Controls</h1><div class="sub">Choose an action and press its new key · the first key shown is the one the interface hints at</div></div>
        <div class="rule"></div>
        <div class="body"><div class="cols"></div></div>
        <div class="foot"><span><kbd>↑↓</kbd>choose</span><span><kbd>Enter</kbd>rebind</span><span><kbd>Bksp</kbd>default</span><span><button class="reset-all">Reset all</button></span><span><kbd>Esc</kbd>close</span></div>
      </div>`);
    root.addEventListener('pointerdown', (e) => { if (e.target === root) this.close(); });
    root.querySelector('.reset-all').addEventListener('click', () => { this.keybinds.reset(); this.render(); this.changed(); });
    host.appendChild(root);
    this.root = root;
    this.modal = setModal(true, 'controls');
    this.bus.emit('sfx:ui', { kind: 'open' });
    this.render();
  }

  close() {
    if (!this.root) return;
    this.root.remove(); this.root = null; this.listening = null;
    if (this.modal) setModal(false, 'controls');
    this.modal = false;
    this.bus.emit('sfx:ui', { kind: 'close' });
  }

  changed() { this.bus.emit('input:keybinds', { overrides: this.keybinds.overrides }); if (this.onChanged) this.onChanged(); }

  render() {
    const cols = this.root.querySelector('.cols');
    cols.innerHTML = '';
    this.rows = [];
    const groups = actionGroups();
    const left = el('div'), right = el('div');
    groups.forEach((g, gi) => {
      const box = el('div');
      box.appendChild(el('h2', '', esc(g.name)));
      for (const a of g.actions) {
        const keys = this.keybinds.keysFor(a.id);
        const locked = LOCKED_ACTIONS.has(a.id);
        const custom = !!this.keybinds.overrides[a.id];
        const row = el('div', `row${locked ? ' locked' : ''}${custom ? ' changed' : ''}`, `<span>${esc(a.name)}</span><span class="k">${keys.length ? keys.map((k, i) => `<kbd class="${i ? 'alt' : ''}">${esc(keyLabel(k))}</kbd>`).join('') : '<kbd>—</kbd>'}</span>`);
        row.dataset.id = a.id;
        const idx = this.rows.length;
        row.addEventListener('mouseenter', () => { if (!this.listening) { this.sel = idx; this.highlight(); } });
        row.addEventListener('click', () => { if (!locked) { this.sel = idx; this.startListening(); } });
        box.appendChild(row);
        this.rows.push({ el: row, action: a, locked });
      }
      (gi < 3 ? left : right).appendChild(box);
    });
    right.appendChild(el('div', 'pad-note', PAD_NOTE));
    cols.appendChild(left); cols.appendChild(right);
    this.sel = Math.min(this.sel, this.rows.length - 1);
    this.highlight();
  }

  highlight() {
    this.rows.forEach((r, i) => r.el.classList.toggle('selected', i === this.sel));
    const r = this.rows[this.sel];
    if (r && r.el.scrollIntoView) r.el.scrollIntoView({ block: 'nearest' });
  }

  startListening() {
    const r = this.rows[this.sel];
    if (!r || r.locked) return;
    this.listening = r.action.id;
    r.el.classList.add('listening');
    r.el.querySelector('.k').textContent = 'press a key…';
    this.bus.emit('sfx:ui', { kind: 'click' });
  }

  /** Keyboard while open. Always consumes (a sheet is modal). */
  handleKey(e) {
    if (!this.root) return false;
    if (this.listening) {
      if (e.key === 'Escape') { this.listening = null; this.render(); return true; }
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return true;
      const id = keyId(e);
      if (id && this.keybinds.rebind(this.listening, id)) { this.listening = null; this.render(); this.changed(); this.bus.emit('sfx:ui', { kind: 'click' }); }
      return true;
    }
    const k = e.key;
    if (k === 'Escape' || k === 'F2') { this.close(); return true; }
    if (k === 'ArrowDown' || k === 'j' || k === 's') { this.sel = (this.sel + 1) % this.rows.length; this.highlight(); return true; }
    if (k === 'ArrowUp' || k === 'k' || k === 'w') { this.sel = (this.sel - 1 + this.rows.length) % this.rows.length; this.highlight(); return true; }
    if (k === 'Enter' || k === ' ') { this.startListening(); return true; }
    if (k === 'Backspace' || k === 'Delete') { const r = this.rows[this.sel]; if (r && !r.locked) { this.keybinds.reset(r.action.id); this.render(); this.changed(); } return true; }
    return true;
  }
}
