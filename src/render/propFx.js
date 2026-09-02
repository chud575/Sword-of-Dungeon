// Shared, procedurally generated sprite textures and billboard/glow shader materials used by the
// prop factory and the effects layer: radial glow, 4-point glint, rune circle, and a procedural
// flame billboard. Everything is created lazily once and cached; fog-of-war is injected through
// attachFog() (called by Effects at construction) so nothing emissive leaks through the darkness.
import * as THREE from 'three';
import { createRng } from '../core/rng.js';
import { patchFog } from './lighting.js';

let fog = null;
const cache = new Map();

/** @param {import('./lighting.js').FogOfWar} f */
export function attachFog(f) { fog = f; }
export function getFog() { return fog; }

/** GLSL for the fog mask (no-op when no fog has been attached yet). */
function fogGlsl() {
  return fog ? fog.glsl() : 'vec3 applyFog(vec3 c, vec2 xz) { return c; }';
}
function fogUniforms() {
  return fog ? { fogTex: fog.uniforms.fogTex, fogSize: fog.uniforms.fogSize, fogTint: fog.uniforms.fogTint } : {};
}

function memo(key, make) { let v = cache.get(key); if (!v) { v = make(); cache.set(key, v); } return v; }

function canvasTexture(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.anisotropy = 2;
  return t;
}

// ------------------------------------------------------------------ textures
/** Soft radial glow (white, alpha falls off with a gentle shoulder). */
export function glowTexture() {
  return memo('tex:glow', () => canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.22)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }));
}

/** Hard-edged disc with a soft rim (impact flashes, decals). */
export function discTexture() {
  return memo('tex:disc', () => canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.8, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }));
}

/** Irregular splat: a lumpy blob with radiating droplets (blood / ichor floor decals). White on transparent. */
export function splatTexture() {
  return memo('tex:splat', () => canvasTexture(128, (ctx, s) => {
    const rng = createRng('fargoal-splat');
    const c = s / 2;
    ctx.clearRect(0, 0, s, s);
    const blob = (x, y, r, a) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.7, `rgba(255,255,255,${a * 0.85})`); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); };
    blob(c, c, c * 0.5, 1);
    for (let i = 0; i < 9; i++) { const a = rng.float(0, 6.28), d = rng.float(0.1, 0.32) * c; blob(c + Math.cos(a) * d, c + Math.sin(a) * d, c * rng.float(0.18, 0.36), 0.95); }
    for (let i = 0; i < 16; i++) { const a = rng.float(0, 6.28), d = rng.float(0.45, 0.9) * c; blob(c + Math.cos(a) * d, c + Math.sin(a) * d, c * rng.float(0.04, 0.11), 0.9); }
  }));
}

