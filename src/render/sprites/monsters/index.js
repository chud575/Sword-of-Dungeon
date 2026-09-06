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
import { CAST_SPRITES } from '../castSheet.js';

/**
 * The HAND-PAINTED builders, before the imported sheet overrides them.
 *
 * Kept as its own export because it is what the house-style lint is about: ink discipline, the one
 * seven-step ramp, no pillow shading, painted at the height its SCALE slot demands
 * (tests/spriteStyle.test.js). An imported bitmap obeys none of those by construction — it has no
 * palette and no ramps — so linting it against them measures nothing. These stay the fallback the
 * game falls back to if the sheet is removed, and they are still the only builders that animate.
 * @type {Object<string, () => object>}
 */
export const PAINTED_SPRITES = {
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

/**
 * What the renderer actually draws: the painted builders, with the imported sheet
 * (sprites/castSheet.js) laid over every type it has a sprite for — currently the whole roster.
 * @type {Object<string, () => {anims:object, palette:object, w:number, h:number, pivot:{x:number,y:number}, emissive?:string, scale?:number}>}
 */
export const MONSTER_SPRITES = { ...PAINTED_SPRITES, ...CAST_SPRITES };

/** The builder for a monster type, or null when that type is still a low-poly mesh. */
export function monsterSpriteBuilder(type) {
  return Object.prototype.hasOwnProperty.call(MONSTER_SPRITES, type) ? MONSTER_SPRITES[type] : null;
}

/** Whether this monster type is drawn as a pixel sprite (rather than the mesh rig). */
export function hasMonsterSprite(type) {
  return !!monsterSpriteBuilder(type);
}
