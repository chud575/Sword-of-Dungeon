// Bestiary and monster generation formulas (DESIGN.md §2.6, §4). The AI lives in monsterAi.js and is
// re-exported here so game.js keeps a single import.
import { monsterPhaseSeconds } from '../core/constants.js';
export {
  updateMonsters, monsterAct, stepMonster, monsterVisibleToPlayer, monsterCanEnter, pathStep, perceive,
  makeNoise, stagger, onMonsterSlain, startFlee, extendedRules, initAiFields, AI,
} from './monsterAi.js';

// Ranged profiles [designed, extended bestiary]: kind/colour drive VFX & audio; damage = x·4·depth·rnd·mul + 1.
const BREATH = (kind, color, word, chargeText, missText, mul) => ({ kind, color, word, chargeText, missText, mul, min: 2, max: 4, length: 4, cooldown: 4, telegraph: true, kite: false, hitChance: 1 });
const RANGED = {
  wyvern: BREATH('venom', 0x69db7c, 'HISSS!', 'The %s rears back, venom dripping from its jaws!', 'A spray of venom spatters the stones beside you!', 0.7),
  'shadow-dragon': BREATH('darkness', 0x7a3ad0, 'SCORCH!', 'The %s draws in a breath of scorching darkness!', 'Scorching darkness roars past you!', 0.8),
  'fyre-drake': BREATH('fire', 0xff7a2a, 'BURN!', 'The %s draws a searing breath!', 'Flames roar past you, blistering the stone!', 0.9),
  mage: { kind: 'bolt', color: 0x7fd4ff, word: 'ZAP!', castText: 'The %s hurls a crackling bolt!', missText: 'The bolt fizzles against the wall.', mul: 0.5, min: 2, max: 5, cooldown: 2, kite: true, hitChance: 1, drain: 0.5 },
  warlock: { kind: 'shadowbolt', color: 0xb197fc, word: 'WITHER!', castText: 'The %s hurls a bolt of shadow!', missText: 'The shadow bolt gutters out.', mul: 0.8, min: 2, max: 5, cooldown: 2, kite: true, hitChance: 1 },
  'elvin-ranger': { kind: 'arrow', color: 0xd9c9a0, word: 'THWACK!', castText: null, missText: 'An arrow whistles past your ear!', mul: 0.6, min: 2, max: 5, cooldown: 2, kite: true, hitChance: 0.75 },
};

/**
 * The 22 original monsters. `typeIndex` is the VIC type index x (0-9) within its family.
 * depthMin/depthMax are the depths on which the index can be rolled (max Infinity = open-ended).
 * `pack` monsters raise the alarm for their kin; `haunt` biases wandering; `ranged` is the extended profile.
 */
