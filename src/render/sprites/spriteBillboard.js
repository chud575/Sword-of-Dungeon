// spriteBillboard: an HD-2D character billboard. A Y-axis billboard quad (NearestFilter atlas,
// alpha-tested) whose pixel art receives the scene lighting — hemisphere + moon + the lantern spots
// + the torch/temple point-light pool (read straight from the scene each frame, flicker included) —
// through a fake normal that faces the camera and tilts up, curving across the sprite so side
// lights fall off across the body. Edge pixels get a rim from the nearest torch; fog-of-war darkens
// at the feet; a per-depth tint and hurt flash sit on top. Under the hero: a soft elliptical blob
// shadow plus a faint silhouette shadow stretched away from the nearest torch.
//
// Pixel scale: PX_PER_TILE sprite texels per world unit, so one texel is a constant world size.
// The quad is stretched vertically by 1/cos(camera pitch) so texels stay square on screen from the
// tilted diorama camera (the classic HD-2D trick); lighting uses the unstretched height.
import * as THREE from 'three';

export const PX_PER_TILE = 32;
const MAX_POINTS = 8, MAX_SPOTS = 2;

const LIGHT_GLSL = `
uniform vec3 uHemiSky, uHemiGround, uDirColor, uDirDir;
uniform vec4 uPtPos[${MAX_POINTS}]; uniform vec3 uPtCol[${MAX_POINTS}];
uniform vec4 uSpPos[${MAX_SPOTS}]; uniform vec3 uSpCol[${MAX_SPOTS}]; uniform vec4 uSpDir[${MAX_SPOTS}];
float distAtt(float d, float cutoff) {
  float f = 1.0 / max(d * d, 0.01);
  if (cutoff > 0.0) { float r = d / cutoff; float rr = r * r; f *= pow(clamp(1.0 - rr * rr, 0.0, 1.0), 2.0); }
  return f;
}
vec3 lightAt(vec3 P, vec3 N) {
  vec3 irr = mix(uHemiGround, uHemiSky, 0.5 + 0.5 * N.y);
  irr += uDirColor * max(0.0, dot(N, uDirDir));
  for (int i = 0; i < ${MAX_POINTS}; i++) {
    vec3 L = uPtPos[i].xyz - P; float d = length(L); L /= max(d, 1e-4);
    irr += uPtCol[i] * max(0.0, dot(N, L)) * distAtt(d, uPtPos[i].w);
  }
  for (int i = 0; i < ${MAX_SPOTS}; i++) {
    vec3 L = uSpPos[i].xyz - P; float d = length(L); L /= max(d, 1e-4);
    float ang = dot(-L, uSpDir[i].xyz);
    float cone = smoothstep(uSpDir[i].w, uSpPos[i].w, ang);
    irr += uSpCol[i] * max(0.0, dot(N, L)) * cone * distAtt(d, 0.0);
  }
  return irr;
}`;

