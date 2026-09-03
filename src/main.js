// Bootstrap: Game + Renderer + Input + UI + Audio + Save, the requestAnimationFrame loop, the debug
// API and the `?debug=1&seed=N&scenario=X` URL contract (see docs/ARCHITECTURE.md).
import { Game } from './game/game.js';
import { bus, EventBus } from './core/events.js';
import { Renderer } from './render/renderer.js';
import { Input } from './core/input.js';
import { registerScenarios } from './debug/scenarios.js';
import { TILE } from './core/constants.js';
import { AudioEngine } from './core/audio.js';
import { saveGame, loadSave, deleteSave, loadSettings } from './core/save.js';
import { Hud } from './ui/hud.js';
import { PanelCollapse } from './ui/collapse.js';
import { Surround } from './render/surround.js';
import { MessageLog } from './ui/log.js';
import { InventoryPanel } from './ui/inventory.js';
import { Minimap } from './ui/minimap.js';
import { Menus } from './ui/menus.js';
import { Tooltip } from './ui/tooltip.js';

const params = new URLSearchParams(location.search);
const debugMode = params.get('debug') === '1';
const seedParam = params.get('seed');
let currentSeed = seedParam !== null && seedParam !== '' ? (Number.isFinite(Number(seedParam)) ? Number(seedParam) : seedParam) : 42;
const difficultyParam = params.get('difficulty') || 'standard';

const canvas = document.getElementById('game-canvas');
const renderer = new Renderer({ canvas, bus, quality: params.get('quality') || 'high' }); // ?quality=low: cheaper fill for bots / weak GPUs
const surround = new Surround({ scene: renderer.scene, bus });
const input = new Input({ canvas, bus, pickTile: (x, y) => renderer.pickTile(x, y) });
const DEFAULT_YAW = renderer.cameraRig.yaw;

let game = null;
let autoPath = null;
let exploring = false;
let frozen = false; // true after a debug scenario ran: the RAF loop stops advancing (deterministic shots)
let loopEnabled = true; // debug.setLoop(false): the RAF loop stops advancing time but input still works (QA bots drive debug.step)
let saveRequested = false;

function newGame(seed = currentSeed, opts = {}) {
  currentSeed = seed;
  game = new Game({ seed, difficulty: opts.difficulty || difficultyParam, bus });
  renderer.fog.override = null;
  renderer.cameraRig.yaw = DEFAULT_YAW;
  renderer.setGame(game);
  input.reset();
  stopAuto(); // also clears the HUD's "exploring" state
  bus.emit('game:start', { game, loaded: false });
  return game;
}

// ------------------------------------------------------------------ UI / audio / save layer
const settings = loadSettings();
const uiRoot = document.getElementById('ui-root');
const audio = new AudioEngine({ bus, settings });
let modalCount = 0;
/** Modal bookkeeping shared by every panel: first modal disables game input and pauses; last one closing resumes. */
function setModal(open) {
  modalCount = Math.max(0, modalCount + (open ? 1 : -1));
  if (open && modalCount === 1) { input.enabled = false; input.reset(); stopAuto(); if (game && !game.over) game.setPaused(true); }
  else if (!open && modalCount === 0) { input.enabled = true; if (game && !game.over && !ui.menus.titleOpen) game.setPaused(false); }
}
const uiCtx = { root: uiRoot, bus, renderer, input, settings, getGame: () => game, setModal, isModal: () => modalCount > 0, allowAutoPause: () => !debugMode && !frozen };
const hud = new Hud(uiCtx);
const log = new MessageLog(uiCtx);
const inventory = new InventoryPanel(uiCtx);
const minimap = new Minimap(uiCtx);
const tooltip = new Tooltip(uiCtx);

/** Title backdrop: a fully lit level from a private Game, framed from above and slowly rotating. */
let preview = null;
function showTitlePreview() {
  if (!preview) { preview = new Game({ seed: 'the-sword-of-fargoal', difficulty: 'standard', bus: new EventBus() }); preview.goToDepth(3); preview.revealAll(); }
  renderer.setGame(preview);
  renderer.fog.override = 'all';
  renderer.overview(46);
}
function hideTitlePreview() {
  renderer.fog.override = null;
  renderer.cameraRig.yaw = DEFAULT_YAW;
  if (game) renderer.setGame(game);
}

