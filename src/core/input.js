// Input: keyboard (rebindable, see core/keybinds.js), mouse click-to-move with a hover path
// preview, wheel / pinch zoom, gamepad (sticks, D-pad, buttons) and a touch pad overlay. Emits
// 'input:*' events on the bus; main.js maps them onto Game actions so this module stays free of
// game rules — with two deliberate exceptions that make the controls *undo-safe*:
//   - stairs / pit confirmations while carrying the Sword (core/confirm.js), and
//   - a pause forgets held keys, so the hero never walks into whatever caused the pause.
// It also hosts the quality-of-life sheets (F2 controls, F3 run statistics), browser lifecycle
// saves (core/lifecycle.js) and the path preview markers (core/pathPreview.js).
//
// Default keys (all rebindable in-game with F2):
//   Space / Enter / Numpad5 / '.'  act (stairs, temple, climb) — the panic button
//   Q or Shift+H  healing potion       T or 1  Teleport       Shift+S or 2  Shield
//   R or 3        Regeneration         I or 4  Invisibility    Shift+L or 5  Light
//   F or 6        Drift                O       toggle Light    Shift+B  bury gold
//   + (=)         place beacon         Z       wait            X        auto-explore
//   > / <         travel to stairs / temple    Tab inventory   M minimap   Esc pause
//   ?  help       F2 controls          F3 statistics          F5 save     [ ] zoom
import { Keybinds, keyId } from './keybinds.js';
import { Confirm } from './confirm.js';
import { TouchPad, wantsTouch } from './touch.js';
import { PathPreview } from './pathPreview.js';
import { ControlsSheet } from './controlsPanel.js';
import { StatsSheet } from './statsPanel.js';
import { Lifecycle } from './lifecycle.js';
import { DEFAULT_SETTINGS } from './save.js';
import { TILE } from './constants.js';
import { el, uiRoot, otherModalOpen } from './qolDom.js';
import './qol.css';

/** Default layout in the legacy {move, actions} shape (the live, rebindable map is Input#keybinds). */
export const KEYMAP = new Keybinds({}).legacy();

/** Standard-mapping gamepad buttons → actions. */
const PAD_BUTTONS = [
  [0, { action: 'interact' }], [1, { action: 'potion' }], [2, { action: 'cast', spell: 'teleport' }], [3, { action: 'cast', spell: 'shield' }],
  [4, { action: 'explore' }], [5, { action: 'wait' }], [6, { action: 'zoom', delta: -1 }], [7, { action: 'zoom', delta: 1 }],
  [8, { action: 'inventory' }], [9, { action: 'pause' }], [10, { action: 'stats' }], [11, { action: 'minimap' }],
];
const STICK_ON = 0.55, STICK_OFF = 0.38;

