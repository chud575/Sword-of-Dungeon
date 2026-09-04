// Floating combat text, painted as PIXEL-FONT glyphs at the sprite texel scale.
//
// WHY A PIXEL FONT
// The rest of the cast is hand-pixelled at PX_PER_TILE texels per world unit (spriteBillboard.js).
// A canvas-rendered serif "14" is vector-antialiased at whatever resolution the framebuffer happens
// to be — its curves are cleaner than the hero's 8px-wide face, which instantly reads as UI pasted
// over the diorama. So the glyphs here are a 5x7 bitmap font with the house one-pixel ink outline,
// and the quad is sized from the camera so ONE FONT TEXEL COVERS AN INTEGER NUMBER OF DEVICE PIXELS
// (the same rounding spriteBillboard does), which is what keeps the digits crisp and square.
//
// ONE SIZE LANGUAGE
// Two sizes only: NORMAL and BIG (crit / banner), where BIG is exactly 1.5x the normal integer texel
// size, so both stay on square texels. Colour carries the meaning, not the size: bone = a monster is
// hurt, red = the player is hurt, gold = a critical hit or treasure, green = healing, violet = magic.
//
// NO COLLISIONS
// Numbers rise at a CONSTANT world-space speed and never drift sideways, so two numbers that do not
// overlap at spawn can never overlap later. Placement therefore only has to solve the spawn frame:
// the candidate anchor is projected to screen pixels and pushed up a slot at a time until its rect
// clears every live number's rect.
import * as THREE from 'three';
import { INK } from './sprites/style.js';