export const MONSTER_TABLE = [
  { type: 'dire-wolf', name: 'Dire Wolf', family: 'creature', typeIndex: 0, glyph: 31, depthMin: 1, depthMax: 1, speedMul: 1.5, flees: true, follows: false, special: null, size: 0.8, pack: true },
  { type: 'ogre', name: 'Ogre', family: 'creature', typeIndex: 1, glyph: 27, depthMin: 1, depthMax: 3, speedMul: 0.8, flees: false, follows: false, special: null, size: 1.3 },
  { type: 'hobgoblin', name: 'Hobgoblin', family: 'creature', typeIndex: 2, glyph: 27, depthMin: 1, depthMax: 5, speedMul: 1.1, flees: true, follows: false, special: null, size: 0.9, pack: true },
  { type: 'werebear', name: 'Werebear', family: 'creature', typeIndex: 3, glyph: 27, depthMin: 1, depthMax: 7, speedMul: 1.0, flees: false, follows: false, special: null, size: 1.2 },
  { type: 'gargoyle', name: 'Gargoyle', family: 'creature', typeIndex: 4, glyph: 28, depthMin: 2, depthMax: 9, speedMul: 1.0, flees: false, follows: true, special: null, size: 1.0 },
  { type: 'troll', name: 'Troll', family: 'creature', typeIndex: 5, glyph: 27, depthMin: 4, depthMax: Infinity, speedMul: 0.9, flees: false, follows: false, special: null, size: 1.4 },
  { type: 'wyvern', name: 'Wyvern', family: 'creature', typeIndex: 6, glyph: 30, depthMin: 6, depthMax: Infinity, speedMul: 1.2, flees: false, follows: true, special: null, size: 1.3, ranged: RANGED.wyvern },
  { type: 'dimension-spider', name: 'Dimension Spider', family: 'creature', typeIndex: 7, glyph: 29, depthMin: 8, depthMax: Infinity, speedMul: 1.0, flees: false, follows: true, special: 'blink', size: 1.1 },
  { type: 'shadow-dragon', name: 'Shadow Dragon', family: 'creature', typeIndex: 8, glyph: 30, depthMin: 10, depthMax: Infinity, speedMul: 1.0, flees: false, follows: false, special: null, size: 1.6, ranged: RANGED['shadow-dragon'] },
  { type: 'fyre-drake', name: 'Fyre Drake', family: 'creature', typeIndex: 9, glyph: 30, depthMin: 12, depthMax: Infinity, speedMul: 1.1, flees: false, follows: true, special: null, size: 1.6, ranged: RANGED['fyre-drake'] },
  { type: 'demon', name: 'Demon', family: 'creature', typeIndex: -1, glyph: 28, depthMin: 14, depthMax: Infinity, speedMul: 1.0, flees: false, follows: false, special: 'demon', size: 1.0 },
  { type: 'rogue', name: 'Rogue', family: 'human', typeIndex: 0, glyph: 42, depthMin: 1, depthMax: 1, speedMul: 1.3, flees: true, follows: false, special: 'thief', size: 0.9 },
  { type: 'barbarian', name: 'Barbarian', family: 'human', typeIndex: 1, glyph: 41, depthMin: 1, depthMax: 3, speedMul: 1.0, flees: false, follows: false, special: null, size: 1.1, pack: true },
  { type: 'elvin-ranger', name: 'Elvin Ranger', family: 'human', typeIndex: 2, glyph: 41, depthMin: 1, depthMax: 5, speedMul: 1.2, flees: true, follows: false, special: null, size: 1.0, ranged: RANGED['elvin-ranger'] },
  { type: 'dwarven-guard', name: 'Dwarven Guard', family: 'human', typeIndex: 3, glyph: 43, depthMin: 1, depthMax: 7, speedMul: 0.9, flees: false, follows: false, special: null, size: 0.9 },
  { type: 'mercenary', name: 'Mercenary', family: 'human', typeIndex: 4, glyph: 41, depthMin: 2, depthMax: 9, speedMul: 1.0, flees: true, follows: false, special: null, size: 1.0, pack: true },
  { type: 'swordsman', name: 'Swordsman', family: 'human', typeIndex: 5, glyph: 41, depthMin: 4, depthMax: Infinity, speedMul: 1.0, flees: false, follows: false, special: null, size: 1.0 },
  { type: 'monk', name: 'Monk', family: 'human', typeIndex: 6, glyph: 41, depthMin: 6, depthMax: Infinity, speedMul: 1.1, flees: false, follows: false, special: null, size: 1.0 },
  { type: 'dark-warrior', name: 'Dark Warrior', family: 'human', typeIndex: 7, glyph: 41, depthMin: 8, depthMax: Infinity, speedMul: 1.0, flees: false, follows: true, special: null, size: 1.1, pack: true },
  { type: 'assassin', name: 'Assassin', family: 'human', typeIndex: 8, glyph: 40, depthMin: 10, depthMax: Infinity, speedMul: 1.2, flees: false, follows: true, special: 'invisible', size: 1.0, haunt: 'stairs' },
  { type: 'war-lord', name: 'War Lord', family: 'human', typeIndex: 9, glyph: 41, depthMin: 12, depthMax: Infinity, speedMul: 1.0, flees: false, follows: true, special: null, size: 1.2 },
  { type: 'mage', name: 'Mage', family: 'human', typeIndex: -1, glyph: 41, depthMin: 14, depthMax: Infinity, speedMul: 1.0, flees: false, follows: false, special: 'mage', size: 1.0, ranged: RANGED.mage },
];

/**
 * Extended-bestiary variants [designed]: rolled in place of an ordinary monster, drawn with the `rig` of a
 * classic type (the renderer keys character builds by entity.type). The Warlock is a battle-caster that
 * can be fought: it keeps its distance and hurls bolts of shadow, fleeing when badly hurt.
 */
export const VARIANT_TABLE = [
  { type: 'warlock', rig: 'mage', name: 'Warlock', family: 'human', typeIndex: 6, glyph: 41, depthMin: 14, depthMax: Infinity, speedMul: 1.0, flees: true, follows: false, special: 'warlock', size: 1.0, ranged: RANGED.warlock, chance: 0.12 },
];

/** Lookup by type string (classic types and variants). */
export const MONSTERS_BY_TYPE = Object.fromEntries([...MONSTER_TABLE, ...VARIANT_TABLE].map((m) => [m.type, m]));
/** The 22 classic types (bestiary order). */
export const MONSTER_TYPES = MONSTER_TABLE.map((m) => m.type);

/** Definition for a family/type index. */
export function monsterDefFor(family, typeIndex) {
  return MONSTER_TABLE.find((m) => m.family === family && m.typeIndex === typeIndex) || null;
}

/**
 * Roll the type index for a depth [VIC]: x = int(4·rnd + L/2); x >= 10 → r = int(6·rnd):
 * r > 0 → 10 − r, r = 0 → Mage/Demon (only from `mageDemonMinDepth`).
 * @returns {{typeIndex:number, special:boolean}}
 */