export class Input {
  /**
   * @param {{canvas:HTMLCanvasElement, bus:import('./events.js').EventBus, pickTile?:(x:number,y:number)=>({x:number,y:number}|null), getGame?:()=>any, getRenderer?:()=>any, settings?:object}} opts
   */
  constructor({ canvas, bus, pickTile = null, getGame = null, getRenderer = null, settings = null }) {
    this.canvas = canvas; this.bus = bus; this.pickTile = pickTile;
    this.getGame = getGame || (() => (globalThis.__game ? globalThis.__game.game : null));
    this.getRenderer = getRenderer || (() => (globalThis.__game ? globalThis.__game.renderer : null));
    this.settings = settings || { ...DEFAULT_SETTINGS };
    this.debugMode = (() => { try { return new URLSearchParams(location.search).get('debug') === '1'; } catch { return false; } })();
    this.enabled = true;
    /** Move keys currently down: key id → [dx, dy]. */
    this.pressed = new Map();
    /** Keys that were down when the game paused: ignored until released and pressed again. */
    this.stale = new Set();
    this.held = { dx: 0, dy: 0 };
    this.gamepadHeld = { dx: 0, dy: 0 };
    this.touchHeld = { dx: 0, dy: 0 };
    this.gamepadButtons = new Set();
    this.gamepad = { connected: false, id: null, stickActive: false };
    this.hover = null;
    this.touched = false;
    this.pointers = new Map(); this.pinch = null;
    this.stats = { keys: 0, clicks: 0, padButtons: 0, touchMoves: 0 };

    this.keybinds = new Keybinds();
    this.confirm = new Confirm({ bus, getGame: this.getGame });
    this.preview = new PathPreview({ bus, getGame: this.getGame, getRenderer: this.getRenderer });
    this.touch = new TouchPad({
      onMove: (dx, dy) => { this.stats.touchMoves++; this.emitMove(dx, dy, 'touch'); },
      onHeld: (dx, dy) => { this.touchHeld = { dx, dy }; this.updateHeld(); },
      onAction: (a) => this.action(a),
    });
    this.controls = new ControlsSheet({ bus, keybinds: this.keybinds });
    this.statsSheet = new StatsSheet({ bus, getGame: this.getGame });
    this.lifecycle = new Lifecycle({ bus, getGame: this.getGame, getSettings: () => this.settings, debugMode: this.debugMode, onSaved: (i) => this.onSaved(i) });
    this.chipEl = null; this.chipTimer = 0;

    this.onKeyDown = (e) => this.keyDown(e);
    this.onKeyUp = (e) => this.keyUp(e);
    this.onKeyCapture = (e) => this.keyCapture(e);
    this.onBlur = () => this.reset();
    this.onPointerDown = (e) => this.pointerDown(e);
    this.onPointerMove = (e) => this.pointerMove(e);
    this.onPointerUp = (e) => this.pointerUp(e);
    this.onMove = (e) => this.mouseMove(e);
    this.onLeave = () => { this.hover = null; this.preview.setHover(null); this.bus.emit('input:hover', { tile: null }); };
    this.onWheel = (e) => { e.preventDefault(); if (!this.enabled) return; this.bus.emit('input:action', { action: 'zoom', delta: Math.sign(-e.deltaY), source: 'wheel' }); };
    this.onContext = (e) => e.preventDefault();
    this.onPadConnect = () => this.pollGamepadPresence();
    this.unsub = [
      bus.on('settings:changed', (p) => this.applySettings(p && p.settings)),
      bus.on('game:start', () => { this.reset(); this.applyGameOptions(); this.lifecycle.playClock = 0; }),
      bus.on('game:paused', (p) => { if (p.paused) { for (const k of this.pressed.keys()) this.stale.add(k); this.updateHeld(); } }),
      bus.on('confirm:needed', (p) => this.onConfirmNeeded(p)),
      bus.on('ui:explore', (p) => this.touch.setExploring(!!p.on)),
    ];
    this.attach();
    this.applyGameOptions();
  }

  attach() {
    window.addEventListener('keydown', this.onKeyCapture, true);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('gamepadconnected', this.onPadConnect);
    window.addEventListener('gamepaddisconnected', this.onPadConnect);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('mousemove', this.onMove);
    this.canvas.addEventListener('mouseleave', this.onLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContext);
    this.canvas.style.touchAction = 'none';
  }

  detach() {
    window.removeEventListener('keydown', this.onKeyCapture, true);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('gamepadconnected', this.onPadConnect);
    window.removeEventListener('gamepaddisconnected', this.onPadConnect);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('mousemove', this.onMove);
    this.canvas.removeEventListener('mouseleave', this.onLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContext);
    for (const u of this.unsub) u(); this.unsub = [];
    this.lifecycle.detach(); this.preview.dispose(); this.touch.dispose();
  }

  /** Forget all held keys (focus loss, scenario reset, modal open). */
  reset() {
    this.pressed.clear(); this.stale.clear();
    this.gamepadHeld = { dx: 0, dy: 0 }; this.touchHeld = { dx: 0, dy: 0 };
    if (this.touch) this.touch.release();
    this.updateHeld();
  }

  // ------------------------------------------------------------------ settings
  applySettings(s) {
    if (s) this.settings = s;
    this.preview.enabled = this.settings.pathPreview !== false;
    this.applyGameOptions();
  }

  /** Push the player's pacing / guard preferences into the live Game. */
  applyGameOptions() {
    const g = this.getGame();
    if (!g || !g.options) return;
    const s = this.settings;
    g.options.holdRepeatDelay = Math.max(0, Number(s.holdRepeatDelay) || 0);
    g.options.holdAccel = s.holdAccel !== false;
    g.options.guardPits = s.confirmStairs !== false;
  }

