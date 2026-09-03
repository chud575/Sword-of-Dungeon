// Rebindable key map. Every game action is a named entry with default keys; the player's
// overrides (core/save.js) replace the defaults per action. Keys are identified by a stable id:
//   letters lower-cased ('w'), symbols as typed ('?', '+'), specials by e.key ('ArrowUp', ' ',
//   'Enter', 'Tab', 'F1'), numpad by e.code ('Numpad8'), with 'Shift+' for shifted letters and
//   'Ctrl+' / 'Alt+' / 'Meta+' prefixes. Arrow keys ignore modifiers so Shift+Arrow still walks.
import { loadKeybinds, saveKeybinds } from './save.js';

/** @typedef {{id:string, group:string, name:string, keys:string[], move?:[number,number], emit?:object, hidden?:boolean}} ActionDef */

/** @type {ActionDef[]} */
export const ACTIONS = [
  { id: 'move-n', group: 'Move', name: 'North', keys: ['ArrowUp', 'w', 'k', 'Numpad8'], move: [0, -1] },
  { id: 'move-s', group: 'Move', name: 'South', keys: ['ArrowDown', 's', 'j', 'Numpad2'], move: [0, 1] },
  { id: 'move-w', group: 'Move', name: 'West', keys: ['ArrowLeft', 'a', 'h', 'Numpad4'], move: [-1, 0] },
  { id: 'move-e', group: 'Move', name: 'East', keys: ['ArrowRight', 'd', 'l', 'Numpad6'], move: [1, 0] },
  { id: 'move-nw', group: 'Move', name: 'North-west', keys: ['y', 'Numpad7', 'Home'], move: [-1, -1] },
  { id: 'move-ne', group: 'Move', name: 'North-east', keys: ['u', 'Numpad9', 'PageUp'], move: [1, -1] },
  { id: 'move-sw', group: 'Move', name: 'South-west', keys: ['b', 'Numpad1', 'End'], move: [-1, 1] },
  { id: 'move-se', group: 'Move', name: 'South-east', keys: ['n', 'Numpad3', 'PageDown'], move: [1, 1] },
  { id: 'interact', group: 'Act', name: 'Act (stairs, temple, climb)', keys: [' ', 'Enter', 'Numpad5', '.', 'c'], emit: { action: 'interact' } },
  { id: 'wait', group: 'Act', name: 'Rest a moment', keys: ['z'], emit: { action: 'wait' } },
  { id: 'explore', group: 'Act', name: 'Auto-explore', keys: ['x'], emit: { action: 'explore' } },
  { id: 'travel-stairs', group: 'Act', name: 'Travel to the stairs down', keys: ['>', 'Shift+x'], emit: { action: 'travel', to: 'stairs' } },
  { id: 'travel-temple', group: 'Act', name: 'Travel to the temple', keys: ['<', 'Shift+t'], emit: { action: 'travel', to: 'temple' } },
  { id: 'potion', group: 'Items', name: 'Drink a healing potion', keys: ['q', 'Shift+h'], emit: { action: 'potion' } },
  { id: 'beacon', group: 'Items', name: 'Place a beacon', keys: ['+', '='], emit: { action: 'beacon' } },
  { id: 'bury', group: 'Items', name: 'Bury your gold', keys: ['Shift+b'], emit: { action: 'bury' } },
  { id: 'toggle-light', group: 'Items', name: 'Light on / off', keys: ['o'], emit: { action: 'toggleLight' } },
  { id: 'cast-teleport', group: 'Spells', name: 'Teleport', keys: ['t', '1'], emit: { action: 'cast', spell: 'teleport' } },
  { id: 'cast-shield', group: 'Spells', name: 'Shield', keys: ['Shift+s', '2'], emit: { action: 'cast', spell: 'shield' } },
  { id: 'cast-regeneration', group: 'Spells', name: 'Regeneration', keys: ['r', '3'], emit: { action: 'cast', spell: 'regeneration' } },
  { id: 'cast-invisibility', group: 'Spells', name: 'Invisibility', keys: ['i', '4'], emit: { action: 'cast', spell: 'invisibility' } },
  { id: 'cast-light', group: 'Spells', name: 'Light', keys: ['Shift+l', '5'], emit: { action: 'cast', spell: 'light' } },
  { id: 'cast-drift', group: 'Spells', name: 'Drift', keys: ['f', '6'], emit: { action: 'cast', spell: 'drift' } },
  { id: 'inventory', group: 'Interface', name: 'Inventory', keys: ['Tab'], emit: { action: 'inventory' } },
  { id: 'minimap', group: 'Interface', name: 'Minimap', keys: ['m'], emit: { action: 'minimap' } },
  { id: 'pause', group: 'Interface', name: 'Pause / menu', keys: ['Escape'], emit: { action: 'pause' } },
  { id: 'help', group: 'Interface', name: 'Help', keys: ['?', 'F1'], emit: { action: 'help' } },
  { id: 'controls', group: 'Interface', name: 'Rebind keys', keys: ['F2'], emit: { action: 'controls' } },
  { id: 'stats', group: 'Interface', name: 'Run statistics', keys: ['F3', 'Shift+i'], emit: { action: 'stats' } },
  { id: 'save', group: 'Interface', name: 'Save now', keys: ['F5'], emit: { action: 'save' } },
  { id: 'zoom-out', group: 'Interface', name: 'Zoom out', keys: ['['], emit: { action: 'zoom', delta: -1 } },
  { id: 'zoom-in', group: 'Interface', name: 'Zoom in', keys: [']'], emit: { action: 'zoom', delta: 1 } },
];
const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
/** Keys that can never be rebound away (the game must stay escapable). */
const LOCKED = new Set(['Escape']);

