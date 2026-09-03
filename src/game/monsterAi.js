// Monster AI (DESIGN.md §4.4 + §9 "extended bestiary"): perception (sight with a rear blind arc, hearing of
// footsteps and fights), a state machine (idle/wander/search/hunt/lurk/flee), pack tactics (alarm howls,
// surrounding, morale), ranged abilities (dragon breath with a telegraph, caster bolts, ranger arrows,
// kiting), and specials (dimension spider blink, mage vanish, assassins haunting the stairs, thieves running
// for the dark and turning at bay when cornered).
//
// Classic rules keep the VIC behaviours (chase / wander / blink / steal); the extended behaviours are used on
// every other difficulty (`extendedRules(game)`).
//
// Events emitted here (all payloads carry `entity` where relevant) so VFX/audio can react to every beat:
//   monster:noticed {entity, how:'sight'|'sound'|'pack'}   monster:heard {entity, x, y, kind}
//   monster:search {entity, x, y, why}                     monster:lost {entity}
//   monster:lurk {entity}                                  monster:alert {entity, allies:[id]}
//   monster:flee {entity, reason:'coward'|'escape'|'morale'} monster:cornered {entity}
//   monster:telegraph {entity, kind, dx, dy, length}       monster:cast {entity, kind, x, y, target}
//   monster:blink {entity, from, to}                       monster:escaped {entity}
//   fx:breath {entity, x, y, dx, dy, length, tiles, kind, color, hit}
//   fx:projectile {entity, from, to, kind, color, hit}     fx:stagger {entity}
//   spell:lost {spell, by}                                 sfx:howl {family, type}  sfx:breath {kind}  sfx:cast {kind}  sfx:arrow {hit}
//   entity:attacked {..., ranged:true, kind}               (same shape as melee, so hit VFX/damage numbers work)
import { TILE, DIRS8 } from '../core/constants.js';
import { aStar } from '../world/pathfinding.js';
import { lineOfSight } from '../world/fov.js';
import { hasStatus, damagePlayer } from './player.js';

/** AI tuning [designed]. Paces multiply the per-depth monster phase rate by state. */
export const AI = {
  pace: { idle: 0.5, wander: 0.55, search: 0.85, lurk: 0.75, hunt: 1, flee: 1.25 },
  noiseLife: 1.6,          // seconds a noise can still be heard
  combatNoise: 7,          // radius of a clashing fight
  footstepWindow: 0.6,     // seconds after a step during which the player is "moving" (audible)
  stepNoise: 3,            // radius of footsteps
  searchActs: 7, searchRadius: 3,
  lurkActs: 16, lurkRadius: 3,
  behindArcDot: -0.3, behindMinDist: 3, behindNoticeChance: 0.35,
  packRange: 10, howlCooldown: 12, moraleRange: 6, moraleChance: 0.4,
  fleeHpFraction: 0.25,
  blinkCooldown: 3, vanishHp: 0.6, vanishCooldown: 6,
  goldLureRange: 5,
  logCooldown: 2.5,
};

/** Non-classic difficulties use the extended behaviours (ranged attacks, lurking, kiting, morale). */
export function extendedRules(game) {
  const b = game.balance || {};
  return b.extendedBestiary ?? b.name !== 'classic';
}

const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const sgn = Math.sign;

/** Can the player see this monster? (tile visible, and not invisible unless Light is on) */
export function monsterVisibleToPlayer(game, monster) {
  if (monster.state === 'dead') return false;
  if (!game.level || !game.level.isVisible(monster.x, monster.y)) return false;
  if (monster.invisible && !game.lightOn()) return false;
  return true;
}

