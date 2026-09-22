// levelBuilder: place, size, raise, turn and delete props in a live level (Settings -> Developer ->
// Level builder, then Shift+B or the BUILD tab on the left edge).
//
// IT EDITS `level.decor`, NOTHING ELSE. The dungeon is still generated; every prop the game draws is
// already one plain entry in `level.decor` (docs/AMBIENCE.md §4.1), `level.setDecor()` rebuilds the
// movement mask from each entry's `blocking`, and `DungeonView.rebuildDecor()` redraws the lot. So a
// placed table blocks the hero and the monsters for exactly the reason a generated sarcophagus does,
// a save carries every edit with the rest of the level, and nothing here has a renderer of its own.
// The builder adds four OPTIONAL fields, documented in AMBIENCE §4.1:
//   placed  true on a piece the builder put down (the generator never sets it)
//   hidden  a generated piece taken out: kept, so it can come back, but not drawn, solid or lit
//   scale   size multiplier, default 1          lift  tiles above the floor, default 0
// plus `art: 'dc'` (draw the owner's Dungeon Crawlers model for this type, even where the kit would
// win) and the existing `model` asset override the Freeport and supplied builders already honour.
//
// LAYERS. A floor decal and a standing prop on one tile is legal and always was (§4.1: "a decal + a
// prop is legal"), so a rug and then a table on it is two entries on one tile. `lift` puts one piece
// on top of another: a candlestick at 0.5 stands on a table.
//
// PERSISTENCE. Every edit writes the level's whole decor list to localStorage under `seed:depth`, with
// the generator's original list kept beside it for Revert. The level is regenerated deterministically
// from its seed, so on entering a level with a stored list the builder puts that list back — a new game
// on the same seed gets the same room. Copy / Paste move a level between browsers or into the repo.
//
// INPUT. The world keeps running and the KEYBOARD stays the game's — WASD walks the hero with the panel
// open, so he can walk into what you built and prove whether it blocks (owner, 2026-09-19). The builder
// takes only the MOUSE on the canvas (at the window, capture phase, so a click never reaches
// click-to-move) and only the keys that mean something to it at that moment: arrows with a piece
// selected, R, [ ], Delete, Esc. "Pause the world" is an option, not the default; it holds a UI modal
// (main.js `setModal`) so the pause menu does not open over the builder.
import * as THREE from 'three';
import { DECOR_TYPES } from '../world/generator.js';
import { TILE } from '../core/constants.js';
import { createRng } from '../core/rng.js';
import { MODEL_MAP } from '../render/props/models.js';
import { applyDecorTransform } from '../render/dungeon.js';
import { PROPS2D } from '../assets/props2d/map.js';
import { buildGroundSprite } from '../render/props/atlas2d.js';
import { decorOffset, defaultOffset, offsetKey, saveDefaultOffset, clearDefaultOffset } from '../render/props/offsets.js';
import { releaseFocusAfterClicks } from './lightPanel.js';

const STORE_KEY = 'fargoal.levelBuilder.v1';
const ROT_FIELDS = ['rotX', 'rotY', 'rotZ'];
const FACINGS = ['s', 'w', 'n', 'e'];
const FACE = { n: { dx: 0, dy: -1 }, e: { dx: 1, dy: 0 }, s: { dx: 0, dy: 1 }, w: { dx: -1, dy: 0 } };
const FREEPORT_ASSETS = [
  ['chest_a', 'strongbox'], ['chest_b', 'strongbox'], ['chest_long', 'footlocker'], ['brazier_a', 'brazier'],
  ['brazier_b', 'brazier'], ['cupboard', 'cupboard'], ['table', 'table'], ['banquet', 'tableLong'],
];
/**
 * Light presets for the Floor Designer. Each places a `light` entry (render/lighting.js setMoods reads it)
 * with its own colour, strength, reach, height and beat; every field is editable once placed. The kinds
 * are lighting.js `moodFlicker`'s own, so a placed torch breathes exactly like a generated one.
 */
const LIGHT_PRESETS = [
  // [label, light, the sheet sprite it burns in (null: the light alone)] — owner, 2026-09-21: the Lights
  // tab places the SPRITE WITH ITS LIGHT, one entry, so the two move, turn, raise and delete together.
  ['Torch', { color: 0xff6a20, intensity: 4.5, radius: 6, y: 1.0, kind: 'fire' }, 'floor-torch'],
  ['Wall torch', { color: 0xff6a20, intensity: 4.5, radius: 6, y: 1.0, kind: 'fire' }, 'wall-torch-1'],
  ['Wall torch (2)', { color: 0xff6a20, intensity: 4.5, radius: 6, y: 1.0, kind: 'fire' }, 'wall-torch-2'],
  ['Wall sconce', { color: 0xffb060, intensity: 3.2, radius: 4.5, y: 1.0, kind: 'candle' }, 'wall-sconce'],
  ['Skull sconce', { color: 0xc8e070, intensity: 2.6, radius: 4.5, y: 0.9, kind: 'sickly' }, 'skull-sconce'],
  ['Candle', { color: 0xffe6b0, intensity: 1.8, radius: 2.8, y: 0.6, kind: 'candle' }, 'candles'],
  ['Candle stand', { color: 0xffe6b0, intensity: 2.2, radius: 3.2, y: 0.9, kind: 'candle' }, 'candle-stand'],
  ['Brazier fire', { color: 0xff6424, intensity: 4.2, radius: 5.2, y: 0.8, kind: 'fire' }, 'brazier'],
  ['Campfire', { color: 0xff6e28, intensity: 5.5, radius: 6, y: 0.65, kind: 'fire' }, 'campfire'],
  ['Campfire (2)', { color: 0xff6a20, intensity: 4.6, radius: 5.8, y: 0.8, kind: 'forge' }, 'campfire-b'],
  ['Lantern', { color: 0xfff4e0, intensity: 3.0, radius: 5, y: 1.4, kind: 'steady' }, 'hanging-lantern'],
  ['Magic blue', { color: 0x6fa8ff, intensity: 3.5, radius: 5.5, y: 1.2, kind: 'water' }, 'blue-flame'],
  ['Fungal green', { color: 0x7fe3a8, intensity: 2.6, radius: 4.5, y: 0.5, kind: 'fungal' }, 'green-flame'],
  ['Blood red', { color: 0xff3030, intensity: 3.0, radius: 4.5, y: 1.0, kind: 'candle' }, 'red-flame'],
  ['Bare light', { color: 0xffc080, intensity: 3.0, radius: 5, y: 1.2, kind: 'steady' }, null],
  ['Moonlight (bare)', { color: 0xbfd6ff, intensity: 3.0, radius: 8, y: 3.0, kind: 'steady' }, null],
];
const LIGHT_KINDS = ['steady', 'fire', 'candle', 'forge', 'fungal', 'sickly', 'water'];

const SOURCE = {
  light: ['#ffcf8a', 'light'], 'light + sprite': ['#ffcf8a', 'light + your sprite'],
  'owner-dc': ['#6fbf8a', 'yours · Dungeon Crawlers'], 'owner-freeport': ['#6fbf8a', 'yours · Freeport'],
  'owner-supplied': ['#6fbf8a', 'yours · sprite / pack'], 'claude-kit': ['#e07a5a', 'procedural kit'],
  'claude-pixel': ['#e07a5a', 'painted pixels'], none: ['#888', 'draws nothing'],
};