/** Stable key id for a keyboard event (see header). */
export function keyId(e) {
  const code = e.code || '';
  if (code.startsWith('Numpad') && code !== 'NumpadEnter') return code;
  let k = e.key;
  if (k === undefined || k === null) return '';
  if (k === 'Spacebar') k = ' ';
  if (code === 'NumpadEnter') k = 'Enter';
  if (k.startsWith('Arrow')) return k; // modifiers ignored: Shift+Arrow walks too
  const letter = k.length === 1 && /[a-z]/i.test(k);
  if (letter) k = k.toLowerCase();
  let mods = '';
  if (e.ctrlKey) mods += 'Ctrl+';
  if (e.altKey) mods += 'Alt+';
  if (e.metaKey) mods += 'Meta+';
  if (e.shiftKey && (letter || k.length > 1)) mods += 'Shift+';
  return mods + k;
}

/** Human label for a key id ('ArrowUp' -> '↑', ' ' -> 'Space', 'Numpad8' -> 'Num 8'). */
export function keyLabel(id) {
  const NAMES = { ' ': 'Space', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', PageUp: 'PgUp', PageDown: 'PgDn', Home: 'Home', End: 'End', Backspace: 'Bksp', Delete: 'Del' };
  const parts = id.split('+');
  const key = id.endsWith('+') ? '+' : parts.pop();
  const mods = (id.endsWith('+') ? parts.slice(0, -1) : parts).filter(Boolean);
  const base = NAMES[key] || (key.startsWith('Numpad') ? 'Num ' + key.slice(6) : key.length === 1 ? key.toUpperCase() : key);
  return [...mods, base].join('+');
}

/** Live key map: defaults + saved overrides. */
export class Keybinds {
  constructor(overrides = null) {
    /** @type {Record<string, string[]>} */
    this.overrides = overrides || loadKeybinds();
    this.rebuild();
  }

  /** Keys currently bound to an action. */
  keysFor(id) { const a = BY_ID.get(id); if (!a) return []; return (this.overrides[id] || a.keys).slice(); }
  /** Primary key label for an action (HUD hints). */
  labelFor(id) { const k = this.keysFor(id)[0]; return k ? keyLabel(k) : '—'; }
  /** Action definition bound to a key id, or null. */
  lookup(id) { return this.map.get(id) || null; }
  /** Is the user's map different from the defaults? */
  get customized() { return Object.keys(this.overrides).length > 0; }

  rebuild() {
    /** @type {Map<string, ActionDef>} */
    this.map = new Map();
    for (const a of ACTIONS) for (const k of this.keysFor(a.id)) if (!this.map.has(k)) this.map.set(k, a);
    for (const k of LOCKED) if (!this.map.has(k)) this.map.set(k, BY_ID.get('pause'));
  }

  /**
   * Make `key` the primary key of `id` (stealing it from any other action). Returns false when the
   * key is locked or the action unknown.
   */
  rebind(id, key) {
    const a = BY_ID.get(id);
    if (!a || !key || LOCKED.has(key)) return false;
    for (const other of ACTIONS) {
      const keys = this.keysFor(other.id);
      if (other.id !== id && keys.includes(key)) this.setKeys(other.id, keys.filter((k) => k !== key));
    }
    const keys = this.keysFor(id).filter((k) => k !== key);
    this.setKeys(id, [key, ...keys].slice(0, 3));
    this.rebuild();
    saveKeybinds(this.overrides);
    return true;
  }

  /** Remove one key from an action (a keyless action can still be reached from the HUD / gamepad). */
  unbind(id, key) {
    if (LOCKED.has(key)) return false;
    this.setKeys(id, this.keysFor(id).filter((k) => k !== key));
    this.rebuild();
    saveKeybinds(this.overrides);
    return true;
  }

  /** Back to the defaults (one action or all). */
  reset(id = null) {
    if (id) delete this.overrides[id]; else this.overrides = {};
    this.rebuild();
    saveKeybinds(this.overrides);
  }

  setKeys(id, keys) {
    const a = BY_ID.get(id); if (!a) return;
    const same = keys.length === a.keys.length && keys.every((k, i) => k === a.keys[i]);
    if (same) delete this.overrides[id]; else this.overrides[id] = keys;
  }

  /** Legacy-shaped map ({move:{key:[dx,dy]}, actions:{key:payload}}) for code that reads KEYMAP. */
  legacy() {
    const move = {}, actions = {};
    for (const [k, a] of this.map) { if (a.move) move[k] = a.move; else if (a.emit) actions[k] = { ...a.emit }; }
    return { move, actions };
  }
}

/** Groups in display order with their actions (for the rebinding panel / help). */
export function actionGroups() {
  const out = [];
  for (const a of ACTIONS) {
    if (a.hidden) continue;
    let g = out.find((x) => x.name === a.group);
    if (!g) { g = { name: a.group, actions: [] }; out.push(g); }
    g.actions.push(a);
  }
  return out;
}