/** Fields the AI relies on; also upgrades entities from older saves. */
export function initAiFields(m) {
  m.cooldowns = m.cooldowns || {};
  m.lastLog = m.lastLog || {};
  m.target = m.target || null;
  m.searchLeft = m.searchLeft || 0;
  m.charging = m.charging || null;
  m.lostAt = m.lostAt ?? null;
  m.hadPrey = !!m.hadPrey;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Noise (transient, per level, not serialized)

/** Register a noise at (x,y) heard within radius r at time t. */
export function makeNoise(level, x, y, r, t, kind = 'noise') {
  if (!level) return;
  if (!level.noises) level.noises = [];
  level.noises.push({ x, y, r, t, kind });
  if (level.noises.length > 16) level.noises.splice(0, level.noises.length - 16);
}

function pruneNoises(level, now) {
  if (!level.noises || !level.noises.length) return;
  level.noises = level.noises.filter((n) => now - n.t <= AI.noiseLife);
}

// ---------------------------------------------------------------------------------------------
// Logging (only when the player can see the monster, rate-limited per beat)

function say(game, m, text, kind = 'info', key = text, { force = false, cooldown = AI.logCooldown } = {}) {
  if (!force && !monsterVisibleToPlayer(game, m)) return false;
  const now = game.state.time;
  const last = m.lastLog[key];
  if (last !== undefined && now - last < cooldown) return false;
  m.lastLog[key] = now;
  game.log(text, kind);
  return true;
}

/** A log line shared by the whole level (e.g. "something stirs"), rate-limited per key. */
function sayLevel(game, key, text, kind = 'info', cooldown = 6) {
  const level = game.level, now = game.state.time;
  if (!level.lastSay) level.lastSay = {};
  if (level.lastSay[key] !== undefined && now - level.lastSay[key] < cooldown) return false;
  level.lastSay[key] = now;
  game.log(text, kind);
  return true;
}

const lower = (m) => m.name.toLowerCase();

// ---------------------------------------------------------------------------------------------
// Perception

function facingDot(m, tx, ty) {
  const f = m.facing || { dx: 0, dy: 1 };
  const dx = tx - m.x, dy = ty - m.y;
  const len = Math.hypot(dx, dy) || 1, fl = Math.hypot(f.dx, f.dy) || 1;
  return (f.dx * dx + f.dy * dy) / (len * fl);
}

/**
 * What a monster perceives this act.
 * @returns {{dist:number, hidden:boolean, sees:boolean, hears:{x:number,y:number,kind:string}|null}}
 */
export function perceive(game, m) {
  const p = game.player, level = game.level, B = game.balance, s = game.state, rng = game.rngs.ai;
  const dist = cheb(m.x, m.y, p.x, p.y);
  const hidden = game.isPlayerHiddenFrom(m);
  const out = { dist, hidden, sees: false, hears: null };
  if (hidden) return out; // sanctuary / invisibility: neither sight nor sound
  // Symmetric FOV: the player's visible mask covering my tile == I can see the player.
  if (dist <= B.aggroRange && level.isVisible(m.x, m.y)) {
    const behind = m.state !== 'hunt' && dist >= AI.behindMinDist && facingDot(m, p.x, p.y) < AI.behindArcDot;
    out.sees = !behind || rng.chance(AI.behindNoticeChance);
  }
  if (!out.sees) {
    const moving = s.time - (p.lastMoveTime || 0) < AI.footstepWindow;
    if (moving && dist <= AI.stepNoise) out.hears = { x: p.x, y: p.y, kind: 'steps' };
    else if (dist <= B.hearRange) out.hears = { x: p.x, y: p.y, kind: 'breathing' };
    else if (level.noises) {
      for (const n of level.noises) {
        if (s.time - n.t <= AI.noiseLife && cheb(m.x, m.y, n.x, n.y) <= n.r) { out.hears = { x: n.x, y: n.y, kind: n.kind }; break; }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Movement primitives

/** A monster may enter a tile if walkable, not the temple, not occupied. */
export function monsterCanEnter(game, m, x, y, { allowPits = false } = {}) {
  const level = game.level;
  const t = level.get(x, y);
  if (t === TILE.WALL || t === TILE.TEMPLE) return false;
  if (!allowPits && (t === TILE.PIT || t === TILE.TRAP_PIT)) return false;
  const e = level.entityAt(x, y);
  if (e && e !== m) return false;
  return true;
}

/** Step a monster to a tile, applying tile consequences (pits kill creatures, humans grab gold). */
export function stepMonster(game, m, nx, ny) {
  const level = game.level;
  const fromX = m.x, fromY = m.y;
  m.facing = { dx: sgn(nx - fromX), dy: sgn(ny - fromY) };
  m.x = nx; m.y = ny;
  game.emit('entity:moved', { entity: m, fromX, fromY, toX: nx, toY: ny });
  const t = level.get(nx, ny);
  if (t === TILE.PIT && m.family === 'creature') {
    game.killMonster(m, 'pit');
    return;
  }
  if (m.family === 'human') {
    for (const it of level.itemsAt(nx, ny)) {
      if (it.type === 'gold' && !it.hidden) {
        level.removeItem(it);
        m.gold += it.gold || 0;
        say(game, m, `The ${lower(m)} snatches a sack of gold.`, 'info', 'gold', { cooldown: 1 });
        game.emit('monster:looted', { entity: m, gold: it.gold || 0, x: nx, y: ny });
      }
    }
  }
}

function options8(game, m, { allowPits = false } = {}) {
  const level = game.level;
  return DIRS8.filter((o) => level.canStep(m.x, m.y, o.dx, o.dy) && monsterCanEnter(game, m, m.x + o.dx, m.y + o.dy, { allowPits }));
}

function greedyStep(game, m, tx, ty, allowPits) {
  const dx = sgn(tx - m.x), dy = sgn(ty - m.y);
  const tries = [[dx, dy], [0, dy], [dx, 0]];
  for (const [ddx, ddy] of tries) {
    if (ddx === 0 && ddy === 0) continue;
    if (!game.level.canStep(m.x, m.y, ddx, ddy)) continue;
    if (!monsterCanEnter(game, m, m.x + ddx, m.y + ddy, { allowPits })) continue;
    stepMonster(game, m, m.x + ddx, m.y + ddy);
    return true;
  }
  const rng = game.rngs.ai;
  for (let i = 0; i < 5; i++) {
    const d = rng.pick(DIRS8);
    if (game.level.canStep(m.x, m.y, d.dx, d.dy) && monsterCanEnter(game, m, m.x + d.dx, m.y + d.dy, { allowPits })) {
      stepMonster(game, m, m.x + d.dx, m.y + d.dy);
      return true;
    }
  }
  return false;
}

/** One A* step toward (tx,ty); creatures can be baited into pits at close range. */
export function pathStep(game, m, tx, ty, { maxNodes = 600 } = {}) {
  const level = game.level;
  if (m.x === tx && m.y === ty) return false;
  const near = cheb(m.x, m.y, tx, ty) <= 2;
  const allowPits = m.family === 'creature' && near;
  const path = aStar(level, { x: m.x, y: m.y }, { x: tx, y: ty }, {
    maxNodes,
    passable: (x, y) => monsterCanEnter(game, m, x, y, { allowPits }),
  });
  if (path && path.length) {
    const s = path[0];
    if (monsterCanEnter(game, m, s.x, s.y, { allowPits: true })) { stepMonster(game, m, s.x, s.y); return true; }
  }
  return greedyStep(game, m, tx, ty, allowPits);
}

/** Step that maximises distance from (fx,fy); returns false when no step gains ground (cornered). */
function awayStep(game, m, fx, fy, { preferUnexplored = false, keepLos = false } = {}) {
  const level = game.level, rng = game.rngs.ai;
  const opts = options8(game, m);
  if (!opts.length) return false;
  const dNow = cheb(m.x, m.y, fx, fy);
  let best = null, bestScore = 0;
  for (const o of opts) {
    const nx = m.x + o.dx, ny = m.y + o.dy;
    let score = cheb(nx, ny, fx, fy) - dNow;
    if (score <= 0) continue;
    if (preferUnexplored && !level.isExplored(nx, ny)) score += 2;
    if (level.get(nx, ny) === TILE.CORRIDOR) score += 0.3;
    if (keepLos && lineOfSight(level, nx, ny, fx, fy)) score += 0.8;
    score += rng.next() * 0.5;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  if (!best) return false;
  stepMonster(game, m, m.x + best.dx, m.y + best.dy);
  return true;
}

// ---------------------------------------------------------------------------------------------
// State transitions

function notice(game, m, how) {
  const p = game.player;
  const was = m.state;
  m.state = 'hunt'; m.hadPrey = true; m.lostAt = null; m.searchLeft = 0;
  m.lastSeen = { x: p.x, y: p.y }; m.target = m.lastSeen;
  if (was !== 'hunt') {
    const name = lower(m);
    const answering = was === 'search' && m.hadPrey; // came running to a howl / a fight it heard
    const line = answering
      ? (m.family === 'human' ? `The ${name} rushes in, blade raised!` : `The ${name} bounds out of the dark, snarling!`)
      : m.family === 'human'
        ? (how === 'sound' ? `The ${name} whirls toward the sound of your steps!` : `The ${name} spots you and draws steel!`)
        : (how === 'sound' ? `The ${name} lifts its head and sniffs the air...` : `The ${name} catches sight of you!`);
    if (answering) { if (monsterVisibleToPlayer(game, m)) sayLevel(game, `answer:${m.type}`, line, 'danger', 2); }
    else say(game, m, line, 'danger', 'notice');
    game.emit('monster:noticed', { entity: m, how: answering ? 'pack' : how });
    if (m.pack && !answering) howl(game, m);
  }
}

function startSearch(game, m, at, why) {
  if (m.state === 'flee') return;
  const was = m.state;
  m.state = 'search';
  m.target = { x: at.x, y: at.y };
  m.searchOrigin = { x: at.x, y: at.y };
  m.searchLeft = AI.searchActs;
  if (was !== 'search') {
    if (why === 'sound') {
      const seen = monsterVisibleToPlayer(game, m);
      if (seen) say(game, m, `The ${lower(m)} pauses, listening.`, 'info', 'listen');
      else sayLevel(game, 'stir', m.family === 'human' ? 'You hear a voice mutter in the dark nearby...' : 'Something stirs in the dark nearby...', 'danger', 8);
      game.emit('monster:heard', { entity: m, x: at.x, y: at.y, kind: at.kind || 'noise' });
    } else if (why === 'lost') {
      say(game, m, `The ${lower(m)} casts about for you.`, 'info', 'search');
    }
    game.emit('monster:search', { entity: m, x: at.x, y: at.y, why });
  }
}

function loseTrail(game, m) {
  const had = m.hadPrey;
  m.state = 'wander'; m.target = null; m.lastSeen = null; m.searchLeft = 0; m.charging = null;
  if (had) { say(game, m, `The ${lower(m)} loses your trail.`, 'info', 'lost'); game.emit('monster:lost', { entity: m }); }
  m.hadPrey = false;
}

function startLurk(game, m) {
  m.state = 'lurk'; m.lurkLeft = AI.lurkActs; m.charging = null; m.target = null;
  say(game, m, `The ${lower(m)} prowls the edge of the sanctuary, unable to enter.`, 'info', 'lurk', { cooldown: 8 });
  game.emit('monster:lurk', { entity: m });
}

export function startFlee(game, m, reason) {
  if (m.state === 'flee' && m.fleeing === reason) return;
  m.state = 'flee'; m.fleeing = reason; m.charging = null; m.target = null;
  const name = lower(m);
  if (reason === 'coward') say(game, m, `The ${name} turns and runs!`, 'info', 'flee');
  else if (reason === 'morale') say(game, m, `The ${name}'s nerve breaks — it bolts!`, 'info', 'flee');
  game.emit('monster:flee', { entity: m, reason });
}

/** Pack alarm: nearby kin come to investigate where the player was seen. */
function howl(game, m) {
  if ((m.cooldowns.howl || 0) > 0) return;
  m.cooldowns.howl = AI.howlCooldown;
  const p = game.player, level = game.level, now = game.state.time;
  // one alarm per pack: kin already roused by a recent howl of this type just join it
  if (!level.lastHowl) level.lastHowl = {};
  if (level.lastHowl[m.type] !== undefined && now - level.lastHowl[m.type] < 10) return;
  level.lastHowl[m.type] = now;
  const allies = level.monsters.filter((o) => o !== m && o.type === m.type && o.state !== 'hunt' && o.state !== 'flee' && cheb(o.x, o.y, m.x, m.y) <= AI.packRange);
  for (const o of allies) { initAiFields(o); startSearch(game, o, { x: p.x, y: p.y, kind: 'howl' }, 'pack'); o.hadPrey = true; }
  const name = lower(m);
  const line = m.family === 'human'
    ? (allies.length ? `The ${name} shouts an alarm — boots clatter in the dark!` : `The ${name} shouts a challenge!`)
    : (allies.length ? `The ${name} howls — answering snarls echo through the dark!` : `The ${name} howls!`);
  say(game, m, line, 'danger', 'howl', { force: allies.length > 0, cooldown: 6 });
  game.emit('monster:alert', { entity: m, allies: allies.map((o) => o.id) });
  game.emit('sfx:howl', { family: m.family, type: m.type });
}

/** Called when a monster dies: kin may break, and the clash draws others. */
export function onMonsterSlain(game, dead) {
  const level = game.level, rng = game.rngs.ai, p = game.player;
  if (!level) return;
  for (const o of level.monsters) {
    if (o === dead || cheb(o.x, o.y, dead.x, dead.y) > AI.moraleRange) continue;
    initAiFields(o);
    const kin = o.type === dead.type || (o.pack && o.family === dead.family);
    if (kin && o.flags.flees && o.state !== 'flee' && rng.chance(AI.moraleChance)) startFlee(game, o, 'morale');
    else if (o.state === 'wander' || o.state === 'idle') startSearch(game, o, { x: p.x, y: p.y, kind: 'combat' }, 'sound');
  }
}

/** A crit interrupts and delays a monster (breath charges are lost). */
export function stagger(game, m) {
  if (!m || m.state === 'dead') return;
  m.moveTimer = Math.min(m.moveTimer || 0, -0.6);
  if (m.charging) { m.charging = null; say(game, m, `The ${lower(m)}'s breath is knocked out of it!`, 'combat', 'interrupt', { cooldown: 1 }); }
  game.emit('fx:stagger', { entity: m });
}

// ---------------------------------------------------------------------------------------------
// Ranged abilities

function isAligned(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
}

function ready(m, key) { return !(m.cooldowns[key] > 0); }

function tickCooldowns(m) {
  for (const k of Object.keys(m.cooldowns)) if (m.cooldowns[k] > 0) m.cooldowns[k]--;
}

/** Ranged/breath damage: x·4·depth·rnd·mul + 1, shield blocks [designed, scaled from the VIC melee formula]. */
function rangedDamage(game, m, mul) {
  const p = game.player, depth = Math.max(1, game.level.depth), rng = game.rngs.combat;
  const x = m.strength / Math.max(1, p.skill);
  const roll = rng.next();
  if (hasStatus(p, 'shield')) return { damage: 0, crit: false, roll };
  return { damage: Math.floor(x * 4 * depth * roll * mul + 1), crit: roll > 0.9, roll };
}

/** Apply a ranged hit on the player with all the usual beats. */
function landRangedHit(game, m, kind, word, mul) {
  const p = game.player;
  const { damage, crit } = rangedDamage(game, m, mul);
  damagePlayer(game, damage, m);
  const inFight = !!game.state.combat;
  const dead = inFight ? p.hp < game.balance.deathHp : false;
  game.emit('entity:attacked', { attacker: m, defender: p, damage, killed: dead, crit, ranged: true, kind });
  game.emit('sfx:hit', { family: m.family, by: 'monster', kind });
  game.log(damage > 0 ? `HITS: ${p.hp} ${word}${crit ? ' — a searing blow!' : ''}` : `Your shield turns the ${kind}. ${word}`, 'combat');
  if (dead) game.die('slain', m);
  return { damage, crit };
}

/** Dragon breath: fire along the charged direction, up to `length` tiles or the first wall. */
function fireBreath(game, m) {
  const p = game.player, level = game.level, r = m.ranged;
  const { dx, dy } = m.charging;
  m.charging = null;
  m.cooldowns.ranged = r.cooldown;
  m.facing = { dx, dy };
  const tiles = [];
  let hit = false;
  for (let i = 1; i <= r.length; i++) {
    const x = m.x + dx * i, y = m.y + dy * i;
    if (level.isOpaque(x, y)) break;
    tiles.push({ x, y });
    if (p.x === x && p.y === y && !game.isPlayerHiddenFrom(m)) hit = true;
  }
  game.emit('fx:breath', { entity: m, x: m.x, y: m.y, dx, dy, length: tiles.length, tiles, kind: r.kind, color: r.color, hit });
  game.emit('sfx:breath', { kind: r.kind, type: m.type });
  game.emit('monster:cast', { entity: m, kind: r.kind, x: m.x, y: m.y, target: { x: m.x + dx * r.length, y: m.y + dy * r.length } });
  if (hit) landRangedHit(game, m, r.kind, r.word, r.mul);
  else say(game, m, r.missText.replace('%s', lower(m)), 'combat', 'miss', { force: level.isVisible(m.x, m.y), cooldown: 1 });
  return true;
}

/** Caster bolt / ranger arrow: instant projectile with a hit roll (bolts always hit). */
function castBolt(game, m) {
  const p = game.player, r = m.ranged, rng = game.rngs.ai;
  m.cooldowns.ranged = r.cooldown;
  m.facing = { dx: sgn(p.x - m.x), dy: sgn(p.y - m.y) };
  const hit = r.hitChance >= 1 || rng.chance(r.hitChance);
  game.emit('monster:cast', { entity: m, kind: r.kind, x: m.x, y: m.y, target: { x: p.x, y: p.y } });
  game.emit('fx:projectile', { entity: m, from: { x: m.x, y: m.y }, to: { x: p.x, y: p.y }, kind: r.kind, color: r.color, hit });
  game.emit(r.kind === 'arrow' ? 'sfx:arrow' : 'sfx:cast', { kind: r.kind, hit, type: m.type });
  if (r.castText) say(game, m, r.castText.replace('%s', lower(m)), 'magic', 'cast', { force: true, cooldown: 1.5 });
  if (!hit) { say(game, m, r.missText.replace('%s', lower(m)), 'combat', 'miss', { force: true, cooldown: 1 }); return true; }
  const { damage } = landRangedHit(game, m, r.kind, r.word, r.mul);
  if (damage > 0 && r.drain && !game.state.over && rng.chance(r.drain)) {
    const have = Object.keys(p.spells).filter((k) => p.spells[k] > 0);
    if (have.length) {
      const spell = rng.pick(have);
      p.spells[spell]--;
      game.log(`The ${lower(m)}'s bolt tears the ${spell} spell from your mind!`, 'danger');
      game.emit('spell:lost', { spell, by: m });
    }
  }
  return true;
}

/** Sidestep to bring the player onto one of the eight breath lines. */
function alignStep(game, m) {
  const p = game.player, level = game.level, rng = game.rngs.ai;
  const opts = options8(game, m).filter((o) => {
    const nx = m.x + o.dx, ny = m.y + o.dy;
    return isAligned(nx, ny, p.x, p.y) && cheb(nx, ny, p.x, p.y) >= m.ranged.min && lineOfSight(level, nx, ny, p.x, p.y);
  });
  if (!opts.length) return false;
  const o = rng.pick(opts);
  stepMonster(game, m, m.x + o.dx, m.y + o.dy);
  return true;
}

/**
 * Ranged behaviour while hunting a seen player. Returns true when the act was consumed.
 */
function rangedAct(game, m, per) {
  const p = game.player, level = game.level, r = m.ranged, dist = per.dist;
  if (m.charging) return fireBreath(game, m);
  const los = lineOfSight(level, m.x, m.y, p.x, p.y);
  const inRange = dist >= r.min && dist <= r.max;
  if (r.kite && dist < r.min) {
    if (awayStep(game, m, p.x, p.y, { keepLos: true })) { say(game, m, `The ${lower(m)} backs away, keeping its distance.`, 'info', 'kite', { cooldown: 4 }); return true; }
    if (m.special === 'mage' || m.special === 'warlock') return false; // cornered casters fall back on their touch / melee
    return false;
  }
  if (inRange && los && ready(m, 'ranged')) {
    if (r.telegraph) {
      if (!isAligned(m.x, m.y, p.x, p.y)) return alignStep(game, m);
      m.charging = { dx: sgn(p.x - m.x), dy: sgn(p.y - m.y) };
      m.facing = { ...m.charging };
      say(game, m, r.chargeText.replace('%s', lower(m)), 'danger', 'charge', { force: level.isVisible(m.x, m.y), cooldown: 1 });
      game.emit('monster:telegraph', { entity: m, kind: r.kind, dx: m.charging.dx, dy: m.charging.dy, length: r.length, color: r.color });
      return true;
    }
    return castBolt(game, m);
  }
  if (r.kite && inRange && los) return true; // in the pocket, recharging: hold ground
  return false; // close in (regain line of sight / range)
}

// ---------------------------------------------------------------------------------------------
// Specials

function spiderBlink(game, m) {
  const p = game.player, rng = game.rngs.ai;
  const spots = DIRS8.map((d) => ({ x: p.x + d.dx, y: p.y + d.dy })).filter((s) => monsterCanEnter(game, m, s.x, s.y));
  if (!spots.length) return false;
  const s = rng.pick(spots);
  const from = { x: m.x, y: m.y };
  m.x = s.x; m.y = s.y;
  m.facing = { dx: sgn(p.x - s.x), dy: sgn(p.y - s.y) };
  m.cooldowns.blink = AI.blinkCooldown;
  game.emit('entity:moved', { entity: m, fromX: from.x, fromY: from.y, toX: s.x, toY: s.y, blink: true });
  game.emit('fx:blink', { entity: m, x: s.x, y: s.y, from });
  game.emit('monster:blink', { entity: m, from, to: { x: s.x, y: s.y } });
  game.log('The dimension spider phases in beside you!', 'danger');
  return true;
}

/** Wounded mage: vanish in smoke and reappear a few tiles away. */
function mageVanish(game, m) {
  const level = game.level, rng = game.rngs.ai, p = game.player;
  const spot = level.randomFloorTile(rng, { plainOnly: true, filter: (x, y) => { const d = cheb(x, y, p.x, p.y); return d >= 3 && d <= 7 && !level.isTemple(x, y); } });
  if (!spot) return false;
  const from = { x: m.x, y: m.y };
  m.x = spot.x; m.y = spot.y;
  m.cooldowns.vanish = AI.vanishCooldown; m.cooldowns.ranged = Math.max(m.cooldowns.ranged || 0, 1);
  game.emit('entity:moved', { entity: m, fromX: from.x, fromY: from.y, toX: spot.x, toY: spot.y, blink: true });
  game.emit('fx:blink', { entity: m, x: from.x, y: from.y, from });
  game.emit('monster:blink', { entity: m, from, to: { x: spot.x, y: spot.y } });
  game.log(`The ${lower(m)} vanishes in a wisp of smoke!`, 'magic');
  if (game.state.combat && game.state.combat.monsterId === m.id) game.endCombat('vanished');
  return true;
}

// ---------------------------------------------------------------------------------------------
// State behaviours

/** Free tile adjacent to the target that is closest to the monster (so packs surround instead of queueing). */
function surroundTile(game, m, tx, ty) {
  const rng = game.rngs.ai;
  let best = null, bestD = Infinity;
  for (const d of DIRS8) {
    const x = tx + d.dx, y = ty + d.dy;
    if (!game.level.canStep(tx, ty, d.dx, d.dy)) continue;
    if (!(x === m.x && y === m.y) && !monsterCanEnter(game, m, x, y)) continue;
    const dd = cheb(m.x, m.y, x, y) + rng.next() * 0.3;
    if (dd < bestD) { bestD = dd; best = { x, y }; }
  }
  return best;
}

function huntAct(game, m, per, ext) {
  const p = game.player, level = game.level, B = game.balance, dist = per.dist;
  const target = m.lastSeen || { x: p.x, y: p.y };
  const playerThere = p.x === target.x && p.y === target.y;
  // Specials
  if (m.flags.blink && per.sees && dist <= B.spiderBlinkRange && dist > 1 && ready(m, 'blink') && spiderBlink(game, m)) return;
  if (ext && m.special === 'mage' && m.hp < m.maxHp * AI.vanishHp && ready(m, 'vanish') && dist <= 2 && mageVanish(game, m)) return;
  if (ext && m.ranged && per.sees && rangedAct(game, m, per)) return;
  // Melee reach
  if (dist <= 1 && !per.hidden && level.canStep(m.x, m.y, p.x - m.x, p.y - m.y)) { game.monsterAttack(m); return; }
  // Close in: surround when the prey is in sight, else march on the last known position.
  if ((per.sees || playerThere) && dist <= 4) {
    const goal = surroundTile(game, m, target.x, target.y);
    if (goal && !(goal.x === m.x && goal.y === m.y) && pathStep(game, m, goal.x, goal.y)) return;
  }
  if (m.x === target.x && m.y === target.y || (!per.sees && !playerThere && cheb(m.x, m.y, target.x, target.y) <= 1)) {
    startSearch(game, m, target, 'lost');
    searchAct(game, m, per);
    return;
  }
  if (!pathStep(game, m, target.x, target.y)) {
    // boxed in: keep facing the prey
    m.facing = { dx: sgn(p.x - m.x) || m.facing.dx, dy: sgn(p.y - m.y) || m.facing.dy };
  }
}

function searchAct(game, m, per) {
  const level = game.level, rng = game.rngs.ai;
  void per;
  if (m.searchLeft <= 0) { loseTrail(game, m); return; }
  m.searchLeft--;
  const origin = m.searchOrigin || m.target || { x: m.x, y: m.y };
  if (!m.target || (m.x === m.target.x && m.y === m.target.y) || rng.chance(0.15)) {
    const cands = [];
    for (let dy = -AI.searchRadius; dy <= AI.searchRadius; dy++) for (let dx = -AI.searchRadius; dx <= AI.searchRadius; dx++) {
      const x = origin.x + dx, y = origin.y + dy;
      if ((x === m.x && y === m.y) || !level.isWalkable(x, y) || level.isTemple(x, y)) continue;
      cands.push({ x, y });
    }
    m.target = cands.length ? rng.pick(cands) : { x: origin.x, y: origin.y };
  }
  if (!pathStep(game, m, m.target.x, m.target.y, { maxNodes: 300 })) m.target = null;
}

function lurkAct(game, m, per) {
  const p = game.player, level = game.level, rng = game.rngs.ai;
  if (!per.hidden) { notice(game, m, 'sight'); huntAct(game, m, per, true); return; }
  if (!game.playerOnSanctuary() || (m.lurkLeft = (m.lurkLeft ?? AI.lurkActs) - 1) <= 0) { loseTrail(game, m); return; }
  // circle the sanctuary at a respectful distance
  if (!m.target || (m.x === m.target.x && m.y === m.target.y) || rng.chance(0.3)) {
    const cands = [];
    for (let dy = -AI.lurkRadius - 1; dy <= AI.lurkRadius + 1; dy++) for (let dx = -AI.lurkRadius - 1; dx <= AI.lurkRadius + 1; dx++) {
      const x = p.x + dx, y = p.y + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (d < 2 || !level.isWalkable(x, y) || level.isTemple(x, y) || (x === m.x && y === m.y)) continue;
      cands.push({ x, y });
    }
    m.target = cands.length ? rng.pick(cands) : null;
  }
  if (m.target && !pathStep(game, m, m.target.x, m.target.y, { maxNodes: 300 })) m.target = null;
  m.facing = { dx: sgn(p.x - m.x) || m.facing.dx, dy: sgn(p.y - m.y) || m.facing.dy };
}

function wanderAct(game, m, per) {
  const rng = game.rngs.ai, level = game.level, B = game.balance;
  // Unaware monsters far from the player drift lazily.
  if (per.dist > B.aggroRange * 2 && rng.chance(0.5)) return;
  // Humans are drawn to loose gold; assassins haunt the down stairs.
  if (m.family === 'human' && rng.chance(0.7)) {
    let best = null, bestD = AI.goldLureRange + 1;
    for (const it of level.items) {
      if (it.type !== 'gold' || it.hidden) continue;
      const d = cheb(m.x, m.y, it.x, it.y);
      if (d < bestD) { bestD = d; best = it; }
    }
    if (best && pathStep(game, m, best.x, best.y, { maxNodes: 200 })) return;
  }
  if (m.haunt === 'stairs' && level.stairsDown && cheb(m.x, m.y, level.stairsDown.x, level.stairsDown.y) > 4 && rng.chance(0.6)) {
    if (pathStep(game, m, level.stairsDown.x, level.stairsDown.y, { maxNodes: 300 })) return;
  }
  if (rng.chance(0.3)) return; // pause now and then
  let d = m.wanderDir;
  if (!d || rng.chance(0.25) || !level.canStep(m.x, m.y, d.dx, d.dy) || !monsterCanEnter(game, m, m.x + d.dx, m.y + d.dy)) {
    const options = options8(game, m);
    if (!options.length) { m.wanderDir = null; return; }
    d = rng.pick(options);
    m.wanderDir = { dx: d.dx, dy: d.dy };
  }
  stepMonster(game, m, m.x + d.dx, m.y + d.dy);
}

function fleeAct(game, m, per) {
  const p = game.player, level = game.level, B = game.balance, dist = per.dist;
  const moved = awayStep(game, m, p.x, p.y, { preferUnexplored: m.fleeing === 'escape' });
  if (m.state === 'dead') return;
  if (!moved) {
    if (dist <= 1 && !per.hidden) {
      // Cornered: turn at bay.
      m.state = 'hunt'; m.fleeing = null; m.lastSeen = { x: p.x, y: p.y }; m.target = m.lastSeen;
      say(game, m, `Cornered, the ${lower(m)} turns at bay!`, 'danger', 'bay');
      game.emit('monster:cornered', { entity: m });
      if (level.canStep(m.x, m.y, p.x - m.x, p.y - m.y)) game.monsterAttack(m);
      return;
    }
    // Nowhere better to go: sidestep if possible so it does not freeze in place.
    const opts = options8(game, m).filter((o) => cheb(m.x + o.dx, m.y + o.dy, p.x, p.y) >= dist);
    if (opts.length) { const o = game.rngs.ai.pick(opts); stepMonster(game, m, m.x + o.dx, m.y + o.dy); if (m.state === 'dead') return; }
  }
  const d2 = cheb(m.x, m.y, p.x, p.y);
  if (m.fleeing === 'escape' && !level.isExplored(m.x, m.y) && d2 > 3) {
    level.removeEntity(m); m.state = 'dead';
    game.log(`The ${lower(m)} escapes into the shadows${m.gold ? ' with your gold' : ''}.`, 'danger');
    game.emit('monster:escaped', { entity: m, gold: m.gold || 0 });
  } else if (m.fleeing !== 'escape' && d2 > B.aggroRange) {
    m.state = 'wander'; m.fleeing = null; m.hadPrey = false;
  }
}

// ---------------------------------------------------------------------------------------------
// Entry points

/** Advance every monster on the current level by dt seconds. */
export function updateMonsters(game, dt) {
  const level = game.level;
  if (!level) return;
  pruneNoises(level, game.state.time);
  for (const m of [...level.entities]) {
    if (m.kind !== 'monster' || m.state === 'dead' || game.state.over) continue;
    if (!m.cooldowns) initAiFields(m);
    const pace = (AI.pace[m.state] ?? 1) * (m.pace || 1);
    m.moveTimer += dt * m.speed * pace;
    let acts = 0;
    while (m.moveTimer >= 1 && acts < 2 && m.state !== 'dead' && !game.state.over) {
      m.moveTimer -= 1;
      monsterAct(game, m);
      acts++;
    }
  }
}

/** One AI decision for a monster. */
export function monsterAct(game, m) {
  if (m.state === 'dead' || game.state.over) return;
  if (!m.cooldowns) initAiFields(m);
  const p = game.player, ext = extendedRules(game);
  tickCooldowns(m);
  const per = perceive(game, m);

  if (m.state === 'flee') { fleeAct(game, m, per); return; }

  if (per.sees) {
    if (m.state !== 'hunt') notice(game, m, 'sight');
    else { m.lastSeen = { x: p.x, y: p.y }; m.target = m.lastSeen; }
  } else if (per.hears && m.state !== 'hunt' && m.state !== 'lurk') {
    startSearch(game, m, per.hears, 'sound');
  } else if (m.state === 'hunt' && per.hidden) {
    if (ext && game.playerOnSanctuary()) startLurk(game, m);
    else loseTrail(game, m);
  }

  // Cowards run when badly hurt (and outmatched).
  if (m.flags.flees && m.hp < m.maxHp * AI.fleeHpFraction && (per.sees || per.dist <= 2) && !per.hidden && m.strength < p.skill) {
    startFlee(game, m, 'coward');
    fleeAct(game, m, per);
    return;
  }

  switch (m.state) {
    case 'hunt': huntAct(game, m, per, ext); return;
    case 'search': searchAct(game, m, per); return;
    case 'lurk': lurkAct(game, m, per); return;
    default: wanderAct(game, m, per);
  }
}
