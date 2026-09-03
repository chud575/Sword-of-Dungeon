// Inventory / spellbook / satchel / character sheet. Keyboard (arrows, WASD, vi-keys, Enter,
// hotkeys 1-6/Q/B, Esc/Tab) and mouse. Pure DOM; reads the Game on render() and emits
// 'input:action' to use things. Styles live in ./panels.css.
import './panels.css';
import { SPELL_TABLE, ITEM_TABLE, sightRadius } from '../game/items.js';
import { goldCapacity, getStatus } from '../game/player.js';
import { xpForLevel } from '../core/constants.js';
import { formatTime } from '../core/save.js';
import { icon } from './icons.js';

const SPELL_KEYS = { teleport: '1', shield: '2', regeneration: '3', invisibility: '4', light: '5', drift: '6' };
const COLS = 3;

/** Flavour text per entry — the manual never had it; the remake's "Book of Lore" does. */
const LORE = {
  teleport: 'Umla’s own trick, copied by hedge-wizards: fold the dungeon in half and step through the crease.',
  shield: 'A shimmer of borrowed steel around the skin. It holds until the blood stops flowing.',
  regeneration: 'Green motes knit flesh while you walk. Twice as fast, for as long as you stay on this level.',
  invisibility: 'The monsters see only the torchlight — and then not even that.',
  light: 'A cold, clean flame that fears nothing. Not even an assassin can hide from it.',
  drift: 'Feathers where there should be stone. The fall forgets you.',
  potion: 'Bitter, warm, and quicker than any temple. Your body drinks it for you when death is near.',
  beacon: 'A green cross scratched into the flagstones. Teleports remember it; monsters do not.',
  sack: 'Bottomless, or near enough. A hundred more coins vanish into the weave.',
  map: 'A deeper level, drawn in a careful hand by someone who never came back up.',
  enchant: 'Runes along the fuller. The blade bites harder with every enchantment laid on it.',
  gold: 'Thieves want it. Gedwyn’s temple wants it more — one point of experience per coin.',
};
const TITLES = [[1, 'of the village'], [3, 'the Delver'], [5, 'Slayer of Beasts'], [8, 'the Deep-Walker'], [11, 'Bane of Umla'], [Infinity, 'Legend of Fargoal']];

