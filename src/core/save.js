// Save / load (versioned JSON via Game.serialize()/Game.deserialize()), settings, hall of fame and
// the daily seed. Everything lives in localStorage and every access is guarded: a blocked or full
// storage must never break the game.
import { SAVE_VERSION } from '../game/state.js';
import { normalizeSeed } from './rng.js';

const PREFIX = 'fargoal.';
const SAVE_KEY = PREFIX + 'save.';        // + difficulty
const SETTINGS_KEY = PREFIX + 'settings';
const HALL_KEY = PREFIX + 'hall';
const DAILY_KEY = PREFIX + 'daily';
export const HALL_MAX = 20;

/** Default settings (see ui/menus.js Settings panel). */
export const DEFAULT_SETTINGS = {
  masterVolume: 0.8, musicVolume: 0.5, sfxVolume: 0.8,
  screenShake: true, fontScale: 1, colorblind: false, autoPauseOnSight: true, reduceFlash: false,
  playerName: 'Warrior', minimap: true, showTooltips: true, lastDifficulty: 'standard',
};

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
function readJson(key) {
  const st = storage(); if (!st) return null;
  try { const raw = st.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeJson(key, value) {
  const st = storage(); if (!st) return false;
  try { st.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function remove(key) { const st = storage(); if (!st) return; try { st.removeItem(key); } catch { /* ignore */ } }

// ------------------------------------------------------------------ game saves
/**
 * Persist a game into its difficulty slot.
 * @param {import('../game/game.js').Game} game
 * @returns {boolean} true if written
 */
export function saveGame(game) {
  if (!game || game.over) return false;
  const data = game.serialize();
  const p = game.player;
  const meta = {
    version: SAVE_VERSION, savedAt: Date.now(), difficulty: game.balance.name, seed: game.seed,
    depth: game.depth, level: p.level, hp: p.hp, maxHp: p.maxHp, xp: p.xp, elapsed: game.state.elapsed,
    hasSword: !!p.hasSword, daily: !!game.daily,
  };
  return writeJson(SAVE_KEY + game.balance.name, { meta, data });
}

/** Read the save for a difficulty (or the most recent one). Returns {meta, data} or null. */
export function loadSave(difficulty = null) {
  if (difficulty) {
    const s = readJson(SAVE_KEY + difficulty);
    return s && s.data && s.data.version === SAVE_VERSION ? s : null;
  }
  let best = null;
  for (const s of listSaves()) if (!best || s.meta.savedAt > best.meta.savedAt) best = s;
  return best;
}

/** All valid saves, newest first. */
export function listSaves() {
  const out = [];
  for (const d of ['classic', 'standard', 'story', 'nightmare']) {
    const s = readJson(SAVE_KEY + d);
    if (s && s.data && s.data.version === SAVE_VERSION && s.meta) out.push(s);
  }
  return out.sort((a, b) => b.meta.savedAt - a.meta.savedAt);
}

export function hasSave() { return listSaves().length > 0; }
export function deleteSave(difficulty) { if (difficulty) remove(SAVE_KEY + difficulty); else for (const d of ['classic', 'standard', 'story', 'nightmare']) remove(SAVE_KEY + d); }

// ------------------------------------------------------------------ settings
/** Settings merged over defaults. */
export function loadSettings() {
  const s = readJson(SETTINGS_KEY) || {};
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in s && typeof s[k] === typeof DEFAULT_SETTINGS[k]) out[k] = s[k];
  return out;
}
export function saveSettings(settings) { return writeJson(SETTINGS_KEY, settings); }

// ------------------------------------------------------------------ hall of fame
/** @returns {object[]} entries sorted by score desc */
export function getHallOfFame() {
  const h = readJson(HALL_KEY);
  return Array.isArray(h) ? h : [];
}

/**
 * Record a finished run. Returns the entry's rank (1-based) or 0 if it did not make the table.
 * @param {object} stats Game.getStats() output
 * @param {{name?:string, daily?:boolean, date?:string}} extra
 */
export function addHallOfFameEntry(stats, extra = {}) {
  const entry = {
    name: (extra.name || 'Warrior').slice(0, 16), score: stats.score | 0, xp: stats.xp | 0, level: stats.level | 0, depth: stats.deepest | 0,
    kills: stats.kills | 0, elapsed: Math.round(stats.elapsed || 0), seed: stats.seed, difficulty: stats.difficulty,
    outcome: stats.victory ? 'victory' : (stats.cause || 'died'), killer: stats.killer || null, daily: !!extra.daily,
    date: extra.date || new Date().toISOString().slice(0, 10), at: Date.now(),
  };
  const hall = getHallOfFame();
  hall.push(entry);
  hall.sort((a, b) => b.score - a.score || a.at - b.at);
  hall.length = Math.min(hall.length, HALL_MAX);
  writeJson(HALL_KEY, hall);
  const rank = hall.indexOf(entry);
  return rank < 0 ? 0 : rank + 1;
}
export function clearHallOfFame() { remove(HALL_KEY); }

// ------------------------------------------------------------------ daily seed
/** UTC date string YYYY-MM-DD. */
export function todayUtc(now = new Date()) { return now.toISOString().slice(0, 10); }
/** Deterministic daily seed from the UTC date. */
export function dailySeed(date = todayUtc()) { return normalizeSeed('fargoal-daily-' + date); }
/** Has today's daily already been attempted? */
export function dailyAttempted(date = todayUtc()) { const d = readJson(DAILY_KEY); return !!(d && d.date === date); }
export function markDailyAttempted(date = todayUtc()) { writeJson(DAILY_KEY, { date }); }

/** Format seconds as m:ss or h:mm:ss. */
export function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
