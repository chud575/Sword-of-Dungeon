// HUD: character card (level medal, HP gauge with damage trail, XP gauge, gold count-up), depth
// banner + the Sword's countdown, spell/item hotbar with procedural icons, counts and hotkeys,
// status-effect chips, quick buttons and the centre banner (auto-pause). Pure DOM: reads the Game
// on update() and reacts to bus events for one-shot animations. Styles live in ./hud.css.
import './hud.css';
import { SPELL_TABLE } from '../game/items.js';
import { xpForLevel } from '../core/constants.js';
import { formatTime } from '../core/save.js';
import { icon } from './icons.js';

const SPELL_KEYS = { teleport: '1', shield: '2', regeneration: '3', invisibility: '4', light: '5', drift: '6' };
const SPELL_SHORT = { teleport: 'Teleport', shield: 'Shield', regeneration: 'Regen', invisibility: 'Unseen', light: 'Light', drift: 'Drift' };
const BANDS = [[5, 'The Upper Halls'], [12, 'The Cold Deep'], [18, 'The Black Roots'], [Infinity, "Umla's Domain"]];

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
const corners = () => '<div class="corners"><i></i><i></i><i></i><i></i></div><div class="filet"></div>';
const fmtNum = (n) => Math.round(n).toLocaleString('en-US');

export class Hud {
  /**
   * @param {{root:HTMLElement, bus:import('../core/events.js').EventBus, getGame:()=>import('../game/game.js').Game|null, settings:object, allowAutoPause?:()=>boolean, isModal?:()=>boolean}} ctx
   */
  constructor(ctx) {
    this.ctx = ctx; this.bus = ctx.bus; this.settings = ctx.settings;
    this.disp = { hp: null, trail: null, trailDelay: 0, gold: 0, xp: 0 };
    this.autoPaused = false;
    this.levelEnterTime = 0;
    this.bannerTimer = 0;
    this.unsub = [];
    this.cache = {};
    this.build();
    this.bind();
  }