function makeSpriteMaterial(texture, fog) {
  const u = {
    uMap: { value: texture }, uTexel: { value: new THREE.Vector2(1 / texture.image.width, 1 / texture.image.height) },
    uRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uFlip: { value: 0 },
    uSize: { value: new THREE.Vector2(1, 1) }, uPivot: { value: new THREE.Vector2(0.5, 0) }, uSquash: { value: new THREE.Vector2(1, 1) }, uStretch: { value: 1 },
    uRight: { value: new THREE.Vector3(1, 0, 0) }, uForward: { value: new THREE.Vector3(0, 0, 1) },
    uOpacity: { value: 1 }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color(1, 0.55, 0.4) }, uTint: { value: new THREE.Color(1, 1, 1) },
    uRimDir: { value: new THREE.Vector3(0, 1, 0) }, uRimColor: { value: new THREE.Color(0, 0, 0) },
    uAmbientGain: { value: 1.0 }, uDirectGain: { value: 1.0 }, uFloor: { value: 0.035 }, uEmissive: { value: 0.9 },
    uHemiSky: { value: new THREE.Color() }, uHemiGround: { value: new THREE.Color() }, uDirColor: { value: new THREE.Color() }, uDirDir: { value: new THREE.Vector3(0, 1, 0) },
    uPtPos: { value: Array.from({ length: MAX_POINTS }, () => new THREE.Vector4(0, 0, 0, 1)) }, uPtCol: { value: Array.from({ length: MAX_POINTS }, () => new THREE.Vector3()) },
    uSpPos: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Vector4(0, 0, 0, 1)) }, uSpCol: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Vector3()) },
    uSpDir: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Vector4(0, -1, 0, 1)) },
    fogTex: fog.uniforms.fogTex, fogSize: fog.uniforms.fogSize, fogTint: fog.uniforms.fogTint,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: false, depthWrite: true, side: THREE.DoubleSide,
    vertexShader: `
      uniform vec4 uRect; uniform float uFlip; uniform vec2 uSize, uPivot, uSquash; uniform float uStretch;
      varying vec2 vUv; varying vec2 vTex; varying vec3 vLit; varying vec2 vFogXZ;
      void main() {
        vUv = uv;
        float ux = uFlip > 0.5 ? 1.0 - uv.x : uv.x;
        vTex = vec2(mix(uRect.x, uRect.z, ux), mix(uRect.y, uRect.w, uv.y));
        vec3 p = vec3((uv.x - uPivot.x) * uSize.x * uSquash.x, (uv.y - uPivot.y) * uSize.y * uSquash.y * uStretch, 0.0);
        vec3 pl = vec3(p.x, (uv.y - uPivot.y) * uSize.y * uSquash.y, 0.0);
        vec4 w = modelMatrix * vec4(p, 1.0);
        vLit = (modelMatrix * vec4(pl, 1.0)).xyz;
        vFogXZ = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec2 uTexel; uniform vec4 uRect; uniform float uFlip;
      uniform vec3 uRight, uForward; uniform float uOpacity, uFlash; uniform vec3 uFlashColor, uTint;
      uniform vec3 uRimDir, uRimColor; uniform float uAmbientGain, uDirectGain, uFloor, uEmissive;
      varying vec2 vUv; varying vec2 vTex; varying vec3 vLit; varying vec2 vFogXZ;
      ${fog.glsl()}
      ${LIGHT_GLSL}
      void main() {
        vec4 tex = texture2D(uMap, vTex);
        if (tex.a < 0.5) discard;
        float emissive = tex.a < 0.98 ? 1.0 : 0.0;
        vec3 albedo = tex.rgb;
        // fake normal: faces the camera, tilts up, and curves left/right across the sprite
        float sx = (uFlip > 0.5 ? 1.0 - vUv.x : vUv.x) - 0.5;
        vec3 N = normalize(uForward * 1.0 + vec3(0.0, 0.62, 0.0) + uRight * sx * 1.1);
        vec3 irr = lightAt(vLit, N);
        vec3 amb = mix(uHemiGround, uHemiSky, 0.5 + 0.5 * N.y);
        vec3 direct = irr - amb;
        vec3 col = albedo * (amb * uAmbientGain + direct * uDirectGain) * 0.3183 + albedo * uFloor;
        // rim from the nearest torch on edge pixels facing it
        vec2 o = uTexel;
        float aL = texture2D(uMap, vTex - vec2(o.x, 0.0)).a, aR = texture2D(uMap, vTex + vec2(o.x, 0.0)).a;
        float aD = texture2D(uMap, vTex - vec2(0.0, o.y)).a, aU = texture2D(uMap, vTex + vec2(0.0, o.y)).a;
        vec2 edge = vec2(step(aR, 0.5) - step(aL, 0.5), step(aU, 0.5) - step(aD, 0.5));
        if (uFlip > 0.5) edge.x = -edge.x;
        if (dot(edge, edge) > 0.0) {
          vec2 ld = vec2(dot(uRimDir, uRight), uRimDir.y);
          float rim = max(0.0, dot(normalize(edge), normalize(ld + vec2(0.0, 0.25))));
          col += uRimColor * rim * rim * 0.9;
        }
        col += albedo * emissive * uEmissive;
        col *= uTint;
        col = applyFog(col, vFogXZ);
        col = mix(col, uFlashColor * 2.2, uFlash);
        gl_FragColor = vec4(col, uOpacity);
      }`,
  });
  return mat;
}

