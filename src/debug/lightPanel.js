// LIGHT PANEL — every light knob in the game, live, with the values in a form you can paste back.
//
//   ?lights=1   opens it        Shift+L   toggles it (any time, no debug mode needed)
//
// WHY IT EDITS CONSTANTS AND NOT LIGHTS
// `Lighting.update()` rebuilds every light's intensity, colour and reach EVERY FRAME: the pool hands
// five point lights to the nearest seventeen torches, the flicker multiplies them, the depth band
// sets the base, the lantern breathes. So setting `torchLight.intensity` in a console lasts exactly
// one frame. The values the frame is computed FROM are the exported tune objects in render/lighting.js
// (`TORCH_TUNE`, `DECOR_TUNE`, `LANTERN_TUNE`, `POOL_TUNE`, `BASE_TUNE`, `COOL_TUNE`) plus the per-level
// `baseHemi`/`baseMoon` and the `groups` faders, and those are what this panel writes. Anything you
// change here is live in the next frame and is included in "Copy values".
//
// PICK A LIGHT picks the nearest wall torch or room fire to the tile you click and edits THAT ONE
// source — `intensity`, `radius`, `colour` on the spot itself — so a single brazier can be tuned
// without moving every fire in the dungeon. Per-source edits are listed separately in the copy, as
// `sources`, because they are level data (a seed's own braziers), not a global setting.
import {
  TORCH_TUNE, COOL_TUNE, LANTERN_TUNE, DECOR_TUNE, POOL_TUNE, BASE_TUNE, SHADOW_TUNE, LIGHT_MOODS,
} from '../render/lighting.js';

const hex6 = (n) => '#' + (n & 0xffffff).toString(16).padStart(6, '0');
const clone = (o) => JSON.parse(JSON.stringify(o));

/** One editable row: label, slider, number box. Writes straight into `obj[key]`. */
function row(obj, key, min, max, step, label, onChange) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:grid;grid-template-columns:8.5em 1fr 4.2em;gap:4px;align-items:center;margin:1px 0';
  const name = document.createElement('span');
  name.textContent = label || key;
  name.style.cssText = 'opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = min; slider.max = max; slider.step = step; slider.value = obj[key];
  slider.style.cssText = 'width:100%;height:14px;margin:0';
  const box = document.createElement('input');
  box.type = 'number'; box.min = min; box.max = max; box.step = step; box.value = obj[key];
  box.style.cssText = 'width:100%;background:#1b1b1f;color:#e8e2d6;border:1px solid #3a3a42;font:inherit;padding:0 2px';
  const set = (v, from) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    obj[key] = n;
    if (from !== 'slider') slider.value = n;
    if (from !== 'box') box.value = n;
    if (onChange) onChange(n);
  };
  slider.addEventListener('input', () => set(slider.value, 'slider'));
  box.addEventListener('input', () => set(box.value, 'box'));
  for (const elm of [slider, box]) elm.addEventListener('keydown', (e) => e.stopPropagation());
  wrap.append(name, slider, box);
  wrap.__sync = () => { slider.value = obj[key]; box.value = obj[key]; };
  return wrap;
}

/** A colour row. `get` returns a hex number, `set` takes one. */
function colorRow(label, get, set) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:grid;grid-template-columns:8.5em 1fr;gap:4px;align-items:center;margin:1px 0';
  const name = document.createElement('span');
  name.textContent = label;
  name.style.cssText = 'opacity:.8';
  const input = document.createElement('input');
  input.type = 'color'; input.value = hex6(get());
  input.style.cssText = 'width:100%;height:16px;padding:0;background:none;border:1px solid #3a3a42';
  input.addEventListener('input', () => set(parseInt(input.value.slice(1), 16)));
  input.addEventListener('keydown', (e) => e.stopPropagation());
  wrap.append(name, input);
  wrap.__sync = () => { input.value = hex6(get()); };
  return wrap;
}

