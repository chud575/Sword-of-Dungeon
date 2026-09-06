// The one source of truth for which sheet sprite plays which entity. Read by the runtime
// (sprites/castSheet.js) and by the importer (tools/sheet-import.mjs), so the atlas can never
// contain a sprite the game does not ask for, or miss one it does.
/**
 * Game entity type -> the sprite on the sheet that plays it.
 *
 * Sixteen of these are the obvious match. The other seven have no counterpart on the sheet at all —
 * Fargoal's roster is the 1982 original's, which has no undead and a ten-deep human family — so
 * they borrow the nearest silhouette rather than stay in a second art style. Those are marked.
 */
export const CAST_MAP = {
  player: 'warrior',
  // creatures
  'dire-wolf': 'wolf',
  ogre: 'ogre',
  hobgoblin: 'goblin',
  werebear: 'bear',
  gargoyle: 'ghoul',              // borrowed: no gargoyle on the sheet; grey-blue clawed brute
  troll: 'troll',
  wyvern: 'bat',                  // borrowed: the only other winged flyer
  'dimension-spider': 'giant-spider',
  'shadow-dragon': 'specter',     // borrowed: large and spectral, and it keeps the "shadow"
  'fyre-drake': 'dragon',
  demon: 'demon',
  // humans
  rogue: 'rogue',
  barbarian: 'orc',               // borrowed: green brute with an axe
  'elvin-ranger': 'elf',
  'dwarven-guard': 'dwarf',
  mercenary: 'skeleton',          // borrowed: an armed humanoid, and the sheet has no spare soldier
  swordsman: 'paladin',
  monk: 'cleric',
  'dark-warrior': 'vampire',      // borrowed: dark cloaked figure
  assassin: 'ghost',              // borrowed: and it suits a stalker with the `invisible` special
  'war-lord': 'minotaur',         // borrowed: the biggest horned warrior on the sheet
  mage: 'wizard',
  warlock: 'ogre-mage',
};