function makeBlobMaterial(fog) {
  return new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: 0.5 }, fogTex: fog.uniforms.fogTex, fogSize: fog.uniforms.fogSize, fogTint: fog.uniforms.fogTint },
    transparent: true, depthWrite: false,
    vertexShader: `varying vec2 vUv; varying vec2 vFogXZ; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vFogXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uStrength; varying vec2 vUv; varying vec2 vFogXZ; ${fog.glsl()}
      void main() { float r = length((vUv - 0.5) * 2.0); float a = smoothstep(1.0, 0.25, r) * uStrength; vec2 f = fogMask(vFogXZ); a *= smoothstep(0.0, 1.0, f.r); gl_FragColor = vec4(0.02, 0.01, 0.04, a); }`,
  });
}

function makeCastMaterial(texture, spriteMat) {
  const u = spriteMat.uniforms;
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: texture }, uRect: u.uRect, uFlip: u.uFlip, uStrength: { value: 0.3 } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `uniform vec4 uRect; uniform float uFlip; varying vec2 vTex; varying float vT;
      void main() { float ux = uFlip > 0.5 ? 1.0 - uv.x : uv.x; vTex = vec2(mix(uRect.x, uRect.z, ux), mix(uRect.y, uRect.w, uv.y)); vT = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform sampler2D uMap; uniform float uStrength; varying vec2 vTex; varying float vT;
      void main() { float a = texture2D(uMap, vTex).a; if (a < 0.5) discard; gl_FragColor = vec4(0.03, 0.02, 0.05, uStrength * (1.0 - vT * 0.7)); }`,
  });
}

/** Plays sheet animations: clips with per-frame durations, one-shots that fall back to a base clip. */
export class SpriteAnimator {
  /** @param {import('./spriteSheet.js').Sheet} sheet */
  constructor(sheet) {
    this.sheet = sheet;
    this.name = 'idle'; this.facing = 'S';
    this.time = 0; this.done = false; this.onDone = null;
  }
  get clip() { const a = this.sheet.anims[this.name]; return a && (a[this.facing] || (this.facing === 'W' && a.E) || a.S); }
  /** West is the mirrored east when the sheet carries no dedicated west row. */
  get flipped() { const a = this.sheet.anims[this.name]; return this.facing === 'W' && !!a && !a.W; }
  /** Switch clip (restarts unless it is already playing and `restart` is false). */
  play(name, facing = this.facing, { restart = false, onDone = null } = {}) {
    const same = name === this.name;
    this.facing = facing;
    if (same && !restart) return;
    this.name = name; this.time = 0; this.done = false; this.onDone = onDone;
  }
  face(facing) { this.facing = facing; }
  /** Advance by dt seconds (loops or clamps; fires onDone once at the end). */
  update(dt) {
    const c = this.clip; if (!c) return;
    this.time += dt * 1000;
    if (c.loop) { this.time %= c.total; }
    else if (this.time >= c.total && !this.done) { this.time = c.total - 1; this.done = true; if (this.onDone) this.onDone(); }
  }
  /** Set the normalized phase of a looping clip (0..1) — walk cycles are ground-locked this way. */
  setPhase(k) { const c = this.clip; if (c) this.time = ((k % 1) + 1) % 1 * c.total; }
  /** Current frame metadata. */
  frame() {
    const c = this.clip; if (!c) return this.sheet.frames[0];
    let t = this.time, i = 0;
    for (; i < c.durations.length - 1; i++) { if (t < c.durations[i]) break; t -= c.durations[i]; }
    return this.sheet.frames[c.frames[i]];
  }
  frameIndex() { const c = this.clip; if (!c) return 0; let t = this.time, i = 0; for (; i < c.durations.length - 1; i++) { if (t < c.durations[i]) break; t -= c.durations[i]; } return i; }
}

