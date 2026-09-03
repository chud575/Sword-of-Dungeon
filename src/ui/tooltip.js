// Hover tooltips for tiles, monsters and items (mouse -> tile via the renderer's picking, which
// the Input module already performs and broadcasts as 'input:hover'). Monsters get a threat meter
// built from the real combat maths (DESIGN.md §7.3), expected damage per round, kill worth and a
// lore line; tiles and items get what they do and how to use them. Styles live in ./panels.css.
import './panels.css';
import * as THREE from 'three';
import { TILE } from '../core/constants.js';
import { ITEM_TABLE } from '../game/items.js';
import { dangerBand, damageRatio, killXp } from '../game/combat.js';
import { MONSTERS_BY_TYPE } from '../game/monsters.js';
import { hasStatus } from '../game/player.js';
import { icon } from './icons.js';

/** [title, kind, body, icon, colour] per tile. */
const TILE_INFO = {
  [TILE.FLOOR]: ['Flagstones', 'floor', '', 'pin', 'var(--parchment-dim)'],
  [TILE.CORRIDOR]: ['Winding corridor', 'passage', 'One tile wide: monsters must come at you one at a time.', 'pin', 'var(--parchment-dim)'],
  [TILE.DOOR]: ['Doorway', 'passage', '', 'pin', 'var(--parchment-dim)'],
  [TILE.WALL]: ['Rock', 'wall', 'Solid stone.', 'pin', 'var(--parchment-dim)'],
  [TILE.STAIRS_DOWN]: ['Stairs going down', 'stairs', 'Stand on them and press Space (or click) to descend. Every descent grants experience.', 'stairs', 'var(--mm-stairs-down)'],
  [TILE.STAIRS_UP]: ['Stairs going up', 'stairs', 'Climb back toward the surface. The way out of level 1 opens only for the Sword.', 'stairs', 'var(--mm-stairs-up)'],
  [TILE.TEMPLE]: ['Temple', 'sanctuary', 'Monsters ignore you here and you heal twice as fast. Step on it with gold to sacrifice it all: 1 gold = 1 experience.', 'temple', 'var(--loot)'],
  [TILE.PIT]: ['Open pit', 'hazard', 'Walk in to climb down 2–5 levels — half the time you fall and take damage. A Drift spell makes the fall gentle.', 'alert', 'var(--combat)'],
  [TILE.WATER]: ['Cistern water', 'water', 'Cold, dark and knee-deep. Nothing lives in it. Probably.', 'drift', 'var(--mm-water)'],
  [TILE.TRAP_TELEPORT]: ['Teleport trap (sprung)', 'hazard', 'Stepping here again teleports you somewhere random on this level.', 'teleport', 'var(--quest)'],
  [TILE.TRAP_PIT]: ['Pit trap (sprung)', 'hazard', 'The floor is gone. You will fall through.', 'alert', 'var(--combat)'],
  [TILE.RUBBLE]: ['Hole in the ceiling', 'debris', 'A ceiling trap fell here. Safe now.', 'bury', 'var(--parchment-dim)'],
};
const TILE_LORE = {
  [TILE.TEMPLE]: 'Gedwyn waits in a temple like this one, far above. The gods still listen here.',
  [TILE.STAIRS_DOWN]: 'Every level is carved fresh when you return; nothing you leave behind will be waiting.',
  [TILE.STAIRS_UP]: 'The way up is the way home — if you are carrying the Sword.',
  [TILE.PIT]: 'Creatures can be baited into pits. Humans know better.',
  [TILE.CORRIDOR]: 'Dug by things that did not walk upright.',
};
const THREAT = {
  trivial: { pips: 1, label: 'Trivial', color: '#9ad4a0', words: 'It can barely scratch you.' },
  easy: { pips: 2, label: 'Easy', color: '#cfe6a2', words: 'You should win without much blood.' },
  even: { pips: 3, label: 'Even', color: 'var(--loot)', words: 'Expect to bleed. Strike first.' },
  hard: { pips: 4, label: 'Hard', color: 'var(--combat)', words: 'Strike first and be ready to flee.' },
  deadly: { pips: 5, label: 'Deadly', color: 'var(--danger)', words: 'Do not let it touch you.' },
};
const SPECIAL = {
  blink: 'Phases between dimensions: it can blink to your side.',
  thief: 'Steals all your gold when it attacks you.',
  invisible: 'Invisible unless a Light spell burns.',
  mage: 'Not a fighter: its touch takes every spell you carry.',
  demon: 'Not a fighter: its touch drains an experience level.',
};
const STATE = { hunt: 'hunting you', wander: 'wandering', idle: 'lurking', flee: 'fleeing', attack: 'attacking' };
const LORE = {
  'dire-wolf': 'Grey hunters of the upper halls. Fast, cowardly when bleeding, and never alone for long.',
  ogre: 'Slow, stupid and enormously strong. It fills the corridor it stands in.',
  hobgoblin: 'A bully with a club. Bold in a pack, quick to run when the pack thins.',
  werebear: 'Half man, half bear, all appetite. It does not flee and it does not forgive.',
  gargoyle: 'Stone that decided to move. It will follow you down the stairs.',
  troll: 'Green, hunched and patient. Kill it quickly or not at all.',
  wyvern: 'A lesser dragon with a barbed tail. It hunts by wing and follows by scent.',
  'dimension-spider': 'It lives between rooms. One moment a corridor away, the next at your throat.',
  'shadow-dragon': 'Darkness with teeth. Its breath is the cold between the stars.',
  'fyre-drake': 'The mountain’s furnace given legs. Everything it touches burns.',
  demon: 'Umla’s herald. It does not fight — its touch drains a whole level of experience.',
  rogue: 'A pickpocket who found the dungeon before you did. Every hit empties your purse.',
  barbarian: 'Northern steel and no patience. Meets you head-on and dies the same way.',
  'elvin-ranger': 'Quiet feet, long bow. Rangers pick up whatever you leave behind.',
  'dwarven-guard': 'Shield up, axe low, feet planted. Dwarves do not flee and do not tire.',
  mercenary: 'Fights for gold — yours, if it can get it. Breaks when the odds turn.',
  swordsman: 'A trained blade. Neither brave nor cowardly, simply competent — which is worse.',
  monk: 'Empty hands that break bone. Monks fight in silence and never step back.',
  'dark-warrior': 'Armour blackened in Umla’s forges. It follows you between levels.',
  assassin: 'You will not see it until the knife is in. A Light spell is the only cure.',
  'war-lord': 'Commander of the deep garrisons. The strongest human sword in Fargoal.',
  mage: 'Umla’s apprentice. Not a fighter — one touch and every spell you carry is gone.',
};

