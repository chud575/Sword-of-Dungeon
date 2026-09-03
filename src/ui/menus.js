// Menus: title screen (with the renderer's rotating dungeon behind it), new-game/difficulty,
// pause, help/controls, settings, death & victory screens and the hall of fame. One keyboard
// router drives whichever screen is on top of the stack; the mouse works everywhere.
// Look & feel lives in menus.css; the wordmark, ornaments and particle layers in menu-fx.js.
import './menus.css';
import { DIFFICULTIES } from '../core/constants.js';
import { listSaves, getHallOfFame, addHallOfFameEntry, dailySeed, todayUtc, dailyAttempted, markDailyAttempted, formatTime, saveSettings, DEFAULT_SETTINGS } from '../core/save.js';
import { seedFrom } from '../core/rng.js';
import { logoSvg, swordRule, heading, ornament, skulls, ParticleLayer } from './menu-fx.js';

const DIFF_INFO = {
  classic: ['Classic', 'Rolled 3–18 hits and skill, the exact 1983 rules, permadeath. Daily seeds and the hall of fame proper.', 3, 'the way it was'],
  standard: ['Standard', 'The manual\'s 12 hits / 8 skill start, guaranteed level connectivity, auto-pause when a monster appears.', 2, 'the recommended quest'],
  story: ['Story', 'No permadeath (your save survives death), a 3000-second clock and the Sword cannot be stolen below half hits.', 1, 'for the tale, not the trial'],
  nightmare: ['Nightmare', 'Twice the wandering monsters, the Mage and Demon from depth 10, and only 1500 seconds to escape.', 4, 'Umla is waiting'],
};
const HELP_GROUPS = [
  ['Movement', [['Move', 'WASD · arrows · numpad · hjklyubn'], ['Click to move', 'left click a tile'], ['Auto-explore', 'X'], ['Rest a moment', 'Z'], ['Zoom', '[ ] · wheel']]],
  ['Combat', [['Attack', 'move into a monster · hold to keep fighting'], ['Disengage', 'release the direction'], ['Interact / panic', 'Space · Enter · click yourself'], ['Bury gold', 'Shift+B'], ['Place beacon', '+']]],
  ['Spells & potions', [['Healing potion', 'Q · Shift+H'], ['Teleport', 'T · 1'], ['Shield', 'Shift+S · 2'], ['Regeneration', 'R · 3'], ['Invisibility', 'I · 4'], ['Light', 'Shift+L · 5'], ['Light on / off', 'O'], ['Drift', 'F · 6']]],
  ['Interface', [['Inventory', 'Tab'], ['Minimap', 'M'], ['Help', '? · F1'], ['Pause / menu', 'Esc']]],
];
const BANDS = [[5, 'The Upper Halls'], [12, 'The Cold Deep'], [18, 'The Black Roots'], [Infinity, "Umla's Domain"]];
const corners = '<div class="corners"><i></i><i></i><i></i><i></i></div><div class="filet"></div>';

/** Name of the dungeon band a depth belongs to (mirrors the HUD's naming). */
function bandName(depth) { return (BANDS.find((b) => depth <= b[0]) || BANDS[BANDS.length - 1])[1]; }
function fmtNum(n) { return Number(n || 0).toLocaleString('en-US'); }

export class Menus {
  /**
   * @param {{root:HTMLElement, bus:import('../core/events.js').EventBus, getGame:()=>any, settings:object, setModal:(open:boolean, who:string)=>void,
   *   isModal:()=>boolean, isAutoPaused:()=>boolean, app:object, inventory?:object}} ctx
   */
  constructor(ctx) {
    this.ctx = ctx; this.bus = ctx.bus; this.settings = ctx.settings; this.app = ctx.app;
    this.stack = [];
    this.titleEl = null;
    this.pendingOver = null;
    this.fx = []; // live particle layers, ticked from update(dt)
    this.onKey = (e) => this.key(e);
    window.addEventListener('keydown', this.onKey, true);
    this.unsub = [
      this.bus.on('game:over', (p) => { const t = p.victory ? 2.2 : 1.6; this.pendingOver = { payload: p, t, deadline: (typeof performance !== 'undefined' ? performance.now() : 0) + t * 1000 }; }),
      this.bus.on('game:paused', (p) => { if (p.paused && !this.isOpen && !this.ctx.isModal() && !this.ctx.isAutoPaused()) { const g = this.ctx.getGame(); if (g && !g.over) this.showPause(); } }),
      this.bus.on('game:start', () => { this.pendingOver = null; this.closeAll(); }),
    ];
  }

  get isOpen() { return this.stack.length > 0; }
  get titleOpen() { return !!this.titleEl; }
  get top() { return this.stack[this.stack.length - 1] || null; }

