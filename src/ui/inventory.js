// Inventory / spellbook / character panel. Keyboard (arrows, WASD, vi-keys, Enter, Esc/Tab) and mouse.
import { SPELL_TABLE, ITEM_TABLE } from '../game/items.js';
import { goldCapacity } from '../game/player.js';
import { xpForLevel } from '../core/constants.js';
import { formatTime } from '../core/save.js';

const SPELL_KEYS = { teleport: '1', shield: '2', regeneration: '3', invisibility: '4', light: '5', drift: '6' };
const COLS = 4;

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
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop clear';
    this.backdrop.addEventListener('mousedown', (e) => { if (e.target === this.backdrop) this.close(); });
    this.panel = document.createElement('div');
    this.panel.className = 'panel modal wide'; this.panel.id = 'inventory';
    this.backdrop.appendChild(this.panel);
    this.ctx.root.appendChild(this.backdrop);
    window.addEventListener('keydown', this.onKey, true);
    this.render();
  }

  close() {
    if (!this.open) return;
    this.open = false;
    window.removeEventListener('keydown', this.onKey, true);
    this.backdrop.remove(); this.backdrop = null;
    this.ctx.setModal(false, 'inventory');
    this.bus.emit('sfx:ui', { kind: 'close' });
  }

  buildEntries(g) {
    const p = g.player;
    const out = [];
    for (const [type, sp] of Object.entries(SPELL_TABLE)) out.push({ id: type, name: sp.name, count: p.spells[type] || 0, color: `var(--sp-${type})`, key: SPELL_KEYS[type], desc: sp.desc, use: 'Cast', action: { action: 'cast', spell: type }, spell: true });
    out.push({ id: 'potion', name: 'Healing Potion', count: p.inventory.potion || 0, color: '#ff6b8a', key: 'Q', desc: ITEM_TABLE.potion.desc, use: 'Drink', action: { action: 'potion' }, item: true });
    out.push({ id: 'beacon', name: 'Beacon', count: p.inventory.beacon || 0, color: 'var(--mm-beacon)', key: '+', desc: ITEM_TABLE.beacon.desc, use: 'Place', action: { action: 'beacon' }, item: true });
    out.push({ id: 'sack', name: 'Magic Sack', count: p.inventory.sack || 0, color: 'var(--loot)', key: '', desc: `${ITEM_TABLE.sack.desc} You can carry ${goldCapacity(p, g.balance)} gold.`, use: 'Passive', item: true });
    out.push({ id: 'map', name: 'Magic Map', count: p.maps.length, color: 'var(--magic)', key: '', desc: p.maps.length ? `Levels ${p.maps.join(', ')} will be fully lit on entry.` : ITEM_TABLE.map.desc, use: 'Passive', item: true });
    out.push({ id: 'enchant', name: 'Enchanted Weapon', count: p.enchant, color: 'var(--combat)', key: '', desc: `${ITEM_TABLE.enchant.desc} Your blade is +${p.enchant}.`, use: 'Passive', item: true });
    out.push({ id: 'gold', name: 'Gold', count: p.gold, color: 'var(--loot)', key: '⇧B', desc: `${p.gold} of ${goldCapacity(p, g.balance)} gold. Sacrifice at a temple for 1 XP each, or bury it to keep it from thieves.`, use: 'Bury', action: { action: 'bury' }, item: true });
    return out;
  }

  render() {
    const g = this.ctx.getGame(); if (!g || !this.open) return;
    const p = g.player, s = g.state;
    this.entries = this.buildEntries(g);
    this.sel = Math.max(0, Math.min(this.entries.length - 1, this.sel));
    const cur = this.entries[this.sel];
    const cap = goldCapacity(p, g.balance);
    const rows = [
      ['Name', this.ctx.settings.playerName || 'Warrior'], ['Experience level', p.level], ['Experience', `${p.xp.toLocaleString('en-US')} / ${xpForLevel(p.level + 1).toLocaleString('en-US')}`],
      ['Hits', `${p.hp} / ${p.maxHp}`], ['Battle skill', p.skill], ['Gold', `${p.gold} / ${cap}`], ['Dungeon level', g.depth], ['Deepest', s.deepest],
      ['Monsters slain', p.kills], ['Quest time', formatTime(s.elapsed)], ['Difficulty', g.balance.name], ['Seed', g.seed],
    ];
    this.panel.innerHTML = `<div class="corners"><i></i><i></i><i></i><i></i></div>
      <h1 class="gold-text">Inventory</h1><div class="subtitle">Spellbook · Satchel · Character</div>
      <div class="cols">
        <div class="char"><h2>Character</h2>${rows.map((r) => `<div class="cr"><span>${r[0]}</span><span>${r[1]}</span></div>`).join('')}
          ${p.hasSword ? '<div class="sword">✦ You carry the Sword of Fargoal ✦</div>' : ''}
        </div>
        <div>
          <h2>Spells</h2><div class="grid spells">${this.entries.filter((e) => e.spell).map((e, i) => this.slot(e, i)).join('')}</div>
          <h2>Satchel</h2><div class="grid items">${this.entries.filter((e) => e.item).map((e, i) => this.slot(e, i + 6)).join('')}</div>
          <div class="desc"><div class="dn">${cur.name}${cur.count ? ` <span class="num" style="color:#fff">×${cur.count}</span>` : ''}</div><div class="dd">${cur.desc}</div>
            <div class="du">${cur.action ? (cur.count > 0 ? `Enter · ${cur.use}${cur.key ? ` (${cur.key})` : ''}` : 'None left') : cur.use}</div></div>
        </div>
      </div>
      <div class="hint-bar"><kbd>↑↓←→</kbd> select &nbsp; <kbd>Enter</kbd> use &nbsp; <kbd>Tab</kbd>/<kbd>Esc</kbd> close</div>`;
    this.panel.querySelectorAll('.it').forEach((n) => {
      const i = Number(n.dataset.i);
      n.addEventListener('mouseenter', () => { if (this.sel !== i) { this.sel = i; this.render(); } });
      n.addEventListener('click', () => { this.sel = i; this.activate(); });
    });
  }

  slot(e, i) {
    return `<button class="it${e.count ? '' : ' empty'}${i === this.sel ? ' selected' : ''}" data-i="${i}" style="--c:${e.color}"><span class="key">${e.key}</span><span class="rune${e.item ? ' item' : ''}"></span><span class="nm">${e.name}</span><span class="cnt">${e.count || ''}</span></button>`;
  }

  activate() {
    const e = this.entries[this.sel];
    if (!e || !e.action || !e.count) { this.bus.emit('sfx:ui', { kind: 'hover' }); return; }
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
      if (dy) { const j = i + dy * COLS; if (j >= 0 && j < n) i = j; else if (dy > 0 && i < 6) i = Math.min(n - 1, i + COLS + 2); else if (dy < 0 && i >= 6) i = Math.max(0, i - COLS - 2); }
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
  }

  update() { if (this.open) { const g = this.ctx.getGame(); if (g && this.lastHp !== g.player.hp) { this.lastHp = g.player.hp; this.render(); } } }
  dispose() { this.close(); for (const u of this.unsub) u(); }
}
