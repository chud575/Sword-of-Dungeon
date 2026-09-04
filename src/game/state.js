// Plain-data GameState schema + factory. Everything here must be JSON-serializable.
import { createQuestState } from './quest.js';
import { BALANCE } from '../core/constants.js';

export const SAVE_VERSION = 1;

/**
 * @typedef {object} GameState
 * @property {number} version
 * @property {number} seed
 * @property {string} difficulty
 * @property {number} time            simulated seconds
 * @property {number} elapsed         seconds of play (excludes pauses)
 * @property {boolean} paused
 * @property {boolean} over
 * @property {{victory:boolean, cause:string, killer:string|null}|null} outcome
 * @property {number} depth           current dungeon depth (0 = surface)
 * @property {number} deepest
 * @property {object} quest           see quest.js createQuestState
 * @property {{monsterId:string, playerInitiated:boolean, timer:number, rounds:number, idle:number}|null} combat
 * @property {object} stats
 * @property {{text:string, kind:string, time:number}[]} log
 * @property {object|null} player     the player entity (see player.js createPlayer)
 */

/**
 * Create a fresh GameState.
 * @param {{seed:number, difficulty?:string}} opts
 * @returns {GameState}
 */
export function createGameState({ seed, difficulty = 'standard' }) {
  const balance = BALANCE[difficulty] || BALANCE.standard;
  return {
    version: SAVE_VERSION,
    seed,
    difficulty: balance.name,
    time: 0,
    elapsed: 0,
    paused: false,
    over: false,
    outcome: null,
    depth: 1,
    deepest: 1,
    quest: createQuestState(seed, balance),
    combat: null,
    stats: { kills: 0, steps: 0, combatTurns: 0, treasures: 0, goldFound: 0, goldSacrificed: 0, levelsVisited: 0, trapsSprung: 0, timeline: [] },
    log: [],
    player: null,
    nextId: 1,
  };
}
