// Items, spells, treasure odds and their effects (DESIGN.md §5).
import { COLORS } from '../core/constants.js';
import { hasStatus, addStatus, removeStatus, healPlayer, addGold, gainXp } from './player.js';

/** Item definitions keyed by type. */
export const ITEM_TABLE = {
  potion: { type: 'potion', name: 'Healing Potion', plural: 'Healing Potions', key: 'H', kind: 'consumable', found: 'HEALING POTION!!', desc: 'Heals 20·rnd + 3·depth hits. Drunk automatically when your hits fall below zero outside a fight.' },
  sack: { type: 'sack', name: 'Magic Sack', plural: 'Magic Sacks', key: null, kind: 'passive', found: 'MAGIC SACK!!', desc: 'Carry 100 more gold.' },
  map: { type: 'map', name: 'Magic Map', plural: 'Magic Maps', key: null, kind: 'passive', found: 'TREASURE MAP!!', desc: 'Reveals a deeper level on entry.' },
  enchant: { type: 'enchant', name: 'Enchanted Weapon', plural: 'Enchanted Weapons', key: null, kind: 'passive', found: 'ENCHANTED WEAPON!!', desc: 'Battle skill +5..14 and +1 damage per enchantment.' },
  beacon: { type: 'beacon', name: 'Beacon', plural: 'Beacons', key: '+', kind: 'placeable', found: 'BEACON!!', desc: 'Place it: teleports arrive here and monsters cannot see you on it.' },
  gold: { type: 'gold', name: 'Gold', plural: 'Gold', kind: 'gold', desc: 'Sacrifice it at a temple for experience.' },
  chest: { type: 'chest', name: 'Treasure square', plural: 'Treasure squares', kind: 'container', desc: 'Hidden treasure or trap — 44% trap.' },
  sword: { type: 'sword', name: 'The Sword of Fargoal', plural: 'Swords of Fargoal', kind: 'quest', desc: 'Umla will know where you are.' },
};

/** Spell definitions keyed by type. */
export const SPELL_TABLE = {
  teleport: { type: 'teleport', name: 'Teleport', key: 'T', color: COLORS.spells.teleport, found: 'TELEPORT SPELL!!', desc: 'Jump to a random tile on this level. Ends any fight.' },
  shield: { type: 'shield', name: 'Shield', key: 'S', color: COLORS.spells.shield, found: 'SHIELD SPELL!!', desc: 'Take no damage until the end of the next fight or blast.' },
  regeneration: { type: 'regeneration', name: 'Regeneration', key: 'R', color: COLORS.spells.regeneration, found: 'REGENERATION SPELL!!', desc: 'Heal twice as fast on this level (stacks).' },
  invisibility: { type: 'invisibility', name: 'Invisibility', key: 'I', color: COLORS.spells.invisibility, found: 'INVISIBILITY SPELL!!', desc: 'Monsters stop chasing you until you kill one or cast Light.' },
  light: { type: 'light', name: 'Light', key: 'L', color: COLORS.spells.light, found: 'LIGHT SPELL!!', desc: 'See further and reveal assassins for the rest of this level.' },
  drift: { type: 'drift', name: 'Drift', key: 'D', color: COLORS.spells.drift, found: 'DRIFT SPELL!!', desc: 'Float down your next fall like a feather.' },
};
export const SPELL_TYPES = Object.keys(SPELL_TABLE);
export const ITEM_TYPES = Object.keys(ITEM_TABLE);

/** 14-slot treasure table [VIC 180]. */
export const TREASURE_SLOTS = ['potion', 'sack', 'potion', 'regeneration', 'sack', 'shield', 'teleport', 'light',
  'enchant', 'map', 'invisibility', 'shield', 'teleport', 'drift'];

/** Gold in one bag: int(20·rnd + 10·depth). */
export function goldValue(rng, depth) { return Math.floor(20 * rng.next() + 10 * Math.max(1, depth)); }

/**
 * Roll a treasure content. Returns {item, spell, mapDepth} (one of item/spell set).
 */
