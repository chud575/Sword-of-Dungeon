// Registry of HD-2D monster sprite builders: monster `type` -> `() => built` (the same shape
// heroSprite.buildHero() returns, so packSheet/createSheetTexture/SpriteBillboard take it as-is,
// plus an optional `scale` the character factory folds into the billboard size).
//
// ONE GROUP PER FILE. To add a group: drop `./<group>.js` exporting a plain map of builders, then
// make TWO targeted edits here — an import line and a spread in MONSTER_SPRITES. Never rewrite this
// file: other agents are adding their own groups to it at the same time.
import { BEAST_SPRITES } from './beasts.js';
import { BOSS_SPRITES } from './boss.js';
import { CASTER_SPRITES } from './caster.js';
import { DRAKE_SPRITES } from './drakes.js';
import { HUMAN_BUILDERS } from './humans.js';
import { HUMANOID_BUILDERS } from './humanoid.js';
import { UNDEAD_SPRITES } from './undead.js';
import { VERMIN_SPRITES } from './vermin.js';

/** @type {Object<string, () => {anims:object, palette:object, w:number, h:number, pivot:{x:number,y:number}, emissive?:string, scale?:number}>} */
export const MONSTER_SPRITES = {
  ...VERMIN_SPRITES,
  ...CASTER_SPRITES,
  ...HUMANOID_BUILDERS,
  ...HUMAN_BUILDERS,
  ...UNDEAD_SPRITES,
  ...BEAST_SPRITES,
  ...BOSS_SPRITES,
  // last: the wyvern / shadow dragon / fyre drake / dimension spider each own a silhouette here
  // (monsters/drakes.js) instead of sharing buildDragon() and the generic spider
  ...DRAKE_SPRITES,
};

/** The builder for a monster type, or null when that type is still a low-poly mesh. */
export function monsterSpriteBuilder(type) {
  return Object.prototype.hasOwnProperty.call(MONSTER_SPRITES, type) ? MONSTER_SPRITES[type] : null;
}

/** Whether this monster type is drawn as a pixel sprite (rather than the mesh rig). */
export function hasMonsterSprite(type) {
  return !!monsterSpriteBuilder(type);
}
