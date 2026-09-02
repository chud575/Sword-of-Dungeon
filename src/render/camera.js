// CameraRig: tilted perspective diorama camera that follows the player with look-ahead and
// critically damped smoothing, zoom, seeded screen shake, overview framing and stair transitions.
import * as THREE from 'three';
import { createRng } from '../core/rng.js';

export class CameraRig {
  constructor(aspect = 16 / 9) {
    this.camera = new THREE.PerspectiveCamera(38, aspect, 0.3, 120);
    this.target = new THREE.Vector3();
    this.smoothTarget = new THREE.Vector3();
    this.lookAhead = new THREE.Vector3();
    this.elevation = 55 * Math.PI / 180;
    this.yaw = 14 * Math.PI / 180;
    this.distance = 12.5;
    this.zoom = 1;
    this.currentDistance = this.distance;
    this.rng = createRng('fargoal-camera');
    this.shakeAmount = 0;
    this.shakeOffset = new THREE.Vector3();
    this.shakeEnabled = true;
    this.overview = null; // {center, distance, elevation}
    this.transition = null; // {kind, t, dur, midpoint, onMid, onEnd}
    this.fade = 0; // 0 clear .. 1 black
    this.dive = 0;
    this.time = 0;
    this.velocity = new THREE.Vector3();
    this._dst = new THREE.Vector3(); this._diff = new THREE.Vector3();
  }

  setAspect(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  /** Follow a world position with a look-ahead direction. */
  follow(pos, dir = null) {
    this.target.set(pos.x, 0, pos.z);
    if (dir) this.lookAhead.set(dir.x * 0.9, 0, dir.z * 0.9);
    this.overview = null;
  }

  /** Frame an entire level (or a rectangle) from above. */
  setOverview(cx, cz, w, h, { elevation = 62 } = {}) {
    const fov = this.camera.fov * Math.PI / 180;
    const aspect = this.camera.aspect;
    const el = elevation * Math.PI / 180;
    const distH = (h * 0.5 * Math.sin(el) + 1.5) / Math.tan(fov / 2) * 0.98;
    const distW = (w * 0.5 + 1) / (Math.tan(fov / 2) * aspect) * 0.98;
    this.overview = { center: new THREE.Vector3(cx, 0, cz), distance: Math.max(distH, distW, 6), elevation: el };
  }

  setZoom(z) { this.zoom = Math.max(0.6, Math.min(1.6, z)); }

  /** Add shake energy (0..1). */
  shake(amount) { if (this.shakeEnabled) this.shakeAmount = Math.min(1.2, this.shakeAmount + amount); }

  /** Snap smoothing to the current target instantly. */
  snap() {
    const dst = this.overview ? this.overview.center : this.target.clone().add(this.lookAhead);
    this.smoothTarget.copy(dst);
    this.currentDistance = this.overview ? this.overview.distance : this.distance / this.zoom;
    this.velocity.set(0, 0, 0);
    this.place(this.overview ? this.overview.elevation : this.elevation, this.currentDistance);
  }

  /**
   * Stairs transition: fade to black while diving (down) or rising (up); onMid fires at the
   * darkest point (rebuild the level there), then the camera settles from the opposite side.
   */
  startTransition(kind, onMid) {
    this.transition = { kind, t: 0, dur: 0.9, midDone: false, onMid };
  }

  place(elev, dist) {
    const c = this.camera;
    const y = Math.sin(elev) * dist, r = Math.cos(elev) * dist;
    c.position.set(this.smoothTarget.x + Math.sin(this.yaw) * r + this.shakeOffset.x, y + this.shakeOffset.y + this.dive, this.smoothTarget.z + Math.cos(this.yaw) * r + this.shakeOffset.z);
    c.lookAt(this.smoothTarget.x + this.shakeOffset.x * 0.5, 0.3 + this.dive * 0.4, this.smoothTarget.z + this.shakeOffset.z * 0.5);
  }

  update(dt) {
    this.time += dt;
    const ov = this.overview;
    const dst = ov ? ov.center : this._dst.copy(this.target).add(this.lookAhead);
    // critically damped spring toward the destination
    const omega = ov ? 3.5 : 7.5;
    const diff = this._diff.subVectors(this.smoothTarget, dst);
    const accel = diff.multiplyScalar(-omega * omega).addScaledVector(this.velocity, -2 * omega);
    this.velocity.addScaledVector(accel, dt);
    this.smoothTarget.addScaledVector(this.velocity, dt);
    const wantDist = ov ? ov.distance : this.distance / this.zoom;
    this.currentDistance += (wantDist - this.currentDistance) * Math.min(1, dt * 4);
    const elev = ov ? ov.elevation : this.elevation;
    // shake
    if (this.shakeAmount > 0.001) {
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * 3.2);
      const a = this.shakeAmount * this.shakeAmount * 0.5;
      this.shakeOffset.set(this.rng.float(-a, a), this.rng.float(-a, a) * 0.6, this.rng.float(-a, a));
    } else this.shakeOffset.set(0, 0, 0);
    // transition (fade + dive)
    let dive = 0;
    if (this.transition) {
      const tr = this.transition;
      tr.t += dt;
      const k = Math.min(1, tr.t / tr.dur);
      const dirSign = tr.kind === 'ascend' ? 1 : -1;
      if (k < 0.5) { this.fade = k / 0.5; dive = dirSign * (k / 0.5) * (k / 0.5) * 4; }
      else {
        if (!tr.midDone) { tr.midDone = true; if (tr.onMid) tr.onMid(); this.snap(); }
        const k2 = (k - 0.5) / 0.5;
        this.fade = 1 - k2;
        dive = -dirSign * (1 - k2) * (1 - k2) * 4;
      }
      if (k >= 1) { this.transition = null; this.fade = 0; dive = 0; }
    } else this.fade = Math.max(0, this.fade - dt * 2);
    this.dive = dive;
    this.place(elev, this.currentDistance);
  }
}