const corners = () => '<div class="corners"><i></i><i></i><i></i><i></i></div><div class="filet"></div>';

export class Tooltip {
  /** @param {{root:HTMLElement, bus:import('../core/events.js').EventBus, getGame:()=>any, settings:object, isModal?:()=>boolean, renderer?:any}} ctx */
  constructor(ctx) {
    this.ctx = ctx; this.bus = ctx.bus;
    this.el = document.createElement('div');
    this.el.className = 'panel px'; this.el.id = 'tooltip';
    this.el.style.pointerEvents = 'none';
    ctx.root.appendChild(this.el);
    this.tile = null; this.pos = { x: 0, y: 0 }; this.pinned = false;
    this.unsub = [
      this.bus.on('input:hover', (p) => { this.pinned = false; this.tile = p.tile; this.pos = { x: p.clientX, y: p.clientY }; this.refresh(); }),
      this.bus.on('game:start', () => this.hide()),
      this.bus.on('level:enter', () => this.hide()),
    ];
    window.addEventListener('mousemove', (e) => { if (this.pinned) return; this.pos = { x: e.clientX, y: e.clientY }; if (this.el.classList.contains('show')) this.place(); });
    this.ctx.root.addEventListener('mouseleave', () => this.hide());
    this.acc = 0;
  }

  hide() { this.el.classList.remove('show'); this.tile = null; this.pinned = false; }

  update(dt) { this.acc += dt; if (this.acc > 0.25) { this.acc = 0; if (this.tile) this.refresh(); } }