/** 4-point star glint with a bright core. */
export function glintTexture() {
  return memo('tex:glint', () => canvasTexture(128, (ctx, s) => {
    const c = s / 2;
    ctx.clearRect(0, 0, s, s);
    const ray = (len, w, rot) => {
      ctx.save(); ctx.translate(c, c); ctx.rotate(rot);
      const g = ctx.createLinearGradient(-len, 0, len, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(0, -w); ctx.lineTo(len, 0); ctx.lineTo(0, w); ctx.closePath(); ctx.fill();
      ctx.restore();
    };
    ray(c * 0.98, c * 0.07, 0); ray(c * 0.98, c * 0.07, Math.PI / 2);
    ray(c * 0.5, c * 0.045, Math.PI / 4); ray(c * 0.5, c * 0.045, -Math.PI / 4);
    const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  }));
}

/** Magic circle: rings, ticks and rune strokes (deterministic). White on transparent. */
export function runeCircleTexture() {
  return memo('tex:rune', () => canvasTexture(256, (ctx, s) => {
    const rng = createRng('fargoal-rune-circle');
    const c = s / 2;
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineCap = 'round';
    const ring = (r, w, a = 1) => { ctx.globalAlpha = a; ctx.lineWidth = w; ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.stroke(); };
    ring(c * 0.94, 5); ring(c * 0.86, 2, 0.8); ring(c * 0.6, 3, 0.9); ring(c * 0.52, 1.5, 0.6);
    ctx.globalAlpha = 0.9; ctx.lineWidth = 2.5;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2, r0 = c * 0.87, r1 = c * (i % 3 === 0 ? 0.78 : 0.82);
      ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); ctx.stroke();
    }
    // rune strokes in the outer band
    ctx.lineWidth = 3;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + 0.1, r = c * 0.71;
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a + Math.PI / 2);
      const n = rng.int(2, 4);
      for (let k = 0; k < n; k++) { ctx.beginPath(); ctx.moveTo(rng.float(-7, 7), rng.float(-7, 7)); ctx.lineTo(rng.float(-7, 7), rng.float(-7, 7)); ctx.stroke(); }
      ctx.restore();
    }
    // inner triangle + hexagram
    ctx.globalAlpha = 0.85; ctx.lineWidth = 2.5;
    for (const off of [0, Math.PI]) {
      ctx.beginPath();
      for (let k = 0; k < 3; k++) { const a = off + (k / 3) * Math.PI * 2 - Math.PI / 2; const x = c + Math.cos(a) * c * 0.5, y = c + Math.sin(a) * c * 0.5; if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.closePath(); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }));
}

/** A single glyph for a spellbook sigil, deterministic per name. */
export function sigilTexture(name) {
  return memo('tex:sigil:' + name, () => canvasTexture(64, (ctx, s) => {
    const rng = createRng('sigil-' + name);
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,255,255,1)'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 5;
    ctx.shadowColor = 'rgba(255,255,255,0.9)'; ctx.shadowBlur = 6;
    const pts = [];
    for (let i = 0; i < 4; i++) pts.push([rng.float(12, s - 12), rng.float(10, s - 10)]);
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(pts[rng.int(0, 3)][0], pts[rng.int(0, 3)][1], 6, 0, Math.PI * 2); ctx.stroke();
  }));
}