const app = {
  /** Start a fresh quest. */
  newGame({ seed, difficulty, daily = false, recordDaily = true } = {}) {
    ui.menus.closeAll();
    hideTitlePreview();
    newGame(seed ?? currentSeed, { difficulty: difficulty || difficultyParam });
    game.daily = daily; game.recordDaily = recordDaily;
    audio.ensure();
    return game;
  },
  /** Resume the most recent save. Returns false if there is none or it is corrupt. */
  continueGame() {
    const s = loadSave();
    if (!s) return false;
    let g;
    try { g = Game.deserialize(s.data, { bus }); } catch (e) { console.warn('save could not be loaded', e); return false; }
    ui.menus.closeAll();
    hideTitlePreview();
    game = g; currentSeed = g.seed; game.daily = !!s.meta.daily;
    renderer.fog.override = null; renderer.cameraRig.yaw = DEFAULT_YAW;
    renderer.setGame(game);
    input.reset(); stopAuto();
    game.state.paused = false;
    bus.emit('game:start', { game, loaded: true });
    bus.emit('log', { text: 'YOUR QUEST CONTINUES!', kind: 'quest', time: game.state.time });
    audio.ensure();
    return true;
  },
  restart() { const seed = game ? game.seed : currentSeed, difficulty = game ? game.balance.name : difficultyParam, daily = !!(game && game.daily); app.newGame({ seed, difficulty, daily, recordDaily: false }); },
  saveAndQuit() { if (game && !game.over) saveGame(game); app.toTitle(); },
  abandon() { if (game && !game.over) { deleteSave(game.balance.name); game.gameOver(false, 'abandoned'); } },
  toTitle() { ui.menus.closeAll(); stopAuto(); showTitlePreview(); ui.menus.showTitle(); if (audio.ok) audio.title(); },
  applySettings(s) {
    document.documentElement.style.setProperty('--ui-scale', String(s.fontScale || 1));
    document.body.classList.toggle('cb', !!s.colorblind);
    document.body.classList.toggle('reduce-flash', !!s.reduceFlash);
    renderer.cameraRig.shakeEnabled = s.screenShake !== false;
    audio.setVolumes({ master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume });
    if (minimap.visible !== (s.minimap !== false)) minimap.toggle(s.minimap !== false);
    hud.refreshStatic();
    bus.emit('settings:changed', { settings: s });
  },
  save() { return game && !game.over ? saveGame(game) : false; },
};
const panelCollapse = new PanelCollapse(uiCtx);
const menus = new Menus({ ...uiCtx, app, inventory, isAutoPaused: () => hud.autoPaused });
const ui = {
  hud, log, inventory, minimap, menus, tooltip, audio, settings, app, panelCollapse,
  panels: { hud, log, inventory, minimap, menus, tooltip },
  update(dt) { hud.update(dt); log.update(dt); inventory.update(dt); minimap.update(dt); tooltip.update(dt); menus.update(dt); },
};
app.applySettings(settings);

// ------------------------------------------------------------------ input wiring
function stopAuto() { autoPath = null; if (exploring) { exploring = false; bus.emit('ui:explore', { on: false }); } }

/** Stairs cinematic: the player must stay put until the level swaps at the darkest point. */
function takeStairs(kind) {
  stopAuto(); input.reset(); game.setHeld(null); game.pendingMove = null;
  input.enabled = false;
  renderer.transition(kind, () => { if (kind === 'descend') game.descend(); else game.ascend(); input.enabled = modalCount === 0; });
}
const inTransition = () => !!renderer.cameraRig.transition;

function interact() {
  if (!game || game.over) return;
  const lv = game.level, p = game.player, t = lv.get(p.x, p.y);
  if (inTransition()) return;
  if (t === TILE.STAIRS_DOWN) { takeStairs('descend'); return; }
  if (t === TILE.STAIRS_UP && (lv.depth > 1 || p.hasSword)) { takeStairs('ascend'); return; }
  game.interact();
}

bus.on('input:move', ({ dx, dy }) => { if (!game || frozen || inTransition()) return; stopAuto(); game.move(dx, dy); });
bus.on('input:held', ({ dx, dy }) => { if (!game || frozen) return; if ((dx || dy) && inTransition()) return; if (dx || dy) stopAuto(); game.setHeld(dx, dy); });
bus.on('input:click', ({ x, y, button }) => {
  if (!game || frozen || button !== 0 || inTransition()) return;
  const p = game.player;
  if (x === p.x && y === p.y) { interact(); return; }
  const m = game.level.monsterAt(x, y);
  if (m && Math.max(Math.abs(m.x - p.x), Math.abs(m.y - p.y)) <= 1) { game.move(m.x - p.x, m.y - p.y); return; }
  const path = game.pathTo(x, y);
  if (path && path.length) { stopAuto(); autoPath = path; }
});
bus.on('input:action', (a) => {
  if (!game || frozen) return;
  switch (a.action) {
    case 'interact': stopAuto(); interact(); break;
    case 'potion': game.useItem('potion'); break;
    case 'cast': game.castSpell(a.spell); break;
    case 'toggleLight': game.toggleLight(); break;
    case 'bury': game.buryGold(); break;
    case 'beacon': game.useItem('beacon'); break;
    case 'wait': stopAuto(); game.wait(); break;
    case 'explore': exploring = !exploring; autoPath = null; bus.emit('ui:explore', { on: exploring }); if (exploring) game.log('Exploring... any monster or treasure stops you.', 'info'); break;
    case 'pause': game.setPaused(!game.paused); break; // the pause menu opens/closes from 'game:paused' (ui/menus.js)
    case 'zoom': renderer.cameraRig.setZoom(renderer.cameraRig.zoom * (a.delta > 0 ? 1.12 : 1 / 1.12)); break;
    default: bus.emit('ui:action', a); // inventory/minimap/help are handled by the UI layer
  }
});
bus.on('ui:action', (a) => {
  switch (a.action) {
    case 'inventory': inventory.toggle(); break;
    case 'minimap': settings.minimap = minimap.toggle(); break;
    case 'help': menus.showHelp(); break;
    default: break;
  }
});
for (const ev of ['monster:seen', 'entity:attacked', 'item:picked', 'trap:triggered', 'level:enter']) bus.on(ev, () => { if (ev !== 'item:picked' || exploring) stopAuto(); });
if (!debugMode) window.addEventListener('blur', () => { if (game && !game.over) game.setPaused(true); });
// autosave on level change (deferred to the next frame so the whole transition is captured); permadeath erases the save on death
bus.on('level:enter', (p) => { if (p.via !== 'new' && !debugMode) saveRequested = true; });
bus.on('game:over', (p) => { if (!game || debugMode) return; if (p.victory || game.balance.permadeath) deleteSave(game.balance.name); });