export function rollTreasure(rng, depth) {
  if (rng.chance(0.03)) return { item: 'beacon', spell: null };
  const slot = TREASURE_SLOTS[rng.int(0, 13)];
  if (SPELL_TABLE[slot]) return { item: null, spell: slot };
  const t = { item: slot, spell: null };
  if (slot === 'map') t.mapDepth = Math.floor(8 * rng.next() + depth + 3);
  return t;
}

/** Trap roll for a hidden treasure/trap square: 1 pit, 2 ceiling, 3 explosion, 4 teleport, else null. */
export function rollTrap(rng) {
  const r = rng.int(1, 9);
  return ['pit', 'ceiling', 'explosion', 'teleport'][r - 1] || null;
}

/** Give a rolled treasure to the player (with the original's messages and XP). */
export function grantTreasure(game, treasure, { silent = false } = {}) {
  const p = game.player;
  let text = '';
  if (treasure.spell) {
    p.spells[treasure.spell] = (p.spells[treasure.spell] || 0) + 1;
    text = SPELL_TABLE[treasure.spell].found;
  } else if (treasure.item === 'enchant') {
    p.enchant += 1;
    const gain = Math.floor(10 * game.rngs.loot.next() + 5);
    p.skill += gain;
    text = `ENCHANTED WEAPON +${p.enchant}!`;
  } else if (treasure.item === 'map') {
    const d = treasure.mapDepth ?? Math.floor(8 * game.rngs.loot.next() + game.level.depth + 3);
    if (p.maps.length < 10) p.maps.push(d);
    text = `MAP TO ${ordinal(d)} LEVEL!!`;
  } else if (treasure.item) {
    p.inventory[treasure.item] = (p.inventory[treasure.item] || 0) + 1;
    text = ITEM_TABLE[treasure.item].found;
  }
  const xp = Math.floor(50 * game.rngs.loot.next() + game.level.depth);
  game.stats.treasures++;
  game.emit('item:picked', { item: { type: treasure.item || treasure.spell, spell: !!treasure.spell, x: p.x, y: p.y }, entity: p });
  if (!silent) game.log(text, 'loot');
  gainXp(game, xp);
  return text;
}