export function rollTypeIndex(rng, depth, mageDemonMinDepth = 14) {
  let x = Math.floor(4 * rng.next() + depth / 2);
  if (mageDemonMinDepth < 14 && depth >= mageDemonMinDepth && depth < 14 && rng.chance(0.08)) return { typeIndex: -1, special: true };
  if (x >= 10) {
    const r = Math.floor(6 * rng.next());
    if (r === 0 && depth >= mageDemonMinDepth) return { typeIndex: -1, special: true };
    x = r === 0 ? 9 : 10 - r;
  }
  return { typeIndex: Math.min(9, x), special: false };
}

function rollStats(rng, family, depth, x) {
  const L = Math.max(1, depth);
  const bonus = () => Math.floor(x * rng.next() + x);
  let strength = 0, hp = 0;
  if (family === 'creature') {
    const n = 2 + Math.floor(L / 4);
    for (let k = 0; k < n; k++) strength += Math.floor(4 * rng.next() + L);
    for (let k = 0; k < n; k++) hp += Math.floor(6 * rng.next() + 1.5 * L);
  } else {
    const n = 3 + Math.floor(L / 4);
    for (let k = 0; k < n; k++) strength += Math.floor(3 * rng.next() + 1.5 * L);
    for (let k = 0; k < n; k++) hp += Math.floor(4 * rng.next() + L);
  }
  strength += bonus(); hp += bonus();
  return { strength: Math.max(1, strength), hp: Math.max(1, hp) };
}

/**
 * Roll a monster entity for a depth.
 * @param {ReturnType<import('../core/rng.js').createRng>} rng
 * @param {number} depth
 * @param {{family?:'creature'|'human', type?:string, id?:string, mageDemonMinDepth?:number, extended?:boolean}} opts
 *   extended (default true): allow extended-bestiary variants (Warlock) to be rolled.
 */
export function rollMonster(rng, depth, opts = {}) {
  let def;
  if (opts.type) {
    def = MONSTERS_BY_TYPE[opts.type];
    if (!def) throw new Error(`unknown monster type ${opts.type}`);
  } else {
    const family = opts.family || (rng.chance(0.6) ? 'creature' : 'human');
    const { typeIndex, special } = rollTypeIndex(rng, depth, opts.mageDemonMinDepth ?? 14);
    let x = typeIndex;
    // The VIC formula can roll one step below the bestiary's listed range at shallow depths; clamp to the table.
    while (!special && x > 0 && monsterDefFor(family, x).depthMin > depth) x--;
    def = special ? MONSTERS_BY_TYPE[family === 'creature' ? 'demon' : 'mage'] : monsterDefFor(family, x);
    if (!special && (opts.extended ?? true)) {
      for (const v of VARIANT_TABLE) {
        if (v.family === family && depth >= v.depthMin && depth <= v.depthMax && rng.chance(v.chance)) { def = v; break; }
      }
    }
  }
  const x = def.typeIndex < 0 ? 5 : def.typeIndex;
  const { strength, hp } = rollStats(rng, def.family, depth, x);
  const speed = (1 / monsterPhaseSeconds(depth)) * def.speedMul;
  return {
    id: opts.id || `m${depth}-${Math.floor(rng.next() * 1e9)}`,
    kind: 'monster', type: def.rig || def.type, variant: def.rig ? def.type : null, name: def.name, family: def.family, typeIndex: def.typeIndex, glyph: def.glyph,
    x: 0, y: 0, px: 0, py: 0, facing: { dx: 0, dy: 1 },
    hp, maxHp: hp, initialHp: hp, strength, level: depth, xpValue: (strength + hp) * Math.max(1, depth),
    speed, moveTimer: rng.next() * 0.5, state: 'wander', target: null, lastSeen: null,
    invisible: def.special === 'invisible', special: def.special,
    flags: { thief: def.special === 'thief', blink: def.special === 'blink', flees: def.flees, follows: def.follows, invisible: def.special === 'invisible' },
    statusEffects: [], gold: 0, stolenGold: 0, wanderDir: null, fleeing: null, homeDepth: depth, size: def.size,
    pack: !!def.pack, haunt: def.haunt || null, ranged: def.ranged ? { ...def.ranged } : null,
    cooldowns: {}, lastLog: {}, searchLeft: 0, charging: null, lostAt: null, hadPrey: false,
  };
}

/** Quality prefix compared with the player's battle skill [VIC]. */
export function monsterPrefix(monster, playerSkill) {
  if (monster.special === 'mage' || monster.special === 'demon') return '';
  const r = (monster.strength / Math.max(1, playerSkill)) * 5;
  if (monster.family === 'creature') return r < 1 ? 'weak' : r > 6 ? 'power' : '';
  return r < 1 ? 'inferior' : r > 6 ? 'exper' : '';
}

/** "a weak dire wolf" / "an exper war lord". */
export function describeMonster(monster, playerSkill) {
  const prefix = monsterPrefix(monster, playerSkill);
  const words = `${prefix ? prefix + ' ' : ''}${monster.name.toLowerCase()}`;
  const article = /^[aeiou]/.test(words) ? 'an' : 'a';
  return `${article} ${words}`;
}