function readStore() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; } }
function writeStore(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); return true; } catch { return false; } }
const plain = (list) => JSON.parse(JSON.stringify(list || []));

/** Where a built decor group's art came from, read off the markers each builder leaves. */
function sourceOf(o) {
  if (!o) return 'none';
  const u = o.userData.decor || {};
  if (u.supplied || u.sheet) return 'owner-supplied';     // the Top-Down packs, and the owner's sprite sheet
  if (u.freeport) return 'owner-freeport';
  if (u.model) return 'owner-dc';
  let meshes = 0; o.traverse((c) => { if (c.isMesh || c.isSprite) meshes++; });
  if (u.drawn === false || !meshes) return 'none';
  return u.kit ? 'claude-kit' : 'claude-pixel';
}

export class LevelBuilder {
  /** @param {{renderer:any, bus:any, getGame:()=>any, setModal:(open:boolean)=>void, settings?:object}} ctx */
  constructor({ renderer, bus, getGame, setModal, isModal, settings }) {
    this.renderer = renderer; this.bus = bus; this.getGame = getGame; this.setModal = setModal;
    this.isModal = isModal || (() => false);
    this.devMode = false; this.root = null; this.tab = null;
    this.mode = 'select';          // 'select' | 'place'
    this.pauseWorld = false;       // the option; off, the hero walks while you build
    this.drag = null;              // {d, gx, gy, moved} while a piece is being dragged
    this.modalHeld = false;
    this.item = null;              // palette entry being placed
    this.next = { variant: 0, facing: 's' };
    this.selected = null;          // the decor entry being edited
    this.hover = null;             // {x, y} under the pointer
    this.ghost = null;
    this.ray = new THREE.Raycaster();
    this.saveTimer = 0;
    this.palette = null;
    this.filter = ''; this.group = 'prop';
    this.orig = new Map();         // seed:depth -> the generator's own list, taken before the first edit

    this.onKey = (e) => this.key(e);
    window.addEventListener('keydown', this.onKey, true);
    this.onPointer = (e) => this.pointer(e);
    for (const t of ['pointerdown', 'pointerup', 'click', 'contextmenu']) window.addEventListener(t, this.onPointer, true);
    this.onMove = (e) => this.move(e);
    window.addEventListener('pointermove', this.onMove, true);
    // A stored level comes back whenever it is entered, dev mode or not: it is the level now.
    // `level:enter` fires INSIDE a new Game's start, before main.js has assigned `game` to it, so the
    // level comes from the event and the work waits a tick for the new game to be wired up.
    this.unsub = bus.on('level:enter', (p) => setTimeout(() => this.restoreStored(p && p.level), 0));
    bus.on('game:start', () => setTimeout(() => this.restoreStored(this.level), 0));
    bus.on('settings:changed', ({ settings: s }) => this.setDevMode(!!(s && s.devMode)));
    // applySettings ran at boot before this module was loaded, so its first event was missed
    this.setDevMode(!!(settings && settings.devMode));
    this.restoreStored();
  }

  get game() { return this.getGame(); }
  get level() { const g = this.game; return g && g.level; }
  get dv() { return this.renderer.dungeon; }
  /**
   * The store key for a level: its own seed and depth. `level.seed` is `seedFrom(gameSeed, 'level',
   * depth)` (world/generator.js), so it names exactly one generated level and needs no Game to read.
   */
  keyOf(lv) { return lv ? `${lv.seed}:${lv.depth}` : null; }
  get key_() { return this.keyOf(this.level); }
  get isOpen() { return !!this.root; }

  // ------------------------------------------------------------------ dev mode, open, close
  setDevMode(on) {
    this.devMode = !!on;
    if (this.devMode && !this.tab) {
      const t = document.createElement('button');
      t.textContent = 'BUILD';
      t.title = 'Level builder (Shift+B)';
      t.style.cssText = 'position:fixed;left:0;top:50%;transform:translateY(-50%);z-index:99998;pointer-events:auto;'
        + 'writing-mode:vertical-rl;padding:10px 4px;background:#1c1a17;color:#ffcf8a;border:1px solid #4a4a55;border-left:0;'
        + 'border-radius:0 4px 4px 0;font:bold 11px/1 ui-monospace,Menlo,monospace;letter-spacing:.2em;cursor:pointer';
      t.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
      document.body.append(t);
      this.tab = t;
    } else if (!this.devMode) {
      if (this.tab) { this.tab.remove(); this.tab = null; }
      this.close();
    }
  }

  /** In the Floor Designer the builder is always available, dev mode or not. */
  get designer() { return !!(this.game && this.game.designer); }
  toggle() { if (this.root) this.close(); else this.open({ force: this.designer }); }

  /** Keep the generator's own list for Revert, taken before anything on this level is touched. */
  noteOrig(lv = this.level) {
    const k = this.keyOf(lv);
    if (!k || !lv || this.orig.has(k)) return;
    const rec = readStore()[k];
    this.orig.set(k, rec && rec.orig ? rec.orig : plain(lv.decor.filter((d) => !d.placed)));
  }

  /** @param {{force?:boolean}} [o] `force` opens it without dev mode — the Floor Designer does. */
  open(o = {}) {
    if (this.root || (!this.devMode && !o.force) || !this.level) return;
    this.noteOrig();
    this.buildPalette();
    const root = document.createElement('div');
    root.style.cssText = [
      'position:fixed', 'top:8px', 'right:8px', 'width:340px', 'max-height:calc(100vh - 16px)', 'overflow:auto',
      'z-index:99999', 'pointer-events:auto', 'background:rgba(16,16,20,.95)', 'color:#e8e2d6', 'border:1px solid #4a4a55',
      'border-radius:4px', 'padding:8px 10px 10px', 'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
      'box-shadow:0 8px 28px rgba(0,0,0,.6)',
    ].join(';');
    // the panel is on <body>, not #ui-root: #ui-root is pointer-events:none (see debug/lightPanel.js)
    root.addEventListener('keydown', (e) => e.stopPropagation());
    for (const t of ['pointerdown', 'click', 'wheel']) root.addEventListener(t, (e) => e.stopPropagation());
    releaseFocusAfterClicks(root);   // a clicked control must not keep WASD from the game
    document.body.append(root);
    this.root = root;
    if (this.pauseWorld) this.holdModal();
    this.showLightMarkers(true);
    this.setMode('select');
    this.render();
  }

  close() {
    if (!this.root) return;
    this.flushSave();
    this.clearGhost(); this.clearMarks();
    this.selected = null; this.item = null;
    this.releaseModal();
    this.showLightMarkers(false);
    this.root.remove(); this.root = null;
  }

