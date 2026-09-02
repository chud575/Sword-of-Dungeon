// Input: keyboard (WASD / arrows / numpad / vi-keys, hotkeys), mouse click-to-move & hover,
// wheel zoom and a basic gamepad poll. Emits 'input:*' events on the bus; main.js maps them
// onto Game actions so this module stays free of game logic.
//
// Hotkeys (Shift variants avoid clashes with movement letters):
//   Space / Enter / Numpad5 / '.'  interact (stairs, temple, climb) — the panic button
//   Q or Shift+H  healing potion       T or 1  Teleport       Shift+S or 2  Shield
//   R or 3        Regeneration         I or 4  Invisibility    Shift+L or 5  Light
//   F or 6        Drift                O       toggle Light    Shift+B  bury gold
//   + (=)         place beacon         Z       wait            X        auto-explore
//   Tab           inventory            M       minimap         Esc      pause
//   ?             help                 [ ]     zoom
export const KEYMAP = {
  move: {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    k: [0, -1], j: [0, 1], h: [-1, 0], l: [1, 0], y: [-1, -1], u: [1, -1], b: [-1, 1], n: [1, 1],
    Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0], Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1],
    Home: [-1, -1], PageUp: [1, -1], End: [-1, 1], PageDown: [1, 1],
  },
  actions: {
    ' ': { action: 'interact' }, Enter: { action: 'interact' }, Numpad5: { action: 'interact' }, '.': { action: 'interact' }, c: { action: 'interact' },
    q: { action: 'potion' }, H: { action: 'potion' },
    t: { action: 'cast', spell: 'teleport' }, '1': { action: 'cast', spell: 'teleport' },
    S: { action: 'cast', spell: 'shield' }, '2': { action: 'cast', spell: 'shield' },
    r: { action: 'cast', spell: 'regeneration' }, '3': { action: 'cast', spell: 'regeneration' },
    i: { action: 'cast', spell: 'invisibility' }, '4': { action: 'cast', spell: 'invisibility' },
    L: { action: 'cast', spell: 'light' }, '5': { action: 'cast', spell: 'light' },
    f: { action: 'cast', spell: 'drift' }, '6': { action: 'cast', spell: 'drift' },
    o: { action: 'toggleLight' }, B: { action: 'bury' }, '+': { action: 'beacon' }, '=': { action: 'beacon' },
    z: { action: 'wait' }, x: { action: 'explore' }, Tab: { action: 'inventory' }, m: { action: 'minimap' },
    Escape: { action: 'pause' }, '?': { action: 'help' }, F1: { action: 'help' },
    '[': { action: 'zoom', delta: -1 }, ']': { action: 'zoom', delta: 1 },
  },
};

export class Input {
  /**
   * @param {{canvas:HTMLCanvasElement, bus:import('./events.js').EventBus, pickTile?:(x:number,y:number)=>({x:number,y:number}|null)}} opts
   */
  constructor({ canvas, bus, pickTile = null }) {
    this.canvas = canvas; this.bus = bus; this.pickTile = pickTile;
    this.enabled = true;
    this.pressed = new Set();     // move keys currently down (by key/code)
    this.held = { dx: 0, dy: 0 };
    this.gamepadHeld = { dx: 0, dy: 0 };
    this.gamepadButtons = new Set();
    this.hover = null;
    this.onKeyDown = (e) => this.keyDown(e);
    this.onKeyUp = (e) => this.keyUp(e);
    this.onBlur = () => this.reset();
    this.onClick = (e) => this.click(e);
    this.onMove = (e) => this.mouseMove(e);
    this.onWheel = (e) => { e.preventDefault(); this.bus.emit('input:action', { action: 'zoom', delta: Math.sign(-e.deltaY) }); };
    this.onContext = (e) => e.preventDefault();
    this.attach();
  }

