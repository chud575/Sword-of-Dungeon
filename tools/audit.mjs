// audit: SCREEN TRUTH. What the PLAYER sees, measured off the canvas — never off a packed sheet.
//
// WHY THIS TOOL EXISTS
// Every quality gate this project had measured the ATLAS: `lint()` histogrammed a packed sheet and
// declared the art legal. Two independent audits then measured the actual frame and found the same
// art 3-10x darker than the sheet-level model predicted (style.js `sceneValue()` says the fyre
// drake, war lord, demon and shadow dragon read at 0.143; canvas readback said 0.014-0.047), a
// private near-black substituted into 269 of the hero's texels with `lint()` still returning CLEAN,
// and a pillow rule whose minimum run length let it examine only 15-46% of a human sheet's body.
//
// So this tool never looks at a sheet to decide anything. It loads the game headless, renders a
// scenario at the camera that scenario plays on, and READS PIXELS BACK OFF THE CANVAS.
//
// THE CAMERA IS ORTHOGRAPHIC. A fixed plan view tilted 17 degrees off vertical: apparent size does
// not vary with depth, the frustum is derived from a whole texel size, and so one world unit is the
// same number of device pixels everywhere in the frame. There is no `fov` to read — the scale comes
// off `camera.top/bottom` and `camera.zoom`, and is reported as `pxPerWorld`, which makes `tilePx`
// exact instead of a rounded `PX_PER_TILE * texel`.
//
// HOW A CHARACTER IS ISOLATED
// A billboard is three meshes: `sprite.mesh` (the body), `sprite.blob` (the contact shadow) and
// `sprite.cast` (the stretched torch shadow). Render the frame; hide one character's body; render
// again; every pixel that CHANGED is a pixel that character was painting on screen. The same trick
// on `blob` gives the contact shadow's footprint and how far it takes the flagstone down.
//
// The mask itself is then built from the GRID rather than from that difference, because a body
// texel that lands on a background of its own colour changes nothing and would drop out of a
// difference — and a creature that is invisible against the floor is exactly the failure this tool
// exists to catch, so it must stay IN the sample and drag the median down. spriteBillboard places
// texel (tx,ty) of a frame at a known device pixel: the pivot is snapped to a whole pixel
// (`floor(apx+0.5)` in the vertex shader) and every texel is exactly S pixels square, so
//     x = pivotX + (tx - frame.px) * S      y = pivotYtop + (ty - frame.py) * S
// (mirrored about the pivot when the animator flips). The mask is every opaque texel of the current
// frame at those pixels; the hidden frame then says what fraction of them actually CHANGED, which
// is reported as `coverage` — low coverage means the figure is occluded or lost in its background.
//
// Hiding one character per render costs one render each, and a render in SwiftShader costs ~2 s of
// pipeline flush, so characters whose screen rectangles do not overlap are hidden in BATCHES: rects
// are greedily coloured, and every character in one colour is measured from a single frame.
//
// WHAT IT REPORTS, per character
//   litMedian / P10 / P90  the screen luminance of its own pixels (0-1, sRGB, as displayed)
//   ambient                what the room shows through the hole it leaves — its background
//   contact                shadow pixels under the feet and how much darker they make the floor
//   runPx / runTexels      mean horizontal run of one colour, in device pixels and in frame texels
//   sameNeighbour          fraction of horizontally adjacent body pixels that share a colour
//   edgeAlign              fraction of its colour edges that land on the frame's texel grid
//   figureTexels / figurePx  how tall the figure stands, in texels and in device pixels
//   pillow                 fraction of ALL its body pixels lit down the middle of a form (never a
//                          sample of runs 8+ long: the denominator is the whole visible body)
//   occlusion / feetOccluded  how much of it, and of its feet, the room draws in front of — measured
//                          by re-drawing it with the depth test off, so an occluded figure is
//                          reported as hidden instead of being judged on a boulder's brightness
//   coverage               how much of it changed the frame at all: 1.0 minus what it is invisible against
//   ownPixels / fxFraction how many pixels inside its footprint are actually ITS (nothing drawn over
//                          them), and how much of it an effect was painting. The grid numbers above
//                          are measured on `ownPixels` alone — see `ownSet` and `fxAt`.
// plus the FLOOR's and the PROPS' run length and edge alignment, so a grid mismatch between the
// hand-pixelled cast and the world they stand in is visible in the same table.
//
// Usage:  node tools/audit.mjs --scenario deep-level [--seed 42] [--json shots/audit.json]
//         node tools/audit.mjs --scenario default --sabotage no-shadows|dark-cast|off-grid
//         node tools/audit.mjs --scenario default,combat,deep-level,bestiary --json out.json
// Exit code is non-zero on page errors or an unknown scenario. It JUDGES NOTHING — the gates that
// judge these numbers live in tests/screenTruth.test.js.
import { startServer, launchBrowser, waitReady, advance } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  INK, INK_DEEP, INK_TOL, FORM_MAT_TOL, FORM_SYMMETRY,
} from '../src/render/sprites/style.js';

/** The measurement constants the in-page pass needs, drawn from the one law (style.js). */
const toRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/**
 * How close two neighbouring SCREEN pixels must be to count as the same colour. The frame carries
 * no dither while auditing (film grain is switched off, see `inPageAudit`) and the sprite shader's
 * light curves gently across a body, so one texel's worth of flat colour still wanders a unit or
 * two between neighbours; 2 is the width of that wander and well under a ramp step.
 */
