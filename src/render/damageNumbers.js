// Floating combat text, painted as PIXEL-FONT glyphs ON THE CAST'S OWN TEXEL GRID.
//
// WHY A PIXEL FONT
// The rest of the cast is hand-pixelled at PX_PER_TILE texels per world unit (spriteBillboard.js).
// A canvas-rendered serif "14" is vector-antialiased at whatever resolution the framebuffer happens
// to be — its curves are cleaner than the hero's 8px-wide face, which instantly reads as UI pasted
// over the diorama. So the glyphs here are a 5x7 bitmap font drawn with the house ink, and the quad
// is built IN SCREEN SPACE with its anchor snapped to a whole device pixel, exactly the way
// spriteBillboard builds a character: one font texel covers `frameTexelSize()` device pixels — THE
// grid, the same integer the hero, the monsters and the flagstones are all on. Nothing here rounds
// its own texel size any more (it used to guess `round(viewportHeight / 225)`, which agreed with the
// cast only by luck and drifted the moment the camera zoomed).
//
// NO PLATES
// The old paint pass dilated the glyph mask by one texel in all EIGHT directions. On a 5x7 font
// whose strokes are one texel wide, every counter and every inter-glyph gap is one or two texels
// across — so the dilation flooded all of them and the result was a solid near-black rectangle with
// a few light pixels scratched into it. Measured in the 'combat' shot: sixteen unbroken device
// pixels of ink between the "1" and the "5" of a 15. That is a plate, and two of them were parked
// over the hero.
// The ink is now a proper CONTOUR: four-neighbour, and only on air the glyph's OUTSIDE can reach
// (flood-filled from the border), so counters stay open and the room shows through them. Glyphs are
// spaced three texels apart, which is the narrowest gap a one-texel contour on both sides cannot
// close. A one-texel drop shadow down-right adds weight without adding a box.
//
// NEVER OVER THE HERO
// A number is feedback about the hero; it must never BE the hero's silhouette. `setProtect()` hands
// this module the player's screen rect each frame and no number is allowed to overlap it: the spawn
// search skips slots that clash with it, and the per-frame separation pass pushes any number that
// drifts onto him back out along whichever axis is cheaper. Everything else about placement is the
// same rule as before — numbers rise at a constant world speed and are nudged clear of each other —
// except that it is now all done in DEVICE PIXELS, which is the space the overlap actually happens
// in, instead of a mix of NDC and world units.
import * as THREE from 'three';
import { INK, HERO_FIGURE_PX } from './sprites/style.js';
import { PX_PER_TILE, frameTexelSize } from './sprites/spriteBillboard.js';
import { hashString } from '../core/rng.js';

// ------------------------------------------------------------------------------------- the font
const GW = 7, GH = 7;                 // glyph cell, in texels
/**
 * THE PORT'S FACE, READ OFF THE REFERENCE FRAMES.
 *
 * The 2009 build does not set its overhead text in a plain geometric pixel font — it uses a
 * LOMBARDIC/UNCIAL one, and the difference is the most visible thing left between this remake's
 * band and the port's. Read at 22x off the fully-opaque lines of photo10 ('SLAIN BY AN EXPERIENCED
 * SWORDSMAN', white on near-black, a 30:1 contrast), photo3 ('YOU ARE') and photo4 ('POISON'), the
 * face has four marks that a geometric font does not:
 *
 *   · E is drawn as a rounded 'Є' — a C with a middle bar — in PELL, ARE and EXPERIENCED alike
 *   · Y is the uncial form: a fork over a tail that curls LEFT, not a plain V on a stem
 *   · stems carry SERIF FEET (L, I, N, P, B, R, U, H) and X is serifed at all four terminals
 *   · bowls are ROUND (B, C, D, G, O, P, R, S), never squared off
 *
 * Two honest limits. The sources are 480x320 JPEGs of a 7-texel face, so these are the port's
 * LETTERFORMS rather than its exact texels — thresholding the line gives ringing, not a bitmap
 * (measured: a 128 threshold on photo10's cleanest line returns mush). And the reference Y drops
 * its tail below the other letters' baseline; that would need a 9-row cell, which would move the
 * cap height every measurement in this file is pinned to, so the tail is drawn INSIDE the 7 rows.
 *
 * The cell went 5 wide to 7 to hold the serifs. Nothing else needed changing: `METRICS` below reads
 * each glyph's width off the bitmap, so the advance follows the art. Measured against the port:
 * cap height 7 texels and an advance of about 10 against its 9.4.
 */
