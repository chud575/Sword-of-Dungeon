// UI theme helpers shared by the panels. The theme is a class on <body> set by main.js before any
// panel is built: `ui-vellum` (the default, "4a Worn vellum"), `ui-module` (?ui=module) or neither
// (?ui=classic). Formatting only: nothing here changes a game value.

/** @returns {'vellum'|'module'|'classic'} */
export function uiTheme() {
  if (typeof document === 'undefined' || !document.body) return 'classic';
  const c = document.body.classList;
  return c.contains('ui-vellum') ? 'vellum' : c.contains('ui-module') ? 'module' : 'classic';
}
export const isVellum = () => uiTheme() === 'vellum';

const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
/** Lowercase roman numerals ("xxvi"); digits outside 1–3999. */
export function roman(n) {
  n = Math.floor(Number(n) || 0);
  if (n < 1 || n > 3999) return String(n);
  let s = '';
  for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; }
  return s;
}

const ORDINALS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth',
  'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth'];
/** "first" … "twentieth"; digits with a suffix above twenty ("21st"). */
export function ordinalWord(n) {
  n = Math.floor(Number(n) || 0);
  if (n >= 0 && n <= 20) return ORDINALS[n];
  const t = n % 100, u = n % 10;
  return `${n}${t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'}`;
}
export const capWord = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