  /** Debug/scenario helper: show the tooltip for a tile as if the mouse hovered it (projects through the camera). */
  showAt(tile) {
    const r = this.ctx.renderer;
    if (!r || !r.camera || !r.canvas) return;
    const rect = r.canvas.getBoundingClientRect();
    const v = new THREE.Vector3(tile.x, 0.5, tile.y).project(r.camera);
    this.pos = { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
    this.tile = { x: tile.x, y: tile.y };
    this.pinned = true;
    this.refresh();
  }

  /** Build the tooltip for the hovered tile (or hide it). */
  refresh() {
    const g = this.ctx.getGame();
    const t = this.tile;
    if (!g || !t || !this.ctx.settings.showTooltips || (this.ctx.isModal && this.ctx.isModal())) return this.el.classList.remove('show');
    const lv = g.level, p = g.player;
    const allLit = this.ctx.renderer && this.ctx.renderer.fog && this.ctx.renderer.fog.override === 'all';
    if (!allLit && !lv.isExplored(t.x, t.y)) return this.el.classList.remove('show');
    const dist = Math.max(Math.abs(t.x - p.x), Math.abs(t.y - p.y));
    const onPlayer = t.x === p.x && t.y === p.y;
    let html = '', tone = '';
    const m = lv.monsterAt(t.x, t.y);
    if (m && !(m.invisible && !g.lightOn())) {
      const def = MONSTERS_BY_TYPE[m.type] || {};
      const band = dangerBand(m, p), th = THREAT[band];
      const depth = Math.max(1, lv.depth), x = damageRatio(m, p);
      const youMax = Math.floor((1 / x) * 4 * depth) + 1 + p.enchant, youMin = 1 + p.enchant;
      const shielded = hasStatus(p, 'shield');
      const itMax = shielded ? 0 : Math.floor(x * 4 * depth) + 1, itMin = shielded ? 0 : 1;
      const rounds = Math.max(1, Math.ceil(m.hp / Math.max(1, (youMin + youMax) / 2)));
      const survive = itMax ? Math.ceil((p.hp + 5) / Math.max(1, (itMin + itMax) / 2)) : Infinity;
      if (band === 'deadly' || band === 'hard') tone = 'deadly';
      html += `<div class="tt-head" style="--c:${th.color}"><div class="tt-ico">${icon(m.family === 'human' ? 'skill' : 'skull')}</div>
        <div><div class="tt-title">${cap(g.describe(m))}</div><div class="tt-sub">${m.family === 'human' ? 'Human · armed' : 'Creature · brute'} · <b>${STATE[m.state] || m.state}</b></div></div></div>`;
      html += `<div class="tt-threat" style="--tc:${th.color}"><span class="pips">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= th.pips ? 'on' : ''}"></i>`).join('')}</span><span class="tl">${th.label}</span><span class="tw">${th.words}</span></div>`;
      if (def.special && SPECIAL[def.special]) html += `<div class="tt-body special">${SPECIAL[def.special]}</div>`;
      if (p.hasSword) html += `<div class="tt-body warn">If it strikes first it steals the Sword.</div>`;
      html += `<div class="tt-rows">
        <div class="tt-row"><span>Strength · your skill</span><span>${m.strength} · ${p.skill}</span></div>
        <div class="tt-row${m.hp < m.maxHp ? ' bad' : ''}"><span>Hits</span><span>${m.hp} / ${m.maxHp}</span></div>
        <div class="tt-row good"><span>You deal per round</span><span>${youMin}–${youMax}</span></div>
        <div class="tt-row${itMax ? ' bad' : ' good'}"><span>It deals per round</span><span>${shielded ? '0 · shielded' : `${itMin}–${itMax}`}</span></div>
        <div class="tt-row"><span>Rounds to kill it</span><span>${rounds}</span></div>
        <div class="tt-row gold"><span>Worth</span><span>${killXp(m, depth).toLocaleString('en-US')} xp</span></div>
        <div class="tt-row"><span>Distance</span><span>${dist}</span></div></div>`;
      if (survive < rounds) html += `<div class="tt-body warn">It would outlast you: about ${survive} round${survive === 1 ? '' : 's'} before you drop.</div>`;
      if (LORE[m.type]) html += `<div class="tt-lore">${LORE[m.type]}</div>`;
      if (dist === 1) html += `<div class="tt-hint"><kbd>move into it</kbd> to attack · release to flee</div>`;
    } else if (onPlayer) {
      html += `<div class="tt-head" style="--c:var(--gold)"><div class="tt-ico">${icon('heart')}</div>
        <div><div class="tt-title">${esc(this.ctx.settings.playerName || 'Warrior')}</div><div class="tt-sub">Level <b>${p.level}</b> · <b>${p.hp}</b>/${p.maxHp} hits · skill <b>${p.skill}</b></div></div></div>`;
      html += `<div class="tt-body">Click here (or press <b>Space</b>) to use stairs, pits and temples.</div>`;
    }
    const items = lv.itemsAt(t.x, t.y).filter((it) => !it.hidden || it.type === 'chest' || (it.type === 'gold' && it.hidden));
    for (const it of items) {
      if (it.type === 'gold' && !it.hidden) html += head('A sack of gold', 'treasure', 'coin', 'var(--loot)') + `<div class="tt-body">Grab it before a thief does. Sacrifice it at a temple for experience, one point per coin.</div>`;
      else if (it.type === 'gold' && it.hidden) html += head('Buried gold', 'cache', 'bury', 'var(--loot)') + `<div class="tt-body">A cache of <b>${it.gold}</b> gold. Step on it to dig it up.</div>`;
      else if (it.type === 'chest') html += head('Hidden treasure — or a trap', '44% trap · 56% treasure', 'alert', 'var(--quest)') + `<div class="tt-body">Pit, ceiling block, explosion or teleport — or a potion, sack, spell, map or enchanted weapon. Auto-explore never steps here.</div>` + `<div class="tt-lore">The dungeon buries its gifts and its jokes in the same kind of square.</div>`;
      else if (it.type === 'sword') { tone = 'quest'; html += head('The Sword of Fargoal', 'the quest', 'sword', 'var(--sp-teleport)', 'quest') + `<div class="tt-body">Taking it doubles your experience and starts Umla’s <b>2000-second</b> clock. Climb.</div><div class="tt-lore">Forged in the fires of the gods, drawn by a boy who was tricked, and hidden here by a wizard who knows exactly where you are.</div>`; }
      else if (it.type === 'beacon') html += head('Beacon', 'left behind', 'beacon', 'var(--mm-beacon)') + `<div class="tt-body">${ITEM_TABLE.beacon.desc}</div>`;
      else { const d = ITEM_TABLE[it.type]; html += head(d ? d.name : it.type, 'item', d && d.type === 'potion' ? 'potion' : 'star', 'var(--parchment)') + `<div class="tt-body">${d ? d.desc : ''}</div>`; }
    }
    const tile = lv.get(t.x, t.y);
    const cl = lv.climbableAt(t.x, t.y);
    if (!html || (!m && !items.length)) {
      const info = TILE_INFO[tile] || ['Unknown', '', '', 'pin', 'var(--parchment-dim)'];
      if (tile === TILE.WALL && !html) return this.el.classList.remove('show');
      if (cl) html += head('Climbable pit above', 'shortcut', 'stairs', 'var(--mm-stairs-up)') + `<div class="tt-body">Press <b>Space</b> here to climb back up ${cl.levels} level${cl.levels > 1 ? 's' : ''}.</div>`;
      else if (lv.beacon && lv.beacon.x === t.x && lv.beacon.y === t.y) html += head('Beacon', 'placed', 'beacon', 'var(--mm-beacon)') + `<div class="tt-body">Teleports arrive here; monsters cannot see you on it.</div>`;
      else if (!onPlayer) {
        html += head(info[0], `${info[1]}${lv.isVisible(t.x, t.y) || allLit ? '' : ' · remembered'}`, info[3], info[4]);
        if (info[2]) html += `<div class="tt-body">${info[2]}</div>`;
        if (tile === TILE.STAIRS_UP && lv.depth === 1 && !p.hasSword) html += `<div class="tt-body warn">Sealed by Umla’s magic until you hold the Sword.</div>`;
        if (tile === TILE.TEMPLE && p.gold > 0) html += `<div class="tt-row gold"><span>Your ${p.gold} gold would bring</span><span>+${p.gold} xp</span></div>`;
        if (TILE_LORE[tile]) html += `<div class="tt-lore">${TILE_LORE[tile]}</div>`;
      }
      if (dist > 0 && tile !== TILE.WALL) html += `<div class="tt-rows"><div class="tt-row"><span>Distance</span><span>${dist}</span></div></div><div class="tt-hint"><kbd>click</kbd> walk here</div>`;
    }
    if (!html) return this.el.classList.remove('show');
    const next = corners() + html;
    if (this.lastHtml !== next) { this.lastHtml = next; this.el.innerHTML = next; }
    this.el.classList.toggle('deadly', tone === 'deadly');
    this.el.classList.toggle('quest', tone === 'quest');
    this.el.classList.add('show');
    this.place();
  }

  place() {
    const pad = 18, w = this.el.offsetWidth, h = this.el.offsetHeight;
    let x = this.pos.x + pad, y = this.pos.y + pad;
    if (x + w > window.innerWidth - 8) x = this.pos.x - w - pad;
    // below the cursor in the upper half of the screen, above it lower down (keeps clear of the hotbar)
    if (this.pos.y > window.innerHeight * 0.58 || y + h > window.innerHeight - 8) y = this.pos.y - h - pad;
    this.el.style.left = Math.max(4, x) + 'px'; this.el.style.top = Math.max(4, y) + 'px';
  }

  dispose() { for (const u of this.unsub) u(); this.el.remove(); }
}

function head(title, sub, ico, color, extra = '') {
  return `<div class="tt-head" style="--c:${color}"><div class="tt-ico">${icon(ico)}</div><div><div class="tt-title${extra ? ' ' + extra : ''}">${title}</div>${sub ? `<div class="tt-sub">${sub}</div>` : ''}</div></div>`;
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