export const FONT = {
  '0': ['..###..', '.##.##.', '.#..##.', '.#.#.#.', '.##..#.', '.##.##.', '..###..'],
  '1': ['..##...', '.###...', '...#...', '...#...', '...#...', '...#...', '.#####.'],
  '2': ['..###..', '.##..#.', '.....#.', '....#..', '...#...', '.##....', '.#####.'],
  '3': ['.####..', '.....#.', '.....#.', '..###..', '.....#.', '.#...#.', '.####..'],
  '4': ['....##.', '...#.#.', '..#..#.', '.#...#.', '.#####.', '.....#.', '....###'],
  '5': ['.#####.', '.#.....', '.####..', '.....#.', '.....#.', '.#...#.', '.####..'],
  '6': ['..###..', '.##....', '.#.....', '.####..', '.#...#.', '.##..#.', '..###..'],
  '7': ['.#####.', '.....#.', '....#..', '...#...', '...#...', '..#....', '..#....'],
  '8': ['..###..', '.##.##.', '.#...#.', '..###..', '.#...#.', '.##.##.', '..###..'],
  '9': ['..###..', '.##..#.', '.#...#.', '..####.', '.....#.', '....##.', '..###..'],
  A: ['..###..', '.##.##.', '.#...#.', '.#####.', '.#...#.', '.#...#.', '##...##'],
  B: ['####...', '.#..##.', '.#...#.', '.####..', '.#...#.', '.#..##.', '####...'],
  C: ['..####.', '.##...#', '.#.....', '.#.....', '.#.....', '.##...#', '..####.'],
  D: ['####...', '.#..##.', '.#...#.', '.#...#.', '.#...#.', '.#..##.', '####...'],
  E: ['..####.', '.##...#', '.#.....', '.####..', '.#.....', '.##...#', '..####.'],
  F: ['.#####.', '.#...#.', '.#.....', '.####..', '.#.....', '.#.....', '###....'],
  G: ['..####.', '.##...#', '.#.....', '.#..###', '.#...#.', '.##..#.', '..###..'],
  H: ['###.###', '.#...#.', '.#...#.', '.#####.', '.#...#.', '.#...#.', '###.###'],
  I: ['.#####.', '...#...', '...#...', '...#...', '...#...', '...#...', '.#####.'],
  J: ['...####', '....#..', '....#..', '....#..', '....#..', '.#..#..', '..##...'],
  K: ['###.##.', '.#..#..', '.#.#...', '.##....', '.#.#...', '.#..#..', '###.##.'],
  L: ['###....', '.#.....', '.#.....', '.#.....', '.#.....', '.#...#.', '.#####.'],
  M: ['##...##', '.##.##.', '.#.#.#.', '.#...#.', '.#...#.', '.#...#.', '###.###'],
  N: ['##...##', '.##..#.', '.#.#.#.', '.#..##.', '.#...#.', '.#...#.', '###.###'],
  O: ['..###..', '.##.##.', '.#...#.', '.#...#.', '.#...#.', '.##.##.', '..###..'],
  P: ['####...', '.#..##.', '.#...#.', '.####..', '.#.....', '.#.....', '###....'],
  Q: ['..###..', '.##.##.', '.#...#.', '.#...#.', '.#.#.#.', '.##.#..', '..###.#'],
  R: ['####...', '.#..##.', '.#...#.', '.####..', '.#.#...', '.#..#..', '###..##'],
  S: ['..####.', '.##...#', '.#.....', '..###..', '.....#.', '##...##', '.####..'],
  T: ['#######', '...#...', '...#...', '...#...', '...#...', '...#...', '..###..'],
  U: ['###.###', '.#...#.', '.#...#.', '.#...#.', '.#...#.', '.##.##.', '..###..'],
  V: ['##...##', '.#...#.', '.#...#.', '.##.##.', '..#.#..', '..###..', '...#...'],
  W: ['##...##', '.#...#.', '.#...#.', '.#.#.#.', '.##.##.', '.##.##.', '..#.#..'],
  X: ['##...##', '.##.##.', '..###..', '...#...', '..###..', '.##.##.', '##...##'],
  Y: ['##...##', '.##.##.', '..###..', '...#...', '...#...', '..##...', '.##....'],
  Z: ['.#####.', '....#..', '...#...', '..#....', '.#.....', '##...#.', '.#####.'],
  '+': ['.......', '...#...', '...#...', '.#####.', '...#...', '...#...', '.......'],
  '-': ['.......', '.......', '.......', '.#####.', '.......', '.......', '.......'],
  '!': ['...#...', '...#...', '...#...', '...#...', '...#...', '.......', '...#...'],
  '.': ['.......', '.......', '.......', '.......', '.......', '..##...', '..##...'],
  '%': ['##...#.', '##..#..', '...#...', '..#....', '.#.....', '.#..##.', '....##.'],
};
/**
 * THE GAP IS THE WHOLE GAME. A one-texel contour eats one texel of air on each side of a glyph, so
 * anything closer than three texels welds two glyphs into one blob (which is what a one-texel
 * advance did to every pair of digits on screen). Metrics are measured off the bitmap
 * rather than declared, so a narrow glyph like "1" keeps its own width and the gap stays constant.
 */
const GAP = 3;
/**
 * ...AND WHEN THERE IS NO CONTOUR THERE IS NO GAP TO KEEP. The port sets its band TIGHT: measured
 * on photo10, 'SLAIN BY AN EXPERIENCED SWORDSMAN' runs 258 px for 33 characters on an 8 px cap —
 * an advance of 7.8, i.e. 0.98 of the cap height. At GAP 3 this face ran 33.5 px on a 28 px cap,
 * a ratio of 1.20, and the band read visibly letterspaced against the reference. Uncontoured text
 * (the stack, and the two flat iOS numbers) therefore takes GAP_TIGHT, which brings the ratio to
 * about 1.04. Contoured text keeps GAP 3, because there the ink really does need the air.
 */
const GAP_TIGHT = 1;
const METRICS = (() => {
  const m = {};
  for (const c in FONT) {
    let lo = GW, hi = -1;
    for (const row of FONT[c]) for (let i = 0; i < GW; i++) if (row[i] === '#') { if (i < lo) lo = i; if (i > hi) hi = i; }
    m[c] = hi < lo ? { lo: 0, w: 2 } : { lo, w: hi - lo + 1 };
  }
  m[' '] = { lo: 0, w: 2 };
  return m;
})();

/**
 * Rasterise a string into a 0 = air / 1 = body mask, tight on both sides.
 * @param {string} text @returns {{w:number, h:number, d:Uint8Array}}
 */
export function textMask(text, gap = GAP) {
  const chars = [...text.toUpperCase()].filter((c) => c === ' ' || FONT[c]);
  if (!chars.length) return { w: 1, h: GH, d: new Uint8Array(GH) };
  const w = chars.reduce((a, c) => a + METRICS[c].w + gap, 0) - gap;
  const d = new Uint8Array(w * GH);
  let x = 0;
  for (const c of chars) {
    const g = FONT[c], me = METRICS[c];
    if (g) for (let y = 0; y < GH; y++) for (let i = 0; i < me.w; i++) if (g[y][me.lo + i] === '#') d[y * w + x + i] = 1;
    x += me.w + gap;
  }
  return { w, h: GH, d };
}

/** The advance a style wants: tight when nothing is outlined, wide enough to clear ink when it is. */
const gapFor = (st) => (st.contour === false ? GAP_TIGHT : GAP);

