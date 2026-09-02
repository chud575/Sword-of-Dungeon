// Pooled GPU point particles with four sprite kinds drawn in the fragment shader:
//   0 soft dot, 1 velocity-stretched streak (sparks, feathers), 2 four-point glint, 3 soft smoke puff.
// Two pools are used by Effects: an additive "glow" pool and an alpha-blended "matter" pool
// (blood, dust, smoke) so dark particles can actually darken the frame. Everything is fog-aware.
import * as THREE from 'three';

export class ParticlePool {
  /**
   * @param {import('./lighting.js').FogOfWar} fog
   * @param {{max?:number, blending?:'add'|'matter'}} [opts]
   */
  constructor(fog, { max = 4000, blending = 'add' } = {}) {
    this.n = max;
    this.additive = blending === 'add';
    this.pos = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.col = new Float32Array(this.n * 3);
    this.size = new Float32Array(this.n);
    this.alpha = new Float32Array(this.n);
    this.kind = new Float32Array(this.n);
    this.life = new Float32Array(this.n);
    this.maxLife = new Float32Array(this.n);
    this.grav = new Float32Array(this.n);
    this.drag = new Float32Array(this.n);
    this.shrink = new Float32Array(this.n);
    this.bounce = new Float32Array(this.n);
    this.stick = new Uint8Array(this.n);
    this.floor = new Float32Array(this.n);
    this.cursor = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aVel', new THREE.BufferAttribute(this.vel, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    g.setAttribute('aKind', new THREE.BufferAttribute(this.kind, 1));
    for (const a of Object.values(g.attributes)) a.setUsage(THREE.DynamicDrawUsage);
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      uniforms: { fogTex: fog.uniforms.fogTex, fogSize: fog.uniforms.fogSize, fogTint: fog.uniforms.fogTint, uScale: { value: 1000 }, uAspect: { value: 16 / 9 } },
      transparent: true, depthWrite: false, blending: this.additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false,
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute vec3 aVel; attribute float aKind;
        varying vec3 vColor; varying float vAlpha; varying vec2 vFogXZ; varying float vKind; varying float vAngle; varying float vStretch;
        uniform float uScale; uniform float uAspect;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0); vFogXZ = w.xz;
          vec4 mv = viewMatrix * w;
          vec4 clip = projectionMatrix * mv;
          float stretch = 1.0, ang = 0.0;
          if (aKind > 0.5 && aKind < 1.5) {
            vec4 clip2 = projectionMatrix * viewMatrix * (w + vec4(aVel * 0.05, 0.0));
            vec2 d = (clip2.xy / clip2.w - clip.xy / clip.w) * vec2(uAspect, 1.0);
            ang = atan(d.y, d.x);
            stretch = clamp(1.0 + length(d) * 70.0, 1.0, 6.0);
          }
          float mul = (aKind > 1.5 && aKind < 2.5) ? 1.9 : (aKind > 2.5 ? 2.2 : 1.0);
          gl_PointSize = aSize * uScale * mul * stretch / max(1.0, -mv.z);
          gl_Position = clip;
          vColor = aColor; vAlpha = aAlpha; vKind = aKind; vAngle = ang; vStretch = stretch;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha; varying vec2 vFogXZ; varying float vKind; varying float vAngle; varying float vStretch;
        ${fog.glsl()}
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float a;
          if (vKind < 0.5) {
            a = smoothstep(0.5, 0.08, length(p));
          } else if (vKind < 1.5) {
            vec2 q = vec2(p.x, -p.y);
            float c = cos(vAngle), s = sin(vAngle);
            vec2 r = vec2(c * q.x + s * q.y, (-s * q.x + c * q.y) * vStretch);
            float d = length(r);
            a = smoothstep(0.5, 0.12, d) + 0.6 * smoothstep(0.2, 0.0, d);
          } else if (vKind < 2.5) {
            float d = length(p);
            float star = (1.0 - smoothstep(0.0, 0.035, abs(p.x * p.y))) * smoothstep(0.5, 0.06, d);
            float core = smoothstep(0.17, 0.0, d);
            a = max(core, star * 0.9);
          } else {
            a = smoothstep(0.5, 0.22, length(p)) * 0.55;
          }
          a *= vAlpha;
          vec3 c = applyFog(vColor, vFogXZ);
          ${this.additive ? 'gl_FragColor = vec4(c * a, a);' : 'gl_FragColor = vec4(c, a);'}
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = this.additive ? 10 : 9;
  }

  /**
   * Emit particles.
   * @param {{x:number,y:number,z:number,count:number,color:number|number[],speed?:number,spread?:number,up?:number,life?:number,size?:number,gravity?:number,drag?:number,radius?:number,shrink?:number,dir?:{x:number,y:number,z:number},bright?:number,kind?:number,stick?:boolean,bounce?:number,floor?:number,ySpread?:number}} o
   * @param {{float:(a:number,b:number)=>number,next:()=>number}} rng
   */
  emit(o, rng) {
    const colors = Array.isArray(o.color) ? o.color : [o.color];
    const c = _c;
    const n = o.count ?? 1;
    for (let k = 0; k < n; k++) {
      const i = this.cursor; this.cursor = (this.cursor + 1) % this.n;
      const r = o.radius ?? 0.1;
      const a = rng.float(0, Math.PI * 2), rr = Math.sqrt(rng.next()) * r;
      this.pos[i * 3] = o.x + Math.cos(a) * rr; this.pos[i * 3 + 1] = o.y + rng.float(-r, r) * (o.ySpread ?? 0.3); this.pos[i * 3 + 2] = o.z + Math.sin(a) * rr;
      const sp = (o.speed ?? 1) * rng.float(0.4, 1), spread = o.spread ?? 1;
      let vx = Math.cos(a) * sp * spread, vz = Math.sin(a) * sp * spread, vy = (o.up ?? 1) * sp * rng.float(0.3, 1);
      if (o.dir) { vx = o.dir.x * sp + vx * 0.35; vy = o.dir.y * sp + vy * 0.35; vz = o.dir.z * sp + vz * 0.35; }
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      c.set(colors[k % colors.length]);
      const bright = o.bright ?? (this.additive ? 1.6 : 1);
      this.col[i * 3] = c.r * bright; this.col[i * 3 + 1] = c.g * bright; this.col[i * 3 + 2] = c.b * bright;
      this.size[i] = (o.size ?? 0.08) * rng.float(0.6, 1.3);
      this.alpha[i] = 1;
      this.kind[i] = o.kind ?? 0;
      this.maxLife[i] = this.life[i] = (o.life ?? 0.8) * rng.float(0.6, 1.2);
      this.grav[i] = o.gravity ?? -2.5;
      this.drag[i] = o.drag ?? 1.5;
      this.shrink[i] = o.shrink ?? 0.5;
      this.bounce[i] = o.bounce ?? 0.3;
      this.stick[i] = o.stick ? 1 : 0;
      this.floor[i] = o.floor ?? 0.012;
    }
  }

  update(dt) {
    let maxIdx = 0;
    const P = this.pos, V = this.vel;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      const k = 1 - Math.exp(-this.drag[i] * dt);
      V[i * 3] -= V[i * 3] * k; V[i * 3 + 2] -= V[i * 3 + 2] * k;
      V[i * 3 + 1] += this.grav[i] * dt - V[i * 3 + 1] * k * 0.5;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
      if (P[i * 3 + 1] < this.floor[i] && this.grav[i] < 0) {
        P[i * 3 + 1] = this.floor[i];
        if (this.stick[i]) { V[i * 3] = V[i * 3 + 1] = V[i * 3 + 2] = 0; this.grav[i] = 0; this.kind[i] = 0; this.life[i] = Math.min(this.life[i], this.maxLife[i] * 0.6); }
        else { V[i * 3 + 1] *= -this.bounce[i]; V[i * 3] *= 0.7; V[i * 3 + 2] *= 0.7; }
      }
      const f = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, f * 2.5) * (1 - this.shrink[i] * (1 - f) * 0.5);
      maxIdx = i + 1;
    }
    this.geometry.setDrawRange(0, maxIdx);
    const at = this.geometry.attributes;
    at.position.needsUpdate = at.aVel.needsUpdate = at.aColor.needsUpdate = at.aSize.needsUpdate = at.aAlpha.needsUpdate = at.aKind.needsUpdate = true;
  }

  setAspect(a) { this.material.uniforms.uAspect.value = a; }
}

const _c = new THREE.Color();