export const RUN_TOL = 2;
/** A colour edge worth counting when looking for the texel grid: bigger than the wander above. */
export const EDGE_TOL = 6;
/** Minimum run length (in texels) that has a middle and two ends worth judging for pillow shading. */
export const SCREEN_FORM_RUN_MIN = 4;
/**
 * How much brighter the middle of a run must read than both its ends, ON SCREEN, before it is a
 * pillow. style.js's FORM_STEP is 0.035 of a SHEET's value; the room's light and the grade compress
 * a body's ramp to about a third of that on the way to the canvas. Calibrated against the sheet-
 * level number on the two creatures that measure cleanly at both ends: the Wyvern reads 0.110 on
 * screen against 0.108 on its sheet, the Troll 0.027 against 0.024.
 */
export const SCREEN_FORM_STEP = 0.0123;

const AUDIT_CONST = {
  ink: toRgb(INK), inkDeep: toRgb(INK_DEEP), inkTol: INK_TOL,
  matTol: FORM_MAT_TOL, formSymmetry: FORM_SYMMETRY, formRunMin: SCREEN_FORM_RUN_MIN,
  runTol: RUN_TOL, edgeTol: EDGE_TOL, screenFormStep: SCREEN_FORM_STEP,
};

/**
 * The whole measurement, run inside the page. Self-contained (playwright serialises it), takes the
 * constants above so the law lives in style.js and nowhere else.
 * @param {object} K
 */