  attach() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.canvas.addEventListener('mousedown', this.onClick);
    this.canvas.addEventListener('mousemove', this.onMove);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContext);
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('mousedown', this.onClick);
    this.canvas.removeEventListener('mousemove', this.onMove);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContext);
  }

  /** Forget all held keys (focus loss, scenario reset). */
  reset() { this.pressed.clear(); this.updateHeld(); }

  static moveKey(e) {
    if (KEYMAP.move[e.code] && e.code.startsWith('Numpad')) return KEYMAP.move[e.code];
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return KEYMAP.move[e.key] && e.key.startsWith('Arrow') ? KEYMAP.move[e.key] : null;
    return KEYMAP.move[e.key] || null;
  }

  keyDown(e) {
    if (!this.enabled) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const mv = Input.moveKey(e);
    if (mv) {
      e.preventDefault();
      if (e.repeat) return;
      const id = e.code.startsWith('Numpad') ? e.code : e.key;
      this.pressed.add(id);
      this.bus.emit('input:move', { dx: mv[0], dy: mv[1] });
      this.updateHeld();
      return;
    }
    if (e.repeat) return;
    const act = (e.ctrlKey || e.metaKey || e.altKey) ? null : (KEYMAP.actions[e.key] || KEYMAP.actions[e.code]);
    if (act) { e.preventDefault(); this.bus.emit('input:action', { ...act, key: e.key }); }
  }

  keyUp(e) {
    const id = e.code.startsWith('Numpad') ? e.code : e.key;
    let changed = this.pressed.delete(id);
    // a Shift release changes e.key case: drop both cases
    if (this.pressed.delete(id.toLowerCase())) changed = true;
    if (this.pressed.delete(id.toUpperCase())) changed = true;
    if (changed) this.updateHeld();
  }

  updateHeld() {
    let dx = 0, dy = 0;
    for (const id of this.pressed) { const v = KEYMAP.move[id]; if (v) { dx += v[0]; dy += v[1]; } }
    dx = Math.sign(dx); dy = Math.sign(dy);
    if (!dx && !dy) { dx = this.gamepadHeld.dx; dy = this.gamepadHeld.dy; }
    if (dx !== this.held.dx || dy !== this.held.dy) { this.held = { dx, dy }; this.bus.emit('input:held', { dx, dy }); }
  }

  click(e) {
    if (!this.enabled || !this.pickTile) return;
    const t = this.pickTile(e.clientX, e.clientY);
    if (!t) return;
    e.preventDefault();
    this.bus.emit('input:click', { x: t.x, y: t.y, button: e.button, shift: e.shiftKey });
  }

  mouseMove(e) {
    if (!this.pickTile) return;
    const t = this.pickTile(e.clientX, e.clientY);
    const key = t ? `${t.x},${t.y}` : null;
    if (key !== this.hover) { this.hover = key; this.bus.emit('input:hover', { tile: t, clientX: e.clientX, clientY: e.clientY }); }
  }

  /** Poll gamepads (call once per frame). */
  update() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null;
    const gp = pads && [...pads].find((p) => p && p.connected);
    if (!gp) { if (this.gamepadHeld.dx || this.gamepadHeld.dy) { this.gamepadHeld = { dx: 0, dy: 0 }; this.updateHeld(); } return; }
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
    const dpad = { l: gp.buttons[14]?.pressed, r: gp.buttons[15]?.pressed, u: gp.buttons[12]?.pressed, d: gp.buttons[13]?.pressed };
    let dx = Math.abs(ax) > 0.5 ? Math.sign(ax) : 0, dy = Math.abs(ay) > 0.5 ? Math.sign(ay) : 0;
    if (dpad.l) dx = -1; if (dpad.r) dx = 1; if (dpad.u) dy = -1; if (dpad.d) dy = 1;
    if (dx !== this.gamepadHeld.dx || dy !== this.gamepadHeld.dy) {
      this.gamepadHeld = { dx, dy };
      if (dx || dy) this.bus.emit('input:move', { dx, dy });
      this.updateHeld();
    }
    const btn = (i, action) => {
      const p = !!gp.buttons[i]?.pressed;
      if (p && !this.gamepadButtons.has(i)) { this.gamepadButtons.add(i); this.bus.emit('input:action', action); }
      else if (!p) this.gamepadButtons.delete(i);
    };
    btn(0, { action: 'interact' }); btn(1, { action: 'cast', spell: 'teleport' }); btn(2, { action: 'potion' }); btn(3, { action: 'cast', spell: 'shield' });
    btn(9, { action: 'pause' }); btn(8, { action: 'inventory' });
  }
}