  update(dt) {
    if (this.pendingOver) {
      this.pendingOver.t -= dt; // simulated time (debug.step) or wall clock, whichever comes first
      const wall = typeof performance !== 'undefined' && performance.now() >= this.pendingOver.deadline;
      if (this.pendingOver.t <= 0 || wall) { const p = this.pendingOver.payload; this.pendingOver = null; if (p.victory) this.showVictory(p.stats); else this.showDeath(p.stats, p); }
    }
    for (const f of this.fx) f.update(dt);
  }

  /** Attach a particle layer to a screen; it is disposed with the stack entry. */
  addFx(entry, parent, opts) {
    const layer = new ParticleLayer(parent, opts);
    this.fx.push(layer);
    (entry.fx || (entry.fx = [])).push(layer);
    return layer;
  }

  // ------------------------------------------------------------------ generic modal machinery
  /**
   * Open a modal. `items` are menu entries {label, sub, onSelect, danger, disabled}; extra keys go to `onKey`.
   * @returns {object} the stack entry
   */
  openModal({ name, cls = '', html = '', items = null, onKey = null, onClose = null, backdrop = true, sel = 0, wide = false, bdCls = '', before = '' }) {
    const entry = { name, items: items || [], sel, onKey, onClose };
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop mxbd ' + bdCls + (backdrop ? '' : ' clear');
    if (before) bd.insertAdjacentHTML('beforeend', before);
    const panel = document.createElement('div');
    panel.className = `panel modal mx ${wide ? 'wide' : ''} ${cls}`;
    panel.innerHTML = corners + html;
    bd.appendChild(panel);
    entry.el = bd; entry.panel = panel;
    if (items) {
      const list = panel.querySelector('.menu-list') || panel.appendChild(Object.assign(document.createElement('div'), { className: 'menu-list' }));
      this.buildItems(entry, list);
    }
    this.ctx.root.appendChild(bd);
    this.stack.push(entry);
    this.ctx.setModal(true, name);
    this.bus.emit('sfx:ui', { kind: 'open' });
    return entry;
  }

