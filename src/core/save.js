// Save / load (versioned JSON via Game.serialize()/Game.deserialize()), settings, key bindings,
// hall of fame, the daily seed and per-day results. Everything lives in localStorage and every
// access is guarded: a blocked or full storage must never break the game.
//
// Reliability: every slot write is checksummed (FNV-1a over the payload) and the previous save is
// kept as a backup; a corrupt or truncated primary falls back to the backup transparently. Saves
// from older versions go through `migrateSave()` before they are trusted.
import { SAVE_VERSION } from '../game/state.js';
import { normalizeSeed } from './rng.js';

const PREFIX = 'fargoal.';
const SAVE_KEY = PREFIX + 'save.';        // + difficulty
const BACKUP_SUFFIX = '.bak';
const SETTINGS_KEY = PREFIX + 'settings';
const KEYBINDS_KEY = PREFIX + 'keybinds';
const HALL_KEY = PREFIX + 'hall';
const DAILY_KEY = PREFIX + 'daily';
const RUNS_KEY = PREFIX + 'runs';
export const HALL_MAX = 20;
export const RUNS_MAX = 50;
export const DIFFICULTIES = ['classic', 'standard', 'story', 'nightmare'];

/** Default settings (see ui/menus.js Settings panel). */
export const DEFAULT_SETTINGS = {
  masterVolume: 0.8, musicVolume: 0.5, sfxVolume: 0.8,
  screenShake: true, fontScale: 1, colorblind: false, autoPauseOnSight: true, reduceFlash: false,
  playerName: 'Warrior', minimap: true, showTooltips: true, lastDifficulty: 'standard',
  // quality of life
  holdRepeatDelay: 0.12,   // extra seconds a direction must be held before it starts auto-repeating
  holdAccel: true,         // held movement speeds up after a moment (never in sight of a monster)
  confirmStairs: true,     // ask before descending with the Sword / walking into a pit with it
  pathPreview: true,       // hover path + click-to-move route markers
  touchControls: 'auto',   // 'auto' | 'on' | 'off'
  autosaveInterval: 45,    // seconds of play between background autosaves (0 = off)
};