  // The shared modal count only pauses on its 0 -> 1 step, so a builder opened while anything else holds
  // a modal would leave the world running under it. So the builder pauses the game itself as well; the
  // modal it holds is what keeps `game:paused` from opening the pause menu (ui/menus.js).
  /** The placed-light gizmos show while the builder is open and not otherwise (dungeon.js lightMarker). */
  showLightMarkers(on) {
    this.dv.showLightMarkers = !!on;
    for (const o of this.dv.decorViews) if (o.userData.decor && o.userData.decor.light) o.visible = !!on;
  }

  holdModal() {
    if (this.modalHeld) return;
    this.modalHeld = true; this.setModal(true);
    const g = this.game; if (g && !g.over && !g.paused) { g.setPaused(true); this.pausedIt = g; }
  }
  releaseModal() {
    if (!this.modalHeld) return;
    this.modalHeld = false; this.setModal(false);
    const g = this.pausedIt; this.pausedIt = null;
    if (g && g === this.game && !g.over && !this.isModal()) g.setPaused(false);
  }

  setMode(m) {
    this.mode = m === 'place' ? 'place' : 'select';
    if (this.mode === 'select') { this.clearGhost(); this.item = null; }
    this.render();
    this.mark();
  }

  setPauseWorld(on) {
    this.pauseWorld = !!on;
    if (this.pauseWorld) this.holdModal(); else this.releaseModal();
    this.render();
  }

  // ------------------------------------------------------------------ the palette
  /** Every placeable thing: the game's own types (built once to read their source) plus the owner's libraries. */
  buildPalette() {
    if (this.palette && !(this.paletteStale && this.dv.modelLib)) return;
    this.paletteStale = false;
    const P = [];
    for (const [type, t] of Object.entries(DECOR_TYPES)) {
      let src = 'none';
      try { src = sourceOf(this.renderer.props.decor({ type, x: 0, y: 0, facing: 's', variant: 0, blocking: false })); } catch { /* drawn below as unknown */ }
      P.push({ key: `t:${type}`, group: t.cls, label: type, type, variants: t.v, span: t.span || 0, blk: !!t.blk, src });
    }
    // THE OWNER'S DUNGEON CRAWLERS MODELS. The kit claims every type this library maps before the
    // library is asked (tools/propsheet.mjs measured it: 116 meshes loaded, none on screen), so each
    // model is offered here by name and drawn with `art: 'dc'`.
    for (const [type, names] of Object.entries(MODEL_MAP)) {
      if (DECOR_TYPES[type] && DECOR_TYPES[type].cls === 'wall') continue;   // it would stand inside the wall
      names.forEach((name, i) => {
        if (this.dv.modelLib) {
          let ok = null;
          try { ok = this.dv.modelFor({ type, x: 0, y: 0, facing: 's', variant: i, blocking: false, art: 'dc' }); } catch { ok = null; }
          if (!ok) return;
        }
        P.push({ key: `dc:${type}:${i}`, group: 'dc', label: name, type, variants: 1, fixedVariant: i, art: 'dc', blk: !!(DECOR_TYPES[type] && DECOR_TYPES[type].blk), src: 'owner-dc' });
      });
    }
    // built before the library landed: build it again next time the panel opens
    if (!this.dv.modelLib) this.paletteStale = true;
    // ...and every Freeport model by its own id (the game picks between a pair by tile position, so
    // the second chest and the second brazier are otherwise a matter of luck)
    // THE OWNER'S SPRITES, flat on the floor: the pit and the two stairs first (2026-09-21), then every
    // sprite of the prop sheet, so anything the owner has drawn can be laid down and judged in a room.
    const ownFirst = ['floor-pit', 'floor-stairs-down', 'floor-stairs-up'];
    const sheetNames = Object.keys(PROPS2D).filter((n) => !ownFirst.includes(n) && n !== 'rugs-strip').sort();
    for (const name of ownFirst.concat(sheetNames)) {
      if (!PROPS2D[name]) continue;
      P.push({ key: `sp:${name}`, group: 'sprite', label: name, type: 'sprite', sprite: name, variants: 1, src: 'owner-supplied' });
    }
    LIGHT_PRESETS.forEach(([label, light, sprite]) => {
      if (sprite && !PROPS2D[sprite]) return;
      P.push({ key: `l:${label}`, group: 'light', label, type: sprite ? 'sprite' : 'light', variants: 1, light, sprite: sprite || undefined, src: sprite ? 'light + sprite' : 'light' });
    });
    for (const [id, type] of FREEPORT_ASSETS) P.push({ key: `fp:${id}`, group: 'freeport', label: id, type, variants: DECOR_TYPES[type].v, model: id, blk: !!DECOR_TYPES[type].blk, src: 'owner-freeport' });
    this.palette = P;
  }

  entryFor(item, x, y) {
    const d = { type: item.type, x, y, facing: this.next.facing, variant: item.fixedVariant ?? Math.min(this.next.variant, item.variants - 1), blocking: false, placed: true };
    if (item.span) d.span = item.span;
    if (item.art) d.art = item.art;
    if (item.model) d.model = item.model;
    if (item.light) d.light = { ...item.light };
    if (item.sprite) { d.sprite = item.sprite; d.tiles = 1; }
    return d;
  }

  // ------------------------------------------------------------------ building the view of one entry
  /** Build a group for an entry the way DungeonView.addDecor does, positioned. Null if nothing draws. */
  viewFor(d) {
    const dv = this.dv;
    let o = null;
    try {
      o = d.type === 'sprite' && d.sprite ? buildGroundSprite(d.sprite, { tiles: d.tiles || 1, facing: d.facing })
        : dv.modelFor(d) || this.renderer.props.decor(d);
    } catch { o = null; }
    if (!o) return null;
    const cls = (o.userData.decor && o.userData.decor.cls) || 'prop';
    if (cls === 'wall') { const f = FACE[d.facing] || FACE.s; o.position.set(d.x + f.dx * 0.5, 0, d.y + f.dy * 0.5); } else o.position.set(d.x, 0, d.y);
    applyDecorTransform(o, d);
    return o;
  }

  // ------------------------------------------------------------------ edits
  commit({ save = true } = {}) {
    const lv = this.level; if (!lv) return;
    lv.setDecor(lv.decor);                       // rebuild the movement mask from `blocking`
    if (this.dv.level === lv) this.dv.rebuildDecor();
    const L = this.renderer.lighting;            // a placed brazier burns, a hidden one goes out
    if (L && L.setMoods) L.setMoods(lv, createRng(((lv.seed | 0) * 31 + 11) >>> 0));
    if (save) this.scheduleSave();
    this.mark();
    this.render();
  }

  place(x, y) {
    const lv = this.level; if (!lv || !this.item) return;
    const d = this.entryFor(this.item, x, y);
    lv.decor.push(d);
    this.selected = d;
    this.commit();
  }

  remove(d) {
    const lv = this.level; if (!lv || !d) return;
    if (d.placed) lv.decor.splice(lv.decor.indexOf(d), 1);
    else d.hidden = true;                        // a generated piece is kept, so Revert can bring it back
    if (this.selected === d) this.selected = null;
    this.commit();
  }

