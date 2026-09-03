// CameraRig: tilted perspective diorama camera with game feel.
//  - critically damped follow with a soft dead zone and spring-smoothed look-ahead (no tile jitter)
//  - tasteful zoom stops (wheel / [ ]) that couple distance with elevation and a touch of FOV
//  - trauma-based screen shake (smooth seeded noise + roll) and directional recoil on hits
//  - stairs dive / rise with FOV rush and roll, pit free-fall with a landing thud, arrival push-in
//  - temple sanctum: low reverent tilt, gentle dolly and slow yaw drift while near an altar
//  - per-depth yaw variation, overview framing and a cinematic breathing orbit for the title
// Everything is deterministic (seeded noise, pure functions of time) so debug.step is repeatable.
import * as THREE from 'three';
import { bus as globalBus } from '../core/events.js';
import { TILE } from '../core/constants.js';
import { TraumaShaker } from './cameraShake.js';

const DEG = Math.PI / 180;
const BASE_FOV = 38;
const BASE_DIST = 12.5;
const BASE_ELEV = 55 * DEG;
const BASE_YAW = 14 * DEG;
/** Zoom stops: each wheel notch moves to the neighbouring stop. */
export const ZOOM_STOPS = [0.72, 0.85, 1, 1.18, 1.4];
const DEAD_ZONE = { x: 0.42, z: 0.32 }; // half extents, tiles
const FRAME_BIAS = new THREE.Vector3(0, 0, -0.3); // player sits a hair below centre (diorama framing)
const FOLLOW_OMEGA = 7.5, OVERVIEW_OMEGA = 3.5, LOOKAHEAD_OMEGA = 3.2;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInQuad = (t) => t * t;
/** Frame-rate independent exponential approach. */
const damp = (cur, dst, rate, dt) => lerp(cur, dst, 1 - Math.exp(-rate * dt));
/** Per-depth yaw: a few degrees of variation so every level sits a little differently. */
const depthYaw = (depth) => Math.sin((depth || 0) * 2.399) * 3 * DEG;