function storage() {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
function readRaw(key) { const st = storage(); if (!st) return null; try { return st.getItem(key); } catch { return null; } }
function readJson(key) {
  const raw = readRaw(key); if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function writeRaw(key, str) { const st = storage(); if (!st) return false; try { st.setItem(key, str); return true; } catch { return false; } }
function writeJson(key, value) { return writeRaw(key, JSON.stringify(value)); }
function remove(key) { const st = storage(); if (!st) return; try { st.removeItem(key); } catch { /* ignore */ } }

/** FNV-1a 32-bit hash of a string, as 8 hex chars (cheap integrity check for saves). */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

// ------------------------------------------------------------------ game saves
/** Summary shown on the Continue entry and used to pick the newest save. */
function buildMeta(game) {
  const p = game.player;
  return {
    version: SAVE_VERSION, savedAt: Date.now(), difficulty: game.balance.name, seed: game.seed,
    depth: game.depth, level: p.level, hp: p.hp, maxHp: p.maxHp, xp: p.xp, elapsed: game.state.elapsed,
    hasSword: !!p.hasSword, daily: !!game.daily, recordDaily: game.recordDaily !== false,
    name: game.playerName || null, kills: p.kills, deepest: game.state.deepest,
  };
}

/** Last successful write (for the HUD's "saved" hint). */
export const saveStatus = { at: 0, ok: null, bytes: 0, reason: '' };

/**
 * Persist a game into its difficulty slot (previous save becomes the backup).
 * @param {import('../game/game.js').Game} game
 * @param {{reason?:string}} [opts]
 * @returns {boolean} true if written
 */
export function saveGame(game, opts = {}) {
  if (!game || game.over) return false;
  let data;
  try { data = game.serialize(); } catch { return false; }
  const meta = buildMeta(game);
  const payload = JSON.stringify(data);
  const rec = JSON.stringify({ meta, hash: hashString(payload), data });
  const key = SAVE_KEY + game.balance.name;
  const prev = readRaw(key);
  if (prev && prev !== rec) writeRaw(key + BACKUP_SUFFIX, prev);
  const ok = writeRaw(key, rec);
  saveStatus.at = Date.now(); saveStatus.ok = ok; saveStatus.bytes = rec.length; saveStatus.reason = opts.reason || '';
  if (ok && game.bus) game.bus.emit('save:written', { difficulty: game.balance.name, reason: opts.reason || '', bytes: rec.length, meta });
  return ok;
}

/** Upgrade an older save payload in place. Returns null when it cannot be brought to SAVE_VERSION. */
export function migrateSave(data) {
  if (!data || typeof data !== 'object') return null;
  let v = data.version | 0;
  if (v > SAVE_VERSION) return null;
  // Future migrations chain here: `if (v === 1) { ...; v = 2; }`
  if (v !== SAVE_VERSION) return null;
  return data;
}

/** Structural sanity: the parts Game.load() dereferences must exist. */
function validSaveData(d) {
  if (!d || typeof d !== 'object' || !d.state || !d.player || !Array.isArray(d.levels) || !d.rngs) return false;
  const depth = d.state.depth;
  if (!Number.isInteger(depth) || !d.levels.some((lv) => lv && lv.depth === depth)) return false;
  return Number.isFinite(d.player.hp) && Number.isFinite(d.player.x) && Number.isFinite(d.player.y);
}

/** Parse + verify one slot key. Returns {meta, data, backup:boolean} or null. */
function readSlot(key, backup = false) {
  const rec = readJson(key);
  if (!rec || !rec.data || !rec.meta) return null;
  if (rec.hash) {
    let payload;
    try { payload = JSON.stringify(rec.data); } catch { return null; }
    if (hashString(payload) !== rec.hash) return null;
  }
  const data = migrateSave(rec.data);
  if (!data || !validSaveData(data)) return null;
  return { meta: rec.meta, data, backup };
}

/** Read the save for a difficulty (or the most recent one). Returns {meta, data, backup} or null. */
export function loadSave(difficulty = null) {
  if (difficulty) {
    const key = SAVE_KEY + difficulty;
    return readSlot(key) || readSlot(key + BACKUP_SUFFIX, true);
  }
  let best = null;
  for (const s of listSaves()) if (!best || s.meta.savedAt > best.meta.savedAt) best = s;
  return best;
}

/** All valid saves, newest first (a slot whose primary is corrupt is served from its backup). */
export function listSaves() {
  const out = [];
  for (const d of DIFFICULTIES) { const s = loadSave(d); if (s) out.push(s); }
  return out.sort((a, b) => b.meta.savedAt - a.meta.savedAt);
}

export function hasSave() { return listSaves().length > 0; }
export function deleteSave(difficulty) {
  const one = (d) => { remove(SAVE_KEY + d); remove(SAVE_KEY + d + BACKUP_SUFFIX); };
  if (difficulty) one(difficulty); else for (const d of DIFFICULTIES) one(d);
}

// ------------------------------------------------------------------ settings
/** Settings merged over defaults. */
export function loadSettings() {
  const s = readJson(SETTINGS_KEY) || {};
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in s && typeof s[k] === typeof DEFAULT_SETTINGS[k]) out[k] = s[k];
  return out;
}
export function saveSettings(settings) { return writeJson(SETTINGS_KEY, settings); }

// ------------------------------------------------------------------ key bindings
/** User overrides: { action: string[] } (only actions that differ from the defaults). */
export function loadKeybinds() {
  const k = readJson(KEYBINDS_KEY);
  if (!k || typeof k !== 'object') return {};
  const out = {};
  for (const [a, keys] of Object.entries(k)) if (Array.isArray(keys) && keys.every((x) => typeof x === 'string')) out[a] = keys.slice(0, 4);
  return out;
}
export function saveKeybinds(overrides) {
  if (!overrides || !Object.keys(overrides).length) { remove(KEYBINDS_KEY); return true; }
  return writeJson(KEYBINDS_KEY, overrides);
}

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
  addRunRecord(stats, extra);
  if (extra.daily) recordDailyResult(stats, extra.date);
  const rank = hall.indexOf(entry);
  return rank < 0 ? 0 : rank + 1;
}
export function clearHallOfFame() { remove(HALL_KEY); }