  // ------------------------------------------------------------------ keyboard
  /** Capture-phase: overlays owned by this module eat their keys before the menus / game see them. */
  keyCapture(e) {
    const sheet = this.confirm.isOpen ? this.confirm : this.controls.isOpen ? this.controls : this.statsSheet.isOpen ? this.statsSheet : null;
    if (!sheet) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (sheet.handleKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }

  keyDown(e) {
    if (!this.enabled) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const id = keyId(e);
    const a = this.keybinds.lookup(id);
    if (!a) return;
    if (a.move) {
      e.preventDefault();
      if (e.repeat) return;
      this.stats.keys++;
      this.pressed.set(id, a.move);
      this.stale.delete(id);
      this.emitMove(a.move[0], a.move[1], 'keyboard');
      this.updateHeld();
      return;
    }
    if (e.repeat) return;
    e.preventDefault();
    this.stats.keys++;
    this.action({ ...a.emit, key: e.key, source: 'keyboard' });
  }

  keyUp(e) {
    const id = keyId(e);
    let changed = false;
    const drop = (k) => { if (this.pressed.delete(k)) changed = true; this.stale.delete(k); };
    drop(id);
    drop(id.startsWith('Shift+') ? id.slice(6) : 'Shift+' + id); // Shift released before/after the letter
    if (e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') {
      for (const k of [...this.pressed.keys()]) if (k.includes('+')) drop(k);
    }
    if (changed) this.updateHeld();
  }

  emitMove(dx, dy, source = 'keyboard') {
    if (!this.enabled) return;
    this.bus.emit('input:move', { dx, dy, source });
  }

  /** Combine keyboard, gamepad and touch into one held direction (keyboard wins). */
  updateHeld() {
    let dx = 0, dy = 0;
    for (const [id, v] of this.pressed) { if (this.stale.has(id)) continue; dx += v[0]; dy += v[1]; }
    dx = Math.sign(dx); dy = Math.sign(dy);
    if (!dx && !dy) { dx = this.gamepadHeld.dx; dy = this.gamepadHeld.dy; }
    if (!dx && !dy) { dx = this.touchHeld.dx; dy = this.touchHeld.dy; }
    if (dx !== this.held.dx || dy !== this.held.dy) { this.held = { dx, dy }; this.bus.emit('input:held', { dx, dy }); }
  }

  // ------------------------------------------------------------------ actions & guards
  /** Route an action payload: sheets and guards first, then the bus. */
  action(a) {
    switch (a.action) {
      case 'interact': if (this.guardInteract(a)) return; break;
      case 'controls': this.controls.open(); return;
      case 'stats': this.statsSheet.toggle(); return;
      case 'save': this.saveNow(); return;
      case 'travel': this.travel(a.to); return;
      default: break;
    }
    this.bus.emit('input:action', a);
  }

  /** Programmatic action by keybind id (tests, touch): press('interact'). */
  press(id) {
    const a = this.keybinds.lookup(this.keybinds.keysFor(id)[0]) || null;
    if (a && a.move) { this.emitMove(a.move[0], a.move[1], 'press'); return true; }
    if (a && a.emit) { this.action({ ...a.emit, source: 'press' }); return true; }
    return false;
  }

  /** Stairs with the Sword deserve a prompt. Returns true when the action was intercepted. */
  guardInteract(a) {
    const g = this.getGame();
    if (!g || g.over || a.confirmed || this.settings.confirmStairs === false || !g.stairsWarning) return false;
    const p = g.player, t = g.level.get(p.x, p.y);
    const w = t === TILE.STAIRS_DOWN ? g.stairsWarning('down') : t === TILE.STAIRS_UP ? g.stairsWarning('up') : null;
    if (!w) return false;
    const timer = g.state.quest.timer;
    const clock = timer === null ? '' : `Umla's clock · ${Math.floor(Math.max(0, timer) / 60)}:${String(Math.floor(Math.max(0, timer)) % 60).padStart(2, '0')} left`;
    this.confirm.open({
      kind: w.kind, title: w.title, text: w.text, clock, eyebrow: 'The Sword hums a warning', acceptLabel: t === TILE.STAIRS_DOWN ? 'Descend' : 'Climb', cancelLabel: 'Stay',
      onAccept: () => this.bus.emit('input:action', { ...a, confirmed: true }),
    });
    return true;
  }

  /** Game asked for a confirmation (pit with the Sword). */
  onConfirmNeeded(p) {
    const g = this.getGame();
    if (!g || !p) return;
    if (this.settings.confirmStairs === false) { g.confirm(p.kind, p.x, p.y); g.move(p.dx, p.dy); return; }
    this.confirm.open({
      kind: p.kind, title: p.title || 'Are you sure?', text: p.text || '', eyebrow: 'The Sword hums a warning', acceptLabel: 'Climb down', cancelLabel: 'Stay',
      onAccept: () => { g.confirm(p.kind, p.x, p.y); g.move(p.dx, p.dy); },
    });
  }

  /** Walk to a known landmark ('stairs' | 'temple' | 'up' | 'beacon') via click-to-move. */
  travel(kind) {
    const g = this.getGame();
    if (!g || g.over) return false;
    const t = g.travelTo(kind);
    if (!t) { this.bus.emit('log', { text: kind === 'stairs' ? 'You know of no way down yet.' : kind === 'temple' ? 'You know of no temple on this level.' : 'Nowhere to travel to.', kind: 'info', time: g.state.time }); this.chip('Nothing known yet', 'danger'); return false; }
    this.preview.commit(t.path, kind === 'temple' ? 'temple' : 'path');
    this.bus.emit('input:click', { x: t.target.x, y: t.target.y, button: 0, shift: false, travel: kind });
    this.bus.emit('log', { text: `Travelling to ${t.name} (${t.path.length} steps).`, kind: 'info', time: g.state.time });
    return true;
  }

  saveNow() {
    const g = this.getGame();
    if (!g || g.over) { this.chip('Nothing to save', 'danger'); return false; }
    return this.lifecycle.saveNow('manual');
  }

  onSaved({ reason, ok, quiet }) {
    if (!ok) { this.chip('Save failed — storage is blocked', 'danger', 3); this.bus.emit('log', { text: 'The save could not be written (storage blocked or full).', kind: 'danger' }); return; }
    if (quiet) this.chip('Quest saved', 'gold', 1.6);
    else { this.chip('Quest saved', 'gold', 2.2); this.bus.emit('log', { text: 'Quest saved. Continue from the title screen any time.', kind: 'info' }); }
    void reason;
  }

  // ------------------------------------------------------------------ mouse / touch
  pointerDown(e) {
    if (e.pointerType === 'touch') { this.touched = true; this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), acc: 0 }; return; } }
    if (!this.enabled || !this.pickTile) return;
    if (e.pointerType !== 'touch' && e.button !== 0 && e.button !== 2) return;
    const t = this.pickTile(e.clientX, e.clientY);
    if (!t) return;
    e.preventDefault();
    this.stats.clicks++;
    const button = e.pointerType === 'touch' ? 0 : e.button;
    if (button === 2) { this.bus.emit('input:action', { action: 'wait', source: 'click' }); this.preview.clearCommitted(); return; } // right-click: stop & rest
    const g = this.getGame();
    if (g && !g.over) {
      const p = g.player;
      if (t.x === p.x && t.y === p.y) { this.action({ action: 'interact', source: 'click' }); return; }
      const m = g.level.monsterAt(t.x, t.y);
      const adjacent = m && Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= 1;
      if (!adjacent && this.preview.enabled) {
        const path = g.pathTo(t.x, t.y);
        if (path && path.length) this.preview.commit(path, g.level.isTemple(path[path.length - 1].x, path[path.length - 1].y) ? 'temple' : 'path');
        else this.preview.clearCommitted();
      }
    }
    this.bus.emit('input:click', { x: t.x, y: t.y, button, shift: e.shiftKey, pointerType: e.pointerType });
  }

  pointerMove(e) {
    if (e.pointerType !== 'touch' || !this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = d / Math.max(1, this.pinch.d0);
      if (ratio > 1.15 || ratio < 0.87) { this.bus.emit('input:action', { action: 'zoom', delta: ratio > 1 ? 1 : -1, source: 'pinch' }); this.pinch.d0 = d; }
    }
  }

  pointerUp(e) {
    if (e.pointerType !== 'touch') return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
  }

  mouseMove(e) {
    if (!this.pickTile) return;
    const t = this.pickTile(e.clientX, e.clientY);
    const key = t ? `${t.x},${t.y}` : null;
    if (key !== this.hover) {
      this.hover = key;
      this.bus.emit('input:hover', { tile: t, clientX: e.clientX, clientY: e.clientY });
      this.preview.setHover(this.enabled && !otherModalOpen() ? t : null);
    }
  }

  // ------------------------------------------------------------------ gamepad
  pollGamepadPresence() {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : null;
    const gp = pads && [...pads].find((p) => p && p.connected);
    const connected = !!gp;
    if (connected !== this.gamepad.connected) {
      this.gamepad.connected = connected; this.gamepad.id = gp ? gp.id : null;
      this.bus.emit('input:gamepad', { connected, id: this.gamepad.id });
      this.chip(connected ? 'Gamepad connected · A act · B potion · LB explore' : 'Gamepad disconnected', connected ? 'magic' : 'danger', 3.2);
      if (!connected) { this.gamepadHeld = { dx: 0, dy: 0 }; this.updateHeld(); }
    }
    return gp || null;
  }

  /** Poll gamepads (call once per frame). */
  update(dt = 0) {
    const gp = this.pollGamepadPresence();
    if (gp) this.readGamepad(gp);
    this.preview.update(dt);
    this.lifecycle.update(dt);
    if (this.chipTimer > 0) { this.chipTimer -= dt; if (this.chipTimer <= 0 && this.chipEl) this.chipEl.classList.remove('show'); }
    const g = this.getGame();
    this.touch.show(wantsTouch(this.settings.touchControls, this.touched) && !!g && !g.over && !otherModalOpen());
  }

  readGamepad(gp) {
    const overlay = this.confirm.isOpen ? this.confirm : this.controls.isOpen ? this.controls : this.statsSheet.isOpen ? this.statsSheet : null;
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, mag = Math.hypot(ax, ay);
    if (this.gamepad.stickActive ? mag < STICK_OFF : mag > STICK_ON) this.gamepad.stickActive = !this.gamepad.stickActive;
    let dx = 0, dy = 0;
    if (this.gamepad.stickActive) { const ang = Math.atan2(ay, ax); const oct = Math.round(ang / (Math.PI / 4)); dx = Math.sign(Math.round(Math.cos(oct * Math.PI / 4))); dy = Math.sign(Math.round(Math.sin(oct * Math.PI / 4))); }
    const dpad = { l: gp.buttons[14]?.pressed, r: gp.buttons[15]?.pressed, u: gp.buttons[12]?.pressed, d: gp.buttons[13]?.pressed };
    if (dpad.l) dx = -1; if (dpad.r) dx = 1; if (dpad.u) dy = -1; if (dpad.d) dy = 1;
    if (overlay) { dx = 0; dy = 0; }
    if (dx !== this.gamepadHeld.dx || dy !== this.gamepadHeld.dy) {
      this.gamepadHeld = { dx, dy };
      if ((dx || dy) && this.enabled) this.emitMove(dx, dy, 'gamepad');
      this.updateHeld();
    }
    const edge = (i) => { const p = !!gp.buttons[i]?.pressed; if (p && !this.gamepadButtons.has(i)) { this.gamepadButtons.add(i); return true; } if (!p) this.gamepadButtons.delete(i); return false; };
    for (const [i, act] of PAD_BUTTONS) {
      if (!edge(i)) continue;
      this.stats.padButtons++;
      if (overlay) { if (overlay === this.confirm) overlay.handlePad(i); else if (i === 1 || i === 9) overlay.handleKey({ key: 'Escape' }); else if (i === 0) overlay.handleKey({ key: 'Enter' }); else if (i === 12) overlay.handleKey({ key: 'ArrowUp' }); else if (i === 13) overlay.handleKey({ key: 'ArrowDown' }); continue; }
      if (!this.enabled && act.action !== 'pause' && act.action !== 'inventory') continue;
      this.action({ ...act, source: 'gamepad' });
    }
  }

  // ------------------------------------------------------------------ chips
  /** Small centre chip ("Quest saved", "Gamepad connected"). */
  chip(text, kind = 'gold', dur = 2.2) {
    const host = uiRoot();
    if (!host) return;
    if (!this.chipEl) { this.chipEl = el('div', 'qol-chip panel', '<span class="dot"></span><span class="txt"></span>'); host.appendChild(this.chipEl); }
    this.chipEl.className = `qol-chip panel ${kind}`;
    this.chipEl.querySelector('.txt').textContent = text;
    void this.chipEl.offsetWidth;
    this.chipEl.classList.add('show');
    this.chipTimer = dur;
  }
}