  buildItems(entry, list) {
    entry.items.forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'menu-item' + (it.danger ? ' danger' : '');
      b.innerHTML = `<span>${it.label}</span>${it.sub ? `<small>${it.key ? `<kbd>${it.sub}</kbd>` : it.sub}</small>` : ''}`;
      if (it.disabled) b.setAttribute('disabled', '');
      b.addEventListener('mouseenter', () => { if (entry.sel !== i && !it.disabled) { entry.sel = i; this.highlight(entry); this.bus.emit('sfx:ui', { kind: 'hover' }); } });
      b.addEventListener('click', () => { entry.sel = i; this.activate(entry); });
      list.appendChild(b); it.el = b;
    });
    this.highlight(entry);
  }

  highlight(entry) {
    entry.items.forEach((it, i) => it.el && it.el.classList.toggle('selected', i === entry.sel));
    const it = entry.items[entry.sel]; if (it && it.el && it.el.scrollIntoView) { try { it.el.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ } }
    if (entry.onHighlight) entry.onHighlight(it, entry.sel);
  }

  activate(entry) {
    const it = entry.items[entry.sel];
    if (!it || it.disabled) return;
    this.bus.emit('sfx:ui', { kind: 'click' });
    it.onSelect();
  }

  /** Close the top-most modal (or a named one). */
  close(name = null) {
    const i = name ? this.stack.findIndex((e) => e.name === name) : this.stack.length - 1;
    if (i < 0) return;
    const [entry] = this.stack.splice(i, 1);
    if (entry.fx) { for (const f of entry.fx) { f.dispose(); this.fx = this.fx.filter((x) => x !== f); } }
    if (entry.el) entry.el.remove();
    if (entry.name === 'title') { this.titleEl = null; this.ctx.root.classList.remove('title-mode'); }
    if (entry.onClose) entry.onClose();
    this.ctx.setModal(false, entry.name);
    this.bus.emit('sfx:ui', { kind: 'close' });
  }

  closeAll() { while (this.stack.length) this.close(); }

  key(e) {
    const top = this.top;
    if (!top) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      if (e.key === 'Escape') { e.target.blur(); e.preventDefault(); e.stopPropagation(); }
      else if (e.key === 'Enter' && top.onKey && e.target.type !== 'range' && top.onKey(e) === true) { e.preventDefault(); e.stopPropagation(); } // Enter in a text field submits the panel
      return;
    }
    e.stopPropagation();
    const k = e.key;
    if (top.onKey && top.onKey(e) === true) { e.preventDefault(); return; }
    if (top.items.length) {
      const n = top.items.length;
      const step = (d) => { let i = top.sel; for (let t = 0; t < n; t++) { i = (i + d + n) % n; if (!top.items[i].disabled) break; } if (i !== top.sel) { top.sel = i; this.highlight(top); this.bus.emit('sfx:ui', { kind: 'hover' }); } };
      if (k === 'ArrowUp' || k === 'w' || k === 'k' || (k === 'Tab' && e.shiftKey)) { step(-1); e.preventDefault(); return; }
      if (k === 'ArrowDown' || k === 's' || k === 'j' || k === 'Tab') { step(1); e.preventDefault(); return; }
      if (top.grid && (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'a' || k === 'd' || k === 'h' || k === 'l')) { step(k === 'ArrowLeft' || k === 'a' || k === 'h' ? -1 : 1); e.preventDefault(); return; }
      if (k === 'Enter' || k === ' ') { this.activate(top); e.preventDefault(); return; }
    }
    if (k === 'Escape' && top.name !== 'title' && !top.noEscape) { this.close(); e.preventDefault(); }
  }

  // ------------------------------------------------------------------ title
  showTitle() {
    if (this.titleEl) return;
    this.closeAll();
    const saves = listSaves();
    const cont = saves[0];
    const daily = todayUtc();
    const attempted = dailyAttempted(daily);
    const el = document.createElement('div');
    el.id = 'title';
    el.innerHTML = `
      <div class="veil"></div>
      <div class="heat"></div>
      <div class="version">Sword of Fargoal<br><b>Remake</b> · procedural edition</div>
      <div class="credit">Jeff McCord's 1982 classic<br>Epyx · 1983 · reimagined</div>
      <div class="wordmark">
        <div class="epyx">A dungeon beneath the mountains</div>
        <div class="t1">The Sword of</div>
        ${logoSvg('FARGOAL')}
        ${swordRule()}
      </div>
      <div class="menu"><div class="menu-list"></div></div>
      <div class="tagline"></div>
      <div class="foot"><kbd>↑↓</kbd> choose &nbsp;·&nbsp; <kbd>Enter</kbd> select &nbsp;·&nbsp; today's daily seed <b>${daily}</b>${attempted ? ' (attempted)' : ''}</div>`;
    const items = [
      { label: 'New Game', sub: 'Choose your difficulty and descend into the mountain.', onSelect: () => this.showNewGame({}) },
      { label: 'Continue', sub: cont ? `Resume your ${cont.meta.difficulty} quest — depth ${cont.meta.depth}, level ${cont.meta.level}, ${formatTime(cont.meta.elapsed)} in the deep.` : 'No saved quest waits for you.', disabled: !cont, onSelect: () => { if (!this.app.continueGame()) this.showTitle(); } },
      { label: 'Daily Seed', sub: `Dungeon of ${daily}, classic rules — everyone descends the same deep today${attempted ? ' (already attempted)' : ''}.`, onSelect: () => this.showNewGame({ daily: true }) },
      { label: 'Hall of Fame', sub: `${getHallOfFame().length} heroes remembered by this browser.`, onSelect: () => this.showHall() },
      { label: 'Settings', sub: 'Sound, screen shake, interface scale and accessibility.', onSelect: () => this.showSettings() },
      { label: 'Help', sub: 'Controls and the rules of the deep.', onSelect: () => this.showHelp() },
    ];
    const tag = el.querySelector('.tagline');
    const entry = { name: 'title', items, sel: 0, el, noEscape: true, onHighlight: (it) => { tag.textContent = it ? it.sub : ''; } };
    this.buildItems(entry, el.querySelector('.menu-list'));
    this.ctx.root.appendChild(el);
    this.ctx.root.classList.add('title-mode');
    this.titleEl = el;
    this.stack.push(entry);
    this.addFx(entry, el, { mode: 'embers', count: 120, seed: 'title-embers', origin: { x: 0.22, y: 0.3, w: 0.56, h: 0.14 } });
    el.querySelector('.fx-layer').style.zIndex = '0';
    for (const c of ['.wordmark', '.menu', '.tagline', '.foot', '.credit', '.version']) el.querySelector(c).style.zIndex = '1';
    this.ctx.setModal(true, 'title');
  }

  hideTitle() { if (this.titleEl) this.close('title'); }

  // ------------------------------------------------------------------ new game
  showNewGame({ daily = false }) {
    const st = { difficulty: daily ? 'classic' : (this.settings.lastDifficulty || 'standard'), seed: daily ? dailySeed() : (seedFrom(Date.now(), 'new') % 1000000), name: this.settings.playerName || 'Warrior' };
    const attempted = daily && dailyAttempted();
    const card = (d, extra = '') => `<button class="card${d === st.difficulty ? ' selected' : ''}" data-d="${d}"><div class="cn"><span>${DIFF_INFO[d][0]}</span>${skulls(DIFF_INFO[d][2])}</div><div class="cd">${DIFF_INFO[d][1]}</div><div class="ct">${DIFF_INFO[d][3]}${extra}</div></button>`;
    const html = heading({ eyebrow: daily ? todayUtc() + ' · one attempt is recorded' : 'Choose how the deep will treat you', title: daily ? 'Daily Seed' : 'New Quest' }) +
      (daily
        ? `<div class="cards"><div class="card selected"><div class="cn"><span>Classic</span>${skulls(3)}</div><div class="cd">${DIFF_INFO.classic[1]}</div><div class="ct">seed ${st.seed}</div></div><div class="card"><div class="cn"><span>Today's dungeon</span></div><div class="cd">Everyone who plays today descends the same dungeon. ${attempted ? '<b style="color:var(--danger)">You already attempted today — this run will not be recorded.</b>' : 'Your first run today is recorded in the hall of fame.'}</div></div></div>`
        : `<div class="cards">${DIFFICULTIES.map((d) => card(d)).join('')}</div>`) +
      `<div class="fields"><div class="field"><span>Your name</span><input type="text" id="ng-name" maxlength="16" value="${esc(st.name)}" autocomplete="off"></div>
      ${daily ? '' : `<div class="field"><span>Seed <small>(number or words)</small></span><input type="text" id="ng-seed" value="${st.seed}" autocomplete="off"></div>`}</div>
      <div class="btn-row actions"><button class="btn" id="ng-back">Back</button><button class="btn primary" id="ng-start">Begin the descent</button></div>
      <div class="hint-bar"><kbd>←→</kbd> difficulty &nbsp; <kbd>Enter</kbd> begin &nbsp; <kbd>Esc</kbd> back</div>`;
    const start = () => {
      const nameEl = entry.panel.querySelector('#ng-name'); const seedEl = entry.panel.querySelector('#ng-seed');
      st.name = (nameEl && nameEl.value.trim()) || 'Warrior';
      if (seedEl) { const v = seedEl.value.trim(); st.seed = v === '' ? st.seed : (Number.isFinite(Number(v)) ? Number(v) : v); }
      this.settings.playerName = st.name; this.settings.lastDifficulty = st.difficulty; saveSettings(this.settings);
      if (daily) markDailyAttempted();
      this.bus.emit('sfx:ui', { kind: 'click' });
      this.app.newGame({ seed: st.seed, difficulty: st.difficulty, daily, recordDaily: daily && !attempted });
    };
    const entry = this.openModal({
      name: 'newgame', cls: 'newgame', html, wide: true,
      onKey: (e) => {
        if (e.key === 'Enter') { start(); return true; }
        if (!daily && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          const i = DIFFICULTIES.indexOf(st.difficulty); const d = (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 1;
          st.difficulty = DIFFICULTIES[(i + d + DIFFICULTIES.length) % DIFFICULTIES.length];
          entry.panel.querySelectorAll('.card').forEach((c) => c.classList.toggle('selected', c.dataset.d === st.difficulty));
          this.bus.emit('sfx:ui', { kind: 'hover' }); return true;
        }
        return false;
      },
    });
    entry.panel.querySelectorAll('.card[data-d]').forEach((c) => c.addEventListener('click', () => { st.difficulty = c.dataset.d; entry.panel.querySelectorAll('.card').forEach((x) => x.classList.toggle('selected', x === c)); this.bus.emit('sfx:ui', { kind: 'click' }); }));
    entry.panel.querySelector('#ng-back').addEventListener('click', () => this.close());
    entry.panel.querySelector('#ng-start').addEventListener('click', start);
  }

  // ------------------------------------------------------------------ pause
  showPause() {
    const g = this.ctx.getGame(); if (!g || this.stack.some((e) => e.name === 'pause')) return;
    const p = g.player;
    const clock = g.state.quest.timer !== null ? `<div class="vital"><div class="l">Umla's clock</div><div class="v clock">${formatTime(g.state.quest.timer)}</div></div>` : '';
    const html = heading({ eyebrow: `Dungeon level ${g.depth} · ${bandName(g.depth)}`, title: 'Paused' }) +
      `<div class="vitals"><div class="vital"><div class="l">Hits</div><div class="v hp">${p.hp} / ${p.maxHp}</div></div><div class="vital"><div class="l">Level</div><div class="v">${p.level}</div></div><div class="vital"><div class="l">Gold</div><div class="v gold">${fmtNum(p.gold)}</div></div><div class="vital"><div class="l">In the deep</div><div class="v">${formatTime(g.state.elapsed)}</div></div>${clock}</div>`;
    this.openModal({
      name: 'pause', cls: 'pause', html, items: [
        { label: 'Resume', sub: 'Esc', key: true, onSelect: () => this.close() },
        { label: 'Inventory', sub: 'Tab', key: true, onSelect: () => { this.close(); if (this.ctx.inventory) this.ctx.inventory.show(); } },
        { label: 'Help', sub: '?', key: true, onSelect: () => this.showHelp() },
        { label: 'Settings', onSelect: () => this.showSettings() },
        { label: 'Save & quit to title', sub: 'your quest waits for you', onSelect: () => { this.closeAll(); this.app.saveAndQuit(); } },
        { label: 'Abandon quest', sub: 'the dungeon keeps your bones', danger: true, onSelect: () => this.confirm('Abandon this quest?', 'Your save will be erased and the run recorded as a death.', () => { this.closeAll(); this.app.abandon(); }) },
      ],
    });
  }

  confirm(title, text, onYes) {
    this.openModal({ name: 'confirm', html: heading({ eyebrow: 'Are you certain?', title, sub: text }), items: [
      { label: 'No, keep going', onSelect: () => this.close() },
      { label: 'Yes', danger: true, onSelect: () => { this.close(); onYes(); } },
    ] });
  }

  // ------------------------------------------------------------------ help
  showHelp() {
    const groups = HELP_GROUPS.map(([name, keys]) => `<div class="kgroup"><h2>${name}</h2><div class="keys">${keys.map((k) => `<div class="k"><span>${k[0]}</span><span>${k[1].split(' · ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' <em>·</em> ')}</span></div>`).join('')}</div></div>`);
    const html = heading({ eyebrow: 'The Book of Lore', title: 'Help', sub: 'Controls and the rules of the deep' }) +
      `<div class="scroll"><div class="help-cols">
        <div>${groups[0]}${groups[1]}${groups[3]}</div>
        <div>${groups[2]}<h2>The rules</h2>
        <div class="lore">
          <p>The Sword of Fargoal lies on a level between the fifteenth and the twentieth. Take it and <em>Umla's clock</em> starts: 2000 seconds to climb back to level 1 and out. Any monster that <b>attacks you first</b> while you carry it steals the Sword.</p>
          <p><b>Bump to attack.</b> Attacking first is always safe — release the direction to walk away. Being caught starts a fight you cannot walk out of; only Teleport ends it early. You heal while standing still; the monsters do not.</p>
          <p><b>Gold is experience</b> at 1:1, but only at a temple. Humans steal it; bury it to keep it. Checkerboard squares hide treasure or a trap. The temple is a sanctuary: monsters ignore you there and you heal twice as fast.</p>
          <p>Every level is generated fresh when you enter it. Pits drop you 2–5 levels. Wait too long on a level and monsters begin climbing in from above and below.</p>
        </div></div>
      </div></div>
      <div class="hint-bar"><kbd>Esc</kbd> close</div>`;
    this.openModal({ name: 'help', cls: 'help', html, wide: true });
  }

  // ------------------------------------------------------------------ settings
  showSettings() {
    const S = this.settings;
    const rows = [
      { group: 'Sound' },
      { id: 'masterVolume', name: 'Master volume', type: 'range', min: 0, max: 1, step: 0.05 },
      { id: 'musicVolume', name: 'Ambient music', desc: 'the drone darkens with depth and rises in combat', type: 'range', min: 0, max: 1, step: 0.05 },
      { id: 'sfxVolume', name: 'Sound effects', type: 'range', min: 0, max: 1, step: 0.05 },
      { group: 'Display' },
      { id: 'screenShake', name: 'Screen shake', type: 'toggle' },
      { id: 'reduceFlash', name: 'Reduce flashes', desc: 'softer explosion and trap flashes', type: 'toggle' },
      { id: 'fontScale', name: 'Interface scale', type: 'range', min: 0.8, max: 2, step: 0.1 },
      { id: 'colorblind', name: 'Colour-blind palette', desc: 'Okabe–Ito accents for log, map and spells', type: 'toggle' },
      { group: 'Gameplay' },
      { id: 'autoPauseOnSight', name: 'Auto-pause on sight', desc: 'pause when a new monster comes into view', type: 'toggle' },
      { id: 'minimap', name: 'Minimap', desc: 'M toggles it any time', type: 'toggle' },
      { id: 'showTooltips', name: 'Tooltips', type: 'toggle' },
      { group: 'Profile' },
      { id: 'playerName', name: 'Your name', desc: 'as the hall of fame will remember you', type: 'text' },
      { id: 'reset', name: 'Restore defaults', type: 'button' },
    ];
    const opts = rows.map((r, i) => (r.group ? -1 : i)).filter((i) => i >= 0);
    let sel = 0; // index into opts
    const html = heading({ eyebrow: 'Applied immediately · saved in this browser', title: 'Settings' }) + `<div class="scroll" id="settings-rows"></div><div class="hint-bar"><kbd>↑↓</kbd> choose &nbsp; <kbd>←→</kbd> adjust &nbsp; <kbd>Enter</kbd> toggle &nbsp; <kbd>Esc</kbd> close</div>`;
    const apply = () => { saveSettings(S); this.app.applySettings(S); };
    const pct = (r) => Math.round(((S[r.id] - r.min) / (r.max - r.min)) * 100) + '%';
    const num = (r) => (r.id === 'fontScale' ? Math.round(S[r.id] * 100) + '%' : String(Math.round(S[r.id] * 100)));
    const render = () => {
      const box = entry.panel.querySelector('#settings-rows');
      box.innerHTML = rows.map((r, i) => {
        if (r.group) return `<h2>${r.group}</h2>`;
        let v = '';
        if (r.type === 'range') v = `<input type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${S[r.id]}" data-id="${r.id}" style="--v:${pct(r)}"><span class="num">${num(r)}</span>`;
        else if (r.type === 'toggle') v = `<button class="toggle${S[r.id] ? ' on' : ''}" data-id="${r.id}" aria-label="${r.name}"></button>`;
        else if (r.type === 'text') v = `<input type="text" maxlength="16" value="${esc(S[r.id])}" data-id="${r.id}" autocomplete="off">`;
        else v = `<button class="btn" data-id="${r.id}">Reset</button>`;
        return `<div class="setting${i === opts[sel] ? ' selected' : ''}" data-i="${i}"><div class="sn">${r.name}${r.desc ? `<small>${r.desc}</small>` : ''}</div><div class="sv">${v}</div></div>`;
      }).join('');
      box.querySelectorAll('input[type=range]').forEach((inp) => inp.addEventListener('input', () => { const r = rows.find((x) => x.id === inp.dataset.id); S[r.id] = Number(inp.value); apply(); inp.style.setProperty('--v', pct(r)); inp.nextElementSibling.textContent = num(r); }));
      box.querySelectorAll('.toggle').forEach((b) => b.addEventListener('click', () => { S[b.dataset.id] = !S[b.dataset.id]; apply(); render(); this.bus.emit('sfx:ui', { kind: 'click' }); }));
      box.querySelectorAll('input[type=text]').forEach((inp) => inp.addEventListener('change', () => { S[inp.dataset.id] = inp.value.trim() || 'Warrior'; apply(); }));
      box.querySelectorAll('.btn[data-id=reset]').forEach((b) => b.addEventListener('click', () => { Object.assign(S, DEFAULT_SETTINGS); apply(); render(); }));
      box.querySelectorAll('.setting').forEach((row) => row.addEventListener('mouseenter', () => { const k = opts.indexOf(Number(row.dataset.i)); if (k >= 0) sel = k; box.querySelectorAll('.setting').forEach((x) => x.classList.toggle('selected', x === row)); }));
    };
    const adjust = (d) => {
      const r = rows[opts[sel]];
      if (r.type === 'range') { S[r.id] = Math.round(Math.max(r.min, Math.min(r.max, S[r.id] + d * r.step)) * 100) / 100; apply(); render(); this.bus.emit('sfx:ui', { kind: 'hover' }); }
      else if (r.type === 'toggle') { S[r.id] = !S[r.id]; apply(); render(); this.bus.emit('sfx:ui', { kind: 'click' }); }
      else if (r.type === 'button') { Object.assign(S, DEFAULT_SETTINGS); apply(); render(); }
      else if (r.type === 'text') { const inp = entry.panel.querySelector('input[type=text]'); if (inp) inp.focus(); }
    };
    const entry = this.openModal({
      name: 'settings', cls: 'settings', html, wide: false,
      onKey: (e) => {
        const k = e.key;
        if (k === 'ArrowUp' || k === 'w' || k === 'k' || (k === 'Tab' && e.shiftKey)) { sel = (sel - 1 + opts.length) % opts.length; render(); this.bus.emit('sfx:ui', { kind: 'hover' }); return true; }
        if (k === 'ArrowDown' || k === 's' || k === 'j' || k === 'Tab') { sel = (sel + 1) % opts.length; render(); this.bus.emit('sfx:ui', { kind: 'hover' }); return true; }
        if (k === 'ArrowLeft' || k === 'a' || k === 'h') { adjust(-1); return true; }
        if (k === 'ArrowRight' || k === 'd' || k === 'l') { adjust(1); return true; }
        if (k === 'Enter' || k === ' ') { adjust(1); return true; }
        return false;
      },
    });
    render();
  }

  // ------------------------------------------------------------------ death / victory
  recordRun(stats) {
    const g = this.ctx.getGame();
    if (!g || g.recorded) return g ? g.rank || 0 : 0;
    g.recorded = true;
    if (g.daily && g.recordDaily === false) { g.rank = 0; return 0; }
    g.rank = addHallOfFameEntry(stats, { name: this.settings.playerName, daily: !!g.daily });
    return g.rank;
  }

  statsHtml(stats, victory) {
    const hero = victory
      ? [['Score', fmtNum(stats.score), 'gold', 'with the Sword'], ['Experience', fmtNum(stats.xp), '', `level ${stats.level} warrior`], ['Monsters slain', fmtNum(stats.kills), '', `battle skill ${stats.skill}`]]
      : [['Score', fmtNum(stats.score), 'gold', `${stats.difficulty} rules`], ['Experience', fmtNum(stats.xp), '', `level ${stats.level} warrior`], ['Deepest level', String(stats.deepest), 'blood', stats.swordFound ? 'the Sword was found' : 'the Sword lies deeper']];
    const minor = [['Monsters slain', stats.kills], ['Battle skill', stats.skill], ['Treasures', stats.treasures], ['Gold offered', stats.goldSacrificed], ['Steps', fmtNum(stats.steps)], ['Quest took', formatTime(stats.elapsed)]];
    if (victory) minor.splice(0, 2, ['Deepest level', stats.deepest]);
    return `<div class="hero-stats">${hero.map((c) => `<div class="hs"><div class="l">${c[0]}</div><div class="v${c[2] ? ' ' + c[2] : ''}">${c[1]}</div><div class="s">${c[3]}</div></div>`).join('')}</div>
      <div class="minor-stats">${minor.map((c) => `<span class="ms">${c[0]}<b>${c[1]}</b></span>`).join('')}</div>`;
  }

  timelineHtml() {
    const g = this.ctx.getGame(); if (!g) return '';
    const t0 = g.state.time - 30;
    const lines = g.state.log.filter((l) => l.time >= t0).slice(-14);
    if (!lines.length) return '';
    return `<h2>The last thirty seconds</h2><div class="timeline">${lines.map((l) => `<div class="tl" style="--c:var(--${l.kind || 'info'})"><span class="t">${formatTime(l.time)}</span><span>${esc(l.text)}</span></div>`).join('')}</div>`;
  }

  endButtons(stats) {
    const g = this.ctx.getGame();
    return [
      { label: 'Try again', sub: `seed ${stats.seed} · ${stats.difficulty}`, onSelect: () => { this.closeAll(); this.app.restart(); } },
      { label: 'New quest', sub: 'a different dungeon', onSelect: () => this.showNewGame({}) }, // stacked: Back returns here
      { label: 'Hall of Fame', sub: g && g.rank ? `you are #${g.rank}` : '', onSelect: () => this.showHall() },
      { label: 'Copy seed', sub: 'share this dungeon', onSelect: () => { copy(String(stats.seed)); this.bus.emit('log', { text: `Seed ${stats.seed} copied.`, kind: 'info' }); } },
      { label: 'Title screen', onSelect: () => { this.closeAll(); this.app.toTitle(); } },
    ];
  }

  showDeath(stats, payload = {}) {
    const rank = this.recordRun(stats);
    const g = this.ctx.getGame();
    const cause = stats.cause || payload.cause || 'died';
    const title = cause === 'timeout' ? 'Out of time' : cause === 'slain' ? 'Thou art slain' : cause === 'abandoned' ? 'Quest abandoned' : 'You died';
    const name = esc(this.settings.playerName || 'Warrior');
    const depth = g ? g.depth : stats.deepest;
    const where = `on dungeon level <b>${depth}</b>, ${bandName(depth)}`;
    const epitaph = stats.killer ? `Here lies <b>${name}</b>, slain by <b>${esc(stats.killer)}</b> ${where},<br>after ${formatTime(stats.elapsed)} in the deep.`
      : cause === 'timeout' ? `Umla's clock ran out ${where}.<br>The mountain is sealed forever, and <b>${name}</b> with it.`
      : cause === 'abandoned' ? `<b>${name}</b> turned back from the deep ${where}.<br>The Sword remains where it lies.`
      : `Here lies <b>${name}</b>, whose wounds were too many ${where}.<br>No potion was left.`;
    const html = heading({ eyebrow: cause === 'abandoned' ? 'The quest ends' : 'Here ends the quest', title, orn: 'blood' }) +
      `<div class="epitaph">${epitaph}</div>${this.statsHtml(stats, false)}${rank ? `<div class="ribbon">Hall of Fame · No. ${rank}</div>` : ''}${this.timelineHtml()}`;
    const entry = this.openModal({ name: 'death', cls: 'death', html, items: this.endButtons(stats), backdrop: true, wide: true, bdCls: 'grave', before: '<div class="death-veil"></div>' });
    entry.noEscape = true; entry.grid = true;
    this.addFx(entry, entry.el, { mode: 'ash', count: 70, seed: 'death-ash' });
    entry.el.querySelector('.fx-layer').style.zIndex = '0';
    entry.panel.style.zIndex = '1';
  }

  showVictory(stats) {
    const rank = this.recordRun(stats);
    const name = esc(this.settings.playerName || 'Warrior');
    const total = Math.max(1, (this.ctx.getGame()?.state?.quest?.timerTotal) || 2000);
    const frac = Math.max(0, Math.min(1, stats.timerRemaining / total));
    const html = `<div class="mhead"><div class="eyebrow">Gedwyn takes the Sword from your hands</div>${logoSvg('QUEST COMPLETE', { width: 1000, height: 200, size: 118, ember: '#e8c15a', cls: 'small' })}${ornament()}</div>
      <div class="epitaph"><b>${name}</b> carried the Sword of Fargoal out of the mountain.<br>The Great Forest is safe.</div>
      <div class="escape"><div class="big"><div class="l">Escaped in</div><div class="v">${formatTime(stats.elapsed)}</div></div><div class="big"><div class="l">Time to spare</div><div class="v magic">${formatTime(stats.timerRemaining)}</div></div></div>
      <div class="clock"><div class="bar"><i style="width:${(frac * 100).toFixed(1)}%"></i></div><div class="cl"><span>Umla's clock</span><span>${Math.round(frac * 100)}% remained of ${formatTime(total)}</span></div></div>
      ${this.statsHtml(stats, true)}${rank ? `<div class="ribbon">Hall of Fame · No. ${rank}</div>` : ''}`;
    const entry = this.openModal({ name: 'victory', cls: 'victory', html, items: this.endButtons(stats), wide: true, bdCls: 'dawn', before: '<div class="victory-rays"></div>' });
    entry.noEscape = true; entry.grid = true;
    this.addFx(entry, entry.el, { mode: 'gold', count: 90, seed: 'victory-gold' });
    entry.el.querySelector('.fx-layer').style.zIndex = '0';
    entry.panel.style.zIndex = '1';
  }

  // ------------------------------------------------------------------ hall of fame
  showHall() {
    const filters = ['all', 'classic', 'standard', 'story', 'nightmare', 'daily'];
    let f = 0;
    const g = this.ctx.getGame();
    const html = heading({ eyebrow: 'Remembered by this browser', title: 'Hall of Fame', sub: 'The twenty greatest quests' }) + `<div class="filters" id="hall-filters"></div><div class="scroll" id="hall-body"></div><div class="hint-bar"><kbd>←→</kbd> filter &nbsp; <kbd>Esc</kbd> close</div>`;
    const render = () => {
      const fl = entry.panel.querySelector('#hall-filters');
      fl.innerHTML = filters.map((x, i) => `<button class="btn${i === f ? ' selected' : ''}" data-i="${i}">${x}</button>`).join('');
      fl.querySelectorAll('.btn').forEach((b) => b.addEventListener('click', () => { f = Number(b.dataset.i); render(); }));
      const rows = getHallOfFame().filter((e) => filters[f] === 'all' || (filters[f] === 'daily' ? e.daily : e.difficulty === filters[f]));
      const body = entry.panel.querySelector('#hall-body');
      if (!rows.length) { body.innerHTML = '<div class="empty">No heroes yet. The deep is waiting.</div>'; return; }
      const mine = g && g.recorded && g.rank ? stats(g).seed : null;
      body.innerHTML = `<table class="hall"><thead><tr><th>#</th><th>Name</th><th>Score</th><th>XP</th><th>Lvl</th><th>Depth</th><th>Slain</th><th>Time</th><th>Mode</th><th>Fate</th><th>Seed</th></tr></thead><tbody>
        ${rows.map((e, i) => `<tr class="${mine !== null && e.seed === mine && i === g.rank - 1 && f === 0 ? 'me' : ''}"><td class="rk">${i + 1}</td><td class="nm">${esc(e.name)}</td><td class="sc">${fmtNum(e.score)}</td><td>${fmtNum(e.xp)}</td><td>${e.level}</td><td>${e.depth}</td><td>${e.kills}</td><td>${formatTime(e.elapsed)}</td><td>${e.difficulty}${e.daily ? ' · daily' : ''}</td><td class="oc-${e.outcome}">${e.outcome}${e.killer ? ' · ' + esc(e.killer) : ''}</td><td>${e.seed}</td></tr>`).join('')}
      </tbody></table>`;
    };
    const entry = this.openModal({ name: 'hall', cls: 'hall', html, wide: true, onKey: (e) => { if (e.key === 'ArrowLeft' || e.key === 'h') { f = (f - 1 + filters.length) % filters.length; render(); return true; } if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'Tab') { f = (f + 1) % filters.length; render(); return true; } return false; } });
    render();
  }

  dispose() { window.removeEventListener('keydown', this.onKey, true); for (const u of this.unsub) u(); this.closeAll(); }
}

function stats(g) { try { return g.getStats(); } catch { return { seed: null }; } }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function copy(text) { try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {}); } catch { /* ignore */ } }