// ------------------------------------------------------------------------------------ the palette
// One size language: `big` is the only size axis, colour is the only meaning axis.
/**
 * ONE FONT, ONE TWEEN, AND COLOUR IS THE ONLY THING THAT CARRIES MEANING.
 *
 * Every piece of floating text in the game comes through `spawn()`, so it is already one 7x7 pixel
 * font on the cast's texel grid and one motion — a linear rise at `RISE`, held opaque to 70% of its
 * life and then faded (see `update`). What was NOT consistent was the palette: a monster's damage
 * was cream, a critical was gold, a level-up and a gold pickup and the Sword itself were all the
 * same gold banner. Three different events, one colour; one event, three colours.
 *
 * So the table below is SEMANTIC. A style names what happened, not what it looks like, and the only
 * axis that separates two events on screen is hue.
 *
 * BUT READ THIS FIRST: matching the iOS port took most of these OUT OF SERVICE. The port floats
 * only damage over the cast and says everything else in the top-centre stack, so `spawn()` now has
 * exactly ONE caller in the whole game — the damage number in `effects.js`, with `hit` or `hurt`.
 * `sleep` is used by the mark below and `banner`/`quest` only alias each other. Everything from
 * `normal` down to `blocked` is currently UNREACHABLE from game code. They are kept because they
 * are the fallback `spawn()` resolves to and because the semantic argument still holds if floating
 * text is ever wanted again — not because anything draws them today.
 *
 *   damage   red      something lost hit points
 *   heal     green    something got them back
 *   gold     yellow   coin changed hands — picked up, stolen, or given at the temple
 *   levelUp  green    the hero grew
 *   death    grey     something died. Deliberately the quietest thing here: a kill is already told
 *                     by the puff, the sound and the corpse, and a shout on every rat is noise
 *   magic    violet   a spell, or experience
 *   blocked  steel    an attack that did nothing
 *   quest    pale     the Sword. One event in the whole run, and it gets its own colour
 *   sleep    blue     the sleep mark — a STATE, not an event, so it stays out of the event palette
 *
 * `big` is scale ONLY (1.5x, see `_texelPx`). It used to also buy a longer life, which meant a
 * critical hung around half a second after an ordinary one — a second, invisible axis of meaning.
 * Life is now one number for everything, and the few announcements that need longer to read pass
 * `life` explicitly at the call site.
 *
 * `top` is the gradient's upper colour: the same hue lifted toward white, never a different hue.
 */
/**
 * HOW FAR ABOVE THE ANCHOR A FLAT NUMBER FLOATS, IN TEXELS.
 *
 * The port's numbers are flat and unoutlined, which only works because it never draws one ON a
 * creature: in img0629 the green 2 stands on open floor a clear glyph-height above the barbarian's
 * helmet, and the red 4 the same above the hero. This remake's billboards are much taller on screen
 * relative to their tile, and the old 0.95-world anchor put the number across the CHEST — so a flat
 * green 7 landed on a green hobgoblin and read as part of the sprite. Measured in the frame: the
 * anchor sat ~58 px below where it needed to be at 2 px per texel, i.e. about one figure's height.
 * Lifting is the faithful fix here, not restoring the outline the port does not have.
 */
const NUM_LIFT = 30;

const STYLES = {
  // THE iOS NUMBERS. Only damage floats over the fighters in the 2009 build, in two colours: green
  // over the monster you just hit, red over the blow you just took. Everything else the port says,
  // it says in the top-centre stack (see MSG_STYLES).
  //
  // MEASURED, not styled. The green in img0629 is rgb(0,230,0) — fully saturated, and the mean of
  // the brightest 4% equals the single peak pixel, so there is no gradient across the stroke and no
  // lighter top row. The red on the same frame peaks at #c34e39 over a tan brick wall at a 0.625
  // downscale, which is where a flat #e60000 lands after that much wall bleeds through it. So both
  // are FLAT: one colour, `top` equal to `color`, no contour, no shadow. This is deliberately
  // unlike every other style in this table — see the ring numbers in `_paint`.
  hit: { color: '#00e600', top: '#00e600', big: false, contour: false, shadow: false, lift: NUM_LIFT },
  hurt: { color: '#e60000', top: '#e60000', big: false, contour: false, shadow: false, lift: NUM_LIFT },
  // --- damage. Both are red, because damage is red; the hero's own is the hotter, brighter one so
  // "I am being hit" still reads differently from "I am hitting" without leaving the hue.
  normal: { color: '#d8422f', top: '#ff8a72', big: false },
  player: { color: '#ff5340', top: '#ffb3a4', big: false },
  crit: { color: '#ff4326', top: '#ffc0ac', big: true },   // a crit shouts by being BIGGER, not by changing colour
  heal: { color: '#4fd167', top: '#c4ffd2', big: false },
  gold: { color: '#ffc32e', top: '#ffeaa0', big: false },
  levelUp: { color: '#4fd167', top: '#c4ffd2', big: true },
  death: { color: '#9aa0a8', top: '#d8dde3', big: false },
  magic: { color: '#b98cff', top: '#e4d6ff', big: false },
  blocked: { color: '#cbd3e0', top: '#f2f6ff', big: false },
  quest: { color: '#9fd0ff', top: '#e6f4ff', big: true },
  // the sleep mark: cool and quiet, so it never competes with a damage number for the eye
  sleep: { color: '#9fc4e8', top: '#e8f4ff', big: false },
};
/** Anything that still asks for the old catch-all banner gets the quest look. */
STYLES.banner = STYLES.quest;

