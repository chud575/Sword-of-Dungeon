// Core constants, enums and balance tables for the Sword of Fargoal remake.
// Numbers marked [VIC] come from the original BASIC source (see docs/DESIGN.md).

/** Tile enum shared by generator, level, renderer and UI. */
export const TILE = {
  WALL: 0, FLOOR: 1, CORRIDOR: 2, STAIRS_DOWN: 3, STAIRS_UP: 4, PIT: 5, TEMPLE: 6, WATER: 7,
  DOOR: 8, TRAP_TELEPORT: 9, TRAP_PIT: 10, RUBBLE: 11,
};

/** Human-readable tile names, indexed by TILE value. */
export const TILE_NAMES = ['wall', 'floor', 'corridor', 'stairs down', 'stairs up', 'pit', 'temple',
  'water', 'door', 'teleport trap', 'pit trap', 'rubble'];

/** One tile = one world unit in the renderer. */
export const TILE_SIZE = 1;

/** Fixed simulation step in seconds. */
export const SIM_DT = 1 / 30;

/** Default map size [designed]: the classic 40x24 map scaled up so rooms breathe. */
export const MAP_WIDTH = 48;
export const MAP_HEIGHT = 32;

/** 8 compass directions, clockwise from north. */
export const DIRS8 = [
  { dx: 0, dy: -1, name: 'n' }, { dx: 1, dy: -1, name: 'ne' }, { dx: 1, dy: 0, name: 'e' },
  { dx: 1, dy: 1, name: 'se' }, { dx: 0, dy: 1, name: 's' }, { dx: -1, dy: 1, name: 'sw' },
  { dx: -1, dy: 0, name: 'w' }, { dx: -1, dy: -1, name: 'nw' },
];
/** 4 cardinal directions. */
export const DIRS4 = [DIRS8[0], DIRS8[2], DIRS8[4], DIRS8[6]];

/** Palette (C64 colours from DESIGN.md §8.3 plus modern accents). */
export const COLORS = {
  black: '#000000', white: '#ffffff', yellow: '#d0dc71', darkGrey: '#555555', grey: '#808080',
  lightRed: '#bb776d', green: '#68a941', red: '#894036',
  gold: '#e8c15a', ink: '#1a1410', parchment: '#e9dcc0', brass: '#b08d3c',
  magic: '#7fd4ff', danger: '#ff5a48', loot: '#ffd866', quest: '#c58cff', info: '#cfd8dc', combat: '#ff9b6a',
  spells: { teleport: '#4ee1ff', shield: '#ffd43b', regeneration: '#69db7c', invisibility: '#b197fc', light: '#fff3bf', drift: '#e9ecef' },
};

/** Combat words printed each round [VIC DATA]. */
export const COMBAT_WORDS = {
  creature: ['CRUNCH', 'CLAW', 'GNARL', 'UGH!', 'GROWL!', 'SHRED', 'THUMP'],
  human: ['CLANG', 'OUCH!', 'SLASH', 'CLINK', 'CHOP', 'THUD', 'SHRIEK!'],
};

/** XP needed to reach experience level n (cumulative) [VIC 58, 88]. */
export function xpForLevel(n) {
  return n <= 1 ? 0 : 200 * 2 ** (n - 2);
}

/** Monster phase length in seconds for a dungeon depth [designed mapping of `20 - level` polls]. */
export function monsterPhaseSeconds(depth) {
  return Math.max(0.2, (20 - depth) / 6);
}

const CLASSIC = {
  name: 'classic',
  rolledStats: true,          // 3*int(6*rnd+1) HP and skill
  startHp: 12, startSkill: 8,
  swordTimer: 2000,           // seconds [manual]
  swordDepthMin: 15, swordDepthMax: 19,
  mageDemonMinDepth: 14,
  wanderMultiplier: 1,
  permadeath: true,
  swordSafeBelowHpFraction: 0, // Story mode: sword cannot be stolen below this HP fraction
  playerStepTime: 1 / 6,      // seconds per tile at full pace
  combatRoundTime: 0.25,      // seconds per exchange
  idleTickTime: 0.1,          // regeneration tick
  autohealRate: 50,
  goldCapacity: 100, sackCapacity: 100,
  maxBuriedCaches: 10,
  fovRadius: 6, lightFovRadius: 10,
  aggroRange: 9, hearRange: 2, spiderBlinkRange: 3,
  wanderFirst: 90, wanderPerKill: 10, wanderRepeat: 60, wanderMinDistance: 8,
  deathHp: -5,
  followDistance: 2,
  autoSacrifice: false,
};

/** Balance tables per difficulty. */
export const BALANCE = {
  classic: CLASSIC,
  standard: { ...CLASSIC, name: 'standard', rolledStats: false },
  story: { ...CLASSIC, name: 'story', rolledStats: false, permadeath: false, swordTimer: 3000, swordSafeBelowHpFraction: 0.5 },
  nightmare: { ...CLASSIC, name: 'nightmare', rolledStats: false, wanderMultiplier: 2, mageDemonMinDepth: 10, swordTimer: 1500 },
};

export const DIFFICULTIES = Object.keys(BALANCE);

/** Log message kinds. */
export const LOG_KINDS = ['info', 'combat', 'loot', 'danger', 'magic', 'quest'];
