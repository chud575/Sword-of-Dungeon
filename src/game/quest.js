// The Sword of Fargoal quest: placement, pickup, theft, timer and victory (DESIGN.md §1).
import { BALANCE } from '../core/constants.js';
import { createRng, seedFrom } from '../core/rng.js';
import { gainXp } from './player.js';

export const SWORD_TYPE = 'sword';

/** The depth the sword lies on for a given seed (15–19) [VIC: int(5*rnd+15)]. */
export function swordDepthForSeed(seed, balance = BALANCE.classic) {
  const rng = createRng(seedFrom(seed, 'quest'));
  return rng.int(balance.swordDepthMin, balance.swordDepthMax);
}

/** Initial quest state. */
export function createQuestState(seed, balance) {
  return {
    swordDepth: swordDepthForSeed(seed, balance),
    swordPos: null,      // {x,y} where the sword was originally placed
    swordFound: false,   // picked up at least once (XP doubling happens once)
    held: false,
    timer: null,         // seconds remaining once started; keeps running after theft
    timerTotal: balance.swordTimer,
    stolenCount: 0,
    lastTimerSecond: null,
  };
}

/** Place the sword item on a level (in place of the temple). */
export function placeSword(level, x, y) {
  return level.addItem({ type: SWORD_TYPE, x, y, qty: 1 });
}

/** Player picks the sword up: XP x2 (once), timer starts, Umla knows. */
export function pickupSword(game, item) {
  const p = game.player, q = game.state.quest;
  if (item) game.level.removeItem(item);
  p.hasSword = true;
  q.held = true;
  const first = !q.swordFound;
  q.swordFound = true;
  if (first) {
    gainXp(game, p.xp);
    q.timer = q.timerTotal;
    q.lastTimerSecond = Math.ceil(q.timer);
    game.log('THE SWORD OF FARGOAL!! Your experience doubles — and Umla knows where you are. Climb!', 'quest');
  } else {
    game.log('You reclaim the Sword of Fargoal. The clock is still running.', 'quest');
  }
  game.emit('sword:found', { first, x: p.x, y: p.y, remaining: q.timer });
  game.emit('sword:timer', { remaining: q.timer, total: q.timerTotal });
  game.emit('sfx:sword', {});
  return true;
}

/** Can this monster steal the sword right now? */
export function swordStealable(game) {
  const p = game.player;
  if (!p.hasSword) return false;
  const frac = game.balance.swordSafeBelowHpFraction || 0;
  if (frac > 0 && p.hp / p.maxHp < frac) return false;
  return true;
}

/** A monster-initiated attack while carrying the sword: it is stolen and returned to its level. */
export function stealSword(game, monster) {
  const p = game.player, q = game.state.quest;
  p.hasSword = false;
  q.held = false;
  q.stolenCount++;
  const swordLevel = game.getLevel(q.swordDepth);
  const pos = q.swordPos || swordLevel.temples[0] || swordLevel.stairsUp;
  if (!swordLevel.items.some((it) => it.type === SWORD_TYPE)) placeSword(swordLevel, pos.x, pos.y);
  game.level.removeEntity(monster);
  monster.state = 'dead';
  game.log(`THE SWORD IS STOLEN!! The ${monster.name.toLowerCase()} vanishes with it — back to level ${q.swordDepth}.`, 'danger');
  game.emit('sword:stolen', { by: monster, depth: q.swordDepth });
  game.emit('fx:sword-stolen', { x: p.x, y: p.y });
  game.emit('sfx:sword-stolen', {});
  return true;
}

/** Advance the sword countdown. Returns true if time ran out. */
export function tickQuest(game, dt) {
  const q = game.state.quest;
  if (q.timer === null || game.state.over) return false;
  q.timer = Math.max(0, q.timer - dt);
  const sec = Math.ceil(q.timer);
  if (sec !== q.lastTimerSecond) {
    q.lastTimerSecond = sec;
    game.emit('sword:timer', { remaining: q.timer, total: q.timerTotal });
    if (sec === 300 || sec === 60 || sec === 10) game.log(`TIMER: ${sec} seconds left!`, 'danger');
  }
  if (q.timer <= 0) {
    game.log('OUT OF TIME! Umla\'s magic seals the mountain forever.', 'danger');
    game.gameOver(false, 'timeout');
    return true;
  }
  return false;
}

/** Victory = standing on the surface (depth 0) with the sword. */
export function checkVictory(game) {
  return game.player.hasSword && game.state.depth === 0;
}
