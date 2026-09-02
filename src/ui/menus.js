// Menus: title screen (with the renderer's rotating dungeon behind it), new-game/difficulty,
// pause, help/controls, settings, death & victory screens and the hall of fame. One keyboard
// router drives whichever screen is on top of the stack; the mouse works everywhere.
import { DIFFICULTIES } from '../core/constants.js';
import { listSaves, getHallOfFame, addHallOfFameEntry, dailySeed, todayUtc, dailyAttempted, markDailyAttempted, formatTime, saveSettings, DEFAULT_SETTINGS } from '../core/save.js';
import { seedFrom } from '../core/rng.js';

const DIFF_INFO = {
  classic: ['Classic', 'Rolled 3–18 hits and skill, exact 1983 rules, permadeath. Daily seeds and the hall of fame proper.'],
  standard: ['Standard', 'The manual\'s 12 hits / 8 skill start, guaranteed level connectivity, auto-pause when a monster appears.'],
  story: ['Story', 'No permadeath (your save survives death), a 3000-second clock and the Sword cannot be stolen below half hits.'],
  nightmare: ['Nightmare', 'Twice the wandering monsters, the Mage and Demon from depth 10, and only 1500 seconds to escape.'],
};
const HELP_KEYS = [
  ['Move', 'WASD · arrows · numpad · hjklyubn'], ['Attack', 'move into a monster (hold to keep fighting)'], ['Disengage', 'release the direction'],
  ['Interact / panic', 'Space · Enter · click yourself'], ['Click to move', 'left click a tile'], ['Auto-explore', 'X'], ['Rest a moment', 'Z'],
  ['Healing potion', 'Q · Shift+H'], ['Teleport', 'T · 1'], ['Shield', 'Shift+S · 2'], ['Regeneration', 'R · 3'], ['Invisibility', 'I · 4'],
  ['Light', 'Shift+L · 5'], ['Light on / off', 'O'], ['Drift', 'F · 6'], ['Bury gold', 'Shift+B'], ['Place beacon', '+'],
  ['Inventory', 'Tab'], ['Minimap', 'M'], ['Zoom', '[ ] · wheel'], ['Help', '? · F1'], ['Pause / menu', 'Esc'],
];
const corners = '<div class="corners"><i></i><i></i><i></i><i></i></div>';

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
  }

  // ------------------------------------------------------------------ generic modal machinery
  /**
   * Open a modal. `items` are menu entries {label, sub, onSelect, danger, disabled}; extra keys go to `onKey`.
   * @returns {object} the stack entry
   */
  openModal({ name, cls = '', html = '', items = null, onKey = null, onClose = null, backdrop = true, sel = 0, wide = false }) {
    const entry = { name, items: items || [], sel, onKey, onClose };
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop' + (backdrop ? '' : ' clear');
    const panel = document.createElement('div');
    panel.className = `panel modal ${wide ? 'wide' : ''} ${cls}`;
    panel.innerHTML = corners + html;
    bd.appendChild(panel);
    entry.el = bd; entry.panel = panel;
    if (items) {
      const list = panel.querySelector('.menu-list') || panel.appendChild(Object.assign(document.createElement('div'), { className: 'menu-list' }));
      items.forEach((it, i) => {
        const b = document.createElement('button');
        b.className = 'menu-item' + (it.danger ? ' danger' : '');
        b.innerHTML = `<span>${it.label}</span>${it.sub ? `<small>${it.sub}</small>` : ''}`;
        if (it.disabled) b.setAttribute('disabled', '');
        b.addEventListener('mouseenter', () => { if (entry.sel !== i && !it.disabled) { entry.sel = i; this.highlight(entry); this.bus.emit('sfx:ui', { kind: 'hover' }); } });
        b.addEventListener('click', () => { entry.sel = i; this.activate(entry); });
        list.appendChild(b); it.el = b;
      });
      this.highlight(entry);
    }
    this.ctx.root.appendChild(bd);
    this.stack.push(entry);
    this.ctx.setModal(true, name);
    this.bus.emit('sfx:ui', { kind: 'open' });
    return entry;
  }

  highlight(entry) {
    entry.items.forEach((it, i) => it.el && it.el.classList.toggle('selected', i === entry.sel));
    const it = entry.items[entry.sel]; if (it && it.el && it.el.scrollIntoView) { try { it.el.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ } }
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
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) { if (e.key === 'Escape') { e.target.blur(); e.preventDefault(); e.stopPropagation(); } return; }
    e.stopPropagation();
    const k = e.key;
    if (top.onKey && top.onKey(e) === true) { e.preventDefault(); return; }
    if (top.items.length) {
      const n = top.items.length;
      const step = (d) => { let i = top.sel; for (let t = 0; t < n; t++) { i = (i + d + n) % n; if (!top.items[i].disabled) break; } if (i !== top.sel) { top.sel = i; this.highlight(top); this.bus.emit('sfx:ui', { kind: 'hover' }); } };
      if (k === 'ArrowUp' || k === 'w' || k === 'k' || (k === 'Tab' && e.shiftKey)) { step(-1); e.preventDefault(); return; }
      if (k === 'ArrowDown' || k === 's' || k === 'j' || k === 'Tab') { step(1); e.preventDefault(); return; }
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
      <div class="credit">Jeff McCord's 1982 classic<br>reimagined · procedural remake</div>
      <div class="knight">⚔</div>
      <div class="epyx">Epyx presents</div>
      <div class="t1">The Sword of</div>
      <div class="t2 gold-text">Fargoal</div>
      <div class="bar"></div>
      <div class="menu"><div class="menu-list"></div></div>
      <div class="foot"><b>↑↓</b> choose &nbsp;·&nbsp; <b>Enter</b> select &nbsp;·&nbsp; today's daily seed <b>${daily}</b>${attempted ? ' (attempted)' : ''}</div>`;
    const items = [
      { label: 'New Game', sub: 'choose your difficulty', onSelect: () => this.showNewGame({}) },
      { label: 'Continue', sub: cont ? `${cont.meta.difficulty} · depth ${cont.meta.depth} · lvl ${cont.meta.level} · ${formatTime(cont.meta.elapsed)}` : 'no saved quest', disabled: !cont, onSelect: () => { if (!this.app.continueGame()) this.showTitle(); } },
      { label: 'Daily Seed', sub: `${daily} · classic rules${attempted ? ' · attempted' : ''}`, onSelect: () => this.showNewGame({ daily: true }) },
      { label: 'Hall of Fame', sub: `${getHallOfFame().length} heroes remembered`, onSelect: () => this.showHall() },
      { label: 'Settings', onSelect: () => this.showSettings() },
      { label: 'Help', sub: 'controls and the rules of the deep', onSelect: () => this.showHelp() },
    ];
    const entry = { name: 'title', items, sel: 0, el, noEscape: true };
    const list = el.querySelector('.menu-list');
    items.forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'menu-item'; b.innerHTML = `<span>${it.label}</span>${it.sub ? `<small>${it.sub}</small>` : ''}`;
      if (it.disabled) b.setAttribute('disabled', '');
      b.addEventListener('mouseenter', () => { if (!it.disabled && entry.sel !== i) { entry.sel = i; this.highlight(entry); this.bus.emit('sfx:ui', { kind: 'hover' }); } });
      b.addEventListener('click', () => { entry.sel = i; this.activate(entry); });
      list.appendChild(b); it.el = b;
    });
    this.highlight(entry);
    this.ctx.root.appendChild(el);
    this.ctx.root.classList.add('title-mode');
    this.titleEl = el;
    this.stack.push(entry);
    this.ctx.setModal(true, 'title');
  }

  hideTitle() { if (this.titleEl) this.close('title'); }

  // ------------------------------------------------------------------ new game
  showNewGame({ daily = false }) {
    const st = { difficulty: daily ? 'classic' : (this.settings.lastDifficulty || 'standard'), seed: daily ? dailySeed() : (seedFrom(Date.now(), 'new') % 1000000), name: this.settings.playerName || 'Warrior' };
    const attempted = daily && dailyAttempted();
    const html = `<h1 class="gold-text">${daily ? 'Daily Seed' : 'New Quest'}</h1>
      <div class="subtitle">${daily ? `${todayUtc()} · classic rules · one attempt is recorded` : 'Choose how the deep will treat you'}</div>
      ${daily ? '' : `<div class="cards">${DIFFICULTIES.map((d) => `<button class="card${d === st.difficulty ? ' selected' : ''}" data-d="${d}"><div class="cn">${DIFF_INFO[d][0]}</div><div class="cd">${DIFF_INFO[d][1]}</div></button>`).join('')}</div>`}
      ${daily ? `<div class="cards"><div class="card selected"><div class="cn">Classic</div><div class="cd">${DIFF_INFO.classic[1]}</div></div><div class="card"><div class="cn">Seed ${st.seed}</div><div class="cd">Everyone who plays today descends the same dungeon. ${attempted ? '<b style="color:var(--danger)">You already attempted today — this run will not be recorded.</b>' : 'Your first run today is recorded in the hall of fame.'}</div></div></div>` : ''}
      <div class="field"><span>Your name</span><input type="text" id="ng-name" maxlength="16" value="${esc(st.name)}"></div>
      ${daily ? '' : `<div class="field"><span>Seed <small style="color:var(--parchment-faint)">(number or words)</small></span><input type="text" id="ng-seed" value="${st.seed}"></div>`}
      <div class="btn-row"><button class="btn" id="ng-back">Back</button><button class="btn primary" id="ng-start">Begin the descent</button></div>
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
      name: 'newgame', html, wide: true,
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
    const html = `<h1 class="gold-text">Paused</h1><div class="subtitle">Dungeon level ${g.depth} · ${p.hp}/${p.maxHp} hits · ${formatTime(g.state.elapsed)} in the deep${g.state.quest.timer !== null ? ` · clock ${formatTime(g.state.quest.timer)}` : ''}</div>`;
    this.openModal({
      name: 'pause', html, items: [
        { label: 'Resume', sub: 'Esc', onSelect: () => this.close() },
        { label: 'Inventory', sub: 'Tab', onSelect: () => { this.close(); if (this.ctx.inventory) this.ctx.inventory.show(); } },
        { label: 'Help', sub: '?', onSelect: () => this.showHelp() },
        { label: 'Settings', onSelect: () => this.showSettings() },
        { label: 'Save & quit to title', sub: 'your quest waits for you', onSelect: () => { this.closeAll(); this.app.saveAndQuit(); } },
        { label: 'Abandon quest', sub: 'the dungeon keeps your bones', danger: true, onSelect: () => this.confirm('Abandon this quest?', 'Your save will be erased and the run recorded as a death.', () => { this.closeAll(); this.app.abandon(); }) },
      ],
    });
  }

  confirm(title, text, onYes) {
    this.openModal({ name: 'confirm', html: `<h1>${title}</h1><div class="subtitle">${text}</div>`, items: [
      { label: 'No, keep going', onSelect: () => this.close() },
      { label: 'Yes', danger: true, onSelect: () => { this.close(); onYes(); } },
    ] });
  }

  // ------------------------------------------------------------------ help
  showHelp() {
    const html = `<h1 class="gold-text">Help</h1><div class="subtitle">Controls and the rules of the deep</div>
      <div class="scroll">
      <h2>Keys</h2><div class="keys">${HELP_KEYS.map((k) => `<div class="k"><span>${k[0]}</span><span><kbd>${k[1]}</kbd></span></div>`).join('')}</div>
      <h2>The rules</h2>
      <div style="font-size:.8rem;line-height:1.45">
        <p>The Sword of Fargoal lies on a level between the fifteenth and the twentieth. Take it and Umla's clock starts: 2000 seconds to climb back to level 1 and out. Any monster that <b>attacks you first</b> while you carry it steals the Sword.</p>
        <p><b>Bump to attack.</b> Attacking first is always safe — release the direction to walk away. Being caught starts a fight you cannot walk out of; only Teleport (Space) ends it early. You heal while standing still; the monsters do not.</p>
        <p><b>Gold is experience</b> at 1:1, but only at a temple. Humans steal it. Bury it (Shift+B) to keep it. Checkerboard squares hide treasure or a trap (44% trap). The temple is a sanctuary: monsters ignore you there and you heal twice as fast.</p>
        <p>Every level is generated fresh when you enter it: nothing you leave behind will be there when you return. Pits drop you 2–5 levels. Wait too long on a level and monsters begin climbing in from above and below.</p>
      </div></div>
      <div class="hint-bar"><kbd>Esc</kbd> close</div>`;
    this.openModal({ name: 'help', html, wide: true });
  }

  // ------------------------------------------------------------------ settings
  showSettings() {
    const S = this.settings;
    const rows = [
      { id: 'masterVolume', name: 'Master volume', type: 'range', min: 0, max: 1, step: 0.05 },
      { id: 'musicVolume', name: 'Ambient music', desc: 'the drone darkens with depth and rises in combat', type: 'range', min: 0, max: 1, step: 0.05 },
      { id: 'sfxVolume', name: 'Sound effects', type: 'range', min: 0, max: 1, step: 0.05 },
      { id: 'screenShake', name: 'Screen shake', type: 'toggle' },
      { id: 'reduceFlash', name: 'Reduce flashes', desc: 'softer explosion and trap flashes', type: 'toggle' },
      { id: 'fontScale', name: 'Interface scale', type: 'range', min: 0.8, max: 2, step: 0.1 },
      { id: 'colorblind', name: 'Colour-blind palette', desc: 'Okabe–Ito accents for log, map and spells', type: 'toggle' },
      { id: 'autoPauseOnSight', name: 'Auto-pause on sight', desc: 'pause when a new monster comes into view', type: 'toggle' },
      { id: 'minimap', name: 'Minimap', desc: 'M toggles it any time', type: 'toggle' },
      { id: 'showTooltips', name: 'Tooltips', type: 'toggle' },
      { id: 'playerName', name: 'Your name', type: 'text' },
      { id: 'reset', name: 'Restore defaults', type: 'button' },
    ];
    let sel = 0;
    const html = `<h1 class="gold-text">Settings</h1><div class="subtitle">Applied immediately · saved in this browser</div><div class="scroll" id="settings-rows"></div><div class="hint-bar"><kbd>↑↓</kbd> choose &nbsp; <kbd>←→</kbd> adjust &nbsp; <kbd>Enter</kbd> toggle &nbsp; <kbd>Esc</kbd> close</div>`;
    const apply = () => { saveSettings(S); this.app.applySettings(S); };
    const render = () => {
      const box = entry.panel.querySelector('#settings-rows');
      box.innerHTML = rows.map((r, i) => {
        let v = '';
        if (r.type === 'range') v = `<input type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${S[r.id]}" data-id="${r.id}"><span class="num">${r.id === 'fontScale' ? Math.round(S[r.id] * 100) + '%' : Math.round(S[r.id] * 100)}</span>`;
        else if (r.type === 'toggle') v = `<button class="toggle${S[r.id] ? ' on' : ''}" data-id="${r.id}"></button>`;
        else if (r.type === 'text') v = `<input type="text" maxlength="16" value="${esc(S[r.id])}" data-id="${r.id}" style="width:9rem;padding:.3rem .5rem;background:rgba(0,0,0,.45);border:1px solid var(--gold-dim);color:var(--parchment);border-radius:3px;outline:none">`;
        else v = `<button class="btn" data-id="${r.id}">Reset</button>`;
        return `<div class="setting${i === sel ? ' selected' : ''}" data-i="${i}"><div class="sn">${r.name}${r.desc ? `<small>${r.desc}</small>` : ''}</div><div class="sv">${v}</div></div>`;
      }).join('');
      box.querySelectorAll('input[type=range]').forEach((inp) => inp.addEventListener('input', () => { S[inp.dataset.id] = Number(inp.value); apply(); inp.nextElementSibling.textContent = inp.dataset.id === 'fontScale' ? Math.round(S[inp.dataset.id] * 100) + '%' : Math.round(S[inp.dataset.id] * 100); }));
      box.querySelectorAll('.toggle').forEach((b) => b.addEventListener('click', () => { S[b.dataset.id] = !S[b.dataset.id]; apply(); render(); this.bus.emit('sfx:ui', { kind: 'click' }); }));
      box.querySelectorAll('input[type=text]').forEach((inp) => inp.addEventListener('change', () => { S[inp.dataset.id] = inp.value.trim() || 'Warrior'; apply(); }));
      box.querySelectorAll('.btn[data-id=reset]').forEach((b) => b.addEventListener('click', () => { Object.assign(S, DEFAULT_SETTINGS); apply(); render(); }));
      box.querySelectorAll('.setting').forEach((row) => row.addEventListener('mouseenter', () => { sel = Number(row.dataset.i); box.querySelectorAll('.setting').forEach((x) => x.classList.toggle('selected', x === row)); }));
    };
    const adjust = (d) => {
      const r = rows[sel];
      if (r.type === 'range') { S[r.id] = Math.round(Math.max(r.min, Math.min(r.max, S[r.id] + d * r.step)) * 100) / 100; apply(); render(); this.bus.emit('sfx:ui', { kind: 'hover' }); }
      else if (r.type === 'toggle') { S[r.id] = !S[r.id]; apply(); render(); this.bus.emit('sfx:ui', { kind: 'click' }); }
      else if (r.type === 'button') { Object.assign(S, DEFAULT_SETTINGS); apply(); render(); }
      else if (r.type === 'text') { const inp = entry.panel.querySelector('input[type=text]'); if (inp) inp.focus(); }
    };
    const entry = this.openModal({
      name: 'settings', html, wide: false,
      onKey: (e) => {
        const k = e.key;
        if (k === 'ArrowUp' || k === 'w' || k === 'k') { sel = (sel - 1 + rows.length) % rows.length; render(); this.bus.emit('sfx:ui', { kind: 'hover' }); return true; }
        if (k === 'ArrowDown' || k === 's' || k === 'j' || k === 'Tab') { sel = (sel + 1) % rows.length; render(); this.bus.emit('sfx:ui', { kind: 'hover' }); return true; }
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
    const cells = [
      ['Experience', stats.xp.toLocaleString('en-US'), 'gold'], ['Level', stats.level], ['Deepest', stats.deepest],
      ['Monsters slain', stats.kills], ['Battle skill', stats.skill], ['Quest took', formatTime(stats.elapsed)],
      ['Score', stats.score.toLocaleString('en-US'), 'gold'], ['Treasures', stats.treasures], victory ? ['Time to spare', formatTime(stats.timerRemaining)] : ['Gold offered', stats.goldSacrificed],
    ];
    return `<div class="stats">${cells.map((c) => `<div class="stat"><span class="label">${c[0]}</span><span class="v${c[2] ? ' ' + c[2] : ''}">${c[1]}</span></div>`).join('')}</div>`;
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
      { label: 'Try again', sub: `same seed ${stats.seed} · ${stats.difficulty}`, onSelect: () => { this.closeAll(); this.app.restart(); } },
      { label: 'New quest', onSelect: () => { this.closeAll(); this.showNewGame({}); } },
      { label: 'Hall of Fame', sub: g && g.rank ? `you are #${g.rank}` : '', onSelect: () => this.showHall() },
      { label: 'Copy seed', sub: 'share this dungeon', onSelect: () => { copy(String(stats.seed)); this.bus.emit('log', { text: `Seed ${stats.seed} copied.`, kind: 'info' }); } },
      { label: 'Title screen', onSelect: () => { this.closeAll(); this.app.toTitle(); } },
    ];
  }

  showDeath(stats, payload = {}) {
    const rank = this.recordRun(stats);
    const cause = stats.cause || payload.cause || 'died';
    const title = cause === 'timeout' ? 'Out of time' : cause === 'slain' ? 'Thou art slain' : cause === 'abandoned' ? 'Quest abandoned' : 'You died';
    const killer = stats.killer ? `Slain by <b>${esc(stats.killer)}</b> on dungeon level ${stats.deepest >= 0 ? this.ctx.getGame()?.depth ?? stats.deepest : stats.deepest}` : cause === 'timeout' ? "Umla's clock ran out. The mountain is sealed forever." : cause === 'abandoned' ? 'You turned back from the deep.' : 'Your wounds were too many and no potion was left.';
    const html = `<h1>${title}</h1><div class="cause">${killer}</div>${this.statsHtml(stats, false)}${rank ? `<div class="rank">✦ Hall of Fame #${rank} ✦</div>` : ''}${this.timelineHtml()}`;
    this.openModal({ name: 'death', cls: 'death', html, items: this.endButtons(stats), backdrop: true, wide: true });
    const top = this.top; if (top) top.noEscape = true;
  }

  showVictory(stats) {
    const rank = this.recordRun(stats);
    const html = `<h1 class="gold-text">Your quest is complete</h1>
      <div class="cause" style="color:var(--parchment)">Gedwyn takes the Sword from your hands. The Great Forest is safe.<br>You escaped the mountain in <b style="color:var(--gold)">${formatTime(stats.elapsed)}</b> with <b style="color:var(--gold)">${formatTime(stats.timerRemaining)}</b> left on Umla's clock.</div>
      ${this.statsHtml(stats, true)}${rank ? `<div class="rank">✦ Hall of Fame #${rank} ✦</div>` : ''}`;
    this.openModal({ name: 'victory', cls: 'victory', html, items: this.endButtons(stats), wide: true });
    const top = this.top; if (top) top.noEscape = true;
  }

  // ------------------------------------------------------------------ hall of fame
  showHall() {
    const filters = ['all', 'classic', 'standard', 'story', 'nightmare', 'daily'];
    let f = 0;
    const g = this.ctx.getGame();
    const html = `<h1 class="gold-text">Hall of Fame</h1><div class="subtitle">The twenty greatest quests remembered by this browser</div><div class="btn-row" id="hall-filters"></div><div class="scroll" id="hall-body"></div><div class="hint-bar"><kbd>←→</kbd> filter &nbsp; <kbd>Esc</kbd> close</div>`;
    const render = () => {
      const fl = entry.panel.querySelector('#hall-filters');
      fl.innerHTML = filters.map((x, i) => `<button class="btn${i === f ? ' selected' : ''}" data-i="${i}">${x}</button>`).join('');
      fl.querySelectorAll('.btn').forEach((b) => b.addEventListener('click', () => { f = Number(b.dataset.i); render(); }));
      const rows = getHallOfFame().filter((e) => filters[f] === 'all' || (filters[f] === 'daily' ? e.daily : e.difficulty === filters[f]));
      const body = entry.panel.querySelector('#hall-body');
      if (!rows.length) { body.innerHTML = '<div class="empty">No heroes yet. The deep is waiting.</div>'; return; }
      body.innerHTML = `<table class="hall"><thead><tr><th>#</th><th>Name</th><th>Score</th><th>XP</th><th>Lvl</th><th>Depth</th><th>Slain</th><th>Time</th><th>Mode</th><th>Fate</th><th>Seed</th></tr></thead><tbody>
        ${rows.map((e, i) => `<tr class="${g && g.recorded && g.rank && e.at && stats(g).seed === e.seed && i === g.rank - 1 && f === 0 ? 'me' : ''}"><td>${i + 1}</td><td class="nm">${esc(e.name)}</td><td>${e.score.toLocaleString('en-US')}</td><td>${e.xp.toLocaleString('en-US')}</td><td>${e.level}</td><td>${e.depth}</td><td>${e.kills}</td><td>${formatTime(e.elapsed)}</td><td>${e.difficulty}${e.daily ? ' ☀' : ''}</td><td class="oc-${e.outcome}">${e.outcome}${e.killer ? ' · ' + esc(e.killer) : ''}</td><td>${e.seed}</td></tr>`).join('')}
      </tbody></table>`;
    };
    const entry = this.openModal({ name: 'hall', html, wide: true, onKey: (e) => { if (e.key === 'ArrowLeft' || e.key === 'h') { f = (f - 1 + filters.length) % filters.length; render(); return true; } if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'Tab') { f = (f + 1) % filters.length; render(); return true; } return false; } });
    render();
  }

  dispose() { window.removeEventListener('keydown', this.onKey, true); for (const u of this.unsub) u(); this.closeAll(); }
}

function stats(g) { try { return g.getStats(); } catch { return { seed: null }; } }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function copy(text) { try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(() => {}); } catch { /* ignore */ } }
