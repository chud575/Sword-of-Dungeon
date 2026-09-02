// HUD: character card (HP with damage trail, XP, gold count-up), depth banner + Sword countdown,
// spell/item hotbar with counts and hotkeys, status-effect chips, quick buttons and the auto-pause
// banner. Pure DOM; reads the Game on update() and reacts to bus events for one-shot animations.
import { SPELL_TABLE, ITEM_TABLE } from '../game/items.js';
import { xpForLevel } from '../core/constants.js';
import { formatTime } from '../core/save.js';

const SPELL_KEYS = { teleport: '1', shield: '2', regeneration: '3', invisibility: '4', light: '5', drift: '6' };
const BANDS = [[5, 'The Upper Halls'], [12, 'The Cold Deep'], [18, 'The Black Roots'], [Infinity, "Umla's Domain"]];

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
const corners = () => '<div class="corners"><i></i><i></i><i></i><i></i></div>';

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
    this.build();
    this.bind();
  }

  build() {
    const root = this.ctx.root;
    // character card
    this.card = el('div', 'panel hud', corners() + `
      <div class="head"><div class="medal"><span class="lv num">1</span><span class="lvl">LVL</span></div>
        <div class="who"><div class="name">Warrior</div><div class="sub"><span>Skill <b class="skill-v num">8</b></span><span>Slain <b class="kills num">0</b></span></div></div></div>
      <div class="bar hp"><div class="trail"></div><div class="fill"></div><div class="txt"><span class="cap">Hits</span><span class="hp-t num">12 / 12</span></div></div>
      <div class="bar xp"><div class="fill"></div></div>
      <div class="row"><span class="xp-t"><span class="label">Exp</span> <span class="num xp-v">0</span> <small style="color:var(--parchment-faint)">/ <span class="num xp-next">200</span></small></span>
        <span class="gold"><span class="num gold-v">0</span><small>gp</small></span></div>`);
    this.card.id = 'hud-card';
    root.appendChild(this.card);
    this.q = (s) => this.card.querySelector(s);
    // status chips
    this.status = el('div', 'hud'); this.status.id = 'hud-status'; root.appendChild(this.status);
    // depth + timer
    this.depth = el('div', 'panel hud', corners() + `
      <div class="depth">DUNGEON LEVEL <span class="n num">1</span></div><div class="band">The Upper Halls</div><div class="seed"></div>
      <div class="timer"><div class="cap">Umla's clock</div><div class="t num">33:20</div><div class="fuse"><div class="f"></div></div></div>`);
    this.depth.id = 'hud-depth'; root.appendChild(this.depth);
    // hotbar
    this.hotbar = el('div', 'panel hud'); this.hotbar.id = 'hud-hotbar'; root.appendChild(this.hotbar);
    this.slots = {};
    const mk = (id, name, key, color, action, isItem) => {
      const s = el('button', 'slot' + (isItem ? ' item-slot' : ''), `<span class="key">${key}</span><span class="rune${isItem ? ' item' : ''}"></span><span class="nm">${name}</span><span class="cnt"></span>`);
      s.style.setProperty('--c', color); s.title = name; s.dataset.id = id;
      s.addEventListener('click', () => { this.bus.emit('sfx:ui', { kind: 'click' }); this.bus.emit('input:action', action); s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); });
      s.addEventListener('mouseenter', () => this.bus.emit('sfx:ui', { kind: 'hover' }));
      this.hotbar.appendChild(s); this.slots[id] = s; return s;
    };
    const SHORT = { teleport: 'Teleport', shield: 'Shield', regeneration: 'Regen', invisibility: 'Unseen', light: 'Light', drift: 'Drift' };
    for (const [type, sp] of Object.entries(SPELL_TABLE)) { const s = mk(type, SHORT[type] || sp.name, SPELL_KEYS[type], `var(--sp-${type})`, { action: 'cast', spell: type }, false); s.title = `${sp.name} — ${sp.desc}`; }
    this.hotbar.appendChild(el('div', 'sep'));
    mk('potion', 'Potion', 'Q', '#ff6b8a', { action: 'potion' }, true);
    mk('beacon', 'Beacon', '+', 'var(--mm-beacon)', { action: 'beacon' }, true);
    this.hotbar.appendChild(el('div', 'sep'));
    mk('toggleLight', 'Lamp', 'O', 'var(--sp-light)', { action: 'toggleLight' }, true);
    mk('bury', 'Bury', '⇧B', 'var(--loot)', { action: 'bury' }, true);
    mk('wait', 'Rest', 'Z', 'var(--info)', { action: 'wait' }, true);
    // quick buttons
    this.quick = el('div', 'panel hud'); this.quick.id = 'hud-quick'; root.appendChild(this.quick);
    const qb = (id, name, key, action) => { const b = el('button', 'qb', `<span>${name}</span><kbd>${key}</kbd>`); b.dataset.id = id; b.addEventListener('click', () => { this.bus.emit('sfx:ui', { kind: 'click' }); this.bus.emit('input:action', action); }); this.quick.appendChild(b); return b; };
    this.exploreBtn = qb('explore', 'Explore', 'X', { action: 'explore' });
    qb('minimap', 'Map', 'M', { action: 'minimap' });
    qb('inventory', 'Inventory', 'Tab', { action: 'inventory' });
    qb('help', 'Help', '?', { action: 'help' });
    qb('pause', 'Menu', 'Esc', { action: 'pause' });
    // banner
    this.banner = el('div', 'panel hud', corners() + '<div class="mark">!</div><div class="why"></div><div class="hint"></div>');
    this.banner.id = 'hud-banner'; root.appendChild(this.banner);
  }

  bind() {
    const on = (n, f) => this.unsub.push(this.bus.on(n, f));
    on('player:hp', (p) => { if (p.delta < 0) { this.card.classList.remove('hurt'); void this.card.offsetWidth; this.card.classList.add('hurt'); } });
    on('player:xp', (p) => { if (p.leveledUp) { const m = this.q('.medal'); m.classList.remove('levelup'); void m.offsetWidth; m.classList.add('levelup'); } });
    on('player:gold', (p) => { if (p.delta > 0) { const g = this.q('.gold'); g.classList.remove('bump'); void g.offsetWidth; g.classList.add('bump'); } });
    on('spell:cast', (p) => this.flash(p.spell));
    on('item:used', (p) => this.flash(p.item && p.item.type));
    on('level:enter', () => { const g = this.ctx.getGame(); this.levelEnterTime = g ? g.state.time : 0; this.autoPaused = false; });
    on('monster:seen', (p) => this.onMonsterSeen(p));
    on('game:paused', (p) => { if (!p.paused && this.autoPaused) { this.autoPaused = false; this.hideBanner(); } }); // e.g. Esc resumes an auto-pause: drop the sticky banner
    on('game:start', () => { this.autoPaused = false; this.disp.hp = null; this.disp.trail = null; this.refreshStatic(); });
    on('ui:explore', (p) => this.exploreBtn.classList.toggle('on', !!p.on));
    const resume = () => { if (!this.autoPaused) return; const g = this.ctx.getGame(); this.autoPaused = false; this.hideBanner(); if (this.ctx.isModal && this.ctx.isModal()) return; if (g && g.paused) g.setPaused(false); };
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') return; resume(); });
    window.addEventListener('pointerdown', resume);
  }

  flash(id) { const s = this.slots[id]; if (!s) return; s.classList.remove('flash'); void s.offsetWidth; s.classList.add('flash'); }

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
    this.depth.querySelector('.seed').textContent = `${g.balance.name.toUpperCase()} · SEED ${g.seed}${g.daily ? ' · DAILY' : ''}`;
  }

  update(dt) {
    const g = this.ctx.getGame(); if (!g) return;
    const p = g.player, D = this.disp;
    // --- HP with damage trail
    if (D.hp === null) { D.hp = p.hp; D.trail = p.hp; }
    const hpTarget = Math.max(0, p.hp);
    if (hpTarget > D.hp) { D.hp = hpTarget; D.trail = Math.max(D.trail, hpTarget); D.trailDelay = 0; }
    else if (hpTarget < D.hp) { D.hp = hpTarget; D.trailDelay = 0.45; }
    if (D.trail > D.hp) { if (D.trailDelay > 0) D.trailDelay -= dt; else D.trail += (D.hp - D.trail) * Math.min(1, dt * 4); if (D.trail - D.hp < 0.2) D.trail = D.hp; }
    const max = Math.max(1, p.maxHp);
    const hpBar = this.q('.bar.hp');
    hpBar.querySelector('.fill').style.transform = `scaleX(${Math.min(1, D.hp / max)})`;
    hpBar.querySelector('.trail').style.transform = `scaleX(${Math.min(1, D.trail / max)})`;
    hpBar.classList.toggle('low', p.hp / max < 0.3);
    this.q('.hp-t').textContent = `${p.hp} / ${p.maxHp}`;
    // --- XP
    const lo = xpForLevel(p.level), hi = xpForLevel(p.level + 1);
    D.xp += (p.xp - D.xp) * Math.min(1, dt * 5); if (Math.abs(p.xp - D.xp) < 1) D.xp = p.xp;
    this.q('.bar.xp .fill').style.transform = `scaleX(${Math.max(0, Math.min(1, (D.xp - lo) / Math.max(1, hi - lo)))})`;
    this.q('.xp-v').textContent = Math.round(D.xp).toLocaleString('en-US');
    this.q('.xp-next').textContent = hi.toLocaleString('en-US');
    this.q('.lv').textContent = String(p.level);
    this.q('.skill-v').textContent = String(p.skill);
    this.q('.kills').textContent = String(p.kills);
    // --- gold count-up
    D.gold += (p.gold - D.gold) * Math.min(1, dt * 6); if (Math.abs(p.gold - D.gold) < 0.6) D.gold = p.gold;
    this.q('.gold-v').textContent = String(Math.round(D.gold));
    // --- depth + timer
    const d = g.depth;
    this.depth.querySelector('.n').textContent = d === 0 ? '—' : String(d);
    this.depth.querySelector('.band').textContent = d === 0 ? 'The Surface' : (BANDS.find((b) => d <= b[0]) || BANDS[3])[1];
    const q = g.state.quest;
    const showTimer = q.timer !== null && q.timer !== undefined;
    this.depth.classList.toggle('sword', showTimer);
    if (showTimer) {
      const rem = Math.max(0, q.timer), total = q.timerTotal || g.balance.swordTimer || 2000;
      this.depth.querySelector('.timer .t').textContent = formatTime(rem);
      this.depth.querySelector('.fuse .f').style.transform = `scaleX(${Math.max(0, Math.min(1, rem / total))})`;
      this.depth.classList.toggle('low', rem < 300);
      this.depth.querySelector('.timer .cap').textContent = p.hasSword ? "Umla's clock — climb!" : 'The sword was stolen — the clock still runs';
    } else this.depth.classList.remove('low');
    // --- hotbar counts
    for (const type of Object.keys(SPELL_TABLE)) {
      const s = this.slots[type], n = p.spells[type] || 0;
      s.querySelector('.cnt').textContent = n ? String(n) : '';
      s.classList.toggle('empty', n === 0);
      const st = p.statusEffects.find((e) => e.type === (type === 'invisibility' ? 'invisible' : type));
      s.classList.toggle('active', !!st && (type !== 'light' || st.on));
    }
    this.slots.potion.querySelector('.cnt').textContent = p.inventory.potion ? String(p.inventory.potion) : '';
    this.slots.potion.classList.toggle('empty', !p.inventory.potion);
    this.slots.beacon.querySelector('.cnt').textContent = p.inventory.beacon ? String(p.inventory.beacon) : '';
    this.slots.beacon.classList.toggle('empty', !p.inventory.beacon);
    const light = p.statusEffects.find((e) => e.type === 'light');
    this.slots.toggleLight.classList.toggle('empty', !light);
    this.slots.toggleLight.classList.toggle('active', !!(light && light.on));
    this.slots.bury.classList.toggle('empty', p.gold <= 0);
    // --- status chips
    this.updateStatus(g);
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) this.hideBanner(); }
  }

  updateStatus(g) {
    const p = g.player;
    const chips = [];
    for (const st of p.statusEffects) {
      if (st.type === 'shield') chips.push(['shield', 'Shielded', 'var(--sp-shield)', 'Takes no damage until the fight ends']);
      else if (st.type === 'regeneration') chips.push(['regeneration', `Regeneration${st.stacks > 1 ? ' ×' + st.stacks : ''}`, 'var(--sp-regeneration)', 'Healing faster on this level']);
      else if (st.type === 'invisible') chips.push(['invisible', 'Unseen', 'var(--sp-invisibility)', 'Monsters cannot track you']);
      else if (st.type === 'light') chips.push(['light', st.on ? 'Light' : 'Light (off)', 'var(--sp-light)', 'Sight radius doubled; assassins revealed', !st.on]);
      else if (st.type === 'drift') chips.push(['drift', 'Drift', 'var(--sp-drift)', 'Your next fall is gentle']);
    }
    if (p.hasSword) chips.push(['sword', 'The Sword', 'var(--quest)', 'Any ambush steals it. Climb!']);
    if (p.enchant > 0) chips.push(['enchant', `Weapon +${p.enchant}`, 'var(--combat)', '+1 damage per enchantment']);
    if (p.maps.length) chips.push(['maps', `Maps: ${p.maps.map((m) => m).join(', ')}`, 'var(--magic)', 'Those levels will be lit on entry']);
    if (g.playerOnTemple()) chips.push(['temple', 'Sanctuary', 'var(--loot)', 'Monsters ignore you; healing doubled']);
    const key = chips.map((c) => c[0] + c[1] + (c[4] ? 'o' : '')).join('|');
    if (key === this.statusKey) return;
    this.statusKey = key;
    this.status.innerHTML = '';
    for (const [id, name, color, tip, off] of chips) {
      const c = el('div', 'status' + (off ? ' off' : ''), `<i></i><span>${name}</span>`);
      c.style.setProperty('--c', color); c.title = tip; c.dataset.id = id;
      this.status.appendChild(c);
    }
  }

  dispose() { for (const u of this.unsub) u(); }
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
