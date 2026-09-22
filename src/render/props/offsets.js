// offsets: nudge a piece off the centre of its tile, per entry or as a saved default for the object.
//
// A decor entry sits on a whole tile (`x`, `y`). The level builder adds two OPTIONAL fields, `offX` and
// `offY`, in tiles (+x east / right, +y south / down the screen), and lets the owner save an offset as
// THE DEFAULT SPOT for that object (2026-09-21, "the ability to save that offset as the default spot for
// said object"). An entry with its own offset uses it; one without uses the saved default for its kind;
// otherwise it sits dead centre as before. Defaults live in this browser's localStorage and apply to every
// level, generated or built, dev mode or not — the same reach the builder's saved layouts have.
//
// "The object" is the most specific thing that names the art: a sheet sprite by its sprite name, a
// Freeport / supplied model by its asset, a Dungeon Crawlers pick by type, and anything else by type.

const KEY = 'fargoal.decorOffsets.v1';
let cache = null;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(globalThis.localStorage?.getItem(KEY) || '{}') || {}; } catch { cache = {}; }
  return cache;
}

function persist() {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(cache || {})); } catch { /* private window: keep it in memory */ }
}

/** The name a saved default is filed under for this entry. */
export function offsetKey(d) {
  if (d.type === 'sprite' && d.sprite) return `sprite:${d.sprite}`;
  if (d.type === 'light') return 'light';
  if (d.model) return `model:${d.model}`;
  if (d.art === 'dc') return `dc:${d.type}`;
  return d.type;
}

/** The saved default for this entry's object, or null. */
export function defaultOffset(d) {
  return load()[offsetKey(d)] || null;
}

/** Where this entry actually sits off its tile centre, in tiles: its own offset, else the default. */
export function decorOffset(d) {
  const def = defaultOffset(d);
  return {
    x: typeof d.offX === 'number' ? d.offX : def ? def.x : 0,
    y: typeof d.offY === 'number' ? d.offY : def ? def.y : 0,
  };
}

export function saveDefaultOffset(d, x, y) {
  load()[offsetKey(d)] = { x, y };
  persist();
}

export function clearDefaultOffset(d) {
  delete load()[offsetKey(d)];
  persist();
}