export class CameraRig {
  /**
   * @param {number} aspect
   * @param {{bus?:import('../core/events.js').EventBus}} [opts]
   */
  constructor(aspect = 16 / 9, { bus = globalBus } = {}) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.3, 120);
    this.bus = bus;
    // follow state
    this.target = new THREE.Vector3(); // raw followed position
    this.anchor = new THREE.Vector3(); // dead-zone window centre
    this.lookAheadTarget = new THREE.Vector3();
    this.lookAhead = new THREE.Vector3();
    this.lookAheadVel = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    // rig parameters (public, tweakable)
    this.elevation = BASE_ELEV;
    this._yaw = BASE_YAW;
    this.distance = BASE_DIST;
    this.zoom = 1;
    this.currentZoom = 1;
    this.currentDistance = this.distance;
    this.currentElevation = this.elevation;
    this.currentYaw = this._yaw;
    this.depthYaw = 0;
    this.fovOffset = 0; // transient FOV punch (degrees)
    this.lookHeight = 0.3;
    // context
    this.level = null;
    this.sanctum = 0; // 0..1 near a temple
    this.overview = null; // {center, distance, elevation}
    this.orbitTouched = false; this.cineTime = 0;
    // transitions / shake
    this.transition = null; // {kind:'descend'|'ascend'|'drop'|'arrive', t, dur, midDone, onMid, landed}
    this.fade = 0; // 0 clear .. 1 black
    this.dive = 0;
    this.time = 0;
    this.shaker = new TraumaShaker();
    this.shakeAmount = 0; // last frame's shake energy (read-only, for effects)
    this._dst = new THREE.Vector3(); this._diff = new THREE.Vector3(); this._tmp = new THREE.Vector3();
    this.unsub = [];
    this.listen();
  }

  /** Base yaw; main.js drives this during the title orbit, which switches on the cinematic breathing. */
  get yaw() { return this._yaw; }
  set yaw(v) { if (this.overview && Math.abs(v - this._yaw) > 1e-9) this.orbitTouched = true; this._yaw = v; }

  get shakeEnabled() { return this.shaker.enabled; }
  set shakeEnabled(v) { this.shaker.enabled = !!v; if (!v) this.shaker.trauma = 0; }

  get shakeOffset() { return this.shaker.out; }

  listen() {
    if (!this.bus) return;
    const on = (n, f) => this.unsub.push(this.bus.on(n, f));
    on('game:start', ({ game }) => { if (game) { this.level = game.level; this.depthYaw = depthYaw(game.level && game.level.depth); } });
    on('level:enter', ({ level, depth, via }) => {
      this.level = level || this.level;
      this.depthYaw = depthYaw(depth ?? (level && level.depth));
      if (via === 'pit') this.startTransition('drop');
      else if (via === 'new') this.startTransition('arrive');
      else if (via === 'teleport') this.punchFov(-5);
    });
    on('entity:attacked', ({ attacker, defender, damage = 0, killed, crit }) => {
      if (!attacker || !defender) return;
      const isPlayerHit = defender.kind === 'player';
      const isPlayerSwing = attacker.kind === 'player';
      if (!isPlayerHit && !isPlayerSwing) return;
      const dx = defender.x - attacker.x, dz = defender.y - attacker.y;
      const len = Math.hypot(dx, dz) || 1;
      if (isPlayerHit) {
        const d = 0.16 + Math.min(0.34, damage * 0.012);
        this.kick(dx / len, dz / len, d);
        this.punchFov(Math.min(4, 1.5 + damage * 0.1));
      } else {
        this.kick(dx / len, dz / len, killed ? 0.16 : crit ? 0.12 : 0.07); // lunge toward the target
      }
    });
    on('trap:triggered', ({ type }) => { if (type === 'explosion' || type === 'ceiling') this.punchFov(2.5); });
  }

  dispose() { for (const off of this.unsub) if (typeof off === 'function') off(); this.unsub.length = 0; }

  setAspect(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  /** Follow a world position with a look-ahead direction (world-space, scaled). */
  follow(pos, dir = null) {
    this.target.set(pos.x, 0, pos.z);
    // soft dead zone: the anchor only moves once the player pushes past the window
    const ax = clamp(this.anchor.x, pos.x - DEAD_ZONE.x, pos.x + DEAD_ZONE.x);
    const az = clamp(this.anchor.z, pos.z - DEAD_ZONE.z, pos.z + DEAD_ZONE.z);
    this.anchor.set(ax, 0, az);
    if (dir) this.lookAheadTarget.set(dir.x * 0.9, 0, dir.z * 0.9);
    if (this.overview) { this.overview = null; this.cineTime = 0; }
  }

  /** Frame an entire level (or a rectangle) from above. */
  setOverview(cx, cz, w, h, { elevation = 62 } = {}) {
    const fov = BASE_FOV * DEG;
    const aspect = this.camera.aspect;
    const el = elevation * DEG;
    const distH = (h * 0.5 * Math.sin(el) + 1.5) / Math.tan(fov / 2) * 0.98;
    const distW = (w * 0.5 + 1) / (Math.tan(fov / 2) * aspect) * 0.98;
    this.overview = { center: new THREE.Vector3(cx, 0, cz), distance: Math.max(distH, distW, 6), elevation: el };
    this.cineTime = 0; this.orbitTouched = false;
  }

  /** Wheel / bracket zoom: steps to the neighbouring tasteful stop in the direction of change. */
  setZoom(z) {
    z = clamp(z, ZOOM_STOPS[0], ZOOM_STOPS[ZOOM_STOPS.length - 1]);
    const cur = this.zoom;
    let pick = null;
    if (z > cur + 1e-4) pick = ZOOM_STOPS.find((s) => s > cur + 1e-4) ?? cur;
    else if (z < cur - 1e-4) pick = [...ZOOM_STOPS].reverse().find((s) => s < cur - 1e-4) ?? cur;
    else pick = ZOOM_STOPS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));
    this.zoom = pick;
  }

  /** Continuous zoom (no stop snapping), for scripted cameras. */
  setZoomExact(z) { this.zoom = clamp(z, 0.5, 2); }

  /** Add shake energy (0..1); quadratic response, decays on its own. */
  shake(amount) {
    const tr = this.transition;
    if (tr && tr.kind === 'drop' && !tr.landed) { tr.pending = (tr.pending || 0) + amount * 0.85; return; } // the thud belongs to the landing
    this.shaker.add(amount * 0.85);
  }

  /** Directional recoil: displaces the follow spring by ~d tiles along (dx, dz); it springs back. */
  kick(dx, dz, d) {
    const v = d * FOLLOW_OMEGA * Math.E;
    this.velocity.x += dx * v; this.velocity.z += dz * v;
  }

  /** Transient FOV change in degrees (positive narrows = impact, negative widens = blink). */
  punchFov(deg) { this.fovOffset = clamp(this.fovOffset + deg, -8, 8); }

  /** Snap smoothing to the current target instantly (keeps any running stairs transition). */
  snap() {
    const ov = this.overview;
    this.anchor.copy(this.target);
    this.lookAhead.copy(this.lookAheadTarget); this.lookAheadVel.set(0, 0, 0);
    const dst = ov ? ov.center : this._dst.copy(this.anchor).add(this.lookAhead).add(FRAME_BIAS);
    this.smoothTarget.copy(dst);
    this.velocity.set(0, 0, 0);
    this.currentZoom = this.zoom;
    this.sanctum = this.sanctumFactor();
    const want = this.wanted();
    this.currentDistance = want.distance; this.currentElevation = want.elevation; this.currentYaw = want.yaw;
    if (this.transition && this.transition.kind === 'arrive') this.transition.t = 0; // restart the push-in from the snapped frame
    this.place();
  }

  /**
   * Stairs transition: fade to black while diving (down) or rising (up); onMid fires at the
   * darkest point (rebuild the level there), then the camera settles from the opposite side.
   * 'drop' (pit) and 'arrive' (new level push-in) are single-phase.
   */
  startTransition(kind, onMid) {
    const dur = kind === 'drop' ? 0.85 : kind === 'arrive' ? 1.1 : 1.05;
    this.transition = { kind, t: 0, dur, midDone: kind === 'drop' || kind === 'arrive', onMid: onMid || null, landed: false, frozen: false };
  }

  /** Debug/stills: park the running transition at time t (seconds) so screenshots can catch it mid-flight. */
  freezeTransition(t) { if (this.transition) { this.transition.t = t; this.transition.frozen = true; } }
  unfreezeTransition() { if (this.transition) this.transition.frozen = false; }

  /** 0..1 how close the followed point is to a temple altar. */
  sanctumFactor() {
    const lv = this.level;
    if (!lv || this.overview) return 0;
    let best = Infinity;
    const temples = lv.temples || [];
    for (const t of temples) { const d = Math.hypot(t.x - this.target.x, t.y - this.target.z); if (d < best) best = d; }
    if (best === Infinity && lv.get && lv.get(Math.round(this.target.x), Math.round(this.target.z)) === TILE.TEMPLE) best = 0;
    return smoothstep(2.6, 0.5, best);
  }

  /** Desired rig parameters for this frame (before smoothing and transient offsets). */
  wanted() {
    const ov = this.overview;
    if (ov) {
      const ct = this.cineTime;
      const cine = ct > 0 ? 1 : 0;
      return {
        distance: ov.distance * (1 + cine * 0.05 * Math.sin(ct * 0.13)),
        elevation: ov.elevation + cine * 3.5 * DEG * Math.sin(ct * 0.21),
        yaw: this._yaw,
        lookHeight: 0.3 + cine * 0.4,
      };
    }
    const z = this.currentZoom;
    const s = this.sanctum;
    const elev = clamp(this.elevation - (z - 1) * 12 * DEG, 46 * DEG, 63 * DEG) - s * 9 * DEG;
    const dist = (this.distance / z) * (1 - s * 0.14);
    const yaw = this._yaw + this.depthYaw + s * Math.sin(this.time * 0.35) * 3.5 * DEG;
    return { distance: dist, elevation: elev, yaw, lookHeight: 0.3 + s * 0.35 };
  }

  /** Evaluate the running transition: dive (camera height offset), fade, fov and roll contributions. */
  transitionState(dt) {
    const tr = this.transition;
    const out = { dive: 0, fade: 0, fov: 0, roll: 0, distMul: 1, elevAdd: 0 };
    if (!tr) return out;
    if (!tr.frozen) tr.t += dt;
    const k = Math.min(1, tr.t / tr.dur);
    if (tr.kind === 'descend' || tr.kind === 'ascend') {
      const sign = tr.kind === 'ascend' ? 1 : -1;
      if (k < 0.5) {
        const e = easeInQuad(k / 0.5);
        out.fade = Math.min(1, e * 1.25);
        out.dive = sign * e * 4.5;
        out.fov = -7 * e; // rush
        out.roll = sign * 1.6 * DEG * e;
        out.distMul = 1 - 0.18 * e;
      } else {
        if (!tr.midDone) { tr.midDone = true; if (tr.onMid) tr.onMid(); this.snap(); }
        const k2 = (k - 0.5) / 0.5;
        const u = 1 - easeOutCubic(k2);
        out.fade = Math.min(1, u * 1.3);
        out.dive = -sign * u * u * 5.5;
        out.fov = -7 * u;
        out.distMul = 1 + 0.08 * u;
        if (!tr.landed && k2 > 0.5) { tr.landed = true; this.shaker.add(0.28); }
      }
    } else if (tr.kind === 'drop') {
      // free fall from above, a thud on landing and a small bounce
      const land = 0.58;
      if (k < land) { const u = k / land; out.dive = 7.5 * (1 - u * u); out.fov = -4 * u; }
      else {
        if (!tr.landed) { tr.landed = true; this.shaker.add(0.6 + (tr.pending || 0)); }
        const u = (k - land) / (1 - land);
        out.dive = -0.55 * Math.sin(u * Math.PI) * (1 - u);
        out.fov = -4 * (1 - easeOutCubic(u));
      }
    } else if (tr.kind === 'arrive') {
      const u = 1 - easeOutCubic(k);
      out.distMul = 1 + 0.16 * u;
      out.elevAdd = 5 * DEG * u;
      out.dive = 0.6 * u;
    }
    if (k >= 1) { this.transition = null; return { dive: 0, fade: 0, fov: 0, roll: 0, distMul: 1, elevAdd: 0 }; }
    return out;
  }

  update(dt) {
    // sub-step long frames so the springs stay well inside their stability margin
    while (dt > 1 / 30 + 1e-6) { this.update(1 / 30); dt -= 1 / 30; }
    if (dt <= 0) return;
    this.time += dt;
    const ov = this.overview;
    if (ov) { if (this.orbitTouched) this.cineTime += dt; this.orbitTouched = false; }

    // look-ahead: its own critically damped spring so held-direction changes glide
    this.springTo(this.lookAhead, this.lookAheadVel, this.lookAheadTarget, LOOKAHEAD_OMEGA, dt);
    // context
    this.sanctum = damp(this.sanctum, this.sanctumFactor(), 3, dt);
    this.currentZoom = damp(this.currentZoom, this.zoom, 6, dt);

    // follow spring toward anchor + look-ahead (+ cinematic drift in overview)
    const dst = ov ? this._dst.copy(ov.center) : this._dst.copy(this.anchor).add(this.lookAhead).add(FRAME_BIAS);
    if (ov && this.cineTime > 0) { const ct = this.cineTime; dst.x += Math.sin(ct * 0.09) * 1.2; dst.z += Math.sin(ct * 0.07 + 0.4) * 0.9; }
    this.springTo(this.smoothTarget, this.velocity, dst, ov ? OVERVIEW_OMEGA : FOLLOW_OMEGA, dt);

    // rig parameters
    const want = this.wanted();
    const tr = this.transitionState(dt);
    this.currentDistance = damp(this.currentDistance, want.distance, 4, dt);
    this.currentElevation = damp(this.currentElevation, want.elevation, 3.5, dt);
    this.currentYaw = damp(this.currentYaw, want.yaw, 4, dt);
    this.lookHeight = damp(this.lookHeight, want.lookHeight, 4, dt);
    this.fovOffset = damp(this.fovOffset, 0, 11, dt);
    if (this.transition) this.fade = tr.fade; else this.fade = Math.max(0, this.fade - dt * 2.5);
    this.dive = tr.dive;
    this._trFov = tr.fov; this._trRoll = tr.roll; this._trDistMul = tr.distMul; this._trElevAdd = tr.elevAdd;

    // shake
    const sh = this.shaker.update(dt);
    this.shakeAmount = sh.amount;
    this.place();
  }

  /** Critically damped spring integration (semi-implicit Euler). */
  springTo(pos, vel, dst, omega, dt) {
    const diff = this._diff.subVectors(pos, dst);
    const accel = diff.multiplyScalar(-omega * omega).addScaledVector(vel, -2 * omega);
    vel.addScaledVector(accel, dt);
    pos.addScaledVector(vel, dt);
  }

  /** Position and orient the camera from the smoothed state plus transient offsets. */
  place() {
    const c = this.camera;
    const sh = this.shaker.out;
    const elev = this.currentElevation + (this._trElevAdd || 0);
    const dist = this.currentDistance * (this._trDistMul || 1);
    const yaw = this.currentYaw;
    const y = Math.sin(elev) * dist, r = Math.cos(elev) * dist;
    const tx = this.smoothTarget.x, tz = this.smoothTarget.z;
    c.position.set(tx + Math.sin(yaw) * r, y + this.dive, tz + Math.cos(yaw) * r);
    this._tmp.set(tx, this.lookHeight + this.dive * 0.4, tz);
    c.lookAt(this._tmp);
    // camera-space shake (handheld parallax) and roll
    if (sh.amount > 0) { c.translateX(sh.x); c.translateY(sh.y); }
    const roll = sh.roll + (this._trRoll || 0);
    if (roll) c.rotateZ(roll);
    const fov = BASE_FOV + this.fovOffset + (this._trFov || 0) + (this.currentZoom - 1) * -2;
    if (Math.abs(fov - c.fov) > 1e-3) { c.fov = fov; c.updateProjectionMatrix(); }
  }
}
