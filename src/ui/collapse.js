// collapse: lets the player minimise any HUD panel by tapping it.
//
// Each registered panel gets a small chevron handle and a click/tap target. Tapping a panel's
// empty area (or its handle) collapses it to a compact labelled chip that stays in the same
// screen corner; tapping the chip restores it. Clicks that land on a real control inside a panel
// (buttons, kbd hints, inputs, links) never collapse it, so the hotbar and quick-action bar keep
// working normally. State is per-panel and persisted, so a player who hides the log keeps it hidden.
import './collapse.css';

const KEY = 'fargoal.collapsed.v1';

/** Panels that can be minimised, with the label shown on the collapsed chip. */
const PANELS = [
  { id: 'hud-card', label: 'Character', icon: '⚔' },
  { id: 'hud-depth', label: 'Depth', icon: '▼' },
  { id: 'hud-hotbar', label: 'Spells', icon: '✨' },
  { id: 'hud-quick', label: 'Actions', icon: '☰' },
  { id: 'log', label: 'Log', icon: '≡' },
  { id: 'minimap', label: 'Map', icon: '▦' },
];

/** True for clicks that should act on the panel's own controls rather than collapse it. */
function isControl(node, panel) {
  for (let n = node; n && n !== panel; n = n.parentElement) {
    if (n.matches?.('button, a, input, select, textarea, kbd, [role="button"], .slot, .qb, .entry')) return true;
  }
  return false;
}

function load() {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); }
}

function save(set) {
  try { localStorage.setItem(KEY, JSON.stringify([...set])); } catch { /* storage may be unavailable */ }
}

export class PanelCollapse {
  /** @param {{root:HTMLElement, bus:{emit:Function}}} ctx */
  constructor(ctx) {
    this.ctx = ctx;
    this.collapsed = load();
    this.panels = new Map();
    // Panels are created by several modules during boot; attach once they exist.
    this.attach();
    this._retry = setInterval(() => this.attach(), 400);
    setTimeout(() => clearInterval(this._retry), 6000);
  }

  attach() {
    for (const def of PANELS) {
      if (this.panels.has(def.id)) continue;
      const panel = document.getElementById(def.id);
      if (!panel) continue;
      this.panels.set(def.id, panel);
      panel.classList.add('collapsible');
      panel.dataset.collapseLabel = def.label;

      // Chevron handle — an explicit, keyboard-reachable control for the same action.
      const handle = document.createElement('button');
      handle.className = 'collapse-handle';
      handle.type = 'button';
      handle.setAttribute('aria-label', `Minimise ${def.label} panel`);
      handle.innerHTML = '<span class="chev"></span>';
      handle.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(def.id); });
      panel.appendChild(handle);

      // The collapsed chip replaces the panel in the same corner.
      const chip = document.createElement('button');
      chip.className = 'panel hud collapsed-chip';
      chip.type = 'button';
      chip.id = `${def.id}-chip`;
      chip.innerHTML = `<span class="ico">${def.icon}</span><span class="lbl">${def.label}</span>`;
      chip.setAttribute('aria-label', `Restore ${def.label} panel`);
      chip.addEventListener('click', () => this.toggle(def.id));
      this.ctx.root.appendChild(chip);

      panel.addEventListener('click', (e) => {
        if (isControl(e.target, panel)) return;
        this.toggle(def.id);
      });

      this.apply(def.id);
    }
  }

  /** Collapse or restore one panel. */
  toggle(id) {
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);
    save(this.collapsed);
    this.apply(id);
    this.ctx.bus?.emit('sfx:ui', { kind: 'click' });
  }

  apply(id) {
    const panel = this.panels.get(id);
    const chip = document.getElementById(`${id}-chip`);
    if (!panel || !chip) return;
    const off = this.collapsed.has(id);
    panel.classList.toggle('is-collapsed', off);
    chip.classList.toggle('show', off);
    const handle = panel.querySelector('.collapse-handle');
    if (handle) handle.setAttribute('aria-label', `${off ? 'Restore' : 'Minimise'} ${panel.dataset.collapseLabel} panel`);
  }

  /** Restore every panel (used by the settings screen). */
  restoreAll() {
    for (const id of [...this.collapsed]) { this.collapsed.delete(id); this.apply(id); }
    save(this.collapsed);
  }
}