/** A checkbox row. `get` reads the current state, `set` takes the new one. */
function checkRow(label, get, set) {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:grid;grid-template-columns:8.5em 1fr;gap:4px;align-items:center;margin:1px 0;cursor:pointer';
  const name = document.createElement('span');
  name.textContent = label;
  name.style.cssText = 'opacity:.8';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !!get();
  box.style.cssText = 'justify-self:start;width:14px;height:14px;accent-color:#ffcf8a;margin:0';
  box.addEventListener('change', () => set(box.checked));
  box.addEventListener('keydown', (e) => e.stopPropagation());
  wrap.append(name, box);
  wrap.__sync = () => { box.checked = !!get(); };
  return wrap;
}

/** A dropdown row, for a setting that is one of a few named choices rather than a number. */
function selectRow(label, options, get, set) {
  const wrap = document.createElement('label');
  wrap.style.cssText = 'display:grid;grid-template-columns:8.5em 1fr;gap:4px;align-items:center;margin:1px 0;cursor:pointer';
  const name = document.createElement('span');
  name.textContent = label;
  name.style.cssText = 'opacity:.8';
  const sel = document.createElement('select');
  sel.style.cssText = 'width:100%;background:#1c1c22;color:#e8e8ef;border:1px solid #3a3a42;font:inherit;padding:1px';
  for (const o of options) { const op = document.createElement('option'); op.value = o; op.textContent = o; sel.append(op); }
  sel.value = get();
  sel.addEventListener('change', () => set(sel.value));
  sel.addEventListener('keydown', (e) => e.stopPropagation());
  wrap.append(name, sel);
  wrap.__sync = () => { sel.value = get(); };
  return wrap;
}

/** Is this an element you type INTO (so it must keep the keyboard)? */
function isTextField(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && ['text', 'number', 'search', ''].includes((el.type || '').toLowerCase());
}

/**
 * GIVE THE KEYBOARD BACK AFTER A CLICK (owner, 2026-09-19: "Cannot move the hero with WASD when light or
 * props panel are open"). A slider, checkbox or dropdown keeps focus after the mouse lets go of it, and
 * core/input.js ignores any key whose target is an INPUT or SELECT — so one click on a fader and WASD was
 * dead until you clicked the game. Anything you do not type into is blurred once the click is done.
 * Exported for debug/levelBuilder.js.
 * @param {HTMLElement} root
 */
export function releaseFocusAfterClicks(root) {
  const drop = () => setTimeout(() => {
    const a = document.activeElement;
    if (a && a !== document.body && root.contains(a) && !isTextField(a)) a.blur();
  }, 0);
  for (const t of ['pointerup', 'click', 'change']) root.addEventListener(t, drop);
}

function section(title) {
  const d = document.createElement('div');
  d.style.cssText = 'margin:7px 0 3px;padding-top:5px;border-top:1px solid #34343c;color:#ffcf8a;letter-spacing:.06em;text-transform:uppercase;font-size:9px';
  d.textContent = title;
  return d;
}