function inPageAudit(K) {
  const G = window.__game, R = G.renderer;
  /**
   * DELIBERATE REGRESSIONS. A gate nobody has watched fail is a gate nobody knows works, so the
   * auditor can break the frame on purpose before measuring it: 'no-shadows' takes every contact
   * shadow away, 'dark-cast' drops the whole cast's albedo to a sixth, 'off-grid' hands each sprite
   * a texel size that is not the frame's. tests/screenTruth.test.js runs each of these and requires
   * the matching gate to go red. Nothing here touches the game outside this measurement.
   */
  const sabotage = K.sabotage || 'none';
  const gl = R.gl.getContext(), cv = R.canvas;
  const W = cv.width, H = cv.height;
  const lumOf = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const maxd = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const rgbDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const clampX = (x) => (x < 0 ? 0 : x > W - 1 ? W - 1 : x | 0);
  const clampY = (y) => (y < 0 ? 0 : y > H - 1 ? H - 1 : y | 0);
  const median = (a) => (a.length ? a.slice().sort((p, q) => p - q)[a.length >> 1] : 0);
  const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))] : 0);

  // film grain is a zero-mean dither laid over the finished frame; it cannot change a median but it
  // does put ±1 on every flat colour, which is noise in the grid measurements. Off while measuring.
  const grainU = R.grading.uniforms.uGrain, grain0 = grainU.value;
  grainU.value = 0;

  /** Render one frame and read the whole canvas back (rows bottom-up, as GL hands them over). */
  const shoot = () => {
    R.draw();
    R.gl.setRenderTarget(null);
    const buf = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  };
  /** Pixel accessor with y measured from the TOP of the frame. */
  const px = (buf, x, y) => { const i = (((H - 1 - y) * W) + x) * 4; return [buf[i], buf[i + 1], buf[i + 2]]; };
  const lum = (buf, x, y) => { const i = (((H - 1 - y) * W) + x) * 4; return lumOf(buf[i], buf[i + 1], buf[i + 2]); };

  // ------------------------------------------------------------------ who is on screen
  const views = [];
  for (const [id, v] of R.views) {
    if (!v.root || !v.root.visible || !v.sprite) continue;
    views.push({ id, v });
  }
  const S = views.length ? views[0].v.sprite.texelPx : 4;      // the frame's one texel size
  // How many device pixels one world tile covers. Under the ORTHOGRAPHIC camera this is one exact
  // constant for the whole frame (no depth falloff), read straight off the frustum, so the patch of
  // floor a shadow may occupy is sized from the camera rather than from `PX_PER_TILE * S` — S is a
  // rounded texel size and would drift from the true tile by up to half a texel per tile.
  const pxPerTile = views.length ? views[0].v.sprite.px : 32;
  const tilePx = R.camera.isOrthographicCamera
    ? H / Math.max(1e-6, (R.camera.top - R.camera.bottom) / (R.camera.zoom || 1))
    : pxPerTile * S;

  if (sabotage === 'no-shadows') for (const { v } of views) v.sprite.blob.visible = false;
  if (sabotage === 'dark-cast') for (const { v } of views) v.sprite.material.uniforms.uTint.value.multiplyScalar(0.16);
  if (sabotage === 'off-grid') {
    // one grid per creature instead of one per screen — the bug spriteBillboard's header was written
    // against. `sync()` rewrites uTexelPx from the camera on every single render, so the uniform has
    // to be re-broken after it each time; the mask still uses the frame's S, which is the whole
    // point — this sprite has stopped landing on the grid the rest of the screen is drawn on.
    for (const { v } of views) {
      const sp = v.sprite, orig = sp.sync.bind(sp);
      sp.sync = (r2, sc, cam) => { orig(r2, sc, cam); sp.material.uniforms.uTexelPx.value = S + 0.5; };
    }
  }

  /** Where a billboard's pivot lands on screen, in device pixels (y from the top). */
  const anchorOf = (v) => {
    const p = v.root.position.clone().project(R.camera);
    return { x: (p.x * 0.5 + 0.5) * W, y: (1 - (p.y * 0.5 + 0.5)) * H };
  };
  /** The rectangle the sprite's quad can occupy, padded. */
  const bodyRect = (v) => {
    const sp = v.sprite, fr = sp.frame, a = anchorOf(v), pad = 2 * S + 4;
    const l = (sp.flip ? fr.w - fr.px : fr.px) * S, r = (sp.flip ? fr.px : fr.w - fr.px) * S;
    return { x0: clampX(a.x - l - pad), x1: clampX(a.x + r + pad), y0: clampY(a.y - fr.py * S - pad), y1: clampY(a.y + (fr.h - fr.py) * S + pad), ax: a.x, ay: a.y };
  };
  /** The patch of floor a contact shadow may occupy: around and in front of the pivot. */
  const shadowRect = (v, br) => {
    const hw = Math.max(0.6 * tilePx, (br.x1 - br.x0) * 0.75);
    return { x0: clampX(br.ax - hw), x1: clampX(br.ax + hw), y0: clampY(br.ay - 0.35 * tilePx), y1: clampY(br.ay + 0.5 * tilePx) };
  };
  const overlaps = (a, b) => a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;

  /**
   * The device-pixel grid this billboard's current frame is drawn on — the vertex shader's own
   * placement, rebuilt exactly (see the header). Texel (tx,ty) of the frame lands on the S x S
   * block whose top-left corner is (x0 + j*S, y0 + ty*S), where j is tx mirrored when flipped.
   */
  const gridOf = (v) => {
    const sp = v.sprite, fr = sp.frame, sq = sp.squash;
    // the shader's anchor is the QUAD's own world position, which `sync` pulls `depthBias` toward
    // the camera so a figure reads in front of the stairs it stands on — not the view's root
    const p = sp.mesh.getWorldPosition(v.root.position.clone()).project(R.camera);
    const pivotX = Math.floor((p.x * 0.5 + 0.5) * W + 0.5);
    const pivotY = H - Math.floor((p.y * 0.5 + 0.5) * H + 0.5);
    // `squash` is the transient hit/attack deformation, the one thing allowed to put a fractional
    // number of pixels on a texel; it is carried here so a recoiling body is still measured on the
    // grid it was actually drawn on, and reported so the grid gate can excuse it.
    const sx = sp.texelPx * sq.x, sy = sp.texelPx * sq.y;
    return {
      fr, S: sp.texelPx, sx, sy, flip: !!sp.flip, pivotX, pivotY,
      xOf: (j) => Math.round(pivotX + (j - fr.px) * sx),
      yOf: (ty) => Math.round(pivotY + (ty - fr.py) * sy),
      snapped: Math.abs(sq.x - 1) < 0.01 && Math.abs(sq.y - 1) < 0.01,
    };
  };

  /**
   * Every opaque texel of the frame, placed on screen. The mask is the ART's own footprint, so a
   * texel that happens to match the floor behind it still counts (and drags the median down, which
   * is the point); `coverage` afterwards says how many of them actually changed the frame.
   */
  const maskOf = (v) => {
    const g = gridOf(v), fr = g.fr, sheet = v.sprite.sheet, D = sheet.data;
    const texels = [], set = new Set();
    let onScreen = 0, offScreen = 0;
    for (let ty = 0; ty < fr.h; ty++) {
      const y = g.yOf(ty), yEnd = g.yOf(ty + 1);
      for (let j = 0; j < fr.w; j++) {
        const tx = g.flip ? fr.w - 1 - j : j;
        const o = (((fr.y + ty) * sheet.width) + fr.x + tx) * 4;
        if (!D[o + 3]) continue;
        const x = g.xOf(j), xEnd = g.xOf(j + 1);
        if (xEnd <= 0 || yEnd <= 0 || x >= W || y >= H) { offScreen++; continue; }
        onScreen++;
        const cx = clampX((x + xEnd - 1) >> 1), cy = clampY((y + yEnd - 1) >> 1);
        texels.push({ j, ty, x, y, w: xEnd - x, h: yEnd - y, cx, cy, rgb: [D[o], D[o + 1], D[o + 2]] });
        for (let py2 = y; py2 < yEnd; py2++) for (let px2 = x; px2 < xEnd; px2++) {
          if (px2 < 0 || py2 < 0 || px2 >= W || py2 >= H) continue;
          set.add(py2 * W + px2);
        }
      }
    }
    return { grid: g, texels, set, onScreen, offScreen };
  };

  const cast = views.map(({ id, v }) => {
    const br = bodyRect(v);
    const sr = shadowRect(v, br);
    const hull = { x0: Math.min(br.x0, sr.x0), x1: Math.max(br.x1, sr.x1), y0: Math.min(br.y0, sr.y0), y1: Math.max(br.y1, sr.y1) };
    return { id, v, br, sr, hull, type: v.type || (v.entity && v.entity.type) || 'unknown' };
  });
  // greedy colouring: everyone in one batch can be hidden together and told apart by rectangle
  const batches = [];
  for (const c of cast) {
    let b = batches.find((bt) => bt.every((o) => !overlaps(o.hull, c.hull)));
    if (!b) { b = []; batches.push(b); }
    b.push(c);
  }

  // ------------------------------------------------------------------ the frames
  const base = shoot();                                   // what the player sees
  for (const c of cast) {
    const m = maskOf(c.v);
    c.grid = m.grid; c.texels = m.texels; c.maskSet = m.set;
    c.onScreen = m.onScreen; c.offScreen = m.offScreen;
  }

  const propMeshes = [...R.dungeon.itemViews.values()].filter((o) => o.visible);
  for (const o of propMeshes) o.visible = false;
  const noProps = propMeshes.length ? shoot() : null;
  for (const o of propMeshes) o.visible = true;

  // ------------------------------------------------------------------ what the EFFECTS painted
  // Sparks, blood, spell bursts, rings, runes, decals and damage numbers are drawn in the
  // transparent pass, ON TOP of the cast and BLENDED with it, so hiding a creature underneath one
  // still changes the pixel and `ownSet` above cannot drop them. Their colour and their edges are
  // the PARTICLES', at the particles' own sub-pixel phase: in 'combat' the Werebear stands inside a
  // spell burst and measured 0.61 of its edges on the grid, which is a fact about the spell. So
  // every effect the renderer owns is hidden for one frame and each character records how much of
  // it the effects were painting (`fxFraction`, reported) — those pixels are then left out of the
  // GRID statistics only. They stay in the tone and contact samples, which are what the player is
  // actually looking at.
  const fxRoots = [];
  for (const k of Object.keys(R.effects || {})) {
    const v = R.effects[k];
    if (!v || typeof v !== 'object' || v.isScene) continue;
    if (v.isObject3D) { fxRoots.push(v); continue; }
    for (const k2 of Object.keys(v)) { const w = v[k2]; if (w && w.isObject3D && !w.isScene) fxRoots.push(w); }
  }
  const fxWas = fxRoots.map((o) => o.visible);
  for (const o of fxRoots) o.visible = false;
  const noFx = fxRoots.length ? shoot() : null;
  fxRoots.forEach((o, i) => { o.visible = fxWas[i]; });
  const fxAt = (x, y) => !!noFx && maxd(px(base, x, y), px(noFx, x, y)) > 6;

  /** Pixels inside `rect` where two frames differ by more than `tol` on any channel. */
  const diffMask = (a, b, rect, tol) => {
    const m = [];
    for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) {
      const i = (((H - 1 - y) * W) + x) * 4;
      if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > tol) m.push(y * W + x);
    }
    return m;
  };

  for (const b of batches) {
    for (const c of b) c.v.sprite.mesh.visible = false;
    const frame = shoot();
    for (const c of b) {
      // what the room shows through the hole this figure leaves, and how much of the figure the
      // room could be told apart from at all
      const amb = [];
      let changed = 0, footTexels = 0, footChanged = 0;
      let maxTy = 0;
      for (const t of c.texels) if (t.ty > maxTy) maxTy = t.ty;
      const footFrom = maxTy - Math.max(1, Math.round(maxTy * 0.15));
      for (const t of c.texels) {
        amb.push(lum(frame, t.cx, t.cy));
        const moved = maxd(px(base, t.cx, t.cy), px(frame, t.cx, t.cy)) > 2;
        if (moved) changed++;
        if (t.ty >= footFrom) { footTexels++; if (moved) footChanged++; }
      }
      c.ambient = median(amb);
      c.coverage = c.texels.length ? changed / c.texels.length : 0;
      // THE PIXELS THIS FIGURE ACTUALLY OWNS. Not every pixel inside its footprint is its own: in
      // 'combat' the Werebear is under a spell burst, a spray of blood motes and half the hero, all
      // drawn in the TRANSPARENT pass where no depth trick can be got in front of them. Those
      // pixels are the PARTICLES' colour, at the particles' own sub-pixel phase, and measuring the
      // Werebear's texel grid through them scored it 0.64 aligned when its own art is exact — a
      // gate failing a creature for a spell somebody cast on it. A pixel is this figure's only if
      // hiding the figure CHANGES it; that is the definition, and it drops overlays, overlapping
      // cast and occluders in one step. Used for the grid statistics only: the TONE sample keeps
      // every texel, because a creature invisible against the floor must stay in that median.
      c.ownSet = new Set();
      for (const k of c.maskSet) {
        const x = k % W, y = (k / W) | 0;
        if (maxd(px(base, x, y), px(frame, x, y)) > 2) c.ownSet.add(k);
      }
      // ARE THE FEET IN THE PICTURE AT ALL? The bottom sixth of the figure, and how much of it the
      // frame loses when the figure is hidden. The hero in 'combat' stands behind a boulder that is
      // drawn in the TRANSPARENT pass, which no depth trick can put him in front of, so `occlusion`
      // reads 0 for him and this is the number that knows his boots are not on screen. Without it
      // the contact gate would fail him for a shadow the room is standing in front of.
      c.feetCoverage = footTexels ? footChanged / footTexels : 0;
      // THE TOOL AUDITS ITSELF: slide the predicted grid a couple of pixels each way and see where
      // it best explains the pixels that changed. Anything but (0,0) means this file's copy of the
      // vertex shader's placement has drifted from spriteBillboard's, and every number below it is
      // measuring the wrong pixels.
      let best = { dx: 0, dy: 0, hits: -1 };
      const span = S + 1;
      for (let dy = -span; dy <= span; dy++) for (let dx = -span; dx <= span; dx++) {
        let hits = 0;
        for (const t of c.texels) {
          const x = t.cx + dx, y = t.cy + dy;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          if (maxd(px(base, x, y), px(frame, x, y)) > 2) hits++;
        }
        if (hits > best.hits) best = { dx, dy, hits };
      }
      c.align = { dx: best.dx, dy: best.dy, coverage: c.texels.length ? best.hits / c.texels.length : 0 };
    }
    for (const c of b) c.v.sprite.mesh.visible = true;
  }
  // OCCLUSION, MEASURED AND NOT GUESSED. A hero standing behind a boulder loses two thirds of his
  // texels to it, and a mask that keeps them measures the BOULDER's luminance and calls it his. So
  // each batch is drawn once more with its members' depth comparison set to ALWAYS — where a
  // sprite's colour changes once it is allowed to draw over everything, something was in front of
  // it. Those texels are dropped from the tone sample and counted, so a figure the room hides is
  // reported as hidden instead of being failed for a shadow it could not show or passed on a rock's
  // brightness.
  //
  // NOT `depthTest = false`: GL stops WRITING depth when the test is off, so the sprite left no
  // depth behind, every dust mote and light shaft drawn after it painted straight over it, and the
  // hero in an empty room measured 38% "occluded" — brighter and greyer, which is fog, not a rock.
  // `depthFunc = AlwaysDepth` keeps the writes and only drops the comparison; the same hero then
  // measures 2.8%, all of it single texels on his own outline.
  for (const b of batches) {
    for (const c of b) c.v.sprite.material.depthFunc = 1;          // THREE.AlwaysDepth
    const frame = shoot();
    for (const c of b) {
      let hidden = 0, footTexels = 0, footHidden = 0;
      let maxTy = 0;
      for (const t of c.texels) if (t.ty > maxTy) maxTy = t.ty;
      const footFrom = maxTy - Math.max(1, Math.round(maxTy * 0.15));
      for (const t of c.texels) {
        t.occluded = maxd(px(base, t.cx, t.cy), px(frame, t.cx, t.cy)) > 2;
        if (t.occluded) hidden++;
        if (t.ty >= footFrom) { footTexels++; if (t.occluded) footHidden++; }
      }
      c.occlusion = c.texels.length ? hidden / c.texels.length : 0;
      c.feetOccluded = footTexels ? footHidden / footTexels : 0;
    }
    for (const c of b) c.v.sprite.material.depthFunc = 3;          // THREE.LessEqualDepth (the default)
  }

  for (const b of batches) {
    for (const c of b) c.v.sprite.blob.visible = false;
    const frame = shoot();
    for (const c of b) {
      let n = 0, sum = 0, worst = 0, core = 0;
      const ground = [];
      for (let y = c.sr.y0; y <= c.sr.y1; y++) for (let x = c.sr.x0; x <= c.sr.x1; x++) {
        if (c.maskSet.has(y * W + x)) continue;            // the body itself is not its shadow
        const withBlob = lum(base, x, y), without = lum(frame, x, y);
        // HOW LIT THE GROUND THIS CREATURE STANDS ON IS, read with its own shadow lifted off, so a
        // figure in a dark corner is not failed for reading dark and a figure on a torchlit
        // flagstone has nowhere to hide. This is what `lit` means in tests/screenTruth.test.js.
        ground.push(without);
        const drop = without - withBlob;
        if (drop <= 0.003) continue;
        const rel = drop / Math.max(without, 1e-4);
        n++; sum += rel; if (rel > worst) worst = rel;
        if (rel >= 0.12) core++;                           // the near-opaque part under a foot
      }
      c.contact = { px: n, core, strength: n ? sum / n : 0, peak: worst };
      c.groundLight = median(ground);
    }
    for (const c of b) c.v.sprite.blob.visible = true;
  }

  // --------------------------------------------------------- run length / grid alignment
  /**
   * Horizontal run statistics over a set of pixels: how long a stretch of one colour is, how often
   * two neighbours match, and whether the colour edges land on one repeating column phase (which is
   * what a texel grid IS).
   */
  const runStats = (buf, inMask, rect) => {
    const runs = [];
    let same = 0, pairs = 0, edgeTotal = 0;
    const SG = Math.max(1, Math.round(S));                  // the grid the phase histogram bins on
    const residue = new Array(SG).fill(0);
    for (let y = rect.y0; y <= rect.y1; y++) {
      let start = -1, c0 = null, prev = null;
      for (let x = rect.x0; x <= rect.x1 + 1; x++) {
        const on = x <= rect.x1 && inMask(x, y);
        const c = on ? px(buf, x, y) : null;
        if (on && prev) {
          pairs++;
          if (maxd(c, prev) <= K.runTol) same++;
          if (maxd(c, prev) > K.edgeTol) { edgeTotal++; residue[x % SG]++; }
        }
        if (!on) { if (start >= 0) { runs.push(x - start); start = -1; } prev = null; c0 = null; continue; }
        if (start < 0) { start = x; c0 = c; }
        else if (maxd(c, c0) > K.runTol) { runs.push(x - start); start = x; c0 = c; }
        prev = c;
      }
    }
    const sorted = runs.slice().sort((a, b) => a - b);
    const mean = runs.length ? runs.reduce((a, b) => a + b, 0) / runs.length : 0;
    const onGrid = runs.length ? runs.filter((r) => r % SG === 0).length / runs.length : 0;
    const edgeAlign = edgeTotal ? Math.max(...residue) / edgeTotal : 0;
    return {
      runs: runs.length, runPx: +mean.toFixed(2), runTexels: +(mean / S).toFixed(2), runMedian: pct(sorted, 0.5),
      onGrid: +onGrid.toFixed(3), sameNeighbour: +(pairs ? same / pairs : 0).toFixed(3),
      edges: edgeTotal, edgeAlign: +edgeAlign.toFixed(3),
    };
  };

  // ------------------------------------------------------------------------- pillow, on screen
  /**
   * Pillow shading measured on the FRAME, over every body texel the player can see.
   *
   * Material identity comes from the ART (the sheet texel behind each screen texel, so a run ends
   * exactly where the painter changed material and the house ink is excluded as the contour it is);
   * the PROFILE is the screen luminance of those texels. Denominator: every visible non-ink body
   * texel, whatever length of run it sits in — this is the number style.js's FORM_RUN_MIN=8 was
   * only ever computing over 15-46% of.
   */
  const isInk = (rgb) => rgbDist(rgb, K.ink) <= K.inkTol || rgbDist(rgb, K.inkDeep) <= K.inkTol;
  const pillowOf = (c) => {
    if (!c.texels.length) return null;
    const rows = new Map();
    for (const t of c.texels) {
      if (isInk(t.rgb) || t.occluded) continue;             // the contour is not a form, nor is a rock
      let r = rows.get(t.ty); if (!r) { r = []; rows.set(t.ty, r); }
      r.push(t);
    }
    let bodyTexels = 0, pillowTexels = 0, worst = null;
    for (const [ty, list] of rows) {
      list.sort((a, b) => a.j - b.j);
      let run = [], prevMat = null, prevJ = -99;
      const flush = (endCol) => {
        const n = run.length;
        if (!n) { run = []; return; }
        bodyTexels += n;                                    // EVERY body texel counts, run or not
        if (n >= K.formRunMin) {
          const p = run.slice();                            // read through one-texel drawn seams
          for (let q = 1; q < n - 1; q++) if (run[q] < run[q - 1] - 0.02 && run[q] < run[q + 1] - 0.02) p[q] = (run[q - 1] + run[q + 1]) / 2;
          const t = Math.floor(n / 3);
          const mean = (a, b) => { let s = 0; for (let q = a; q < b; q++) s += p[q]; return s / (b - a); };
          const lo = mean(0, t), mid = mean(t, n - t), hi = mean(n - t, n);
          const dark = Math.min(lo, hi), light = Math.max(lo, hi);
          if (mid - light > K.screenFormStep && light - dark < (mid - dark) * K.formSymmetry) {
            pillowTexels += n;
            if (!worst || n > worst.n) worst = { row: ty, col: endCol - n, n };
          }
        }
        run = [];
      };
      for (const t of list) {
        if (t.j !== prevJ + 1) flush(t.j);                  // a gap in the row ends the form
        else if (prevMat && rgbDist(t.rgb, prevMat) > K.matTol) flush(t.j);
        run.push(lum(base, t.cx, t.cy));
        prevMat = t.rgb; prevJ = t.j;
      }
      flush(prevJ + 1);
    }
    return { bodyTexels, pillowTexels, pillow: +(bodyTexels ? pillowTexels / bodyTexels : 0).toFixed(3), worst };
  };

  // ------------------------------------------------------------------------- per character
  const characters = [];
  for (const c of cast) {
    if (c.maskSet.size < 16) continue;                      // entirely off screen
    let bx0 = W, bx1 = -1, by0 = H, by1 = -1;
    // THE BODY, NOT THE OUTLINE. style.js measures a sheet's median over its fill tones with the
    // ink dropped, and LIT_VALUE_FLOOR is a number on that scale; a mask that keeps the one-texel
    // contour would be measuring a different quantity and comparing it to the same floor. Both are
    // reported: `litMedian` is the body, `litMedianWithInk` is every texel the sprite draws.
    const lums = [], all = [];
    let inkTexels = 0;
    for (const t of c.texels) {
      const ink = isInk(t.rgb);
      if (ink) inkTexels++;
      for (let dy = 0; dy < t.h; dy++) for (let dx = 0; dx < t.w; dx++) {
        const x = t.x + dx, y = t.y + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
        if (t.occluded) continue;                           // that pixel belongs to whatever is in front
        const L = lum(base, x, y);
        all.push(L);
        if (!ink) lums.push(L);
      }
    }
    if (!lums.length) continue;
    lums.sort((a, b) => a - b);
    all.sort((a, b) => a - b);
    const rect = { x0: bx0, x1: bx1, y0: by0, y1: by1 };
    // the grid is measured on the pixels this figure actually owns (`ownSet`, above): a pixel a
    // boulder is drawn over, or a spell burst, or another sprite, contributes THAT thing's edges at
    // THAT thing's phase, which is not a fact about this sprite's pixel grid
    const visSet = new Set();
    let fxPixels = 0;
    for (const t of c.texels) {
      if (t.occluded) continue;
      for (let dy = 0; dy < t.h; dy++) for (let dx = 0; dx < t.w; dx++) {
        const x = t.x + dx, y = t.y + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        if (c.ownSet && !c.ownSet.has(y * W + x)) continue;
        if (fxAt(x, y)) { fxPixels++; continue; }             // that pixel is a spell, not the art
        visSet.add(y * W + x);
      }
    }
    const rs = runStats(base, (x, y) => visSet.has(y * W + x), rect);
    const pil = pillowOf(c);
    const figurePx = by1 - by0 + 1;
    characters.push({
      id: c.id, type: c.type, name: (c.v.entity && c.v.entity.kind === 'player') ? 'player' : c.type,
      pixels: c.maskSet.size, ownPixels: visSet.size, fxPixels,
      fxFraction: +(c.maskSet.size ? fxPixels / c.maskSet.size : 0).toFixed(3),
      texels: c.texels.length, offScreenTexels: c.offScreen,
      coverage: +c.coverage.toFixed(3), squashed: !c.grid.snapped,
      occlusion: +c.occlusion.toFixed(3), feetOccluded: +c.feetOccluded.toFixed(3),
      feetCoverage: +c.feetCoverage.toFixed(3),
      align: { dx: c.align.dx, dy: c.align.dy, coverage: +c.align.coverage.toFixed(3) },
      bbox: { x: bx0, y: by0, w: bx1 - bx0 + 1, h: figurePx },
      litMedian: +pct(lums, 0.5).toFixed(4), p10: +pct(lums, 0.1).toFixed(4), p90: +pct(lums, 0.9).toFixed(4),
      litMean: +(lums.reduce((a, b) => a + b, 0) / lums.length).toFixed(4),
      litMedianWithInk: +pct(all, 0.5).toFixed(4), bodyPixels: lums.length,
      inkFraction: +(inkTexels / c.texels.length).toFixed(3),
      ambient: +c.ambient.toFixed(4), contrast: +(pct(lums, 0.5) - c.ambient).toFixed(4),
      contact: { px: c.contact.px, core: c.contact.core, strength: +c.contact.strength.toFixed(4), peak: +c.contact.peak.toFixed(4) },
      groundLight: +c.groundLight.toFixed(4),
      runPx: rs.runPx, runTexels: rs.runTexels, runMedianPx: rs.runMedian, onGrid: rs.onGrid,
      sameNeighbour: rs.sameNeighbour, edges: rs.edges, edgeAlign: rs.edgeAlign,
      figurePx, figureTexels: +(figurePx / S).toFixed(2),
      widthTexels: +((bx1 - bx0 + 1) / S).toFixed(2),
      pillow: pil,
    });
  }
  characters.sort((a, b) => a.litMedian - b.litMedian);

  // ------------------------------------------------------------------------- the floor
  const pv = R.playerView || (cast.find((c) => c.v.entity && c.v.entity.kind === 'player') || {}).v;
  const anchor = pv ? anchorOf(pv) : { x: W / 2, y: H * 0.6 };
  const charPixels = new Set();
  for (const c of cast) if (c.maskSet) for (const k of c.maskSet) charPixels.add(k);
  // the props' own pixels, with anything an effect was painting over dropped for the same reason
  // the cast's grid sample drops it (see `fxAt`)
  const propMask = new Set();
  if (noProps) for (const k of diffMask(base, noProps, { x0: 0, x1: W - 1, y0: 0, y1: H - 1 }, 10)) {
    if (!fxAt(k % W, (k / W) | 0)) propMask.add(k);
  }
  const floorOk = (x, y) => !charPixels.has(y * W + x) && !propMask.has(y * W + x) && !fxAt(x, y) && lum(base, x, y) > 0.03;
  let floorRect = {
    x0: clampX(anchor.x - 2.5 * tilePx), x1: clampX(anchor.x + 2.5 * tilePx),
    y0: clampY(anchor.y + 0.25 * tilePx), y1: clampY(anchor.y + 1.6 * tilePx),
  };
  let floorPx = 0;
  for (let y = floorRect.y0; y <= floorRect.y1; y++) for (let x = floorRect.x0; x <= floorRect.x1; x++) if (floorOk(x, y)) floorPx++;
  if (floorPx < 2000) {                                     // the hero is at the edge of the plate
    floorRect = { x0: (W * 0.2) | 0, x1: (W * 0.8) | 0, y0: (H * 0.55) | 0, y1: (H * 0.9) | 0 };
    floorPx = 0;
    for (let y = floorRect.y0; y <= floorRect.y1; y++) for (let x = floorRect.x0; x <= floorRect.x1; x++) if (floorOk(x, y)) floorPx++;
  }
  const floorStats = runStats(base, floorOk, floorRect);
  const floor = { pixels: floorPx, rect: floorRect, ...floorStats };

  // ------------------------------------------------------------------------- the props
  let props = null;
  if (propMask.size > 200) {
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (const k of propMask) { const x = k % W, y = (k / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    props = { count: propMeshes.length, pixels: propMask.size, ...runStats(base, (x, y) => propMask.has(y * W + x), { x0, x1, y0, y1 }) };
  }

  grainU.value = grain0;
  R.draw();
  return {
    width: W, height: H, texelPx: S, tilePx: +tilePx.toFixed(2), sabotage,
    // THE CAMERA IS ORTHOGRAPHIC: a fixed plan view with no field of view, so `fov` is undefined and
    // the frustum height / zoom are what set the scale (and, through `frameTexelSize`, the texel
    // size the whole frame is drawn on). Both projections are described so a report says which one
    // it was measured under, and `pxPerWorld` is the number the grid numbers above derive from.
    camera: {
      projection: R.camera.isOrthographicCamera ? 'orthographic' : 'perspective',
      fov: R.camera.isPerspectiveCamera ? R.camera.fov : null,
      top: R.camera.isOrthographicCamera ? +R.camera.top.toFixed(4) : null,
      bottom: R.camera.isOrthographicCamera ? +R.camera.bottom.toFixed(4) : null,
      zoom: +(R.camera.zoom || 1).toFixed(4),
      pxPerWorld: R.camera.isOrthographicCamera
        ? +(H / Math.max(1e-6, (R.camera.top - R.camera.bottom) / (R.camera.zoom || 1))).toFixed(3) : null,
      overview: !!R.cameraRig.overview,
      pos: [+R.camera.position.x.toFixed(2), +R.camera.position.y.toFixed(2), +R.camera.position.z.toFixed(2)],
    },
    renders: 1 + (noProps ? 1 : 0) + (noFx ? 1 : 0) + batches.length * 3, batches: batches.length,
    characters, floor, props,
  };
}

/**
 * Audit one or more scenarios in a single browser.
 * @param {string[]} names
 * @param {{seed?:number, width?:number, height?:number, wait?:number}} [opts]
 * @returns {Promise<{reports:Record<string,object>, errors:string[], unknown:string[]}>}
 */
export async function auditScenarios(names, opts = {}) {
  const seed = Number(opts.seed ?? 42), width = Number(opts.width ?? 1600), height = Number(opts.height ?? 900);
  const wait = Number(opts.wait ?? 1500);
  // an entry is a scenario name, or { scenario, sabotage } to measure a deliberately broken frame
  const runs = names.map((n) => (typeof n === 'string' ? { scenario: n, sabotage: opts.sabotage || 'none' } : { sabotage: 'none', ...n }))
    .map((r) => ({ ...r, key: r.key || (r.sabotage && r.sabotage !== 'none' ? `${r.scenario}#${r.sabotage}` : r.scenario) }));
  const server = await startServer();
  const b = await launchBrowser({ width, height });
  const reports = {}, unknown = [];
  try {
    await b.page.goto(server.url + `?debug=1&seed=${seed}`, { waitUntil: 'load' });
    await waitReady(b.page);
    for (const run of runs) {
      // every run re-runs its scenario from scratch, so a sabotaged frame cannot leak into the next
      const ok = await b.page.evaluate(async ({ n, s }) => window.__game.debug.runScenario(n, { seed: s }), { n: run.scenario, s: seed });
      if (ok === false) { unknown.push(run.scenario); continue; }
      await advance(b.page, wait);
      const r = await b.page.evaluate(inPageAudit, { ...AUDIT_CONST, sabotage: run.sabotage });
      reports[run.key] = { scenario: run.scenario, seed, ...r };
    }
  } finally {
    await b.close();
    server.stop();
  }
  return { reports, errors: b.errors.slice(), unknown };
}

/** Audit a single scenario. @returns {Promise<object>} the report */
export async function auditScenario(name, opts = {}) {
  const { reports, unknown } = await auditScenarios([name], opts);
  if (unknown.length) throw new Error('unknown scenario: ' + name);
  return reports[name];
}

/** A readable table of one report. @param {object} r @returns {string} */
export function formatReport(r) {
  const L = [];
  L.push(`SCENARIO ${r.scenario}${r.sabotage && r.sabotage !== 'none' ? ' [SABOTAGE: ' + r.sabotage + ']' : ''}  seed=${r.seed}  ${r.width}x${r.height}  texel=${r.texelPx}px  tile=${r.tilePx}px  camera=${r.camera.overview ? 'overview' : 'play'}/${r.camera.projection || 'perspective'}`
    + `${r.camera.pxPerWorld ? ' ' + r.camera.pxPerWorld + 'px/world' : ''}  (${r.renders} renders, ${r.batches} batches)`);
  const head = ['character', 'litMed', 'P10', 'P90', 'amb', 'cntr', 'shPx', 'shStr', 'runPx', 'runTx', 'same', 'edgeAl', 'figTx', 'figPx', 'pillow', 'bodyTx', 'cover', 'occl', 'px'];
  const w = [18, 7, 7, 7, 7, 7, 6, 7, 6, 6, 6, 7, 7, 6, 7, 7, 7, 6, 7];
  const row = (cells) => cells.map((c, i) => String(c).padEnd(w[i])).join('');
  L.push(row(head));
  for (const c of r.characters) {
    L.push(row([
      c.name.slice(0, 17), c.litMedian.toFixed(3), c.p10.toFixed(3), c.p90.toFixed(3), c.ambient.toFixed(3),
      c.contrast.toFixed(3), c.contact.px, c.contact.strength.toFixed(3), c.runPx.toFixed(2), c.runTexels.toFixed(2),
      c.sameNeighbour.toFixed(2), c.edgeAlign.toFixed(2), c.figureTexels.toFixed(1), c.figurePx,
      c.pillow ? c.pillow.pillow.toFixed(3) : '-',
      c.pillow ? c.pillow.bodyTexels : '-', c.coverage.toFixed(2), c.occlusion.toFixed(2), c.pixels,
    ]));
  }
  const f = r.floor;
  L.push(row(['FLOOR', '', '', '', '', '', '', '', f.runPx.toFixed(2), f.runTexels.toFixed(2), f.sameNeighbour.toFixed(2), f.edgeAlign.toFixed(2), '', '', '', '', '', '', f.pixels]));
  if (r.props) {
    const p = r.props;
    L.push(row([`PROPS (${p.count})`, '', '', '', '', '', '', '', p.runPx.toFixed(2), p.runTexels.toFixed(2), p.sameNeighbour.toFixed(2), p.edgeAlign.toFixed(2), '', '', '', '', '', '', p.pixels]));
  }
  return L.join('\n');
}

// ------------------------------------------------------------------------------------ CLI
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : [])).filter(Boolean));
  const names = String(args.scenario || 'deep-level').split(',').map((s) => s.trim()).filter(Boolean);
  const { reports, errors, unknown } = await auditScenarios(names, args);
  const keys = Object.keys(reports);
  for (const k of keys) console.log(formatReport(reports[k]) + '\n');
  if (args.json && typeof args.json === 'string') {
    fs.mkdirSync(path.dirname(path.resolve(args.json)), { recursive: true });
    fs.writeFileSync(args.json, JSON.stringify(keys.length === 1 ? reports[keys[0]] : reports, null, 2));
    console.log('wrote ' + args.json);
  } else {
    console.log(JSON.stringify(keys.length === 1 ? reports[keys[0]] : reports));
  }
  let code = 0;
  if (unknown.length) { console.error('unknown scenario: ' + unknown.join(', ')); code = 3; }
  if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); code = code || 1; }
  process.exit(code);
}