function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; }
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export class InventoryPanel {
  /** @param {{root:HTMLElement, bus:import('../core/events.js').EventBus, getGame:()=>any, settings:object, setModal:(open:boolean, who:string)=>void}} ctx */
  constructor(ctx) {
    this.ctx = ctx; this.bus = ctx.bus;
    this.open = false; this.sel = 0; this.entries = [];
    this.onKey = (e) => this.key(e);
    this.unsub = [this.bus.on('game:start', () => { if (this.open) this.close(); })];
  }

  toggle() { if (this.open) this.close(); else this.show(); }

  show() {
    const g = this.ctx.getGame(); if (!g || this.open) return;
    this.open = true;
    this.ctx.setModal(true, 'inventory');
    this.bus.emit('sfx:ui', { kind: 'open' });
    this.backdrop = el('div', 'modal-backdrop clear pxbd');
    this.backdrop.addEventListener('mousedown', (e) => { if (e.target === this.backdrop) this.close(); });
    this.panel = el('div', 'panel modal wide px'); this.panel.id = 'inventory';
    this.backdrop.appendChild(this.panel);
    this.ctx.root.appendChild(this.backdrop);
    window.addEventListener('keydown', this.onKey, true);
    this.built = false;
    this.render();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    window.removeEventListener('keydown', this.onKey, true);
    this.backdrop.remove(); this.backdrop = null; this.panel = null;
    this.ctx.setModal(false, 'inventory');
    this.bus.emit('sfx:ui', { kind: 'close' });
  }

  /** Everything the player carries, as slot entries (0-5 spells, 6-11 satchel). */
  buildEntries(g) {
    const p = g.player, depth = Math.max(1, g.depth), lv = g.level;
    const cap = goldCapacity(p, g.balance);
    const out = [];
    const st = (type) => getStatus(p, type);
    for (const [type, sp] of Object.entries(SPELL_TABLE)) {
      const e = { id: type, name: sp.name, count: p.spells[type] || 0, color: `var(--sp-${type})`, key: SPELL_KEYS[type], desc: sp.desc, lore: LORE[type], use: 'Cast', action: { action: 'cast', spell: type }, spell: true, kind: 'Spell', ico: type, rows: [], active: false, status: '' };
      if (type === 'teleport') { e.rows.push(['Destination', lv && lv.beacon ? 'Your beacon' : `Random tile, level ${depth}`]); e.rows.push(['Also', 'Ends any fight']); }
      if (type === 'shield') { const s = st('shield'); e.active = !!s; e.status = s ? 'Shimmering' : ''; e.rows.push(['Blocks', 'All damage, next fight'], ['Lasts', 'Until the fight ends']); }
      if (type === 'regeneration') { const s = st('regeneration'); e.active = !!s; e.status = s ? `Active ×${s.stacks || 1}` : ''; e.rows.push(['Healing', s ? `×${2 ** (s.stacks || 1)} on this level` : '×2 on this level', 'good'], ['Lasts', 'Until you leave the level']); }
      if (type === 'invisibility') { const s = st('invisible'); e.active = !!s; e.status = s ? 'Unseen' : ''; e.rows.push(['Effect', 'Monsters lose you'], ['Breaks', 'On a kill, or Light']); }
      if (type === 'light') { const s = st('light'); e.active = !!(s && s.on); e.status = s ? (s.on ? 'Burning' : 'Shuttered') : ''; e.rows.push(['Sight radius', s && s.on ? `${sightRadius(g)}` : `${g.balance.fovRadius} → ${g.balance.lightFovRadius}`], ['Reveals', 'Assassins'], ['Lasts', 'Rest of this level']); }
      if (type === 'drift') { const s = st('drift'); e.active = !!s; e.status = s ? 'Ready' : ''; e.rows.push(['Next fall', 'No damage', 'good'], ['Pits drop you', '2–5 levels']); }
      out.push(e);
    }
    const potionMin = 3 * depth, potionMax = 3 * depth + 19;
    out.push({ id: 'potion', name: 'Healing Potion', count: p.inventory.potion || 0, color: '#ff6b8a', key: 'Q', desc: ITEM_TABLE.potion.desc, lore: LORE.potion, use: 'Drink', action: { action: 'potion' }, item: true, kind: 'Consumable', ico: 'potion',
      rows: [['Heals', `${potionMin}–${potionMax} hits`, 'good'], ['Your hits', `${p.hp} / ${p.maxHp}`, p.hp < p.maxHp * 0.3 ? 'warn' : ''], ['Auto-drunk', 'Below 0 hits, out of combat']] });
    out.push({ id: 'beacon', name: 'Beacon', count: p.inventory.beacon || 0, color: 'var(--mm-beacon)', key: '+', desc: ITEM_TABLE.beacon.desc, lore: LORE.beacon, use: 'Place here', action: { action: 'beacon' }, item: true, kind: 'Placeable', ico: 'beacon',
      rows: [['Placed', lv && lv.beacon ? `At ${lv.beacon.x}, ${lv.beacon.y}` : 'None on this level'], ['Teleports', 'Arrive on it'], ['Monsters', 'Cannot see you on it', 'good']] });
    out.push({ id: 'sack', name: 'Magic Sack', count: p.inventory.sack || 0, color: 'var(--loot)', key: '', desc: ITEM_TABLE.sack.desc, lore: LORE.sack, use: 'Passive', item: true, kind: 'Passive', ico: 'coin',
      rows: [['Gold capacity', `${cap}`], ['Per sack', `+${g.balance.sackCapacity}`]] });
    out.push({ id: 'map', name: 'Magic Map', count: p.maps.length, color: 'var(--magic)', key: '', desc: ITEM_TABLE.map.desc, lore: LORE.map, use: 'Passive', item: true, kind: 'Passive', ico: 'maps',
      rows: [['Charted levels', p.maps.length ? p.maps.slice().sort((a, b) => a - b).join(', ') : 'None'], ['On entry', 'Whole level lit']] });
    out.push({ id: 'enchant', name: 'Enchanted Weapon', count: p.enchant, color: 'var(--combat)', key: '', desc: ITEM_TABLE.enchant.desc, lore: LORE.enchant, use: 'Passive', item: true, kind: 'Passive', ico: 'enchant',
      rows: [['Blade', `+${p.enchant}`], ['Bonus damage', `+${p.enchant} per hit`, p.enchant ? 'good' : ''], ['Battle skill', `${p.skill}`]] });
    out.push({ id: 'gold', name: 'Gold', count: p.gold, color: 'var(--loot)', key: 'B', desc: 'Sacrifice it at a temple for experience, or bury it here to keep it from thieves.', lore: LORE.gold, use: 'Bury here', action: { action: 'bury' }, item: true, kind: 'Treasure', ico: 'coin',
      rows: [['Carried', `${p.gold} / ${cap}`, p.gold >= cap ? 'warn' : ''], ['At a temple', `+${p.gold} xp`, 'good'], ['Buried here', lv ? `${lv.buriedCount || 0} cache${(lv.buriedCount || 0) === 1 ? '' : 's'}` : '—']] });
    return out;
  }

  render() {
    const g = this.ctx.getGame(); if (!g || !this.open) return;
    const p = g.player, s = g.state;
    this.entries = this.buildEntries(g);
    this.sel = Math.max(0, Math.min(this.entries.length - 1, this.sel));
    const cur = this.entries[this.sel];
    const cap = goldCapacity(p, g.balance);
    const lo = xpForLevel(p.level), hi = xpForLevel(p.level + 1);
    const title = (TITLES.find((t) => p.level <= t[0]) || TITLES[TITLES.length - 1])[1];
    const spellCount = Object.values(p.spells).reduce((a, b) => a + (b || 0), 0);
    const itemCount = (p.inventory.potion || 0) + (p.inventory.beacon || 0);
    const rows = [
      ['skill', 'Battle skill', `${p.skill}`],
      ['skull', 'Monsters slain', `${p.kills}`],
      ['coin', 'Gold', `<span class="v gold">${p.gold} <small>/ ${cap}</small></span>`, true],
      ['stairs', 'Dungeon level', `${g.depth} <small>· deepest ${s.deepest}</small>`],
      ['hourglass', 'Quest time', formatTime(s.elapsed)],
      ['enchant', 'Weapon', p.enchant ? `<span class="v up">+${p.enchant}</span>` : '+0', true],
    ];
    this.panel.innerHTML = `<div class="corners"><i></i><i></i><i></i><i></i></div><div class="filet"></div>
      <div class="mhead"><div class="eyebrow">Spellbook · Satchel · Character</div><h1>Inventory</h1>
        <div class="subtitle"><b>${spellCount}</b> spell${spellCount === 1 ? '' : 's'} · <b>${itemCount}</b> item${itemCount === 1 ? '' : 's'} · <b>${p.gold}</b> gold</div>
        <div class="orn"><i></i><b></b><i></i></div></div>
      <div class="cols">
        <div class="char">
          <div class="who"><div class="medal"><span class="lv num">${p.level}</span><span class="lvl">Level</span></div>
            <div><div class="name">${esc(this.ctx.settings.playerName || 'Warrior')}</div><div class="title">Warrior ${title}</div></div></div>
          <div class="gauge hp"><div class="lab"><span class="cap">Hits</span><span class="num">${p.hp} <small>/ ${p.maxHp}</small></span></div>
            <div class="frame"><div class="fill" style="transform:scaleX(${Math.max(0, Math.min(1, p.hp / Math.max(1, p.maxHp)))})"></div><div class="ticks"></div></div><i class="end l"></i><i class="end r"></i></div>
          <div class="gauge xp"><div class="lab"><span class="cap">Experience</span><span class="num">${fmt(p.xp)} <small>/ ${fmt(hi)}</small></span></div>
            <div class="frame"><div class="fill" style="transform:scaleX(${Math.max(0, Math.min(1, (p.xp - lo) / Math.max(1, hi - lo)))})"></div></div><i class="end l"></i><i class="end r"></i></div>
          <div class="sheet">${rows.map((r) => `<div class="cr">${icon(r[0])}<span class="k">${r[1]}</span>${r[3] ? r[2] : `<span class="v">${r[2]}</span>`}</div>`).join('')}</div>
          <div class="foot-meta"><span>${esc(g.balance.name)}${g.daily ? ' · daily' : ''}</span><span>Seed <b>${g.seed}</b></span></div>
          ${p.hasSword ? `<div class="sword">${icon('sword')} The Sword of Fargoal<small>Any ambush steals it. Climb.</small></div>` : ''}
        </div>
        <div class="mid">
          <h2>${icon('teleport')}Spellbook <small>1–6</small></h2><div class="grid spells">${this.entries.filter((e) => e.spell).map((e, i) => this.slot(e, i)).join('')}</div>
          <h2>${icon('potion')}Satchel <small>Q · B</small></h2><div class="grid items">${this.entries.filter((e) => e.item).map((e, i) => this.slot(e, i + 6)).join('')}</div>
          <h2>${icon('star')}Counsel</h2><div class="counsel">${this.counsel(g).map((c) => `<div class="cl" style="--c:${c[2]}">${icon(c[0])}<span>${c[1]}</span></div>`).join('')}</div>
        </div>
        <div class="detail" style="--c:${cur.color}">
          <div class="big">${icon(cur.ico)}${cur.count ? `<span class="n">×${cur.count}</span>` : ''}</div>
          <div class="kind">${cur.kind}${cur.status ? ` · ${cur.status}` : ''}</div>
          <div class="dn">${cur.name}</div>
          <div class="lore">${cur.lore}</div>
          <div class="eff">${cur.rows.map((r) => `<div class="er${r[2] ? ' ' + r[2] : ''}"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}</div>
          <div class="actions">${cur.action
            ? `<button class="act primary" data-act="use"${cur.count > 0 ? '' : ' disabled'}><span>${cur.count > 0 ? cur.use : 'None left'}</span><kbd>${cur.key || 'Enter'}</kbd></button>`
            : `<div class="passive">Works on its own</div>`}
            <button class="act" data-act="close"><span>Close</span><kbd>Tab</kbd></button></div>
        </div>
      </div>
      <div class="hint-bar"><span><kbd>↑↓←→</kbd> select</span><span><kbd>Enter</kbd> use</span><span><kbd>1–6</kbd> cast</span><span><kbd>Q</kbd> potion</span><span><kbd>B</kbd> bury gold</span><span><kbd>Tab</kbd>/<kbd>Esc</kbd> close</span></div>`;
    this.panel.querySelectorAll('.it').forEach((n) => {
      const i = Number(n.dataset.i);
      n.addEventListener('mouseenter', () => { if (this.sel !== i) { this.sel = i; this.bus.emit('sfx:ui', { kind: 'hover' }); this.render(); } });
      n.addEventListener('click', () => { this.sel = i; this.activate(); });
    });
    const use = this.panel.querySelector('[data-act=use]'); if (use) use.addEventListener('click', () => this.activate());
    this.panel.querySelector('[data-act=close]').addEventListener('click', () => this.close());
    this.lastHp = p.hp;
  }

  /** Two or three context-aware tips (the manual's advice, applied to the current situation). */
  counsel(g) {
    const p = g.player, lv = g.level, out = [];
    const togo = Math.max(0, xpForLevel(p.level + 1) - p.xp);
    if (p.hasSword) out.push(['sword', 'You hold the Sword. Never let a monster strike first — find stairs going up as fast as you can.', 'var(--quest)']);
    if (p.hp < p.maxHp * 0.4) out.push(['heart', `You are badly hurt: rest on a temple (heals twice as fast)${p.inventory.potion ? ' or drink a potion' : ''}.`, 'var(--danger)']);
    if (p.gold > 0) out.push(['temple', `${p.gold} gold sacrificed at a temple is worth ${p.gold} experience${togo <= p.gold ? ' — enough for your next level' : ` (${fmt(togo)} to go)`}.`, 'var(--loot)']);
    if (!p.inventory.potion) out.push(['potion', 'No potions left. Below zero hits outside a fight there is nothing to catch you.', 'var(--combat)']);
    if (p.maps.length && !p.maps.includes(g.depth)) { const next = p.maps.filter((d) => d > g.depth).sort((a, b) => a - b)[0]; if (next) out.push(['maps', `Your map will light level ${next} the moment you arrive.`, 'var(--magic)']); }
    if (lv && lv.beacon && !(lv.beacon.x === p.x && lv.beacon.y === p.y)) out.push(['beacon', 'A beacon is set on this level: Teleport takes you straight to it.', 'var(--mm-beacon)']);
    if (out.length < 2) out.push(['alert', 'Corridors are one tile wide — fight in them so monsters come at you one at a time.', 'var(--info)']);
    if (out.length < 2) out.push(['skull', 'Hidden treasure squares are traps 44% of the time. Auto-explore never steps on them.', 'var(--info)']);
    return out.slice(0, 3);
  }

  slot(e, i) {
    const status = e.count ? (e.status || (e.spell ? 'Ready to cast' : e.action ? `Press ${e.key}` : 'Always on')) : (e.spell ? 'Not learned' : 'None');
    return `<button class="it${e.count ? '' : ' empty'}${i === this.sel ? ' selected' : ''}${e.active ? ' active' : ''}" data-i="${i}" style="--c:${e.color};--i:${i}" title="${e.name}">
      <span class="key">${e.key}</span><span class="glyph">${icon(e.ico)}</span><span class="tx"><span class="nm">${e.name}</span><span class="st">${status}</span></span><span class="cnt">${e.count > 0 ? e.count : ''}</span></button>`;
  }

  activate() {
    const e = this.entries[this.sel];
    if (!e || !e.action || !e.count) { this.bus.emit('sfx:ui', { kind: 'hover' }); if (this.open) this.render(); return; }
    this.close();
    this.bus.emit('input:action', e.action);
  }

  key(e) {
    if (!this.open) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const k = e.key;
    const move = (dx, dy) => {
      const n = this.entries.length;
      let i = this.sel;
      if (dx) i = (i + dx + n) % n;
      if (dy) {
        const j = i + dy * COLS;
        if (j >= 0 && j < n) i = j;
        else i = dy > 0 ? i % COLS : n - COLS + (i % COLS); // wrap vertically, keeping the column
      }
      if (i !== this.sel) { this.sel = i; this.bus.emit('sfx:ui', { kind: 'hover' }); this.render(); }
    };
    if (k === 'Escape' || k === 'Tab' || k === 'i' || k === 'I') this.close();
    else if (k === 'ArrowLeft' || k === 'a' || k === 'h') move(-1, 0);
    else if (k === 'ArrowRight' || k === 'd' || k === 'l') move(1, 0);
    else if (k === 'ArrowUp' || k === 'w' || k === 'k') move(0, -1);
    else if (k === 'ArrowDown' || k === 's' || k === 'j') move(0, 1);
    else if (k === 'Enter' || k === ' ') this.activate();
    else if (/^[1-6]$/.test(k)) { this.sel = Number(k) - 1; this.activate(); }
    else if (k === 'q' || k === 'Q') { this.sel = 6; this.activate(); }
    else if (k === '+') { this.sel = 7; this.activate(); }
    else if (k === 'b' || k === 'B') { this.sel = 11; this.activate(); }
  }

  update() { if (this.open) { const g = this.ctx.getGame(); if (g && this.lastHp !== g.player.hp) { this.lastHp = g.player.hp; this.render(); } } }
  dispose() { this.close(); for (const u of this.unsub) u(); }
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