/**
 * THE iOS MESSAGE STACK — measured off the 2009 iPhone build, not invented.
 *
 * The iOS port does not put words over the cast. It keeps a stack of short, ALL-CAPS lines at the
 * TOP CENTRE of the screen, and only numbers float over the fighters. Measured from the shipped
 * 480x320 screenshots (TouchArcade's 2009 preview set, archived):
 *
 *   · glyph cap height  8 px of 320  = 2.5% of screen height
 *   · line pitch       10 px of 320  = 3.1%
 *   · newest line's centre at y 53.5 of 320 = 16.7% down, horizontally centred
 *   · COLOUR. Only the newest line is fully opaque, so only the newest line in a frame measures
 *     its own colour — the faded ones read as whatever is behind them, which is what made the
 *     first pass of this wrong. Taking the newest line from each frame:
 *       photo10 'SLAIN BY AN EXPERIENCED SWORDSMAN'  #fefdff  WHITE
 *       photo3  'YOU ARE FILLED WITH DREAD!'         #f9fffe  WHITE
 *       photo6  'TELEPORT SPELL CAST!'               #f2d7d0  white, warm-cast by a brown wall —
 *               the older 'AN ASSASSIN!' in the same frame carries the identical cast, so the cast
 *               is the frame and not the text. SPELL CASTS ARE WHITE, not cyan.
 *       photo4  'POISON HAS WORN OFF'                #73b7cf  CYAN, hue 196, and genuinely so:
 *               every other line in that frame reads hue 245 off the blue-violet wall behind it.
 *               Cyan is not "magic" — it is an affliction ENDING.
 *     And one more, off img0629: 'ATTACKED BY AN INFERIOR BARBARIAN!' reads #a07220, hue 38,
 *     saturation 80%, directly under a white THUD / CHOP! in the same band. AMBER, for the line
 *     that names what just engaged you. (One low-resolution frame, but the hue is unambiguous.)
 *   · MOTION: a line fades IN at the bottom of the band, rises, and fades OUT at the top. That is
 *     the only reading consistent with all five reference frames — in one of them the bottom line
 *     is the dimmest of three (just arriving) while the top one is also dim (nearly gone).
 */
const MSG_STYLES = {
  white: { color: '#ffffff', top: '#ffffff', big: false, contour: false },
  cyan: { color: '#73b7cf', top: '#73b7cf', big: false, contour: false },
  amber: { color: '#e0a01e', top: '#e0a01e', big: false, contour: false },
};
const MSG_CAP = 8 / 320;        // glyph cap height as a fraction of screen height
const MSG_PITCH = 10 / 320;     // line pitch
const MSG_CENTRE = 53.5 / 320;  // the newest line's centre, measured from the top
const MSG_LIFE = 1.9;           // seconds a line lives
const MSG_FADE_IN = 0.12;       // seconds to fade in at the bottom of the band
const MSG_HOLD = 0.55;          // fraction of life at full opacity before fading out
const MSG_RISE_T = 0.85;        // seconds to climb one line pitch
const MSG_DRAIN = 0.22;         // seconds an over-cap line gets to fade before it goes
/**
 * HOW MANY LINES STAND AT ONCE.
 *
 * The reference frames run to five (CLANG! / SWOOSH! / CHOP! / INVISIBILITY SPELL CAST! / SLAIN BY
 * AN EXPERIENCED SWORDSMAN), spanning roughly 2%-18% of the screen height. That top 9% is where
 * this remake parks its DUNGEON LEVEL banner, which the iPhone screen does not have — it keeps
 * FLOOR, HITS and GOLD along the bottom. So the band keeps the port's measured spawn point, pitch,
 * colours and fade, and holds THREE lines rather than five, which lands the oldest just clear of
 * the banner. Capping the climb instead was the wrong fix: lines then pile onto one row.
 */
const MSG_MAX = 3;

const PAD = 2;                        // texels of air around the glyph block (contour + drop shadow)
const RISE = 0.85;                    // world units per second — CONSTANT, so gaps never close
/** ONE life for every piece of floating text. An announcement that needs longer passes `life`. */
const LIFE = 1.25;
const SHADOW_A = 150;                 // the drop shadow is ink at part strength, never a second ink
const MAX_DRIFT_X = 90;               // device pixels a number may be pushed sideways to clear the hero
const MAX_DRIFT_Y = 320;
/** The hero's silhouette, in texels: 46 tall (style.js HERO_FIGURE_PX) and a man's width. */
const HERO_TEX_W = 22;

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Screen-space quad: the anchor arrives already projected to device pixels, is snapped to a whole
 *  one, and the corners are laid out in exact device pixels around it. That is what keeps every font
 *  texel square and the same size as a hero texel — a world-sized quad cannot, under a pitched
 *  perspective camera.
 *
 *  THE ANCHOR IS A UNIFORM, NOT A MODEL MATRIX. These quads live in the renderer's `overlay` scene,
 *  drawn after the composer, so there is no play camera in scope when they render and no view matrix
 *  worth reading — the CPU projects the world anchor once per frame (`_syncAnchors`) and hands the
 *  result down. The shader writes NDC directly and never touches `projectionMatrix`. */
function makeMaterial(tex) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex },
      uViewport: { value: new THREE.Vector2(1600, 900) },
      uSizePx: { value: new THREE.Vector2(1, 1) },   // the quad, in device pixels
      uOffsetPx: { value: new THREE.Vector2(0, 0) }, // separation nudge, in device pixels
      uAnchorPx: { value: new THREE.Vector2(0, 0) }, // the world anchor, already projected
      uOpacity: { value: 1 },
    },
    transparent: true, depthTest: false, depthWrite: false,
    vertexShader: `
      uniform vec2 uViewport, uSizePx, uOffsetPx, uAnchorPx;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec2 aPx = floor(uAnchorPx + 0.5) + floor(uOffsetPx + 0.5);
        // corners at WHOLE device pixels. Centring an odd-width quad on the anchor would put both
        // its edges on a half pixel, which is a blurred column down each side of the text.
        vec2 px = aPx - floor(uSizePx * 0.5) + uv * uSizePx;
        vec2 ndc = px / uViewport * 2.0 - 1.0;
        gl_Position = vec4(ndc, 0.0, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        if (t.a < 0.02) discard;
        gl_FragColor = vec4(t.rgb, t.a * uOpacity);
      }`,
  });
}