// ------------------------------------------------------------------ materials
const BILLBOARD_VS = `
  varying vec2 vUv; varying vec2 vFogXZ; varying float vPhase;
  uniform float uCylindrical;
  void main() {
    vUv = uv;
    vec3 origin = modelMatrix[3].xyz;
    float sx = length(modelMatrix[0].xyz), sy = length(modelMatrix[1].xyz);
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    vec3 up = mix(camUp, vec3(0.0, 1.0, 0.0), uCylindrical);
    vec3 w = origin + right * (position.x * sx) + up * (position.y * sy);
    vFogXZ = origin.xz;
    vPhase = fract(dot(origin, vec3(0.317, 0.911, 0.523)) * 3.7) * 6.283;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;

/**
 * Spherical/cylindrical billboard of a sprite texture tinted by uColor (additive, fog-aware).
 * One material per (texture,color) pair is shared; animate by scaling the mesh.
 */
export function billboardMaterial(tex, color, { cylindrical = false, intensity = 1.6 } = {}) {
  const key = `bb:${tex.uuid}:${color}:${cylindrical}:${intensity}`;
  return memo(key, () => {
    const m = new THREE.ShaderMaterial({
      uniforms: { ...fogUniforms(), uTex: { value: tex }, uColor: { value: new THREE.Color(color).multiplyScalar(intensity) }, uCylindrical: { value: cylindrical ? 1 : 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: BILLBOARD_VS,
      fragmentShader: `uniform sampler2D uTex; uniform vec3 uColor; varying vec2 vUv; varying vec2 vFogXZ; varying float vPhase;
        ${fogGlsl()}
        void main() { vec4 t = texture2D(uTex, vUv); vec3 c = applyFog(uColor * t.rgb, vFogXZ); gl_FragColor = vec4(c, t.a); }`,
    });
    return m;
  });
}

/** Procedural flame billboard (cylindrical). Scale the mesh to flicker; uTime is driven by updateFlames(). */
export function flameMaterial() {
  return memo('flame', () => {
    const m = new THREE.ShaderMaterial({
      uniforms: { ...fogUniforms(), uTime: { value: 0 }, uCylindrical: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: BILLBOARD_VS,
      fragmentShader: `uniform float uTime; varying vec2 vUv; varying vec2 vFogXZ; varying float vPhase;
        ${fogGlsl()}
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
        void main() {
          vec2 p = vec2(vUv.x - 0.5, vUv.y);
          float t = uTime * 1.9 + vPhase;
          float n = noise(vec2(p.x * 4.0 + vPhase, p.y * 5.0 - t * 2.4)) * 2.0 - 1.0;
          float n2 = noise(vec2(p.x * 9.0 + 3.1, p.y * 12.0 - t * 3.8)) * 2.0 - 1.0;
          float x = p.x + (n * 0.13 + n2 * 0.05) * p.y;
          float width = 0.46 * (1.0 - p.y) * (0.3 + 0.7 * sqrt(min(1.0, p.y * 3.5)));
          float d = abs(x) / max(width, 1e-3);
          float body = 1.0 - smoothstep(0.5, 1.0, d);
          float tip = 1.0 - smoothstep(0.7, 1.0, p.y + n * 0.1);
          float a = body * tip;
          float core = (1.0 - smoothstep(0.0, 0.5, d)) * (1.0 - smoothstep(0.05, 0.62, p.y + n2 * 0.05));
          vec3 col = mix(vec3(1.0, 0.22, 0.02), vec3(1.0, 0.58, 0.1), body);
          col = mix(col, vec3(1.0, 0.95, 0.72), core);
          col *= 1.7 + core * 1.2;
          vec3 c = applyFog(col, vFogXZ);
          gl_FragColor = vec4(c, a);
        }`,
    });
    return m;
  });
}

/** Flat additive disc/ring/glyph material (MeshBasic + fog). One per (texture,color). */
export function flatGlowMaterial(tex, color, { opacity = 1, intensity = 1 } = {}) {
  const key = `flat:${tex.uuid}:${color}:${opacity}:${intensity}`;
  return memo(key, () => {
    const m = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(color).multiplyScalar(intensity), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    m.toneMapped = false;
    if (fog) patchFog(m, fog);
    return m;
  });
}

/** Standard (lit, fog-aware) material, cached by option signature. */
export function litMaterial(key, opts) {
  return memo('lit:' + key, () => { const m = new THREE.MeshStandardMaterial(opts); if (fog) patchFog(m, fog); return m; });
}

const unitPlane = memo('geo:plane', () => new THREE.PlaneGeometry(1, 1));
export function planeGeometry() { return unitPlane; }

/** Billboard mesh helper. */
export function billboard(tex, color, size, opts = {}) {
  const m = new THREE.Mesh(planeGeometry(), billboardMaterial(tex, color, opts));
  m.scale.set(size, size * (opts.aspect || 1), 1);
  m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false;
  m.renderOrder = 6;
  return m;
}

/** Flat glow disc on the floor. */
export function groundGlow(color, radius, { opacity = 0.55, y = 0.015, tex = glowTexture(), intensity = 1 } = {}) {
  const m = new THREE.Mesh(planeGeometry(), flatGlowMaterial(tex, color, { opacity, intensity }));
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.scale.setScalar(radius * 2);
  m.castShadow = false; m.receiveShadow = false; m.renderOrder = 3;
  return m;
}

/** Flame billboard mesh (userData.flame so DungeonView flickers its scale). */
export function flame(size = 0.3, aspect = 1.6) {
  const m = new THREE.Mesh(planeGeometry(), flameMaterial());
  m.geometry = memo('geo:flamePlane', () => new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0));
  m.scale.set(size, size * aspect, 1);
  m.userData.flame = true; m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; m.renderOrder = 7;
  return m;
}

/** Advance the shared flame clock. */
export function updateFlames(time) { const m = cache.get('flame'); if (m) m.uniforms.uTime.value = time; }
