// Hover tooltips for tiles, monsters and items (mouse -> tile via the renderer's picking, which
// the Input module already performs and broadcasts as 'input:hover').
import { TILE } from '../core/constants.js';
import { ITEM_TABLE } from '../game/items.js';
import { dangerBand } from '../game/combat.js';
import { MONSTERS_BY_TYPE } from '../game/monsters.js';

const TILE_INFO = {
  [TILE.FLOOR]: ['Flagstones', 'floor', ''],
  [TILE.CORRIDOR]: ['Winding corridor', 'passage', 'One tile wide. Monsters must come at you one at a time.'],
  [TILE.DOOR]: ['Doorway', 'passage', ''],
  [TILE.WALL]: ['Rock', 'wall', 'Solid stone.'],
  [TILE.STAIRS_DOWN]: ['Stairs going down', 'stairs', 'Stand on them and press Space (or click) to descend. Descending grants experience.'],
  [TILE.STAIRS_UP]: ['Stairs going up', 'stairs', 'Climb back toward the surface. The way out of level 1 opens only for the Sword.'],
  [TILE.TEMPLE]: ['Temple', 'sanctuary', 'Monsters ignore you here and you heal twice as fast. Press Space to sacrifice all your gold: 1 gold = 1 experience.'],
  [TILE.PIT]: ['Open pit', 'hazard', 'Walk in to climb down 2–5 levels — half the time you fall and take damage. A Drift spell makes the fall gentle.'],
  [TILE.WATER]: ['Cistern water', 'water', 'Cold, dark and knee-deep.'],
  [TILE.TRAP_TELEPORT]: ['Teleport trap (sprung)', 'hazard', 'Stepping here again teleports you somewhere random on this level.'],
  [TILE.TRAP_PIT]: ['Pit trap (sprung)', 'hazard', 'The floor is gone. You will fall through.'],
  [TILE.RUBBLE]: ['Hole in the ceiling', 'debris', 'A ceiling trap fell here. Safe now.'],
};
const DANGER_TEXT = { trivial: 'Trivial — it can barely scratch you', easy: 'Easy fight', even: 'Even fight — expect to bleed', hard: 'Hard — strike first and be ready to flee', deadly: 'Deadly — do not let it touch you' };
const SPECIAL = { blink: 'Phases between dimensions: it can blink to your side.', thief: 'Steals all your gold when it attacks you.', invisible: 'Invisible unless a Light spell burns.', mage: 'Not a fighter: its touch takes all your spells.', demon: 'Not a fighter: its touch drains an experience level.' };

export class Tooltip {
  /** @param {{root:HTMLElement, bus:import('../core/events.js').EventBus, getGame:()=>any, settings:object, isModal?:()=>boolean, renderer?:any}} ctx */
  constructor(ctx) {
    this.ctx = ctx; this.bus = ctx.bus;
    this.el = document.createElement('div');
    this.el.className = 'panel'; this.el.id = 'tooltip';
    this.el.style.pointerEvents = 'none';
    ctx.root.appendChild(this.el);
    this.tile = null; this.pos = { x: 0, y: 0 };
    this.unsub = [
      this.bus.on('input:hover', (p) => { this.tile = p.tile; this.pos = { x: p.clientX, y: p.clientY }; this.refresh(); }),
      this.bus.on('game:start', () => this.hide()),
      this.bus.on('level:enter', () => this.hide()),
    ];
    window.addEventListener('mousemove', (e) => { this.pos = { x: e.clientX, y: e.clientY }; if (this.el.classList.contains('show')) this.place(); });
    this.ctx.root.addEventListener('mouseleave', () => this.hide());
    this.acc = 0;
  }

  hide() { this.el.classList.remove('show'); }

  update(dt) { this.acc += dt; if (this.acc > 0.25) { this.acc = 0; if (this.tile) this.refresh(); } }