export class DamageNumbers {
  /**
   * @param {THREE.Scene} scene the world scene — the camera probe rides in it, nothing else does
   * @param {*} rng
   * @param {THREE.Scene} [overlay] the renderer's screen layer, drawn after post-processing; the
   *   number quads live here. Defaults to `scene`, which is the old in-world behaviour and is what
   *   the headless tools get when they build a DamageNumbers without a renderer around it.
   */
  constructor(scene, rng, overlay = null) {
    this.scene = scene; this.overlay = overlay || scene; this.rng = rng;
    this.pool = []; this.active = [];
    /** the iOS-style top-centre message stack; kept apart from `active` because these are anchored
     *  to the SCREEN, and the world-space slot search and separation pass must not touch them */
    this.msgs = [];
    /** persistent marks that track a living entity, keyed by entity id (see `syncSleep`) */
    this.marks = new Map();
    this.time = 0;
    this._cam = null; this._gl = null; this._vpH = 900; this._vpW = 1600;
    this._S = 4;
    this._v = new THREE.Vector3();
    /** the hero's tile, set once per frame by Effects; nothing may sit on top of him */
    this._hero = null;
    // CAMERA PROBE. Numbers are spawned from inside the simulation step, where there is no camera in
    // scope, but the slot search has to work in screen pixels — two hits on neighbouring monsters can
    // be a metre apart in world space and still land on top of each other on screen. So a degenerate,
    // colour-write-disabled triangle rides in the scene purely to hand us the camera and the viewport
    // once per frame. Without it the first hits of a fight (before anything has rendered) stack blind.
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    this.probe = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
    this.probe.frustumCulled = false; this.probe.renderOrder = -1000;
    this.probe.onBeforeRender = (renderer, sc, camera) => this._readCamera(renderer, camera);
    scene.add(this.probe);
  }

  /**
   * The tile the numbers must stay off: the hero's. Called once per frame by Effects.
   * @param {number} x @param {number} z the player's interpolated tile centre
   * @param {number} [texH] his sprite's height in texels @param {number} [texW] its width
   */
  setProtect(x, z, texH = HERO_FIGURE_PX, texW = HERO_TEX_W) {
    this._hero = { x, z, texH, texW };
  }

  /**
   * @param {number} x @param {number} z @param {string} text
   * @param {{style?:keyof typeof STYLES, y?:number, life?:number}} [o]
   */
  spawn(x, z, text, o = {}) {
    const st = STYLES[o.style] || STYLES.normal;
    const s = this.pool.pop() || this._make();
    const mask = textMask(text, gapFor(st));
    this._paint(s, mask, st);
    const u = s.userData;
    u.t = 0;
    u.msg = false; u.px = 0; u.rise = 0; u.drain = -1; u.lift = 0;   // may have been a stack line
    u.big = st.big;
    // A pickup banner is deliberately placed high above the hero's head, so it does not need the
    // keep-off-the-hero push that combat numbers do — that push slides a wide label sideways and
    // the announcement stops reading as "this happened to ME".
    u.overHero = !!o.overHero;
    u.lift = st.lift || 0;
    u.life = o.life ?? LIFE;
    u.texW = mask.w + PAD * 2; u.texH = GH + PAD * 2;
    const base = o.y ?? 0.95;
    u.x0 = x; u.z0 = z; u.y0 = base;
    u.dx = 0; u.dy = 0;                                 // the separation offset, in device pixels
    s.position.set(x, base, z);
    s.material.uniforms.uOpacity.value = 1;
    s.material.uniforms.uOffsetPx.value.set(0, 0);
    this.overlay.add(s);
    this.active.push(s);
    this._seed(s);
    this._syncAnchor(s);
  }