  build() {
    const root = this.ctx.root;
    // --- character card
    this.card = el('div', 'panel hud ornate', corners() + `<div class="flash"></div>
      <div class="head">
        <div class="medal"><span class="lv num">1</span><span class="lvl">Level</span><span class="ring"></span></div>
        <div class="who"><div class="name">Warrior</div>
          <div class="sub"><span title="Battle skill">${icon('skill')}Skill <b class="skill-v">8</b></span><span title="Monsters slain">${icon('skull')}Slain <b class="kills">0</b></span></div></div>
      </div>
      <div class="gauge hp"><div class="frame"><div class="trail"></div><div class="fill"></div><div class="ticks"></div>
        <div class="txt"><span class="cap">Hits</span><span class="val"><span class="hp-t">12</span> <small>/ <span class="hp-m">12</span></small></span></div></div><i class="end l"></i><i class="end r"></i></div>
      <div class="gauge xp"><div class="lab"><span class="cap-l">Experience</span><span class="num"><span class="xp-v">0</span> <small>/ <span class="xp-next">200</span></small></span></div>
        <div class="frame"><div class="fill"></div></div><i class="end l"></i><i class="end r"></i></div>
      <div class="purse"><span class="gold" title="Gold carried — sacrifice it at a temple for experience">${icon('coin')}<span class="num gold-v">0</span><small>gold</small></span>
        <span class="next">Next level <b class="xp-togo">200</b></span></div>`);
    this.card.id = 'hud-card';
    root.appendChild(this.card);
    this.q = (s) => this.cache[s] || (this.cache[s] = this.card.querySelector(s));
    // --- status chips
    this.status = el('div', 'hud'); this.status.id = 'hud-status'; root.appendChild(this.status);
    // --- depth + Sword timer
    this.depth = el('div', 'panel hud ornate', corners() + `
      <div class="depth">${icon('stairs')}<span>Dungeon level</span><span class="n num">1</span></div>
      <div class="band">The Upper Halls</div><div class="seed"></div>
      <div class="timer"><div class="cap">Umla's clock</div><div class="clock">${icon('hourglass')}<div class="t num">33:20</div></div><div class="fuse"><div class="f"></div></div></div>`);
    this.depth.id = 'hud-depth'; root.appendChild(this.depth);
    this.dq = { n: this.depth.querySelector('.n'), band: this.depth.querySelector('.band'), seed: this.depth.querySelector('.seed'), t: this.depth.querySelector('.timer .t'), cap: this.depth.querySelector('.timer .cap'), fuse: this.depth.querySelector('.fuse .f') };
    // --- hotbar
    this.hotbar = el('div', 'panel hud ornate'); this.hotbar.id = 'hud-hotbar'; root.appendChild(this.hotbar);
    this.slots = {};
    const mk = (id, name, key, color, action, ico) => {
      const s = el('button', 'slot', `<span class="key">${key}</span><span class="glyph">${icon(ico)}</span><span class="nm">${name}</span><span class="cnt"></span>`);
      s.style.setProperty('--c', color); s.title = name; s.dataset.id = id;
      s.addEventListener('click', () => { this.bus.emit('sfx:ui', { kind: 'click' }); this.bus.emit('input:action', action); this.flash(id); });
      s.addEventListener('mouseenter', () => this.bus.emit('sfx:ui', { kind: 'hover' }));
      this.hotbar.appendChild(s); this.slots[id] = s;
      return s;
    };
    for (const [type, sp] of Object.entries(SPELL_TABLE)) { const s = mk(type, SPELL_SHORT[type] || sp.name, SPELL_KEYS[type], `var(--sp-${type})`, { action: 'cast', spell: type }, type); s.title = `${sp.name} — ${sp.desc}`; }
    this.hotbar.appendChild(el('div', 'sep'));
    mk('potion', 'Potion', 'Q', '#ff6b8a', { action: 'potion' }, 'potion').title = 'Healing Potion — heals 20·rnd + 3·depth hits';
    mk('beacon', 'Beacon', '+', 'var(--mm-beacon)', { action: 'beacon' }, 'beacon').title = 'Beacon — place it: teleports arrive here and monsters cannot see you on it';
    this.hotbar.appendChild(el('div', 'sep'));
    mk('toggleLight', 'Lamp', 'O', 'var(--sp-light)', { action: 'toggleLight' }, 'lamp').title = 'Lamp — shutter or open your Light spell';
    mk('bury', 'Bury', '⇧B', 'var(--loot)', { action: 'bury' }, 'bury').title = 'Bury gold here — safe from thieves, dig it up later';
    mk('wait', 'Rest', 'Z', 'var(--info)', { action: 'wait' }, 'wait').title = 'Rest a moment (heals slowly outside a fight)';
    // --- quick buttons
    this.quick = el('div', 'panel hud ornate'); this.quick.id = 'hud-quick'; root.appendChild(this.quick);
    const qb = (id, name, key, action) => { const b = el('button', 'qb', `<span>${name}</span><kbd>${key}</kbd>`); b.dataset.id = id; b.addEventListener('click', () => { this.bus.emit('sfx:ui', { kind: 'click' }); this.bus.emit('input:action', action); }); this.quick.appendChild(b); return b; };
    this.exploreBtn = qb('explore', 'Explore', 'X', { action: 'explore' });
    qb('minimap', 'Map', 'M', { action: 'minimap' });
    qb('inventory', 'Inventory', 'Tab', { action: 'inventory' });
    qb('help', 'Help', '?', { action: 'help' });
    qb('pause', 'Menu', 'Esc', { action: 'pause' });
    // --- centre banner
    this.banner = el('div', 'panel hud ornate', corners() + '<div class="mark">!</div><div class="why"></div><div class="hint"></div>');
    this.banner.id = 'hud-banner'; root.appendChild(this.banner);
    // the log squeezes against the hotbar on narrow windows: publish the hotbar's width
    this.measure();
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => this.measure()); this.ro.observe(this.hotbar); }
  }

  measure() { const w = this.hotbar.offsetWidth; if (w) this.ctx.root.style.setProperty('--hotbar-w', `${w}px`); }

  bind() {
    const on = (n, f) => this.unsub.push(this.bus.on(n, f));
    on('player:hp', (p) => { if (p.delta < 0) retrigger(this.card, 'hurt'); });
    on('player:xp', (p) => { if (p.leveledUp) retrigger(this.q('.medal'), 'levelup'); });
    on('player:gold', (p) => { if (p.delta > 0) retrigger(this.q('.gold'), 'bump'); });
    on('spell:cast', (p) => this.flash(p.spell));
    on('item:used', (p) => this.flash(p.item && p.item.type));
    on('level:enter', () => { const g = this.ctx.getGame(); this.levelEnterTime = g ? g.state.time : 0; this.autoPaused = false; retrigger(this.depth, 'enter'); });
    on('monster:seen', (p) => this.onMonsterSeen(p));
    on('game:paused', (p) => { if (!p.paused && this.autoPaused) { this.autoPaused = false; this.hideBanner(); } }); // e.g. Esc resumes an auto-pause: drop the sticky banner
    on('game:start', () => { this.autoPaused = false; this.disp.hp = null; this.disp.trail = null; this.refreshStatic(); });
    on('ui:explore', (p) => this.exploreBtn.classList.toggle('on', !!p.on));
    const resume = () => { if (!this.autoPaused) return; const g = this.ctx.getGame(); this.autoPaused = false; this.hideBanner(); if (this.ctx.isModal && this.ctx.isModal()) return; if (g && g.paused) g.setPaused(false); };
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') return; resume(); });
    window.addEventListener('pointerdown', resume);
  }

  flash(id) { const s = this.slots[id]; if (s) retrigger(s, 'flash'); }

  /** Auto-pause when a new monster comes into view (setting), with a "!" banner. */
  onMonsterSeen({ entity, description }) {
    const g = this.ctx.getGame();
    if (!g || g.over || g.paused || !this.settings.autoPauseOnSight) return;
    if (this.ctx.allowAutoPause && !this.ctx.allowAutoPause()) return;
    if (this.ctx.isModal && this.ctx.isModal()) return;
    if (g.state.time - this.levelEnterTime < 0.35) return;
    if (entity && entity.state !== 'hunt' && Math.max(Math.abs(entity.x - g.player.x), Math.abs(entity.y - g.player.y)) > 7) return;
    this.autoPaused = true;
    g.setPaused(true);
    this.showBanner(`${cap(description || 'a monster')} comes into view`, 'Paused — any key to continue', 'danger', 0);
  }

  /** Show the centre banner. dur 0 = stays until hideBanner(). */
  showBanner(why, hint = '', kind = 'danger', dur = 2.4) {
    const b = this.banner;
    b.querySelector('.why').textContent = why; b.querySelector('.hint').textContent = hint;
    b.querySelector('.mark').textContent = kind === 'danger' ? '!' : '✦';
    b.classList.toggle('info', kind !== 'danger');
    b.classList.remove('show', 'timed'); void b.offsetWidth;
    b.style.setProperty('--dur', `${Math.max(0.5, dur)}s`);
    b.classList.add('show'); if (dur > 0) b.classList.add('timed');
    this.bannerTimer = dur;
  }
  hideBanner() { this.banner.classList.remove('show', 'timed'); this.bannerTimer = 0; }

  /** Re-read values that only change on game start/load (name, seed, difficulty). */
  refreshStatic() {
    const g = this.ctx.getGame(); if (!g) return;
    this.q('.name').textContent = this.settings.playerName || 'Warrior';
    this.dq.seed.textContent = `${g.balance.name.toUpperCase()} · SEED ${g.seed}${g.daily ? ' · DAILY' : ''}`;
  }

  update(dt) {
    const g = this.ctx.getGame(); if (!g) return;
    const p = g.player, D = this.disp;
    // --- HP with damage trail (the pale trail lingers, then slides down to the new value)
    if (D.hp === null) { D.hp = p.hp; D.trail = p.hp; }
    const hpTarget = Math.max(0, p.hp);
    if (hpTarget > D.hp) { D.hp = hpTarget; D.trail = Math.max(D.trail, hpTarget); D.trailDelay = 0; }
    else if (hpTarget < D.hp) { D.hp = hpTarget; D.trailDelay = 0.45; }
    if (D.trail > D.hp) { if (D.trailDelay > 0) D.trailDelay -= dt; else D.trail += (D.hp - D.trail) * Math.min(1, dt * 4); if (D.trail - D.hp < 0.2) D.trail = D.hp; }
    const max = Math.max(1, p.maxHp);
    this.q('.gauge.hp .fill').style.transform = `scaleX(${Math.min(1, D.hp / max)})`;
    this.q('.gauge.hp .trail').style.transform = `scaleX(${Math.min(1, D.trail / max)})`;
    this.card.classList.toggle('low', p.hp / max < 0.3);
    setText(this.q('.hp-t'), String(p.hp)); setText(this.q('.hp-m'), String(p.maxHp));
    // --- XP
    const lo = xpForLevel(p.level), hi = xpForLevel(p.level + 1);
    D.xp += (p.xp - D.xp) * Math.min(1, dt * 5); if (Math.abs(p.xp - D.xp) < 1) D.xp = p.xp;
    this.q('.gauge.xp .fill').style.transform = `scaleX(${Math.max(0, Math.min(1, (D.xp - lo) / Math.max(1, hi - lo)))})`;
    setText(this.q('.xp-v'), fmtNum(D.xp));
    setText(this.q('.xp-next'), fmtNum(hi));
    setText(this.q('.xp-togo'), fmtNum(Math.max(0, hi - p.xp)));
    setText(this.q('.lv'), String(p.level));
    setText(this.q('.skill-v'), String(p.skill));
    setText(this.q('.kills'), String(p.kills));
    // --- gold count-up
    D.gold += (p.gold - D.gold) * Math.min(1, dt * 6); if (Math.abs(p.gold - D.gold) < 0.6) D.gold = p.gold;
    setText(this.q('.gold-v'), fmtNum(D.gold));
    // --- depth + timer
    const d = g.depth;
    setText(this.dq.n, d === 0 ? '—' : String(d));
    setText(this.dq.band, d === 0 ? 'The Surface' : (BANDS.find((b) => d <= b[0]) || BANDS[3])[1]);
    const q = g.state.quest;
    const showTimer = q.timer !== null && q.timer !== undefined;
    this.depth.classList.toggle('sword', showTimer);
    if (showTimer) {
      const rem = Math.max(0, q.timer), total = q.timerTotal || g.balance.swordTimer || 2000;
      setText(this.dq.t, formatTime(rem));
      this.dq.fuse.style.transform = `scaleX(${Math.max(0, Math.min(1, rem / total))})`;
      this.depth.classList.toggle('low', rem < 300);
      setText(this.dq.cap, p.hasSword ? "Umla's clock — climb!" : 'The sword was stolen — the clock still runs');
    } else this.depth.classList.remove('low');
    // --- hotbar counts
    for (const type of Object.keys(SPELL_TABLE)) {
      const n = p.spells[type] || 0;
      const st = p.statusEffects.find((e) => e.type === (type === 'invisibility' ? 'invisible' : type));
      this.setSlot(type, n, !!st && (type !== 'light' || st.on));
    }
    this.setSlot('potion', p.inventory.potion || 0, false);
    this.setSlot('beacon', p.inventory.beacon || 0, false);
    const light = p.statusEffects.find((e) => e.type === 'light');
    this.setSlot('toggleLight', light ? -1 : 0, !!(light && light.on));
    this.setSlot('bury', p.gold > 0 ? -1 : 0, false);
    // --- status chips
    this.updateStatus(g);
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) this.hideBanner(); }
  }

  /** count: >0 shows a badge, -1 = available without a badge, 0 = empty/greyed. */
  setSlot(id, count, active) {
    const s = this.slots[id];
    setText(s.querySelector('.cnt'), count > 0 ? String(count) : '');
    s.classList.toggle('empty', count === 0);
    s.classList.toggle('active', !!active);
  }

  updateStatus(g) {
    const p = g.player;
    const chips = [];
    for (const st of p.statusEffects) {
      if (st.type === 'shield') chips.push(['shield', 'Shielded', 'var(--sp-shield)', 'Takes no damage until the fight ends', false, 'shield']);
      else if (st.type === 'regeneration') chips.push(['regeneration', `Regeneration${st.stacks > 1 ? ' ×' + st.stacks : ''}`, 'var(--sp-regeneration)', 'Healing faster on this level', false, 'regeneration']);
      else if (st.type === 'invisible') chips.push(['invisible', 'Unseen', 'var(--sp-invisibility)', 'Monsters cannot track you', false, 'invisibility']);
      else if (st.type === 'light') chips.push(['light', st.on ? 'Light' : 'Light (off)', 'var(--sp-light)', 'Sight radius doubled; assassins revealed', !st.on, 'light']);
      else if (st.type === 'drift') chips.push(['drift', 'Drift', 'var(--sp-drift)', 'Your next fall is gentle', false, 'drift']);
    }
    if (p.hasSword) chips.push(['sword', 'The Sword', 'var(--quest)', 'Any ambush steals it. Climb!', false, 'sword']);
    if (p.enchant > 0) chips.push(['enchant', `Weapon +${p.enchant}`, 'var(--combat)', '+1 damage per enchantment', false, 'enchant']);
    if (p.maps.length) chips.push(['maps', `Maps ${p.maps.join(', ')}`, 'var(--magic)', 'Those levels will be lit on entry', false, 'maps']);
    if (g.playerOnTemple()) chips.push(['temple', 'Sanctuary', 'var(--loot)', 'Monsters ignore you; healing doubled', false, 'temple']);
    // One turn is one exchange: your blow and the monster's answer together. Rounds land every
    // 250ms, far too fast for floating text, so the count lives here where it stays readable.
    const cb = g.state && g.state.combat;
    if (cb && cb.rounds > 0) chips.push(['turn', `Turn ${cb.rounds}`, 'var(--combat)', 'One turn is your blow and the monster\'s answer together', false, 'skill']);
    const key = chips.map((c) => c[0] + c[1] + (c[4] ? 'o' : '')).join('|');
    if (key === this.statusKey) return;
    this.statusKey = key;
    this.status.innerHTML = '';
    for (const [id, name, color, tip, off, ico] of chips) {
      const c = el('div', `status ${id}${off ? ' off' : ''}`, `${icon(ico)}<span>${name}</span>`);
      c.style.setProperty('--c', color); c.title = tip; c.dataset.id = id;
      this.status.appendChild(c);
    }
  }

  dispose() { for (const u of this.unsub) u(); if (this.ro) this.ro.disconnect(); }
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function setText(node, text) { if (node && node.textContent !== text) node.textContent = text; }
function retrigger(node, cls) { if (!node) return; node.classList.remove(cls); void node.offsetWidth; node.classList.add(cls); }