  /** Change one field of the selected entry. `live` skips the full rebuild (a slider mid-drag). */
  edit(field, value, { live = false } = {}) {
    const d = this.selected; if (!d) return;
    d[field] = value;
    if (live && (field === 'scale' || field === 'lift' || ROT_FIELDS.includes(field))) {
      for (const o of this.dv.decorViews) if (o.userData.decorRef === d) applyDecorTransform(o, d);
      this.scheduleSave();
      return;
    }
    this.commit();
  }

  /**
   * Change one field of the selected light. `live` (a slider mid-drag) relights the room without
   * rebuilding the decor, so the drag stays smooth; the marker catches up on release.
   */
  editLight(field, value, live = false) {
    const d = this.selected; if (!d || !d.light) return;
    d.light[field] = value;
    if (live) {
      const lv = this.level, L = this.renderer.lighting;
      if (lv && L && L.setMoods) L.setMoods(lv, createRng(((lv.seed | 0) * 31 + 11) >>> 0));
      this.scheduleSave();
      return;
    }
    this.commit();
  }

  nudge(dx, dy) {
    const d = this.selected; if (!d) return;
    d.x += dx; d.y += dy;
    this.commit();
  }

  rotate() {
    const turn = (f) => FACINGS[(FACINGS.indexOf(f) + 1) % 4];
    if (this.mode === 'place') { this.next.facing = turn(this.next.facing); this.refreshGhost(true); this.render(); return; }
    const d = this.selected; if (!d) return;
    // a 1x3 table turned a quarter is a 3x1 table: the footprint turns with the piece
    const tx = d.tilesX, ty = d.tilesY;
    if (tx || ty) { if (ty) d.tilesX = ty; else delete d.tilesX; if (tx) d.tilesY = tx; else delete d.tilesY; }
    this.edit('facing', turn(d.facing || 's'));
  }

  // ------------------------------------------------------------------ pointer
  aim(e) {
    const c = this.renderer.canvas; if (!c) return false;
    const r = c.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(ndc, this.renderer.cameraRig.camera);
    return true;
  }