// ------------------------------------------------------------------ run history (every finished run, newest first)
/** Compact record of a finished run for the statistics screen. */
export function addRunRecord(stats, extra = {}) {
  const runs = getRunHistory();
  runs.unshift({
    at: Date.now(), date: extra.date || new Date().toISOString().slice(0, 10), name: (extra.name || 'Warrior').slice(0, 16),
    seed: stats.seed, difficulty: stats.difficulty, daily: !!extra.daily, victory: !!stats.victory, cause: stats.cause || null, killer: stats.killer || null,
    score: stats.score | 0, xp: stats.xp | 0, level: stats.level | 0, deepest: stats.deepest | 0, kills: stats.kills | 0, elapsed: Math.round(stats.elapsed || 0),
    steps: stats.steps | 0, treasures: stats.treasures | 0, damageDealt: stats.damageDealt | 0, damageTaken: stats.damageTaken | 0,
    potions: stats.potions | 0, spells: stats.spells | 0, swordFound: !!stats.swordFound,
  });
  runs.length = Math.min(runs.length, RUNS_MAX);
  writeJson(RUNS_KEY, runs);
  return runs[0];
}
export function getRunHistory() { const r = readJson(RUNS_KEY); return Array.isArray(r) ? r : []; }
export function clearRunHistory() { remove(RUNS_KEY); }

/** Lifetime totals across recorded runs (for the statistics panel). */
export function careerStats() {
  const runs = getRunHistory();
  const c = { runs: runs.length, victories: 0, deaths: 0, kills: 0, deepest: 0, bestScore: 0, elapsed: 0, steps: 0, swordsFound: 0, dailies: 0 };
  for (const r of runs) {
    if (r.victory) c.victories++; else c.deaths++;
    c.kills += r.kills | 0; c.deepest = Math.max(c.deepest, r.deepest | 0); c.bestScore = Math.max(c.bestScore, r.score | 0);
    c.elapsed += r.elapsed | 0; c.steps += r.steps | 0; if (r.swordFound) c.swordsFound++; if (r.daily) c.dailies++;
  }
  return c;
}

// ------------------------------------------------------------------ daily seed
/** UTC date string YYYY-MM-DD. */
export function todayUtc(now = new Date()) { return now.toISOString().slice(0, 10); }
/** Deterministic daily seed from the UTC date. */
export function dailySeed(date = todayUtc()) { return normalizeSeed('fargoal-daily-' + date); }
/** Seconds until the next daily (UTC midnight). */
export function secondsUntilNextDaily(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, Math.floor((next - now.getTime()) / 1000));
}
function dailyRecord() { const d = readJson(DAILY_KEY); return d && typeof d === 'object' ? d : {}; }
/** Has today's daily already been attempted? */
export function dailyAttempted(date = todayUtc()) { return dailyRecord().date === date; }
export function markDailyAttempted(date = todayUtc()) { const d = dailyRecord(); writeJson(DAILY_KEY, { ...(d.date === date ? d : {}), date, startedAt: Date.now() }); }
/** Store the outcome of the day's attempt (kept with the date so a new day starts clean). */
export function recordDailyResult(stats, date = todayUtc()) {
  const d = dailyRecord();
  const streak = d.date && d.lastResultDate && daysBetween(d.lastResultDate, date) === 1 ? (d.streak | 0) + 1 : 1;
  writeJson(DAILY_KEY, { ...(d.date === date ? d : {}), date, lastResultDate: date, streak, result: { score: stats.score | 0, deepest: stats.deepest | 0, victory: !!stats.victory, cause: stats.cause || null, elapsed: Math.round(stats.elapsed || 0) } });
}
function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
/** Everything the title needs about today's daily. */
export function dailyInfo(now = new Date()) {
  const date = todayUtc(now), d = dailyRecord();
  return { date, seed: dailySeed(date), attempted: d.date === date, result: d.date === date ? d.result || null : null, streak: d.lastResultDate && daysBetween(d.lastResultDate, date) <= 1 ? d.streak | 0 : 0, nextIn: secondsUntilNextDaily(now) };
}

/** Format seconds as m:ss or h:mm:ss. */
export function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