/** Drive click-to-move / auto-explore one step when the player is ready. */
function autoStep() {
  if (!game || game.over || game.paused || inTransition()) return;
  const p = game.player;
  if (p.moveTimer > 0) return;
  if (autoPath && autoPath.length) {
    const s = autoPath.shift();
    if (!game.move(s.x - p.x, s.y - p.y)) autoPath = null;
    if (autoPath && !autoPath.length) autoPath = null;
  } else if (exploring) {
    const s = game.autoExplore();
    if (!s) { stopAuto(); game.log('Nothing left to explore here.', 'info'); }
    else game.move(s.dx, s.dy);
  }
}

// ------------------------------------------------------------------ main loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (frozen || !loopEnabled) { last = now; return; }
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  input.update(dt);
  if (game) { autoStep(); game.update(dt); }
  if (menus.titleOpen) renderer.cameraRig.yaw += dt * 0.055;
  renderer.render(dt);
  ui.update(dt);
  audio.update(dt, menus.titleOpen ? null : game);
  flushSave();
}
/** Deferred autosave (requested on level change) once the frame that produced it is complete. */
function flushSave() { if (saveRequested && game && !game.over && !frozen) { saveRequested = false; saveGame(game); } }

// ------------------------------------------------------------------ debug API
const debug = {
  scenarios: {},
  /** Advance simulation + render deterministically by ms (no RAF needed). */
  step(ms) {
    if (!game) return;
    let rem = Math.max(0, ms) / 1000;
    while (rem > 1e-6) {
      const d = Math.min(rem, 0.25);
      autoStep();
      game.update(d);
      if (menus.titleOpen) renderer.cameraRig.yaw += d * 0.055;
      renderer.step(d);
      ui.update(d);
      rem -= d;
    }
    renderer.draw();
    flushSave();
  },
  /** Run a registered scenario on a fresh game. Resolves false if unknown. */
  async runScenario(name, opts = {}) {
    const fn = debug.scenarios[name];
    if (!fn) return false;
    frozen = true;
    const seed = opts.seed ?? currentSeed;
    const ctx = {
      reset: (s = seed, o = {}) => newGame(s, o),
      get game() { return game; },
      renderer, bus, debug, ui, app,
      step: (ms) => debug.step(ms),
    };
    menus.closeAll();
    hideTitlePreview();
    newGame(seed);
    await fn(ctx, opts);
    debug.step(16);
    return true;
  },
  /** Resume the live loop after scenarios (they freeze it for deterministic screenshots). */
  resume() { frozen = false; last = performance.now(); },
  get frozen() { return frozen; },
  /** Enable/disable the live RAF clock (input keeps working). QA bots disable it so debug.step is the only clock. */
  setLoop(on) { loopEnabled = !!on; last = performance.now(); },
  get loopEnabled() { return loopEnabled; },
  setSeed(seed) { return newGame(seed); },
  goToDepth(d) { game.goToDepth(d); renderer.render(0); },
  teleport(x, y) { return game.teleportTo(x, y); },
  revealAll() { game.revealAll(); },
  spawn(type, x, y, opts) { return game.spawnMonster(type, x, y, opts); },
  give(type, qty) { return game.give(type, qty); },
  heal() { game.heal(); },
  kill(entity) { game.kill(entity); },
  setTime(hour) { renderer.setTimeOfDay(hour); },
  stats() { return renderer.stats(); },
  showTitle() { showTitlePreview(); menus.showTitle(); },
  newGame, input, ui, app, audio,
};
registerScenarios(debug);

window.__game = { get game() { return game; }, renderer, ui, debug, bus };

// ------------------------------------------------------------------ start
newGame(currentSeed);
if (!debugMode) app.toTitle();
renderer.render(0);
window.__GAME_READY = true;
requestAnimationFrame(frame);
const scenarioParam = params.get('scenario');
if (debugMode && scenarioParam) debug.runScenario(scenarioParam, { seed: currentSeed });