  tileAt(e, planeY = 0) {
    if (!this.aim(e)) return null;
    const hit = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY), hit)) return null;
    return { x: Math.round(hit.x), y: Math.round(hit.z), fx: hit.x - Math.round(hit.x), fy: hit.z - Math.round(hit.z) };
  }

  /** Is the pointer on the game canvas (and not on some panel over it)? */
  onCanvas(e) { return !!this.renderer.canvas && e.target === this.renderer.canvas; }

  /** Where a wall piece on (x,y) would hang and which way it would face, or null if it cannot. */
  wallSpot(t) {
    const lv = this.level;
    if (!lv || lv.get(t.x, t.y) !== TILE.WALL) return null;
    let best = null, bestD = Infinity;
    for (const f of ['n', 'e', 's', 'w']) {
      const { dx, dy } = FACE[f];
      const n = lv.get(t.x + dx, t.y + dy);
      if (n === undefined || n === TILE.WALL) continue;
      const d = Math.hypot(t.fx - dx * 0.5, t.fy - dy * 0.5);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best ? { x: t.x, y: t.y, facing: best } : null;
  }

  /**
   * The piece under the pointer, by its GEOMETRY. Picking by the floor tile under the cursor missed every
   * standing piece: this camera draws a table's body a tile NORTH of the tile it stands on, so a click on
   * the table found an empty tile (owner: "after an item is unselected, i can no longer select"). Contact
   * shadows and ground glows are skipped — they are wide flat see-through quads and would steal clicks
   * meant for the floor beside a brazier. Falls back to the tile, which is how a flat decal is found.
   */
  pickPiece(e, t) {
    if (this.aim(e)) {
      const views = this.dv.decorViews.filter((o) => o.userData.decorRef && !o.userData.decorRef.hidden);
      for (const h of this.ray.intersectObjects(views, true)) {
        const m = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material;
        if (m && m.transparent && m.depthWrite === false) continue;
        let o = h.object; while (o && !o.userData.decorRef) o = o.parent;
        if (o) return o.userData.decorRef;
      }
    }
    const here = t ? this.piecesAt(t.x, t.y) : [];
    return here.length ? here[0] : null;
  }

  pointer(e) {
    if (!this.root || !this.onCanvas(e)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (e.type === 'contextmenu') { if (this.mode === 'place') this.setMode('select'); else { this.selected = null; this.mark(); this.render(); } return; }
    if (e.type === 'pointerup') { this.endDrag(); return; }
    if (e.type !== 'pointerdown' || e.button !== 0) return;
    const wall = this.item && this.item.group === 'wall';
    const t = this.tileAt(e, wall ? 0.5 : 0);
    if (!t) return;
    const lv = this.level;
    if (this.mode === 'place' && this.item) {
      if (wall) {
        const w = this.wallSpot(t); if (!w) return;
        const keep = this.next.facing; this.next.facing = w.facing;
        this.place(w.x, w.y);
        this.next.facing = keep;
      } else if (lv.get(t.x, t.y) !== undefined && lv.get(t.x, t.y) !== TILE.WALL) this.place(t.x, t.y);
      return;
    }
    // select: the piece under the pointer — and hold the button to drag it
    const d = this.pickPiece(e, this.tileAt(e, 0));
    this.selected = d;
    const t0 = this.tileAt(e, 0);
    this.drag = d && t0 ? { d, gx: t0.x - d.x, gy: t0.y - d.y, moved: false } : null;
    try { if (this.drag && e.pointerId !== undefined) this.renderer.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    this.mark(); this.render();
  }

  /** Move the dragged piece to the tile under the pointer, drawn live; committed on release. */
  dragTo(e) {
    const g = this.drag; if (!g) return;
    const d = g.d, lv = this.level;
    const wall = (DECOR_TYPES[d.type] ? DECOR_TYPES[d.type].cls : 'prop') === 'wall';
    if (wall) {
      const w = this.wallSpot(this.tileAt(e, 0.5) || {});
      if (!w || (w.x === d.x && w.y === d.y && w.facing === d.facing)) return;
      d.x = w.x; d.y = w.y; d.facing = w.facing;
      g.moved = true;
      this.commit({ save: false });            // a new facing needs the piece rebuilt
      return;
    }
    const t = this.tileAt(e, 0); if (!t) return;
    const nx = t.x - g.gx, ny = t.y - g.gy;
    if (nx === d.x && ny === d.y) return;
    if (lv.get(nx, ny) === TILE.WALL) return;
    d.x = nx; d.y = ny; g.moved = true;
    for (const o of this.dv.decorViews) if (o.userData.decorRef === d) applyDecorTransform(o, d);
    this.mark();
  }

  endDrag() {
    const g = this.drag; this.drag = null;
    if (g && g.moved) this.commit();           // the movement mask, the fires and the save follow it
  }

  /** Pieces that belong to a clicked tile: its own, standing props first, then wall pieces facing it. */
  piecesAt(x, y) {
    const lv = this.level; if (!lv) return [];
    const cls = (d) => (DECOR_TYPES[d.type] ? DECOR_TYPES[d.type].cls : 'prop');
    const covers = (d) => x >= d.x && y >= d.y && x < d.x + Math.max(1, d.tilesX | 0) && y < d.y + Math.max(1, d.tilesY | 0);
    const own = lv.decor.filter((d) => !d.hidden && covers(d) && cls(d) !== 'wall');
    own.sort((a, b) => (cls(a) === 'decal') - (cls(b) === 'decal') || (b.lift || 0) - (a.lift || 0));
    const hung = lv.decor.filter((d) => !d.hidden && cls(d) === 'wall' && ((d.x === x && d.y === y) || (d.x + FACE[d.facing || 's'].dx === x && d.y + FACE[d.facing || 's'].dy === y)));
    return own.concat(hung);
  }

  move(e) {
    if (!this.root) return;
    if (this.drag) { this.dragTo(e); return; }
    if (this.mode !== 'place' || !this.item || !this.onCanvas(e)) return;
    const wall = this.item.group === 'wall';
    const t = this.tileAt(e, wall ? 0.5 : 0);
    if (!t) return;
    const spot = wall ? this.wallSpot(t) : t;
    const key = spot ? `${spot.x},${spot.y},${spot.facing || ''}` : 'none';
    if (key === this.hoverKey) return;
    this.hoverKey = key;
    this.hover = spot;
    this.refreshGhost(false);
  }

  // ------------------------------------------------------------------ ghost + tile marks
  clearGhost() { if (this.ghost) { this.ghost.removeFromParent(); this.ghost = null; } this.ghostKey = null; }

  refreshGhost(force) {
    const lv = this.level, spot = this.hover;
    if (!this.item || !spot || !lv) { this.clearGhost(); this.mark(); return; }
    const wall = this.item.group === 'wall';
    if (!wall && (lv.get(spot.x, spot.y) === undefined || lv.get(spot.x, spot.y) === TILE.WALL)) { this.clearGhost(); this.mark(); return; }
    const d = this.entryFor(this.item, spot.x, spot.y);
    if (wall) d.facing = spot.facing;
    const gk = `${this.item.key}|${d.variant}|${d.facing}`;
    if (force || gk !== this.ghostKey || !this.ghost) {
      this.clearGhost();
      const o = this.viewFor(d);
      if (o) {
        // THE PREVIEW IS THE REAL PIECE, NOT A SEE-THROUGH ONE. Transparent clones of these materials
        // were in the scene at the right tile and still did not show at the play camera (and
        // Material.clone() drops the `onBeforeCompile` patch every kit and Freeport material depends
        // on, which had to be carried over by hand). The white square says it is a preview.
        this.dv.root.add(o);
        this.ghost = o; this.ghostKey = gk;
      }
    } else {
      const f = FACE[d.facing] || FACE.s;
      const cls = (this.ghost.userData.decor && this.ghost.userData.decor.cls) || 'prop';
      if (cls === 'wall') this.ghost.position.set(d.x + f.dx * 0.5, this.ghost.position.y, d.y + f.dy * 0.5);
      else this.ghost.position.set(d.x, this.ghost.position.y, d.y);
    }
    this.mark();
  }

  clearMarks() { if (this.marks) { this.marks.removeFromParent(); this.marks = null; } }

  /** Square outlines on the floor: white where a piece would go, gold round the selected piece. */
  mark() {
    this.clearMarks();
    if (!this.root) return;
    const g = new THREE.Group();
    const square = (x, y, color, w = 1, dep = 1) => {
      const h = 0.48, x1 = x - h, y1 = y - h, x2 = x + (w - 1) + h, y2 = y + (dep - 1) + h;
      const pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]].map(([a, b]) => new THREE.Vector3(a, 0.03, b));
      const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
      l.renderOrder = 20; g.add(l);
    };
    const onFloor = (d) => { const c = DECOR_TYPES[d.type] ? DECOR_TYPES[d.type].cls : 'prop'; const f = FACE[d.facing || 's']; return c === 'wall' ? { x: d.x + f.dx, y: d.y + f.dy } : d; };
    if (this.mode === 'place' && this.hover) { const s = this.item && this.item.group === 'wall' ? onFloor({ ...this.hover, type: this.item.type }) : this.hover; square(s.x, s.y, 0xffffff); }
    if (this.selected) { const d = this.selected, s = onFloor(d); square(s.x, s.y, 0xffcf3a, s === d ? Math.max(1, d.tilesX | 0) : 1, s === d ? Math.max(1, d.tilesY | 0) : 1); }
    this.dv.root.add(g);
    this.marks = g;
  }

  // ------------------------------------------------------------------ keyboard
  key(e) {
    const inField = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
    const isB = e.code === 'KeyB' || (typeof e.key === 'string' && e.key.toLowerCase() === 'b');
    if (isB && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !inField) {
      if (!this.devMode && !this.designer) return;
      e.preventDefault(); e.stopPropagation(); this.toggle(); return;
    }
    if (!this.root || inField || e.metaKey || e.ctrlKey) return;
    // Only keys that mean something to the builder RIGHT NOW are taken; the rest (WASD above all) walk
    // the hero as usual.
    const sel = this.selected, placing = this.mode === 'place';
    let used = true;
    switch (e.key) {
      case 'Escape': if (placing) this.setMode('select'); else if (sel) { this.selected = null; this.mark(); this.render(); } else used = false; break;
      case 'Delete': case 'Backspace': if (sel) this.remove(sel); else used = false; break;
      case 'r': case 'R': if (placing || sel) this.rotate(); else used = false; break;
      case '[': if (sel) this.edit('scale', Math.max(0.25, +((sel.scale || 1) - 0.1).toFixed(2))); else used = false; break;
      case ']': if (sel) this.edit('scale', Math.min(3, +((sel.scale || 1) + 0.1).toFixed(2))); else used = false; break;
      case 'ArrowUp': if (sel) this.nudge(0, -1); else used = false; break;
      case 'ArrowDown': if (sel) this.nudge(0, 1); else used = false; break;
      case 'ArrowLeft': if (sel) this.nudge(-1, 0); else used = false; break;
      case 'ArrowRight': if (sel) this.nudge(1, 0); else used = false; break;
      default: used = false;
    }
    if (used) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
  }

  // ------------------------------------------------------------------ persistence
  scheduleSave() { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.flushSave(), 300); }

  flushSave() {
    clearTimeout(this.saveTimer);
    const k = this.key_, lv = this.level;
    if (!k || !lv) return false;
    const st = readStore();
    const rec = st[k] || {};
    if (!rec.orig) { this.noteOrig(); rec.orig = this.orig.get(k) || plain(lv.decor.filter((d) => !d.placed)); }
    rec.decor = plain(lv.decor);
    rec.saved = Date.now();
    st[k] = rec;
    this.lastSave = writeStore(st) ? 'saved' : 'NOT saved (storage blocked)';
    return true;
  }

  /** On entering a level: if this seed and depth has a stored layout, it is the level. */
  restoreStored(lv = this.level) {
    const k = this.keyOf(lv);
    if (lv === this.level) { this.selected = null; this.clearGhost(); this.clearMarks(); }
    if (!k || !lv) return;
    this.noteOrig(lv);
    const rec = readStore()[k];
    if (rec && Array.isArray(rec.decor) && JSON.stringify(rec.decor) !== JSON.stringify(lv.decor)) {
      lv.decor = plain(rec.decor);
      if (lv === this.level) this.commit({ save: false });
      else lv.setDecor(lv.decor);          // not on screen yet: the renderer draws it when it is
    }
    if (this.root) this.render();
  }

  /**
   * Start from an empty room: every piece the builder placed goes, and every generated piece is HIDDEN
   * (kept, so Revert can still bring the generator's layout back).
   */
  clearAll() {
    const lv = this.level; if (!lv) return;
    this.noteOrig();
    lv.decor = lv.decor.filter((d) => !d.placed);
    for (const d of lv.decor) d.hidden = true;
    this.selected = null;
    this.commit();
    this.lastSave = 'level cleared';
    this.render();
  }

  revert() {
    const k = this.key_, lv = this.level; if (!k || !lv) return;
    clearTimeout(this.saveTimer);
    this.noteOrig();
    const st = readStore();
    const orig = (st[k] && st[k].orig) || this.orig.get(k);
    if (orig) lv.decor = plain(orig);
    delete st[k]; writeStore(st);
    this.selected = null;
    this.commit({ save: false });
    this.lastSave = orig ? 'reverted to the generated level' : 'nothing stored to revert to';
    this.render();
  }

  copy() {
    const lv = this.level; if (!lv) return;
    const text = JSON.stringify({ key: this.key_, decor: lv.decor }, null, 1);
    console.log('[levelBuilder] level\n' + text);
    const done = (ok) => { this.lastSave = ok ? 'copied to the clipboard (and the console)' : 'clipboard blocked — logged to the console'; this.render(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false)); else done(false);
  }

  paste() {
    const lv = this.level; if (!lv) return;
    const text = window.prompt('Paste a level from Copy (this replaces every prop on this level):');
    if (!text) return;
    try {
      const j = JSON.parse(text);
      const list = Array.isArray(j) ? j : j.decor;
      if (!Array.isArray(list)) throw new Error('no decor list');
      lv.decor = plain(list);
      this.selected = null;
      this.commit();
      this.lastSave = 'pasted';
    } catch (err) { this.lastSave = 'paste failed: ' + err.message; }
    this.render();
  }

  // ------------------------------------------------------------------ the panel
  render() {
    const root = this.root; if (!root) return;
    const lv = this.level, g = this.game;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const placed = lv ? lv.decor.filter((d) => d.placed).length : 0, hidden = lv ? lv.decor.filter((d) => d.hidden).length : 0;
    const btn = (id, label, on = false, extra = '') => `<button data-a="${id}" style="font:inherit;padding:2px 7px;margin:1px;border:1px solid ${on ? '#ffcf8a' : '#4a4a55'};background:${on ? '#3a3020' : '#24242b'};color:${on ? '#ffcf8a' : '#e8e2d6'};border-radius:3px;cursor:pointer" ${extra}>${label}</button>`;
    const sec = (t) => `<div style="margin:8px 0 3px;padding-top:5px;border-top:1px solid #34343c;color:#ffcf8a;letter-spacing:.06em;text-transform:uppercase;font-size:9px">${t}</div>`;
    let h = `<div style="display:flex;align-items:center;gap:6px"><b style="color:#ffcf8a">LEVEL BUILDER</b><span style="opacity:.6">Shift+B</span><span style="flex:1"></span>${btn('close', '×')}</div>`;
    const B = (window.__game && window.__game.debug && window.__game.debug.build) || null;
    if (B) h += `<div style="opacity:.55">build ${esc(B.time || '?')} · ${esc(B.hash)}</div>`;
    h += `<div style="opacity:.75">level ${lv ? lv.depth : '?'} · seed ${g ? g.seed : '?'} · ${placed} placed · ${hidden} hidden${this.lastSave ? ` · ${esc(this.lastSave)}` : ''}</div>`;
    h += `<div style="margin-top:5px">${btn('m-select', 'Select', this.mode === 'select')}${btn('m-place', 'Place', this.mode === 'place', this.item ? '' : 'disabled title="choose a prop below first"')}</div>`;
    h += `<div style="opacity:.6;margin-top:2px">${this.mode === 'place' ? 'Click a tile to place · R turns it · right-click or Esc stops placing' : 'Click a piece to edit · drag it to move · arrows nudge · R turns · Del removes'} · WASD walks the hero</div>`;
    h += `<label style="display:block;margin-top:4px;cursor:pointer"><input type="checkbox" data-a="pause" ${this.pauseWorld ? 'checked' : ''}> pause the world while the builder is open</label>`;
    h += `<label style="display:block;margin-top:4px;cursor:pointer"><input type="checkbox" data-a="fog" ${this.renderer.fog.override === 'all' ? 'checked' : ''}> show the whole level (lift the fog)</label>`;

    // the selected piece
    const d = this.selected;
    if (d && lv && lv.decor.includes(d)) {
      h += sec('Selected');
      const tile = this.piecesAt(d.x, d.y);
      if (tile.length > 1) h += `<div>on this tile: ${tile.map((p, i) => btn(`pick-${i}`, `${esc(p.type)}${p.lift ? ' ↑' : ''}`, p === d)).join('')}</div>`;
      const spec = DECOR_TYPES[d.type];
      const view = this.dv.decorViews.find((o) => o.userData.decorRef === d);
      const [col, srcLabel] = SOURCE[sourceOf(view)] || ['#888', '?'];
      h += `<div><b>${esc(d.type)}</b> <span style="color:${col}">${srcLabel}</span>${d.placed ? '' : ' <span style="opacity:.6">(generated)</span>'}${d.model ? ` · ${esc(d.model)}` : ''}${d.art === 'dc' ? ` · ${esc((MODEL_MAP[d.type] || [])[(d.variant | 0) % Math.max(1, (MODEL_MAP[d.type] || []).length)] || '')}` : ''}</div>`;
      const nv = d.art === 'dc' ? (MODEL_MAP[d.type] || [1]).length : spec ? spec.v : 1;
      h += `<div>variant ${btn('v-', '‹')} ${d.variant | 0} / ${nv - 1} ${btn('v+', '›')} &nbsp; facing ${['n', 'e', 's', 'w'].map((f) => btn(`f-${f}`, f.toUpperCase(), (d.facing || 's') === f)).join('')}</div>`;
      const wallPiece = (spec ? spec.cls : 'prop') === 'wall';
      // OFFSET: slide the piece off the centre of its tile, and optionally keep that as where this object
      // always stands (render/props/offsets.js). The sliders show where it actually is, default included.
      {
        const off = decorOffset(d), def = defaultOffset(d);
        const own = typeof d.offX === 'number' || typeof d.offY === 'number';
        const oslider = (f, label, v, hint) => `<div>${label} <input data-a="${f}" type="range" min="-1" max="1" step="0.01" value="${v}" style="width:150px;vertical-align:middle"> <span data-v="${f}">${v.toFixed(2)}</span> <span style="opacity:.55">${hint}</span></div>`;
        h += oslider('offX', 'offset X', off.x, '+ right');
        h += oslider('offY', 'offset Y', off.y, '+ down');
        const from = own ? 'its own offset' : def ? 'the saved default' : 'centred';
        h += `<div style="opacity:.7">now: ${from}${def ? ` · default for <b>${esc(offsetKey(d))}</b> is ${def.x.toFixed(2)}, ${def.y.toFixed(2)}` : ''}</div>`;
        // ROTATION, free on all three axes, in degrees (dungeon.js applyDecorTransform composes it on top
        // of the piece's facing, about its tile-centre pivot — so a quad stood up at X 90 wants some height)
        const rslider = (f, label, hint) => `<div>${label} <input data-a="${f}" type="range" min="-180" max="180" step="1" value="${+d[f] || 0}" style="width:150px;vertical-align:middle"> <span data-v="${f}">${(+d[f] || 0).toFixed(0)}</span>° <span style="opacity:.55">${hint}</span></div>`;
        h += rslider('rotX', 'rotate X', 'tip');
        h += rslider('rotY', 'rotate Y', 'spin');
        h += rslider('rotZ', 'rotate Z', 'roll');
        h += `<div>${btn('rot-reset', 'Reset rotation')}${[90, -90].map((v) => btn(`rot-up${v}`, v > 0 ? 'Stand up (X 90)' : 'Stand up (X −90)')).join('')}</div>`;
        h += `<div>${btn('off-save', 'Save as default')}${own && def ? btn('off-follow', 'Use default') : ''}${btn('off-centre', 'Centre')}${def ? btn('off-forget', 'Forget default') : ''}</div>`;
      }
      // a light's controls show for a bare light AND for a sprite burning with one (the Lights tab)
      if (d.light) {
        if (d.type !== 'light') h += `<div style="margin-top:4px;color:#ffcf8a">its light</div>`;
        const L = d.light, hex = '#' + (L.color >>> 0).toString(16).padStart(6, '0');
        h += `<div>colour <input data-a="lcolor" type="color" value="${hex}" style="vertical-align:middle;width:48px;height:18px;padding:0;border:1px solid #3a3a42;background:none"></div>`;
        const slider = (f, label, min, max, step, unit) => `<div>${label} <input data-a="l:${f}" type="range" min="${min}" max="${max}" step="${step}" value="${L[f]}" style="width:150px;vertical-align:middle"> <span data-v="l:${f}">${(+L[f]).toFixed(2)}</span>${unit}</div>`;
        h += slider('intensity', 'strength', 0, 12, 0.1, '');
        h += slider('radius', 'reach', 0.5, 14, 0.1, ' tiles');
        h += slider('y', 'height', 0.1, 4, 0.05, ' tiles');
        h += `<div>flicker <select data-a="lkind" style="background:#1c1c22;color:#e8e2d6;border:1px solid #3a3a42;font:inherit">${LIGHT_KINDS.map((k) => `<option ${L.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>`;
        if (d.type === 'light') h += `<div>${btn('del', 'Delete')}${btn('deselect', 'Deselect')}</div>`;
      }
      if (d.type !== 'light') {
      if (!wallPiece) {
        const tx = Math.max(1, d.tilesX | 0), ty = Math.max(1, d.tilesY | 0);
        h += `<div>footprint ${btn('tx-', '‹')} <b>${tx}</b> wide ${btn('tx+', '›')} × ${btn('ty-', '‹')} <b>${ty}</b> deep ${btn('ty+', '›')} tiles</div>`;
      }
      h += `<div>scale <input data-a="scale" type="range" min="0.25" max="3" step="0.05" value="${d.scale || 1}" style="width:162px;vertical-align:middle"> <span data-v="scale">${(d.scale || 1).toFixed(2)}</span>×</div>`;
      h += `<div>height <input data-a="lift" type="range" min="0" max="2" step="0.05" value="${d.lift || 0}" style="width:158px;vertical-align:middle"> <span data-v="lift">${(d.lift || 0).toFixed(2)}</span> tiles</div>`;
      h += `<label style="display:block;cursor:pointer"><input type="checkbox" data-a="blocking" ${d.blocking ? 'checked' : ''}> blocks movement — nobody walks through it</label>`;
      h += `<div>${btn('del', d.placed ? 'Delete' : 'Remove (hide)')}${btn('reset', 'Reset footprint, scale & height')}${btn('deselect', 'Deselect')}</div>`;
      }
    } else if (this.selected) this.selected = null;

    // the palette
    h += sec('Props');
    const groups = [['prop', 'Standing'], ['decal', 'Floor'], ['wall', 'Wall'], ['light', 'Lights'], ['sprite', 'Your sprites'], ['dc', 'Your Dungeon Crawlers'], ['freeport', 'Your Freeport']];
    h += `<div>${groups.map(([k, l]) => btn(`g-${k}`, l, this.group === k)).join('')}</div>`;
    h += `<input data-a="filter" placeholder="search…" value="${esc(this.filter)}" style="width:100%;box-sizing:border-box;margin:4px 0;background:#1c1c22;color:#e8e2d6;border:1px solid #3a3a42;font:inherit;padding:2px 4px">`;
    const items = (this.palette || []).filter((p) => p.group === this.group && (!this.filter || p.label.toLowerCase().includes(this.filter.toLowerCase()) || p.type.toLowerCase().includes(this.filter.toLowerCase())));
    const drawnless = items.filter((p) => p.src === 'none').length;
    h += `<div style="max-height:34vh;overflow:auto;border:1px solid #2c2c33">`;
    for (const p of items) {
      if (p.src === 'none') continue;
      const [col, lab] = SOURCE[p.src] || ['#888', p.src];
      const on = this.item && this.item.key === p.key;
      h += `<div data-a="item" data-k="${esc(p.key)}" style="display:flex;gap:6px;padding:2px 5px;cursor:pointer;background:${on ? '#3a3020' : 'transparent'}"><span style="flex:1;color:${on ? '#ffcf8a' : '#e8e2d6'}">${esc(p.label)}</span>${p.blk ? '<span title="the generator may make this solid" style="opacity:.6">■</span>' : ''}<span style="color:${col};opacity:.85">${lab}</span></div>`;
    }
    h += `</div>`;
    if (drawnless) h += `<div style="opacity:.55">${drawnless} type${drawnless > 1 ? 's' : ''} here draw nothing and are left out.</div>`;
    if (this.item && this.item.variants > 1 && this.item.fixedVariant === undefined) h += `<div>next variant ${btn('nv-', '‹')} ${Math.min(this.next.variant, this.item.variants - 1)} / ${this.item.variants - 1} ${btn('nv+', '›')} &nbsp; facing ${this.next.facing.toUpperCase()} (R)</div>`;

    h += sec('This level');
    h += `<div>${btn('clear', 'Clear all props')}${btn('revert', 'Revert to generated')}</div>`;
    h += `<div>${btn('copy', 'Copy')}${btn('paste', 'Paste')}</div>`;
    h += `<div style="opacity:.55">Edits save in this browser as you make them, per seed and level.</div>`;

    // keep the palette's scroll position across a re-render
    const list = root.querySelector('[style*="max-height:34vh"]');
    const scroll = list ? list.scrollTop : 0;
    root.innerHTML = h;
    const list2 = root.querySelector('[style*="max-height:34vh"]'); if (list2) list2.scrollTop = scroll;
    this.wire();
  }

  wire() {
    const root = this.root;
    root.querySelectorAll('[data-a]').forEach((el) => {
      const a = el.dataset.a;
      if (a === 'scale' || a === 'lift') {
        el.addEventListener('input', () => { this.edit(a, +el.value, { live: true }); const v = root.querySelector(`[data-v="${a}"]`); if (v) v.textContent = (+el.value).toFixed(2); });
        el.addEventListener('change', () => this.edit(a, +el.value));
        return;
      }
      if (a === 'filter') { el.addEventListener('input', () => { this.filter = el.value; const pos = el.selectionStart; this.render(); const f = this.root.querySelector('[data-a="filter"]'); f.focus(); f.setSelectionRange(pos, pos); }); return; }
      if (ROT_FIELDS.includes(a)) {
        el.addEventListener('input', () => { this.edit(a, +el.value, { live: true }); const v = root.querySelector(`[data-v="${a}"]`); if (v) v.textContent = (+el.value).toFixed(0); });
        el.addEventListener('change', () => this.edit(a, +el.value));
        return;
      }
      if (a === 'offX' || a === 'offY') {
        el.addEventListener('input', () => { this.editOffset(a, +el.value, true); const v = root.querySelector(`[data-v="${a}"]`); if (v) v.textContent = (+el.value).toFixed(2); });
        el.addEventListener('change', () => this.editOffset(a, +el.value));
        return;
      }
      if (a === 'blocking') { el.addEventListener('change', () => this.edit('blocking', el.checked)); return; }
      if (a === 'fog') { el.addEventListener('change', () => { this.renderer.fog.override = el.checked ? 'all' : null; }); return; }
      if (a === 'pause') { el.addEventListener('change', () => this.setPauseWorld(el.checked)); return; }
      if (a === 'lcolor') { el.addEventListener('input', () => this.editLight('color', parseInt(el.value.slice(1), 16), true)); el.addEventListener('change', () => this.editLight('color', parseInt(el.value.slice(1), 16))); return; }
      if (a === 'lkind') { el.addEventListener('change', () => this.editLight('kind', el.value)); return; }
      if (a.startsWith('l:')) {
        const f = a.slice(2);
        el.addEventListener('input', () => { this.editLight(f, +el.value, true); const v = root.querySelector(`[data-v="${a}"]`); if (v) v.textContent = (+el.value).toFixed(2); });
        el.addEventListener('change', () => this.editLight(f, +el.value));
        return;
      }
      el.addEventListener('click', (e) => { e.stopPropagation(); this.action(a, el); });
    });
  }

  action(a, el) {
    const d = this.selected;
    if (a === 'close') return this.close();
    if (a === 'm-select') return this.setMode('select');
    if (a === 'm-place') return this.item && this.setMode('place');
    if (a === 'item') {
      this.item = this.palette.find((p) => p.key === el.dataset.k) || null;
      this.next.variant = 0;
      this.setMode(this.item ? 'place' : 'select');
      return;
    }
    if (a.startsWith('g-')) { this.group = a.slice(2); return this.render(); }
    if (a === 'nv-' || a === 'nv+') { const n = this.item ? this.item.variants : 1; this.next.variant = (Math.min(this.next.variant, n - 1) + (a === 'nv+' ? 1 : n - 1)) % n; this.refreshGhost(true); return this.render(); }
    if (a === 'copy') return this.copy();
    if (a === 'paste') return this.paste();
    if (a === 'clear') { if (window.confirm('Take every prop off this level? Revert to generated brings the original ones back.')) this.clearAll(); return; }
    if (a === 'revert') { if (window.confirm('Put this level back the way the generator made it? Every placed piece goes.')) this.revert(); return; }
    if (!d) return;
    if (a.startsWith('pick-')) { this.selected = this.piecesAt(d.x, d.y)[+a.slice(5)] || d; this.mark(); return this.render(); }
    if (a === 'v-' || a === 'v+') {
      const n = d.art === 'dc' ? (MODEL_MAP[d.type] || [1]).length : DECOR_TYPES[d.type] ? DECOR_TYPES[d.type].v : 1;
      return this.edit('variant', ((d.variant | 0) + (a === 'v+' ? 1 : n - 1)) % n);
    }
    if (a.startsWith('f-')) return this.edit('facing', a.slice(2));
    if (a === 'tx-' || a === 'tx+' || a === 'ty-' || a === 'ty+') {
      const f = a[1] === 'x' ? 'tilesX' : 'tilesY';
      const n = Math.max(1, Math.min(8, Math.max(1, d[f] | 0) + (a[2] === '+' ? 1 : -1)));
      if (n === 1) { delete d[f]; return this.commit(); }
      return this.edit(f, n);
    }
    if (a === 'del') return this.remove(d);
    if (a === 'reset') { delete d.scale; delete d.lift; delete d.tilesX; delete d.tilesY; return this.commit(); }
    if (a === 'deselect') { this.selected = null; this.mark(); return this.render(); }
    if (a === 'off-save') {
      // the default takes this piece's spot, and the piece then FOLLOWS it (drops its own copy), so every
      // other piece of the same object without an offset of its own moves to the same place
      const off = decorOffset(d);
      saveDefaultOffset(d, off.x, off.y);
      delete d.offX; delete d.offY;
      return this.commit();
    }
    if (a === 'rot-reset') { for (const f of ROT_FIELDS) delete d[f]; return this.commit(); }
    if (a === 'rot-up90' || a === 'rot-up-90') { d.rotX = a === 'rot-up90' ? 90 : -90; if (!(d.lift > 0)) d.lift = 0.5; return this.commit(); }
    if (a === 'off-follow') { delete d.offX; delete d.offY; return this.commit(); }
    if (a === 'off-centre') { d.offX = 0; d.offY = 0; return this.commit(); }
    if (a === 'off-forget') { clearDefaultOffset(d); return this.commit(); }
  }

  /**
   * Slide the selected piece off its tile centre. The first touch copies the object's default into the
   * entry, so moving X alone does not snap Y back to the centre. `live` moves the view and the light
   * without rebuilding the decor.
   */
  editOffset(field, value, live = false) {
    const d = this.selected; if (!d) return;
    const off = decorOffset(d);
    d.offX = off.x; d.offY = off.y;
    d[field] = value;
    if (live) {
      for (const o of this.dv.decorViews) if (o.userData.decorRef === d) applyDecorTransform(o, d);
      const lv = this.level, L = this.renderer.lighting;
      if (lv && L && L.setMoods) L.setMoods(lv, createRng(((lv.seed | 0) * 31 + 11) >>> 0));
      this.scheduleSave();
      return;
    }
    this.commit();
  }

  dispose() {
    this.close();
    window.removeEventListener('keydown', this.onKey, true);
    for (const t of ['pointerdown', 'pointerup', 'click', 'contextmenu']) window.removeEventListener(t, this.onPointer, true);
    window.removeEventListener('pointermove', this.onMove, true);
    if (this.tab) this.tab.remove();
    if (this.unsub) this.unsub();
  }
}