  update(dt) {
    this.time += dt;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i], u = s.userData;
      u.t += dt;
      const k = Math.min(1, u.t / u.life);
      s.position.y = u.y0 + RISE * u.t;                 // linear rise; the nudge is screen-space only
      s.material.uniforms.uOpacity.value = k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3);
      if (k >= 1) { this.overlay.remove(s); this.active.splice(i, 1); this.pool.push(s); }
    }
    // the stack: fade in at the bottom of the band, rise, fade out at the top
    const rise = (MSG_PITCH * this._vpH) / MSG_RISE_T;
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const s = this.msgs[i], u = s.userData;
      u.t += dt;
      u.rise += rise * dt;
      u.px = this._msgTexelPx();
      const k = u.t / u.life;
      const fadeIn = Math.min(1, u.t / MSG_FADE_IN);
      const fadeOut = k < MSG_HOLD ? 1 : Math.max(0, 1 - (k - MSG_HOLD) / (1 - MSG_HOLD));
      // A line pushed past the cap drains on its own clock, multiplied into whatever opacity it had
      // reached. Shortening its life instead would snap it part-way down the fade curve.
      let drain = 1;
      if (u.drain >= 0) { u.drain += dt; drain = Math.max(0, 1 - u.drain / MSG_DRAIN); }
      s.material.uniforms.uOpacity.value = fadeIn * fadeOut * drain;
      if (k >= 1 || drain <= 0) { this.overlay.remove(s); this.msgs.splice(i, 1); this.pool.push(s); continue; }
      this._syncMsg(s);
    }
    this._separate(dt);
    for (const s of this.active) this._syncAnchor(s);
  }

  /**
   * Texel size for the stack. The port's band is 8/320 of the screen tall, but this project has ONE
   * PIXEL GRID (CLAUDE.md rule 2) and the cast is drawn on it — so the stack takes the nearest
   * INTEGER MULTIPLE of the world texel size rather than whatever the iOS proportion asks for.
   * Picking the proportion directly put pixel text at 3px texels into frames whose cast is on 2px
   * ones, and `tools/audit.mjs` caught it: the grid fit for 'combat' moved off by a pixel.
   */
  _msgTexelPx() {
    const S = Math.max(1, this._texelPx(false));
    const want = (this._vpH * MSG_CAP) / GH;
    return S * Math.max(1, Math.round(want / S));
  }

  /**
   * Push a line onto the top-centre stack (the iOS port's only overhead text besides the numbers).
   * @param {string} text @param {{style?:'white'|'cyan', life?:number}} [o]
   */
  message(text, o = {}) {
    const st = MSG_STYLES[o.style] || MSG_STYLES.white;
    const mask = textMask(String(text), gapFor(st));
    const s = this.pool.pop() || this._make();
    this._paint(s, mask, st);
    const u = s.userData;
    u.msg = true; u.t = 0; u.life = o.life ?? MSG_LIFE; u.big = false;
    u.texW = mask.w + PAD * 2; u.texH = GH + PAD * 2;
    u.dx = 0; u.dy = 0; u.rise = 0; u.drain = -1;
    u.px = this._msgTexelPx();
    s.material.uniforms.uOpacity.value = 0;
    // Older lines step up so the newest always has a clear pitch beneath them. In a burst of hits
    // this reproduces the even ~10px spacing the reference frames show; when messages are seconds
    // apart the gaps stay ragged, which the reference also shows.
    const pitch = MSG_PITCH * this._vpH;
    this.msgs.forEach((m, k) => { m.userData.rise = Math.max(m.userData.rise, pitch * (k + 1)); });
    this.msgs.unshift(s);
    // Anything past the cap is drained on the spot rather than merely started fading: given the
    // port's pitch, a fourth line is already level with the DUNGEON LEVEL banner, so it gets
    // MSG_DRAIN seconds to go rather than the rest of MSG_LIFE.
    for (let i = MSG_MAX; i < this.msgs.length; i++) {
      const uu = this.msgs[i].userData;
      if (uu.drain < 0) uu.drain = 0;
    }
    this.overlay.add(s);
    this._syncMsg(s);
    return s;
  }

  /** Drop every live line (level change, new game). */
  clearMessages() {
    for (const s of this.msgs) { this.overlay.remove(s); this.pool.push(s); }
    this.msgs.length = 0;
  }

  /** Anchor a stack line: centred horizontally, its own rise above the band. */
  _syncMsg(s) {
    const u = s.userData;
    s.visible = true;
    const y = this._vpH * (1 - MSG_CENTRE) + u.rise;   // the shader's space has its origin bottom-left
    s.material.uniforms.uAnchorPx.value.set(Math.round(this._vpW / 2), Math.round(y));
  }

  // ------------------------------------------------------------------------- placement
  /**
   * The hero's box in device pixels, or null before the first frame / with no player.
   *
   * MEASURED THE WAY HE IS DRAWN, not the way he stands. A character is a screen-space quad pinned
   * to his feet and `texels * S` device pixels tall (spriteBillboard.js), so projecting a world
   * point at head height and calling the difference his height is wrong by the cosine of the camera
   * pitch — it made this box 50 px tall for a 138 px hero, and numbers walked straight over him.
   */
  _heroRect() {
    const h = this._hero;
    if (!h || !this._cam) return null;
    const foot = this._project(h.x, 0.02, h.z);
    if (!foot) return null;
    const S = Math.max(1, this._S);
    const hh = (h.texH * S) / 2, hw = (h.texW * S) / 2;
    return { cx: foot.x, cy: foot.y + hh, hw, hh };
  }

  /**
   * Project one number's world anchor to device pixels and hand it to the shader.
   *
   * On the CPU, once per frame per number, because the quads no longer render under the play camera.
   * An anchor BEHIND a perspective camera projects to a mirrored point in front of it, so a number
   * spawned on a monster the camera has since passed would otherwise appear on the wrong side of
   * the screen; those are hidden instead.
   */
  _syncAnchor(s) {
    if (!this._cam) { s.visible = false; return; }
    const v = this._v.set(s.position.x, s.position.y, s.position.z).project(this._cam);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || v.z > 1) { s.visible = false; return; }
    s.visible = true;
    const lift = (s.userData.lift || 0) * this._texelPx(s.userData.big);   // bottom-left origin: up is +
    s.material.uniforms.uAnchorPx.value.set((v.x * 0.5 + 0.5) * this._vpW, (v.y * 0.5 + 0.5) * this._vpH + lift);
  }

  /** World point -> device pixels (origin bottom-left, the space the quad shader works in). */
  _project(wx, wy, wz) {
    const v = this._v.set(wx, wy, wz).project(this._cam);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    return { x: (v.x * 0.5 + 0.5) * this._vpW, y: (v.y * 0.5 + 0.5) * this._vpH };
  }

  /** The rect a number occupies right now, in device pixels. */
  _rect(s) {
    const u = s.userData;
    const p = this._project(s.position.x, s.position.y, s.position.z);
    if (!p) return null;
    const S = this._texelPx(u.big);
    return { cx: p.x + u.dx, cy: p.y + u.dy, hw: (u.texW * S) / 2, hh: (u.texH * S) / 2 };
  }

  /** Overlap of two rects, or null. */
  static _hit(a, b, padX = 1, padY = 1) {
    const ox = a.hw + b.hw + padX - Math.abs(a.cx - b.cx);
    const oy = a.hh + b.hh + padY - Math.abs(a.cy - b.cy);
    return ox > 0 && oy > 0 ? { ox, oy } : null;
  }

  /**
   * Pick the spawn offset. Candidates climb, but they also STEP ASIDE: a pure vertical search turns
   * four hits on one tile into a totem pole reaching a third of the way up the frame, whereas real
   * combat text fans out. So the search walks a small lattice — straight up, then a column either
   * side, then up again — and takes the first cell that clears every live number AND the hero.
   */
  _seed(s) {
    if (!this._cam) return;
    const u = s.userData;
    const S = this._texelPx(u.big);
    const stepY = (u.texH + 1) * S, stepX = (u.texW + 2) * S;
    const hero = this._heroRect();
    const cells = [];
    for (let row = 0; row < 5; row++) for (const col of [0, -1, 1]) cells.push([col * stepX, row * stepY]);
    for (const [dx, dy] of cells) {
      u.dx = dx; u.dy = dy;
      const a = this._rect(s);
      if (!a) return;
      // An `overHero` banner is placed high on purpose: it may sit in the hero's column.
      let clash = (hero && !u.overHero) ? !!DamageNumbers._hit(a, hero, 2, 2) : false;
      if (!clash) {
        for (const o of this.active) {
          if (o === s) continue;
          const b = this._rect(o);
          if (b && DamageNumbers._hit(a, b, 2, 2)) { clash = true; break; }
        }
      }
      if (!clash) return;
    }
    u.dx = 0; u.dy = 4 * stepY;
  }

  /**
   * Keep them apart while they live, not only at spawn. The camera follows the player, so two
   * numbers a metre apart in the world slide across each other on screen as it pans; and a number
   * that was clear of the hero at spawn can be carried straight over his head a moment later. Each
   * frame every number is pushed out of the hero's box and out of any OLDER number, along whichever
   * axis is the shorter escape, a fraction of the overlap per frame so it reads as a stagger.
   */
  _separate(dt = 1 / 60) {
    if (!this._cam || !this.active.length) return;
    const hero = this._heroRect();
    // Resolve most of the overlap the frame it appears. The old pass moved a number one texel per
    // frame, which cannot keep up with a camera pan: by the time a 33-pixel overlap had been walked
    // off, three more numbers had landed on it and the whole stack read as a smear. Three relaxation
    // passes at a time-based rate settle a chain in about a tenth of a second, which the eye reads as
    // a stagger rather than a jump.
    const k = Math.min(1, Math.max(0.2, dt * 14));
    for (let pass = 0; pass < 3; pass++) {
      const rects = this.active.map((s) => this._rect(s));
      let moved = false;
      for (let i = 0; i < this.active.length; i++) {
        const s = this.active[i], u = s.userData, a = rects[i];
        if (!a) continue;
        let px = 0, py = 0;
        // the hero is immovable: a number never wins a fight with the sprite that owns the frame
        const H = (hero && !u.overHero) && DamageNumbers._hit(a, hero, 2, 2);
        if (H) {
          if (H.ox < H.oy) px = a.cx >= hero.cx ? H.ox : -H.ox;
          else py = a.cy >= hero.cy ? H.oy : -H.oy;
        }
        // SUM the pushes from the older numbers, do not take the largest. Taking the largest let a
        // number SANDWICHED between two others flip between "climb over the one below me" and "drop
        // under the one above me" every frame and never leave: measured in 'combat', a 12 sat 21 px
        // inside one number and 12 px inside another for its whole life, and sixty extra relaxation
        // passes moved it 1.6 px. When the sum nearly cancels — which is exactly what sandwiched
        // means — it steps ASIDE instead, which always has room.
        let sy = 0, side = 0, worst = 0;
        for (let j = 0; j < i; j++) {
          const b = rects[j];
          if (!b) continue;
          const O = DamageNumbers._hit(a, b, 2, 2);
          if (!O) continue;
          sy += (a.cy >= b.cy ? 1 : -1) * O.oy;
          side += a.cx >= b.cx ? 1 : -1;
          worst = Math.max(worst, O.oy);
        }
        if (worst > 0) {
          if (Math.abs(sy) >= worst * 0.5) py += sy;
          else px += (side >= 0 ? 1 : -1) * worst;
        }
        if (!px && !py) continue;
        u.dx = Math.max(-MAX_DRIFT_X, Math.min(MAX_DRIFT_X, u.dx + px * k));
        u.dy = Math.max(-MAX_DRIFT_Y, Math.min(MAX_DRIFT_Y, u.dy + py * k));
        rects[i] = this._rect(s);
        moved = true;
      }
      if (!moved) break;
    }
  }

  // ------------------------------------------------------------------------------ internals
  /**
   * Reconcile the sleep marks against the monsters that are asleep right now.
   *
   * A mark is not a damage number and is not pooled like one: it persists for exactly as long as its
   * creature sleeps, so the marks are keyed by entity id and reconciled each frame. It rides this
   * layer for the same reason the numbers do — a 'Z' dimmed by the depth grade and shrunk by
   * distance is as unreadable as a damage number that is, and 45% of the monsters on a level start
   * asleep (game/monsterAi.js), so this is the only thing telling the player which fights are
   * optional.
   *
   * ANCHORED AT THE FEET, OFFSET IN PIXELS. Same lesson as `_heroRect`: a sprite is a screen-space
   * quad pinned to its feet and `texels * S` device pixels tall, so projecting a world point at head
   * height and calling that the top of the creature is wrong by the cosine of the camera pitch.
   *
   * @param {{id:string|number, x:number, z:number, texH:number}[]} sleepers feet, in world units
   */
  syncSleep(sleepers) {
    const seen = this._seenIds || (this._seenIds = new Set());
    seen.clear();
    for (const sl of sleepers) {
      seen.add(sl.id);
      let m = this.marks.get(sl.id);
      if (!m) {
        m = this.pool.pop() || this._make();
        const mask = textMask('Z');
        this._paint(m, mask, STYLES.sleep);
        const u = m.userData;
        u.big = false; u.msg = false; u.px = 0; u.lift = 0; u.texW = mask.w + PAD * 2; u.texH = GH + PAD * 2;
        u.t = 0; u.life = Infinity; u.overHero = false;
        // The breath phase is HASHED FROM THE ENTITY ID, never drawn from `this.rng`. Taking it
        // from the shared stream would have advanced it once per sleeping monster per level, which
        // shifts every effects draw downstream and changes the frame for a given seed — the first
        // version of this did exactly that, and two shots of one scenario came back as different
        // rooms. Same rule as core/rng.js: fork or derive, never borrow.
        u.phase = (hashString(String(sl.id)) % 6283) / 1000;
        m.material.uniforms.uOpacity.value = 0.92;
        this.overlay.add(m);
        this.marks.set(sl.id, m);
      }
      const u = m.userData;
      m.position.set(sl.x, 0.02, sl.z);
      const S = this._texelPx(false);
      // the creature's own height, then a texel of air, then a slow breath so it reads as dormant
      // rather than as a frozen icon; whole device pixels only, or the glyph crawls between them.
      const bob = Math.round(Math.sin(this.time * 1.6 + (u.phase || 0)) * 1.5) * S;
      u.dx = 0;
      u.dy = Math.round(sl.texH * S + u.texH * S * 0.5 + 2 * S) + bob;
      this._syncAnchor(m);
    }
    for (const [id, m] of this.marks) {
      if (seen.has(id)) continue;
      this.overlay.remove(m);
      this.marks.delete(id);
      this.pool.push(m);
    }
  }

  _make() {
    const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
    const tex = new THREE.CanvasTexture(canvas);
    // NoColorSpace, AND THAT IS NOT AN OVERSIGHT — flagging it sRGB silently darkened every colour
    // in this file. These quads are drawn by a custom ShaderMaterial into the default framebuffer
    // AFTER the composer, so three injects neither `tonemapping_fragment` nor `colorspace_fragment`
    // into the shader: whatever it writes reaches the screen verbatim. An sRGB-flagged texture is
    // given an sRGB8 internal format, so the GPU decodes it to LINEAR on sample — and with nothing
    // re-encoding on the way out, the authored byte was displayed as its own linear value.
    // Measured, cyan #73b7cf: decode gives (0.176, 0.473, 0.617), which lands on screen as
    // #2d799d; the frame came back #2c799f. Raw pass-through is what a post-composite overlay of
    // authored sRGB bytes actually wants.
    tex.colorSpace = THREE.NoColorSpace;
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    const s = new THREE.Mesh(_quad(), makeMaterial(tex));
    s.userData.canvas = canvas; s.userData.tex = tex;
    s.renderOrder = 20; s.frustumCulled = false;
    s.onBeforeRender = (renderer, scene, camera) => this._sync(s, renderer, camera);
    return s;
  }

  /**
   * Draw the mask into the sprite's own canvas, sized to the text:
   *   · the body, with the top row of every glyph lifted (a one-texel bevel, key light top-left);
   *   · a one-texel INK CONTOUR — four-neighbour, and only where the outside air can reach it, so
   *     the hole in an 8 or the gap between two digits stays open and the room shows through;
   *   · a one-texel drop shadow down-right at part alpha, for weight on a busy floor.
   */
  _paint(s, mask, st) {
    const W = mask.w + PAD * 2, H = mask.h + PAD * 2;
    const canvas = s.userData.canvas;
    // A POOLED QUAD'S CANVAS CHANGES SIZE, AND THE GL TEXTURE MUST BE THROWN AWAY WHEN IT DOES.
    // Resizing the canvas and only setting `needsUpdate` re-uploads into the OLD allocation, so the
    // new image is sampled across the quad at the old width — a 33-texel line smeared over a
    // 534-pixel quad. Every number this pool ever drew was 9-13 texels wide, so the fault stayed
    // invisible until the message stack started reusing the same quads for 178-texel lines.
    // Disposing makes three allocate the texture afresh at the new size on the next frame.
    if (canvas.width !== W || canvas.height !== H) s.userData.tex.dispose();
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(W, H);
    const px = img.data;
    const body = hexRgb(st.color), top = hexRgb(st.top), ink = hexRgb(INK);
    const at = (mx, my) => (mx < 0 || my < 0 || mx >= mask.w || my >= mask.h ? 0 : mask.d[my * mask.w + mx]);
    const put = (cx, cy, c, a) => {
      if (cx < 0 || cy < 0 || cx >= W || cy >= H) return;
      const i = (cy * W + cx) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a;
    };
    // OUTSIDE AIR: flood the padded canvas from its border through air only, four-connected. Air the
    // flood cannot reach is a counter (the hole of a 0, an 8, a 9) and must be left alone — dilating
    // into it is exactly what turned these numbers into plates.
    const outside = new Uint8Array(W * H);
    const stack = [0];
    outside[0] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % W, y = (i / W) | 0;
      const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (outside[j] || at(nx - PAD, ny - PAD)) continue;
        outside[j] = 1; stack.push(j);
      }
    }
    // Drop shadow first (it is the lowest layer), then the contour over it. BOTH ARE OPT-OUT,
    // because the port does not treat its two kinds of text the same way and the difference is
    // measurable. Ring test, one pixel out from the glyph, against the same rows clear of it:
    //   stack line, photo3 'YOU ARE FILLED WITH DREAD!'  ring 49.9 vs background 68.1  = -27%
    //   damage number, img0629 green 2                    ring 81.7 vs background 86.1  = -5%
    // So the stack carries a soft shadow and no outline; the numbers carry NEITHER. A -5% ring on
    // a 7px glyph cannot hide a one-pixel shadow — it would move the mean by far more than that.
    if (st.shadow !== false) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!outside[y * W + x]) continue;
        if (at(x - PAD - 1, y - PAD - 1)) put(x, y, ink, SHADOW_A);
      }
    }
    // A FULL CONTOUR IS FOR A NUMBER OVER A BUSY FLOOR, NOT FOR THE STACK. At the stack's size a
    // one-texel ink ring around a one-texel stroke is more ink than letter, and the line reads as a
    // black bar — which is exactly what it did. The port's top-centre lines carry a soft drop
    // shadow and no outline, so a style may turn the contour off and keep the shadow.
    if (st.contour !== false) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!outside[y * W + x]) continue;
        const mx = x - PAD, my = y - PAD;
        if (at(mx - 1, my) || at(mx + 1, my) || at(mx, my - 1) || at(mx, my + 1)) put(x, y, ink, 255);
      }
    }
    for (let y = 0; y < mask.h; y++) for (let x = 0; x < mask.w; x++) {
      if (!mask.d[y * mask.w + x]) continue;
      put(x + PAD, y + PAD, at(x, y - 1) ? body : top, 255);
    }
    ctx.putImageData(img, 0, 0);
    s.userData.tex.needsUpdate = true;
  }

  /** Device pixels per font texel — THE frame's grid, the one the whole cast is on. */
  _texelPx(big) {
    const S = Math.max(1, this._S);
    return big ? Math.round(S * 1.5) : S;
  }

  _readCamera(renderer, camera) {
    this._cam = camera; this._gl = renderer;
    const size = renderer.getDrawingBufferSize(_v2);
    this._vpH = size.y; this._vpW = size.x;
    if (camera && (camera.isPerspectiveCamera || camera.isOrthographicCamera)) this._S = frameTexelSize(renderer, camera, PX_PER_TILE);
  }

  /**
   * Per-frame, per-number: hand the shader the viewport, the quad's exact pixel size and its nudge.
   *
   * It deliberately does NOT read the camera it is handed. These quads render in the overlay scene
   * under a dummy camera; the play camera comes from the probe, which still rides in the world
   * scene. Taking the camera from here would replace it with the dummy and every projection —
   * the hero's keep-off box, the anti-overlap search — would silently go wrong.
   */
  _sync(s, renderer, camera) {
    const u = s.userData, uni = s.material.uniforms;
    const S = u.px || this._texelPx(u.big);   // the stack sizes itself off the viewport, not the world grid
    uni.uViewport.value.set(this._vpW, this._vpH);
    uni.uSizePx.value.set(u.texW * S, u.texH * S);
    uni.uOffsetPx.value.set(u.dx, u.dy);
  }
}

let _quadGeo = null;
function _quad() {
  if (!_quadGeo) _quadGeo = new THREE.PlaneGeometry(1, 1);
  return _quadGeo;
}

const _v2 = new THREE.Vector2();