export class LightPanel {
  /** @param {{renderer:any, bus?:any}} ctx */
  constructor({ renderer, bus }) {
    this.renderer = renderer; this.bus = bus;
    this.root = null; this.rows = []; this.picking = false; this.selected = null;
    this.defaults = {
      TORCH_TUNE: clone(TORCH_TUNE), COOL_TUNE: clone(COOL_TUNE), LANTERN_TUNE: clone(LANTERN_TUNE),
      DECOR_TUNE: clone(DECOR_TUNE), POOL_TUNE: clone(POOL_TUNE), BASE_TUNE: clone(BASE_TUNE),
      SHADOW_TUNE: clone(SHADOW_TUNE),
    };
    this.sourceEdits = [];
    this.onKey = (e) => {
      // Match on the PHYSICAL key as well as the character: a layout (or a synthetic event) can
      // deliver shift+l as 'l' rather than 'L', and then the panel simply never opens.
      const isL = e.code === 'KeyL' || (typeof e.key === 'string' && e.key.toLowerCase() === 'l');
      if (isL && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); this.toggle(); }
    };
    window.addEventListener('keydown', this.onKey, true);
    this.onCanvasClick = (e) => {
      if (!this.picking) return;
      e.preventDefault(); e.stopPropagation();
      this.picking = false;
      this.pickAt(e.clientX, e.clientY);
    };
  }

  get lighting() { return this.renderer.lighting; }
  get isOpen() { return !!this.root; }
  toggle() { if (this.root) this.close(); else this.open(); }

  close() {
    if (!this.root) return;
    this.renderer.canvas.removeEventListener('pointerdown', this.onCanvasClick, true);
    clearInterval(this.timer);
    this.root.remove(); this.root = null; this.rows = [];
  }

  dispose() { this.close(); window.removeEventListener('keydown', this.onKey, true); }

  open() {
    if (this.root || !this.lighting) return;
    const L = this.lighting;
    const root = document.createElement('div');
    root.style.cssText = [
      'position:fixed', 'top:8px', 'right:8px', 'width:340px', 'max-height:calc(100vh - 16px)', 'overflow:auto',
      'z-index:99999', 'background:rgba(16,16,20,.94)', 'color:#e8e2d6', 'border:1px solid #4a4a55', 'border-radius:4px',
      'padding:8px 10px 10px', 'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace', 'box-shadow:0 8px 28px rgba(0,0,0,.6)',
      // `#ui-root` is `pointer-events: none` (the HUD lets clicks through to the dungeon), and a child
      // inherits that: the first build of this panel looked right and could not be touched at all —
      // `elementFromPoint` over a slider returned the CANVAS. The panel lives on <body> for the same
      // reason, so no HUD rule reaches it.
      'pointer-events:auto',
    ].join(';');
    root.addEventListener('keydown', (e) => e.stopPropagation());
    releaseFocusAfterClicks(root);

    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:4px';
    head.innerHTML = '<b style="color:#ffcf8a">LIGHTS</b><span style="opacity:.55">Shift+L</span>';
    const spacer = document.createElement('span'); spacer.style.flex = '1';
    const btn = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'background:#2a2a32;color:#e8e2d6;border:1px solid #4a4a55;border-radius:3px;font:inherit;padding:1px 6px;cursor:pointer';
      b.addEventListener('click', fn);
      return b;
    };
    head.append(spacer, btn('Copy values', () => this.copy()), btn('Reset', () => this.reset()), btn('✕', () => this.close()));
    root.append(head);

    // live readout
    this.live = document.createElement('pre');
    this.live.style.cssText = 'margin:0 0 2px;padding:4px 5px;background:#0e0e12;border:1px solid #2d2d35;border-radius:3px;white-space:pre-wrap;color:#9fd0a8;font:inherit';
    root.append(this.live);

    const add = (r) => { this.rows.push(r); root.append(r); return r; };

    /**
     * ON / OFF PER LIGHT GROUP. `Lighting.setGroups` coerces every group to 1 or 0, which would wipe a
     * fader you had set to 0.6 — so a toggle writes the numeric group directly and REMEMBERS what it
     * was, and switching back restores that value rather than snapping to full. `setGroups({})` is then
     * called to re-derive the two shadow casters, which are switched at the source rather than dimmed
     * (a zero-intensity shadow map still costs a full frame of rendering).
     */
    const offMemo = new Map();
    const groupOn = (k) => (k === 'grade' ? this.renderer.gradeOn !== false : (L.groups[k] || 0) > 0);
    const setGroupOn = (k, on) => {
      if (k === 'grade') { this.renderer.setLightGroups({ grade: on }); this.refresh(); return; }
      if (!on) { offMemo.set(k, L.groups[k] || 1); L.groups[k] = 0; } else { L.groups[k] = offMemo.get(k) ?? 1; }
      L.setGroups({});
      this.refresh();
    };

    root.append(section('Lights on / off'));
    for (const [k, label] of [
      ['ambient', 'ambient (hemi)'], ['key', 'key light'], ['lantern', "player's light"], ['torches', 'wall torches'],
      ['decor', 'room fires'], ['temple', 'temple glow'], ['shadows', 'shadows'], ['grade', 'depth grade'],
    ]) add(checkRow(label, () => groupOn(k), (on) => setGroupOn(k, on)));

    root.append(section('Scene — key light (directional)'));
    add(row(BASE_TUNE, 'key', 0, 3, 0.01, 'key ×'));
    add(colorRow('key colour', () => (L.moonBase ? L.moonBase.getHex() : 0xffffff), (v) => { if (L.moonBase) L.moonBase.setHex(v); }));
    add(row(L.groups, 'key', 0, 2, 0.01, 'group fader'));

    root.append(section('Scene — ambient (hemisphere)'));
    add(row(BASE_TUNE, 'hemi', 0, 3, 0.01, 'ambient ×'));
    add(colorRow('sky', () => L.hemi.color.getHex(), (v) => L.hemi.color.setHex(v)));
    add(colorRow('ground', () => L.hemi.groundColor.getHex(), (v) => L.hemi.groundColor.setHex(v)));
    add(row(L.groups, 'ambient', 0, 2, 0.01, 'group fader'));

    root.append(section('Wall torches (point ×5 + shadow spot)'));
    add(row(TORCH_TUNE, 'i', 0, 60, 0.5, 'intensity'));
    add(row(TORCH_TUNE, 'dist', 1, 20, 0.1, 'distance'));
    add(row(TORCH_TUNE, 'g', 0, 1, 0.01, 'green (hue)'));
    add(row(TORCH_TUNE, 'b', 0, 1, 0.01, 'blue (hue)'));
    add(row(TORCH_TUNE, 'gF', 0, 0.4, 0.005, 'green flicker'));
    add(row(TORCH_TUNE, 'bF', 0, 0.4, 0.005, 'blue flicker'));
    add(row(TORCH_TUNE, 'spot', 0, 40, 0.5, 'shadow spot'));
    add(row(POOL_TUNE, 'torchCut', 4, 40, 0.5, 'pool cut'));
    add(row(POOL_TUNE, 'torchRamp', 0.5, 12, 0.1, 'dim ramp'));
    add(row(L.groups, 'torches', 0, 2, 0.01, 'group fader'));

    root.append(section('Room fires (braziers, hearths, fungus)'));
    add(row(DECOR_TUNE, 'i', 0, 4, 0.01, 'intensity ×'));
    add(row(DECOR_TUNE, 'dist', 0.2, 3, 0.01, 'distance ×'));
    add(row(POOL_TUNE, 'decorCut', 4, 40, 0.5, 'pool cut'));
    add(row(POOL_TUNE, 'decorRamp', 0.5, 12, 0.1, 'dim ramp'));
    add(row(L.groups, 'decor', 0, 2, 0.01, 'group fader'));

    // The player's own light is TWO lights, and both are here: the glow at their centre, and the
    // raked spot that models the cast and lays the long shadow (the frame's main shadow caster).
    root.append(section("Player's light — glow (point)"));
    add(row(LANTERN_TUNE, 'on', 0, 10, 0.05, 'lit intensity'));
    add(row(LANTERN_TUNE, 'off', 0, 10, 0.05, 'unlit intensity'));
    add(row(LANTERN_TUNE, 'dist', 1, 20, 0.1, 'distance'));
    add(row(LANTERN_TUNE, 'decay', 0.5, 4, 0.05, 'decay'));
    add(row(LANTERN_TUNE, 'height', 0.5, 6, 0.05, 'height'));
    add(row(LANTERN_TUNE, 'sword', 0, 2, 0.01, 'Sword boost'));
    add(row(LANTERN_TUNE, 'litScale', 1, 4, 0.05, 'Light spell ×'));
    add(row(LANTERN_TUNE, 'breatheAmp', 0, 0.3, 0.005, 'breathe depth'));
    add(row(LANTERN_TUNE, 'breatheHz', 0.2, 6, 0.05, 'breathe speed'));
    add(colorRow('colour', () => L.lanternColor.getHex(), (v) => this.renderer.setLanternColor(v)));
    add(row(L.groups, 'lantern', 0, 2, 0.01, 'group fader (both)'));

    root.append(section("Player's light — throw (spot, main shadow)"));
    add(row(LANTERN_TUNE, 'spotI', 0, 30, 0.1, 'intensity'));
    add(row(LANTERN_TUNE, 'spotILit', 0, 30, 0.1, 'intensity (map lit)'));
    add(row(LANTERN_TUNE, 'spotDist', 4, 60, 0.5, 'distance'));
    add(row(LANTERN_TUNE, 'spotAngle', 0.1, 1.2, 0.01, 'cone angle'));
    add(row(LANTERN_TUNE, 'spotPenumbra', 0, 1, 0.01, 'penumbra (softness)'));
    add(row(LANTERN_TUNE, 'spotH', 2, 16, 0.1, 'height'));
    add(row(LANTERN_TUNE, 'spotX', -10, 10, 0.1, 'offset east'));
    add(row(LANTERN_TUNE, 'spotZ', -10, 10, 0.1, 'offset south'));
    add(row(LANTERN_TUNE, 'spotWhite', 0, 1, 0.01, 'Light spell whiten'));

    root.append(section('Shadows'));
    // WHERE SHADOWS COME FROM (see SHADOW_TUNE in render/lighting.js). 'world' is the fixed sun and
    // the default: a prop's shadow is a property of the prop, not of where you are standing.
    // 'lantern' restores the player-relative spots this replaced, for comparison.
    add(selectRow('cast by', ['world', 'lantern', 'both', 'off'], () => SHADOW_TUNE.source, (v) => {
      SHADOW_TUNE.source = v;
      L.applyShadowSource();
    }));
    add(row(SHADOW_TUNE, 'share', 0, 1, 0.01, 'share of the key'));
    add(row(SHADOW_TUNE, 'y', 4, 30, 0.2, 'sun height'));
    add(row(SHADOW_TUNE, 'x', -24, 24, 0.2, 'sun east'));
    add(row(SHADOW_TUNE, 'z', -24, 24, 0.2, 'sun south'));
    add(row(SHADOW_TUNE, 'size', 10, 60, 1, 'frustum tiles', () => { L._sunSize = -1; }));
    if (L.sun.shadow) add(row(L.sun.shadow, 'radius', 0, 16, 0.5, 'sun blur'));
    add(row(L.groups, 'shadows', 0, 2, 0.01, 'shadow fader'));
    add(row(L.torchSpot, 'penumbra', 0, 1, 0.01, 'torch penumbra'));
    if (L.spot.shadow) add(row(L.spot.shadow, 'radius', 0, 16, 0.5, 'lantern blur'));

    root.append(section('Light pools'));
    add(row(L.groups, 'temple', 0, 2, 0.01, 'temple fader'));
    add(row(POOL_TUNE, 'fade', 0.05, 2, 0.01, 'slot crossfade s'));
    // OFF BY DEFAULT since 2026-09-18, and this is the artefact the owner caught: with it on, a wall
    // torch's brightness depends on how far the HERO is from it, so a room lights up as you enter.
    add(checkRow('distance ramp', () => POOL_TUNE.ramp, (on) => { POOL_TUNE.ramp = on; }));

    root.append(section('Depth band lean (COOL_TUNE)'));
    add(row(COOL_TUNE, 'key', 0, 1, 0.01, 'key lean'));
    add(row(COOL_TUNE, 'sky', 0, 1, 0.01, 'sky lean'));
    add(row(COOL_TUNE, 'ground', 0, 1, 0.01, 'ground lean'));
    add(colorRow('cool hex', () => COOL_TUNE.hex, (v) => { COOL_TUNE.hex = v; }));

    // pick-a-light
    root.append(section('One light at a time'));
    const pickRow = document.createElement('div');
    pickRow.style.cssText = 'display:flex;gap:5px;align-items:center;margin:2px 0';
    this.pickBtn = btn('Pick a light', () => {
      this.picking = !this.picking;
      this.pickBtn.textContent = this.picking ? 'Click a light…' : 'Pick a light';
    });
    pickRow.append(this.pickBtn);
    root.append(pickRow);
    this.selBox = document.createElement('div');
    this.selBox.style.cssText = 'margin-top:2px';
    root.append(this.selBox);

    root.append(section('Room moods (torch budget & dust only)'));
    const note = document.createElement('div');
    note.style.cssText = 'opacity:.6;margin:1px 0 3px';
    note.textContent = 'ambient/fill/colour no longer tint the frame — ?moodkey=1 restores that';
    root.append(note);
    const moodSel = document.createElement('select');
    moodSel.style.cssText = 'width:100%;background:#1b1b1f;color:#e8e2d6;border:1px solid #3a3a42;font:inherit';
    for (const k of Object.keys(LIGHT_MOODS)) moodSel.append(new Option(k, k));
    moodSel.addEventListener('keydown', (e) => e.stopPropagation());
    root.append(moodSel);
    const moodRows = document.createElement('div');
    root.append(moodRows);
    const buildMood = () => {
      moodRows.textContent = '';
      const m = LIGHT_MOODS[moodSel.value];
      const r1 = row(m, 'torches', 0, 6, 1, 'torch budget');
      const r2 = row(m, 'dust', 0, 3, 0.05, 'dust');
      const r3 = colorRow('mood colour', () => m.color, (v) => { m.color = v; });
      moodRows.append(r1, r2, r3);
    };
    moodSel.addEventListener('change', buildMood);
    moodSel.value = L.mood ? L.mood.name : 'torchlit';
    buildMood();

    document.body.append(root);
    this.root = root;
    this.renderer.canvas.addEventListener('pointerdown', this.onCanvasClick, true);
    this.timer = setInterval(() => this.refresh(), 200);
    this.refresh();
  }

  /** The live numbers at the top: what the frame is actually using right now. */
  refresh() {
    if (!this.root) return;
    const L = this.lighting;
    const slots = (L.torches || []).map((l) => (l.userData.poolSpot ? `${l.intensity.toFixed(1)}` : '–')).join(' ');
    const fires = (L.moodLights || []).map((l) => (l.userData.poolSpot ? `${l.userData.poolSpot.kind}:${l.intensity.toFixed(1)}` : '–')).join(' ');
    this.live.textContent = [
      `mood ${L.mood ? L.mood.name : '?'}   depth ${L.depth ?? '?'}`,
      `key   ${L.moon.intensity.toFixed(2)}  #${L.moon.color.getHexString()}  (base ${L.baseMoon.toFixed(2)})`,
      `amb   ${L.hemi.intensity.toFixed(2)}  #${L.hemi.color.getHexString()}  (base ${L.baseHemi.toFixed(2)})`,
      `lamp  ${L.point.intensity.toFixed(2)}  #${L.point.color.getHexString()}`,
      `torch slots ${slots || '–'}`,
      `fires ${fires || '–'}`,
    ].join('\n');
    for (const r of this.rows) if (r.__sync) r.__sync();
  }

  /** Select the nearest wall torch or room fire to a clicked point. */
  pickAt(clientX, clientY) {
    this.pickBtn.textContent = 'Pick a light';
    const L = this.lighting;
    const tile = this.renderer.pickTile(clientX, clientY);
    if (!tile) { this.selBox.textContent = 'no tile there'; return; }
    let best = null;
    const consider = (sp, kind) => {
      const d = Math.hypot((sp.x ?? 0) - tile.wx, (sp.z ?? 0) - tile.wz);
      if (!best || d < best.d) best = { sp, kind, d };
    };
    for (const sp of L.torchSpots || []) consider(sp, 'wall torch');
    for (const sp of L.moodSources || []) consider(sp, `room fire (${sp.kind})`);
    if (!best || best.d > 3.5) { this.selBox.textContent = 'no light within 3.5 tiles of that tile'; return; }
    this.selected = best;
    if (!this.sourceEdits.includes(best.sp)) this.sourceEdits.push(best.sp);
    this.selBox.textContent = '';
    const title = document.createElement('div');
    title.style.cssText = 'color:#ffcf8a;margin:2px 0';
    title.textContent = `${best.kind} at ${Math.round(best.sp.x)},${Math.round(best.sp.z)} (${best.d.toFixed(1)} away)`;
    this.selBox.append(title);
    const sp = best.sp;
    const rows = [];
    if ('intensity' in sp) rows.push(row(sp, 'intensity', 0, 40, 0.1, 'intensity'));
    if ('radius' in sp) rows.push(row(sp, 'radius', 0.5, 20, 0.1, 'radius'));
    if ('color' in sp) rows.push(colorRow('colour', () => sp.color, (v) => { sp.color = v; }));
    if (!rows.length) {
      const p = document.createElement('div');
      p.style.opacity = '.7';
      p.textContent = 'a wall torch takes its light from TORCH_TUNE above (all five share it)';
      rows.push(p);
    }
    for (const r of rows) { this.rows.push(r); this.selBox.append(r); }
  }

  /** Everything that differs from the shipped defaults, as text to paste back. */
  values() {
    const out = {};
    for (const [name, def] of Object.entries(this.defaults)) {
      const live = { TORCH_TUNE, COOL_TUNE, LANTERN_TUNE, DECOR_TUNE, POOL_TUNE, BASE_TUNE, SHADOW_TUNE }[name];
      const diff = {};
      for (const k of Object.keys(def)) if (live[k] !== def[k]) diff[k] = live[k];
      if (Object.keys(diff).length) out[name] = diff;
    }
    const L = this.lighting;
    out.scene = {
      keyColor: L.moonBase ? hex6(L.moonBase.getHex()) : null,
      hemiSky: hex6(L.hemi.color.getHex()),
      hemiGround: hex6(L.hemi.groundColor.getHex()),
      lanternColor: hex6(L.lanternColor.getHex()),
      groups: { ...L.groups },
      spot: { penumbra: +L.spot.penumbra.toFixed(3), angle: +L.spot.angle.toFixed(3) },
      torchSpotPenumbra: +L.torchSpot.penumbra.toFixed(3),
      baseHemi: +L.baseHemi.toFixed(3), baseMoon: +L.baseMoon.toFixed(3), depth: L.depth,
    };
    const moods = {};
    for (const [k, m] of Object.entries(LIGHT_MOODS)) moods[k] = { torches: m.torches, dust: m.dust, color: hex6(m.color) };
    out.moods = moods;
    if (this.sourceEdits.length) {
      out.sources = this.sourceEdits.map((sp) => ({
        kind: sp.kind || 'wall torch', x: Math.round(sp.x), z: Math.round(sp.z),
        intensity: sp.intensity, radius: sp.radius, color: 'color' in sp ? hex6(sp.color) : undefined,
      }));
    }
    return out;
  }

  copy() {
    const text = JSON.stringify(this.values(), null, 2);
    const done = (ok) => {
      const b = this.root && this.root.querySelector('button');
      console.log('[lightPanel] values\n' + text);
      if (this.live) this.live.textContent = (ok ? 'copied to clipboard — also logged to the console\n' : 'clipboard blocked; logged to the console\n') + this.live.textContent;
      void b;
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    else done(false);
  }

  reset() {
    for (const [name, def] of Object.entries(this.defaults)) {
      const live = { TORCH_TUNE, COOL_TUNE, LANTERN_TUNE, DECOR_TUNE, POOL_TUNE, BASE_TUNE, SHADOW_TUNE }[name];
      Object.assign(live, clone(def));
    }
    this.refresh();
  }
}