/** The billboard, its shadows and its material; add `root` to the scene and set `root.position`. */
export class SpriteBillboard {
  /**
   * @param {{sheet:import('./spriteSheet.js').Sheet, texture:THREE.Texture, fog:import('../lighting.js').FogOfWar, pxPerTile?:number}} o
   */
  constructor({ sheet, texture, fog, pxPerTile = PX_PER_TILE }) {
    this.sheet = sheet; this.texture = texture; this.fog = fog; this.px = pxPerTile;
    this.root = new THREE.Group();
    this.material = makeSpriteMaterial(texture, fog);
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0.5, 0.5, 0); // unit quad, uv == position
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false; this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 2;
    this.root.add(this.mesh);
    // blob shadow
    this.blobMat = makeBlobMaterial(fog);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.blobMat);
    this.blob.rotation.x = -Math.PI / 2; this.blob.position.y = 0.012; this.blob.scale.set(0.8, 0.5, 1);
    this.blob.renderOrder = 1; this.blob.frustumCulled = false;
    this.root.add(this.blob);
    // stretched torch shadow: 4 dynamic vertices on the floor
    this.castGeo = new THREE.BufferGeometry();
    this.castPos = new Float32Array(12);
    this.castGeo.setAttribute('position', new THREE.BufferAttribute(this.castPos, 3));
    this.castGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
    this.castGeo.setIndex([0, 1, 2, 2, 1, 3]);
    this.castMat = makeCastMaterial(texture, this.material);
    this.cast = new THREE.Mesh(this.castGeo, this.castMat);
    this.cast.frustumCulled = false; this.cast.renderOrder = 1;
    this.root.add(this.cast);
    this.animator = new SpriteAnimator(sheet);
    this.flip = false;
    this.squash = new THREE.Vector2(1, 1);
    this.opacity = 1; this.flash = 0;
    this.lights = null; this._lightCount = -1;
    this._tmp = new THREE.Vector3(); this._tmp2 = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this.mesh.onBeforeRender = (renderer, scene, camera) => this.sync(scene, camera);
    this.setFrame(sheet.frames[0]);
  }

  /** Point the material at a frame of the atlas. */
  setFrame(fr) {
    const u = this.material.uniforms;
    u.uRect.value.set(fr.u0, fr.v0, fr.u1, fr.v1);
    u.uSize.value.set(fr.w / this.px, fr.h / this.px);
    u.uPivot.value.set(fr.px / fr.w, 1 - fr.py / fr.h);
    this.frame = fr;
  }

  /** Per-frame: advance the animation and copy the state into uniforms. */
  update(dt) {
    this.animator.update(dt);
    this.setFrame(this.animator.frame());
    const u = this.material.uniforms;
    this.flip = this.animator.flipped;
    u.uFlip.value = this.flip ? 1 : 0;
    u.uSquash.value.copy(this.squash);
    u.uOpacity.value = this.opacity;
    u.uFlash.value = this.flash;
    const fade = this.opacity < 1;
    if (this.material.transparent !== fade) { this.material.transparent = fade; this.material.needsUpdate = true; }
    this.blobMat.uniforms.uStrength.value = 0.5 * this.opacity;
    this.castMat.uniforms.uStrength.value = 0.28 * this.opacity;
  }

  collectLights(scene) {
    if (this.lights && this._lightCount === scene.children.length) return;
    const L = { hemi: null, dir: null, points: [], spots: [] };
    scene.traverse((o) => {
      if (o.isHemisphereLight) L.hemi = o; else if (o.isDirectionalLight) L.dir = o;
      else if (o.isPointLight) L.points.push(o); else if (o.isSpotLight) L.spots.push(o);
    });
    this.lights = L; this._lightCount = scene.children.length;
  }

  /** Orient toward the camera, stretch for the pitch, and read the live lights (called before each draw). */
  sync(scene, camera) {
    const u = this.material.uniforms;
    const root = this.root;
    root.updateMatrixWorld(true);
    const wp = this._tmp.setFromMatrixPosition(root.matrixWorld);
    // Y-axis billboard toward the camera
    const cx = camera.position.x - wp.x, cz = camera.position.z - wp.z;
    const yaw = Math.atan2(cx, cz);
    this.mesh.quaternion.setFromAxisAngle(this._tmp2.set(0, 1, 0), yaw);
    // square texels on screen: stretch by 1/cos(pitch)
    const fwd = this._tmp2.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const pitch = Math.asin(Math.max(-1, Math.min(1, -fwd.y)));
    u.uStretch.value = 1 / Math.max(0.35, Math.cos(pitch));
    u.uRight.value.set(Math.cos(yaw), 0, -Math.sin(yaw));
    u.uForward.value.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.mesh.updateMatrix(); this.mesh.updateMatrixWorld(true);
    // lights
    this.collectLights(scene);
    const L = this.lights;
    if (L.hemi) { u.uHemiSky.value.copy(L.hemi.color).multiplyScalar(L.hemi.intensity); u.uHemiGround.value.copy(L.hemi.groundColor).multiplyScalar(L.hemi.intensity); }
    if (L.dir) { u.uDirColor.value.copy(L.dir.color).multiplyScalar(L.dir.intensity); u.uDirDir.value.copy(L.dir.position).sub(L.dir.target.position).normalize(); }
    let best = null, bestW = 0;
    for (let i = 0; i < MAX_POINTS; i++) {
      const l = L.points[i];
      const pos = u.uPtPos.value[i], col = u.uPtCol.value[i];
      if (!l || l.intensity <= 0) { col.set(0, 0, 0); pos.set(0, -100, 0, 1); continue; }
      pos.set(l.position.x, l.position.y, l.position.z, l.distance);
      col.set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity);
      // warm lights (torches) drive the rim; weight by falloff at the hero
      const d = Math.hypot(l.position.x - wp.x, l.position.y - wp.y - 0.8, l.position.z - wp.z);
      const w = l.color.r > l.color.b * 1.5 ? l.intensity / Math.max(0.5, d * d) : 0;
      if (w > bestW) { bestW = w; best = l; }
    }
    for (let i = 0; i < MAX_SPOTS; i++) {
      const l = L.spots[i];
      const pos = u.uSpPos.value[i], col = u.uSpCol.value[i], dir = u.uSpDir.value[i];
      if (!l || l.intensity <= 0) { col.set(0, 0, 0); pos.set(0, -100, 0, 1); continue; }
      const penumbraCos = Math.cos(l.angle * (1 - l.penumbra)), coneCos = Math.cos(l.angle);
      pos.set(l.position.x, l.position.y, l.position.z, penumbraCos);
      col.set(l.color.r * l.intensity, l.color.g * l.intensity, l.color.b * l.intensity);
      const d = this._tmp2.copy(l.target.position).sub(l.position).normalize();
      dir.set(d.x, d.y, d.z, coneCos);
    }
    // rim + stretched shadow from the strongest warm light
    if (best) {
      const dx = best.position.x - wp.x, dy = best.position.y - (wp.y + 0.7), dz = best.position.z - wp.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      u.uRimDir.value.set(dx / len, dy / len, dz / len);
      const k = Math.min(1, bestW * 0.16);
      u.uRimColor.value.set(best.color.r * k, best.color.g * k, best.color.b * k);
      this.updateCast(-dx, -dz, Math.hypot(dx, dz), best.position.y, k);
    } else { u.uRimColor.value.set(0, 0, 0); this.cast.visible = false; }
  }

  /** Lay the silhouette shadow on the floor, away from the light, longer for low/near lights. */
  updateCast(ax, az, dist, lightH, strength) {
    const fr = this.frame; if (!fr) { this.cast.visible = false; return; }
    const w = (fr.w / this.px) * 0.9, h = (fr.h / this.px) * 0.85;
    const len = Math.max(0.5, Math.min(1.8, h * (h / Math.max(0.6, lightH)) * (1.2 / Math.max(1, dist * 0.5))));
    const n = Math.hypot(ax, az) || 1; ax /= n; az /= n;
    const rx = -az, rz = ax; // right vector on the floor, perpendicular to the shadow direction
    const p = this.castPos, hw = w * 0.5, y = 0.014;
    const px0 = (this.frame.px / this.frame.w - 0.5) * w * (this.flip ? -1 : 1);
    const set = (i, x, z) => { p[i * 3] = x; p[i * 3 + 1] = y; p[i * 3 + 2] = z; };
    set(0, rx * (-hw - px0), rz * (-hw - px0)); set(1, rx * (hw - px0), rz * (hw - px0));
    set(2, rx * (-hw - px0) + ax * len, rz * (-hw - px0) + az * len); set(3, rx * (hw - px0) + ax * len, rz * (hw - px0) + az * len);
    this.castGeo.attributes.position.needsUpdate = true;
    this.cast.visible = strength > 0.02 && this.opacity > 0.05;
    this.castMat.uniforms.uStrength.value = 0.32 * Math.min(1, strength * 1.5) * this.opacity;
  }

  dispose() { this.material.dispose(); this.blobMat.dispose(); this.castMat.dispose(); this.castGeo.dispose(); this.mesh.geometry.dispose(); this.blob.geometry.dispose(); }
}