function ordinal(n) {
  const s = ['TH', 'ST', 'ND', 'RD'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Use an inventory item. Returns true if something happened.
 * @param {import('./game.js').Game} game
 * @param {'potion'|'beacon'|'sack'|'map'} type
 */
export function useItem(game, type) {
  const p = game.player;
  if (game.state.over) return false;
  if (!(p.inventory[type] > 0)) { game.log(`You have no ${ITEM_TABLE[type]?.plural?.toLowerCase() || type}.`, 'info'); return false; }
  if (type === 'potion') {
    p.inventory.potion--;
    const amount = Math.floor(20 * game.rngs.loot.next() + 3 * game.level.depth);
    healPlayer(game, amount);
    game.log('HEALING POTION TAKEN!', 'magic');
    game.emit('item:used', { item: { type: 'potion', amount } });
    game.emit('sfx:potion', {});
    return true;
  }
  if (type === 'beacon') {
    const level = game.level;
    if (level.isTemple(p.x, p.y) || level.isStairs(p.x, p.y)) { game.log("You can't place a beacon here.", 'info'); return false; }
    p.inventory.beacon--;
    level.beacon = { x: p.x, y: p.y };
    game.log('BEACON PLACED. Teleports will bring you back here.', 'magic');
    game.emit('item:used', { item: { type: 'beacon', x: p.x, y: p.y } });
    return true;
  }
  game.log(`${ITEM_TABLE[type]?.name || type} works on its own.`, 'info');
  return false;
}

/**
 * Cast a spell. Returns true if cast.
 * @param {import('./game.js').Game} game
 * @param {keyof typeof SPELL_TABLE} type
 */
export function castSpell(game, type) {
  const p = game.player;
  if (game.state.over) return false;
  if (!SPELL_TABLE[type]) return false;
  if (!(p.spells[type] > 0)) { game.log(`You have no ${SPELL_TABLE[type].name} spell.`, 'info'); return false; }
  const level = game.level;
  const spend = () => { p.spells[type]--; };
  switch (type) {
    case 'teleport': {
      spend();
      game.log('TELEPORT SPELL CAST!', 'magic');
      game.emit('spell:cast', { spell: type, x: p.x, y: p.y, target: null });
      game.teleportPlayer('spell');
      return true;
    }
    case 'shield': {
      if (hasStatus(p, 'shield')) { game.log('Your shield already shimmers.', 'info'); return false; }
      spend();
      addStatus(p, 'shield', { fights: 1 });
      game.log('SHIELD SPELL CAST!', 'magic');
      game.emit('spell:cast', { spell: type, x: p.x, y: p.y, target: p });
      return true;
    }
    case 'regeneration': {
      spend();
      p.autohealRate = Math.max(1, p.autohealRate / 2);
      const st = addStatus(p, 'regeneration', { stacks: 0 });
      st.stacks++;
      game.log('REGENERATION SPELL CAST!', 'magic');
      game.emit('spell:cast', { spell: type, x: p.x, y: p.y, target: p });
      return true;
    }
    case 'invisibility': {
      if (hasStatus(p, 'invisible')) { game.log('You are already unseen.', 'info'); return false; }
      spend();
      addStatus(p, 'invisible', {});
      p.invisible = true;
      for (const m of level.monsters) { if (m.state === 'hunt') { m.state = 'wander'; m.lastSeen = null; } }
      game.log('INVISIBILITY SPELL CAST! The monsters lose you.', 'magic');
      game.emit('spell:cast', { spell: type, x: p.x, y: p.y, target: p });
      return true;
    }
    case 'light': {
      const st = getLight(p);
      if (st) {
        if (st.on) { game.log('Light already burns here.', 'info'); return false; }
        st.on = true;
        game.log('LIGHT ON', 'magic');
      } else {
        spend();
        addStatus(p, 'light', { on: true });
        game.log('LIGHT SPELL CAST!', 'magic');
      }
      if (hasStatus(p, 'invisible')) { removeStatus(p, 'invisible'); p.invisible = false; game.log('The light betrays you: you are visible again.', 'danger'); }
      game.emit('spell:cast', { spell: type, x: p.x, y: p.y, target: p });
      game.updateFov();
      return true;
    }
    case 'drift': {
      if (hasStatus(p, 'drift')) { game.log('You already feel feather-light.', 'info'); return false; }
      spend();
      addStatus(p, 'drift', {});
      game.log('DRIFT SPELL CAST! Your next fall will be gentle.', 'magic');
      game.emit('spell:cast', { spell: type, x: p.x, y: p.y, target: p });
      return true;
    }
    default: return false;
  }
}

function getLight(p) { return p.statusEffects.find((s) => s.type === 'light') || null; }

/** Toggle an existing Light spell on/off (key O). */
export function toggleLight(game) {
  const st = getLight(game.player);
  if (!st) return false;
  st.on = !st.on;
  game.log(st.on ? 'LIGHT ON' : 'LIGHT OFF', 'magic');
  game.updateFov();
  return true;
}

/** Current sight radius for the player. */
export function sightRadius(game) {
  const st = getLight(game.player);
  return st && st.on ? game.balance.lightFovRadius : game.balance.fovRadius;
}

/** Is Light currently shining? */
export function lightOn(player) { const st = getLight(player); return !!(st && st.on); }

/** Pick up gold lying on a tile (bag or buried); handles overflow burial. Returns amount taken. */
export function pickupGold(game, item) {
  const p = game.player;
  const level = game.level;
  const amount = item.gold || 0;
  level.removeItem(item);
  const taken = addGold(game, amount);
  const excess = amount - taken;
  if (item.hidden) game.log(`HIDDEN TREASURE!! ${taken} gold recovered.`, 'loot');
  else game.log(`TREASURE: ${amount} GP'S`, 'loot');
  game.emit('item:picked', { item, entity: p });
  if (excess > 0) {
    level.addItem({ type: 'gold', x: item.x, y: item.y, qty: 1, gold: excess, hidden: true });
    game.log(`CAN'T CARRY MORE GOLD — hiding ${excess} gold here.`, 'info');
  }
  return taken;
}