  /** Build the tooltip for the hovered tile (or hide it). */
  refresh() {
    const g = this.ctx.getGame();
    const t = this.tile;
    if (!g || !t || !this.ctx.settings.showTooltips || (this.ctx.isModal && this.ctx.isModal())) return this.hide();
    const lv = g.level, p = g.player;
    const allLit = this.ctx.renderer && this.ctx.renderer.fog && this.ctx.renderer.fog.override === 'all';
    if (!allLit && !lv.isExplored(t.x, t.y)) return this.hide();
    const dist = Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y));
    let html = '';
    const m = lv.monsterAt(t.x, t.y);
    if (m && !(m.invisible && !g.lightOn())) {
      const def = MONSTERS_BY_TYPE[m.type] || {};
      const band = dangerBand(m, p);
      const state = { hunt: 'hunting you', wander: 'wandering', idle: 'lurking', flee: 'fleeing', attack: 'attacking' }[m.state] || m.state;
      html += `<div class="tt-title">${cap(g.describe(m))}</div><div class="tt-sub">${m.family === 'human' ? 'Human — carries a weapon, steals treasure' : 'Creature — relies on brute strength'} · ${state}</div>`;
      html += `<div class="tt-body danger-${band}">${DANGER_TEXT[band]}</div>`;
      if (def.special && SPECIAL[def.special]) html += `<div class="tt-body">${SPECIAL[def.special]}</div>`;
      if (p.hasSword) html += `<div class="tt-body danger-deadly">If it attacks first it will steal the Sword.</div>`;
      html += `<div class="tt-row"><span>Distance</span><span>${dist}</span></div>`;
    } else if (t.x === p.x && t.y === p.y) {
      html += `<div class="tt-title">${this.ctx.settings.playerName || 'Warrior'}</div><div class="tt-sub">Level ${p.level} · ${p.hp}/${p.maxHp} hits · skill ${p.skill}</div>`;
      html += `<div class="tt-body">Click here (or press Space) to use stairs, pits and temples.</div>`;
    }
    const items = lv.itemsAt(t.x, t.y).filter((it) => !it.hidden || it.type === 'chest' || (it.type === 'gold' && it.hidden));
    for (const it of items) {
      if (it.type === 'gold' && !it.hidden) html += `<div class="tt-title">A sack of gold</div><div class="tt-body">Grab gold as soon as possible — thieves want it too. Sacrifice it at a temple for experience.</div>`;
      else if (it.type === 'gold' && it.hidden) html += `<div class="tt-title">Buried gold</div><div class="tt-body">A cache of ${it.gold} gold. Step on it to dig it up.</div>`;
      else if (it.type === 'chest') html += `<div class="tt-title">Hidden treasure or trap</div><div class="tt-sub">44% trap</div><div class="tt-body">Pit, ceiling block, explosion or teleport — or a potion, sack, spell, map or enchanted weapon. Auto-explore never steps here.</div>`;
      else if (it.type === 'sword') html += `<div class="tt-title gold-text">The Sword of Fargoal</div><div class="tt-body">Taking it doubles your experience and starts Umla's 2000-second clock. Climb.</div>`;
      else { const d = ITEM_TABLE[it.type]; html += `<div class="tt-title">${d ? d.name : it.type}</div><div class="tt-body">${d ? d.desc : ''}</div>`; }
    }
    const tile = lv.get(t.x, t.y);
    const cl = lv.climbableAt(t.x, t.y);
    if (!html || (!m && !items.length)) {
      const info = TILE_INFO[tile] || ['Unknown', '', ''];
      if (tile === TILE.WALL && !html) return this.hide();
      if (cl) html += `<div class="tt-title">Climbable pit above</div><div class="tt-sub">shortcut</div><div class="tt-body">Press Space here to climb back up ${cl.levels} level${cl.levels > 1 ? 's' : ''}.</div>`;
      else if (lv.beacon && lv.beacon.x === t.x && lv.beacon.y === t.y) html += `<div class="tt-title">Beacon</div><div class="tt-body">Teleports arrive here; monsters cannot see you on it.</div>`;
      else if (!(t.x === p.x && t.y === p.y)) {
        html += `<div class="tt-title">${info[0]}</div>${info[1] ? `<div class="tt-sub">${info[1]}${lv.isVisible(t.x, t.y) ? '' : ' · remembered'}</div>` : ''}${info[2] ? `<div class="tt-body">${info[2]}</div>` : ''}`;
        if (tile === TILE.STAIRS_UP && lv.depth === 1 && !p.hasSword) html += `<div class="tt-body danger-hard">Sealed by Umla's magic until you hold the Sword.</div>`;
      }
      if (dist > 0 && tile !== TILE.WALL) html += `<div class="tt-row"><span>Distance</span><span>${dist}</span></div>`;
    }
    if (!html) return this.hide();
    this.el.innerHTML = '<div class="corners"><i></i><i></i><i></i><i></i></div>' + html;
    this.el.classList.add('show');
    this.place();
  }

  place() {
    const pad = 18, w = this.el.offsetWidth, h = this.el.offsetHeight;
    let x = this.pos.x + pad, y = this.pos.y + pad;
    if (x + w > window.innerWidth - 8) x = this.pos.x - w - pad;
    if (y + h > window.innerHeight - 8) y = this.pos.y - h - pad;
    this.el.style.left = Math.max(4, x) + 'px'; this.el.style.top = Math.max(4, y) + 'px';
  }

  dispose() { for (const u of this.unsub) u(); this.el.remove(); }
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