// ------------------------------------------------------------------------------------- the font
const GW = 5, GH = 7;                 // glyph cell, in texels
const FONT = {
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  '4': ['...##', '..#.#', '.#..#', '#...#', '#####', '....#', '....#'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.....', '..#..'],
  '%': ['#...#', '#..#.', '...#.', '..#..', '.#...', '.#..#', '#...#'],
};
/** Tight advance (glyph columns actually used + 1 column of air). */
const ADVANCE = { '1': 5, '!': 4, '.': 4, ' ': 4 };
const advance = (c) => ADVANCE[c] ?? GW + 1;

/**
 * Rasterise a string into a 0 = air / 1 = body mask.
 * @param {string} text @returns {{w:number, h:number, d:Uint8Array}}
 */
function textMask(text) {
  const chars = [...text.toUpperCase()].filter((c) => c === ' ' || FONT[c]);
  const w = Math.max(1, chars.reduce((a, c) => a + advance(c), 0) - 1);
  const d = new Uint8Array(w * GH);
  let x = 0;
  for (const c of chars) {
    const g = FONT[c];
    if (g) for (let y = 0; y < GH; y++) for (let i = 0; i < GW; i++) if (g[y][i] === '#') d[y * w + x + i] = 1;
    x += advance(c);
  }
  return { w, h: GH, d };
}

// ------------------------------------------------------------------------------------ the palette
// One size language: `big` is the only size axis, colour is the only meaning axis.
const STYLES = {
  normal: { color: '#f2e9d6', top: '#ffffff', big: false },
  player: { color: '#ff6f5c', top: '#ffc4b6', big: false },
  crit: { color: '#ffd257', top: '#fff4c8', big: true },
  heal: { color: '#8ce8a2', top: '#dcffe6', big: false },
  gold: { color: '#ffcf4d', top: '#fff1b4', big: false },
  magic: { color: '#c6a8ff', top: '#eadfff', big: false },
  banner: { color: '#ffdf8a', top: '#fff7d6', big: true },
  blocked: { color: '#cbd3e0', top: '#f2f6ff', big: false },
};

const CW = 88, CH = 13;               // canvas, in font texels (fits "-9999 GOLD" with room to spare)
const TEXT_Y = 3;                     // top row of the glyph block inside the canvas
const RISE = 0.85;                    // world units per second — CONSTANT, so gaps never close
const LIFE = 1.25, LIFE_BIG = 1.7;
const SLOT = 0.30;                    // world-Y step between stacked numbers, before the screen test
const DEG = Math.PI / 180;

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export class DamageNumbers {
  constructor(scene, rng) {
    this.scene = scene; this.rng = rng;
    this.pool = []; this.active = [];
    this.time = 0;
    this._cam = null; this._vpH = 900; this._vpW = 1600;
    this._v = new THREE.Vector3();
    // CAMERA PROBE. Numbers are spawned from inside the simulation step, where there is no camera in
    // scope, but the slot search has to work in screen pixels — two hits on neighbouring monsters can
    // be a metre apart in world space and still land on top of each other on screen. So a degenerate,
    // colour-write-disabled triangle rides in the scene purely to hand us the camera and the viewport
    // once per frame. Without it the first hits of a fight (before anything has rendered) stack blind.
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    this.probe = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
    this.probe.frustumCulled = false; this.probe.renderOrder = -1000;
    this.probe.onBeforeRender = (renderer, sc, camera) => {
      this._cam = camera;
      const size = renderer.getDrawingBufferSize(_v2);
      this._vpH = size.y; this._vpW = size.x;
    };
    scene.add(this.probe);
  }

  /**
   * @param {number} x @param {number} z @param {string} text
   * @param {{style?:keyof typeof STYLES, y?:number, life?:number}} [o]
   */
  spawn(x, z, text, o = {}) {
    const st = STYLES[o.style] || STYLES.normal;
    const s = this.pool.pop() || this._make();
    const mask = textMask(text);
    this._paint(s, mask, st);
    const u = s.userData;
    u.t = 0;
    u.big = st.big;
    u.life = o.life ?? (st.big ? LIFE_BIG : LIFE);
    u.textW = mask.w + 2; u.textH = GH + 2;              // + the ink outline
    const base = o.y ?? 0.95;
    u.lift = 0;
    u.x0 = x; u.z0 = z; u.y0 = this._freeSlot(x, base, z, u);
    s.position.set(u.x0, u.y0, u.z0);
    s.material.opacity = 1;
    s.scale.set(0.001, 0.001, 1);
    this.scene.add(s);
    this.active.push(s);
  }

  update(dt) {
    this.time += dt;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i], u = s.userData;
      u.t += dt;
      const k = Math.min(1, u.t / u.life);
      s.position.y = u.y0 + RISE * u.t + u.lift;         // linear rise; `lift` is the separation pass
      s.material.opacity = k < 0.7 ? 1 : Math.max(0, 1 - (k - 0.7) / 0.3);
      if (k >= 1) { this.scene.remove(s); this.active.splice(i, 1); this.pool.push(s); }
    }
    this._separate();
  }

  /**
   * Keep them apart while they live, not only at spawn. Spawn-time placement alone is not enough:
   * the camera follows the player, so two numbers a metre apart in the world slide across each other
   * on screen as it pans, and the pair ends up stacked into an unreadable smear. Each frame, any
   * number overlapping an OLDER one is nudged clear of it, at most a fraction of a world unit per
   * frame so it reads as a stagger rather than a jump.
   */
  _separate() {
    const n = this.active.length;
    if (!this._cam || n < 2) return;
    const R = (s) => this._rect(s.position.x, s.position.y, s.position.z, s.userData.textW, s.userData.textH, s.userData.big);
    // NDC gained per world unit of height at this camera (all numbers sit at much the same depth)
    const a0 = this._rect(this.active[0].position.x, this.active[0].position.y, this.active[0].position.z, 1, 1, false);
    const a1 = this._rect(this.active[0].position.x, this.active[0].position.y + 1, this.active[0].position.z, 1, 1, false);
    const perWorld = Math.max(1e-3, Math.abs(a1.cy - a0.cy));
    const rects = this.active.map(R);
    for (let i = 1; i < n; i++) {
      const s = this.active[i], u = s.userData;
      // push AWAY from the older number, never blindly upward: lifting a number that is already
      // below its neighbour just drives the two together.
      let push = 0;
      for (let j = 0; j < i; j++) {
        const a = rects[i], b = rects[j];
        const ox = a.hw + b.hw - Math.abs(a.cx - b.cx);
        const oy = a.hh + b.hh - Math.abs(a.cy - b.cy) + 0.004;
        if (ox <= 0 || oy <= 0) continue;
        const dir = a.cy >= b.cy ? 1 : -1;
        if (Math.abs(oy) > Math.abs(push)) push = oy * dir;
      }
      if (!push) continue;
      const step = Math.min(0.09, Math.abs(push) / perWorld) * Math.sign(push);
      u.lift = Math.max(-0.55, Math.min(1.4, u.lift + step));
      s.position.y = u.y0 + RISE * u.t + u.lift;
      rects[i] = R(s);
    }
  }

  // ------------------------------------------------------------------------------ internals
  _make() {
    const canvas = document.createElement('canvas'); canvas.width = CW; canvas.height = CH;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const s = new THREE.Sprite(mat);
    s.userData.canvas = canvas; s.userData.tex = tex; s.renderOrder = 20;
    s.onBeforeRender = (renderer, scene, camera) => this._sync(s, renderer, camera);
    return s;
  }

  /** Draw the mask into the sprite's canvas: body colour, a lighter top row, one ink outline. */
  _paint(s, mask, st) {
    const ctx = s.userData.canvas.getContext('2d');
    const img = ctx.createImageData(CW, CH);
    const px = img.data;
    const body = hexRgb(st.color), top = hexRgb(st.top), ink = hexRgb(INK);
    const ox = Math.floor((CW - mask.w) / 2), oy = TEXT_Y;
    const at = (mx, my) => (mx < 0 || my < 0 || mx >= mask.w || my >= mask.h ? 0 : mask.d[my * mask.w + mx]);
    const put = (cx, cy, c, a) => {
      if (cx < 0 || cy < 0 || cx >= CW || cy >= CH) return;
      const i = (cy * CW + cx) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a;
    };
    // ink outline first (8-neighbour, so diagonals close up and the text reads on any background)
    for (let y = -1; y <= mask.h; y++) for (let x = -1; x <= mask.w; x++) {
      if (at(x, y)) continue;
      let near = 0;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (at(x + dx, y + dy)) { near = 1; break; }
      if (near) put(ox + x, oy + y, ink, 255);
    }
    // body, with the top row of every glyph lifted (a one-pixel bevel, key light top-left)
    for (let y = 0; y < mask.h; y++) for (let x = 0; x < mask.w; x++) {
      if (!mask.d[y * mask.w + x]) continue;
      put(ox + x, oy + y, at(x, y - 1) ? body : top, 255);
    }
    ctx.putImageData(img, 0, 0);
    s.userData.tex.needsUpdate = true;
  }

  /** Screen-space rect (in device pixels) a number would occupy at a world anchor. */
  _rect(wx, wy, wz, textW, textH, big) {
    const cam = this._cam;
    const v = this._v.set(wx, wy, wz);
    const S = this._texelPx(big);
    v.project(cam);
    return { cx: v.x, cy: v.y, hw: (textW * S) / this._vpW, hh: (textH * S) / this._vpH };
  }

  _texelPx(big) {
    const base = Math.min(8, Math.max(2, Math.round(this._vpH / 225)));   // ~4 at 900p: the hero's texel
    return big ? Math.round(base * 1.5) : base;
  }

  /** Lowest free stacking slot above (x, base, z): pure screen-space rect rejection. */
  _freeSlot(x, base, z, u) {
    if (!this.active.length) return base;
    if (!this._cam) {
      let n = 0;
      for (const s of this.active) if (Math.abs(s.position.x - x) < 0.8 && Math.abs(s.position.z - z) < 0.8) n++;
      return base + n * 0.34;
    }
    for (let k = 0; k < 14; k++) {
      const y = base + k * SLOT;
      const a = this._rect(x, y, z, u.textW, u.textH, u.big);
      let clash = false;
      for (const s of this.active) {
        const o = s.userData;
        const b = this._rect(s.position.x, s.position.y, s.position.z, o.textW, o.textH, o.big);
        if (Math.abs(a.cx - b.cx) < a.hw + b.hw && Math.abs(a.cy - b.cy) < a.hh + b.hh) { clash = true; break; }
      }
      if (!clash) return y;
    }
    return base + 14 * SLOT;
  }

  /**
   * Per-frame, per-sprite: remember the camera (the spawn-time slot search needs it) and size the
   * quad so one font texel is an exact integer number of device pixels at this depth.
   */
  _sync(s, renderer, camera) {
    this._cam = camera;
    const size = renderer.getDrawingBufferSize(_v2);
    this._vpH = size.y; this._vpW = size.x;
    const d = Math.max(0.3, s.position.distanceTo(camera.position));
    const pxPerWorld = (size.y * (camera.zoom || 1)) / (2 * Math.tan(camera.fov * DEG / 2) * d);
    const S = this._texelPx(s.userData.big);
    const w = S / pxPerWorld;                            // world size that holds S device pixels                            // world size of one font texel
    s.scale.set(CW * w, CH * w, 1);
    s.updateMatrix();
    s.matrixWorld.copy(s.matrix);
  }
}

const _v2 = new THREE.Vector2();
