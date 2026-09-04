// spriteBillboard: an HD-2D character billboard. A screen-aligned, texel-snapped quad (NearestFilter
// atlas, alpha-tested) whose pixel art receives the scene lighting — hemisphere + moon + the lantern
// spots + the torch/temple point-light pool (read straight from the scene each frame, flicker
// included) — through a fake normal that faces the camera and tilts up, curving across the sprite so
// side lights fall off across the body. Edge pixels get a warm rim from the nearest torch; fog-of-war
// darkens at the feet; a per-depth tint and hurt flash sit on top. Under the hero: a two-lobe contact
// shadow (tight core + faint ambient-occlusion halo, sized from the frame's real foot span) plus a
// silhouette shadow stretched away from the nearest torch.
//
// ---------------------------------------------------------------------------------------------
// TEXEL CRISPNESS — why the quad is built in screen space
// ---------------------------------------------------------------------------------------------
// A world-sized vertical quad under a pitched perspective camera cannot have square, evenly sized
// texels: the top of a 1.4-unit-tall sprite sits ~1.1 units NEARER the camera than its feet, so the
// perspective divide magnifies the helmet rows ~17% more than the boot rows. That, plus a
// texel-to-pixel ratio that is not an integer, is what makes the art read as 3px/4px/3px mush.
//
// So the quad is placed like a UI element pinned to a world anchor:
//
//   1. anchor  = projectionMatrix * viewMatrix * modelMatrix * vec4(0,0,0,1)   (the pivot, at the feet)
//   2. pixels per world unit at the anchor's depth, for a perspective camera of vertical field of
//      view `fov` rendering into a buffer `H` device pixels tall:
//
//          ndc.y = y_view / (d * tan(fov/2))        (perspective divide, d = view-space depth)
//          y_px  = ndc.y * H / 2
//      =>   pxPerWorld = H * zoom / (2 * tan(fov/2) * d)
//
//   3. one sprite texel should cover `texelPx = pxPerWorld / PX_PER_TILE` screen pixels. That is
//      4.4 at the showcase camera — a fraction, hence the uneven blocks. We ROUND it to an integer
//      S (with a little hysteresis so it does not flip-flop mid-zoom) and derive the sprite's world
//      size back from it: worldPerTexel = S / pxPerWorld. The billboard's world size is therefore a
//      function of the camera, not a constant — exactly the trade HD-2D games make.
//   4. the quad's corners are then offset from the anchor in DEVICE PIXELS (multiples of S) and
//      converted to clip space as `ndcOffset * anchor.w`, which survives the perspective divide
//      untouched. Every vertex shares the anchor's w, so the whole sprite is parallel to the image
//      plane: no foreshortening across it, every texel exactly S x S pixels. Only gl_Position.z is
//      faked back to that of an upright body standing on the anchor, so occlusion still behaves like
//      a figure (his head draws in front of the staircase he is standing on) — depth does not touch
//      the screen-space placement.
//   5. sub-pixel alignment: the anchor's own pixel coordinate is rounded to a whole pixel in the
//      vertex shader (`floor(apx + 0.5) - apx`). Frame pivots are integer texel coordinates, so once
//      the pivot lands on a pixel corner every texel edge in the sprite lands on a pixel edge too.
//
// SCALE vs SQUASH — why a big monster is not a scaled-up quad
// `scale` (a troll is 1.66x the hero: see sprites/style.js SCALE) is applied by CHOOSING A BIGGER
// INTEGER TEXEL, S = round(want * scale), never by multiplying the quad. Multiplying would put a
// fractional number of screen pixels on every texel again and hand back the 3px/4px/3px mush the
// whole screen-space construction exists to avoid — which is exactly what happened while character
// scale rode in on `uSquash`. So every sprite in the room, hero and troll alike, is drawn on its own
// whole-pixel grid; only the size steps are quantised (a troll is 6 device pixels per texel where
// the hero is 4), which is the trade every HD-2D game makes.
// `squash` stays for the brief hit/attack deformation ONLY. It is allowed to be fractional for the
// few frames a body pops or recoils, because a deforming body is not meant to look nailed to the
// grid; nothing may park a non-integer value in it.
//
// Because the quad is parallel to the image plane there is no 1/cos(pitch) stretch any more; the
// old trick only approximated this under orthographic projection.
import * as THREE from 'three';

export const PX_PER_TILE = 32;
const MAX_POINTS = 8, MAX_SPOTS = 2;

/**
 * Alpha an opaque sprite pixel writes into the HDR scene buffer. Every other opaque thing in the
 * scene writes 1.0, so the grading pass (renderer.js) can read the alpha channel as a "this is
 * hand-pixelled art" mask and keep film grain from crawling over the flat colours. The material
 * blends with src=ONE/dst=ZERO while opaque so this tag is written, not composited.
 */
export const SPRITE_MASK_ALPHA = 0.35;

const LIGHT_GLSL = `
uniform vec3 uHemiSky, uHemiGround, uDirColor, uDirDir;
uniform vec4 uPtPos[${MAX_POINTS}]; uniform vec3 uPtCol[${MAX_POINTS}];
uniform vec4 uSpPos[${MAX_SPOTS}]; uniform vec3 uSpCol[${MAX_SPOTS}]; uniform vec4 uSpDir[${MAX_SPOTS}];
float distAtt(float d, float cutoff) {
  float f = 1.0 / max(d * d, 0.01);
  if (cutoff > 0.0) { float r = d / cutoff; float rr = r * r; f *= pow(clamp(1.0 - rr * rr, 0.0, 1.0), 2.0); }
  return f;
}
uniform float uGradeAmb, uGradeCold, uGradeWarm;
// Pull a light colour part-way toward a warm neutral of the same luminance.
vec3 grade(vec3 c, float k) { float l = dot(c, vec3(0.299, 0.587, 0.114)); return mix(c, vec3(l) * vec3(1.12, 1.0, 0.84), k); }
// Per-light grading, by how warm the light is. The dungeon's blue-white lantern and the cold fill
// would turn hand-picked ramps into a blue statue, so they are pulled almost all the way to neutral;
// a torch keeps nearly all of its orange, so it lands as a real warm key that models the form
// instead of a flat tint over the whole sprite.
vec3 tone(vec3 c) {
  float warm = clamp((c.r - c.b) / max(1e-4, c.r + c.b), 0.0, 1.0);
  return grade(c, mix(uGradeCold, uGradeWarm, smoothstep(0.12, 0.45, warm)));
}
// Wrapped diffuse for the room's lamps. A billboard has one fake normal facing the camera, so a
// torch on the wall BEHIND the hero would otherwise contribute exactly nothing and he would read as
// a sticker pasted over a lit room. Wrapping the falloff past the terminator lets a near torch spill
// warm light around the silhouette the way a real figure picks up a room's bounce.
uniform float uWrap;
float wrapped(float nd) { return max(0.0, (nd + uWrap) / (1.0 + uWrap)); }
vec3 lightAt(vec3 P, vec3 N) {
  vec3 irr = vec3(0.0);
  irr += tone(uDirColor) * max(0.0, dot(N, uDirDir));
  for (int i = 0; i < ${MAX_POINTS}; i++) {
    vec3 L = uPtPos[i].xyz - P; float d = length(L); L /= max(d, 1e-4);
    irr += tone(uPtCol[i]) * wrapped(dot(N, L)) * distAtt(d, uPtPos[i].w);
  }
  for (int i = 0; i < ${MAX_SPOTS}; i++) {
    vec3 L = uSpPos[i].xyz - P; float d = length(L); L /= max(d, 1e-4);
    float ang = dot(-L, uSpDir[i].xyz);
    float cone = smoothstep(uSpDir[i].w, uSpPos[i].w, ang);
    irr += tone(uSpCol[i]) * max(0.0, dot(N, L)) * cone * distAtt(d, 0.0);
  }
  return irr;
}`;

function makeSpriteMaterial(texture, fog) {
  const u = {
    uMap: { value: texture }, uTexel: { value: new THREE.Vector2(1 / texture.image.width, 1 / texture.image.height) },
    uRect: { value: new THREE.Vector4(0, 0, 1, 1) }, uFlip: { value: 0 },
    uSizeTex: { value: new THREE.Vector2(48, 48) }, uPivot: { value: new THREE.Vector2(0.5, 0) }, uSquash: { value: new THREE.Vector2(1, 1) },
    // screen-space placement (see the header): device pixels per texel, viewport in device pixels,
    // and pixels per world unit at the anchor's depth (used to rebuild a world position for lighting)
    uTexelPx: { value: 4 }, uViewport: { value: new THREE.Vector2(1600, 900) }, uPxPerWorld: { value: 128 }, uZLift: { value: 1.6 },
    uRight: { value: new THREE.Vector3(1, 0, 0) }, uForward: { value: new THREE.Vector3(0, 0, 1) },
    uOpacity: { value: 1 }, uAlphaOut: { value: SPRITE_MASK_ALPHA }, uFlash: { value: 0 }, uFlashColor: { value: new THREE.Color(1, 0.55, 0.4) },
    // a whisper of warmth so the character stays a focal point against cold stone; the real warmth
    // now comes from the torches themselves (see tone()), so this stays subtle
    uTint: { value: new THREE.Color(1.03, 1.0, 0.94) },
    // DEPTH-TINT CLAMP. The grading pass (renderer.js) multiplies the WHOLE frame by the depth
    // band's tint and split-tone, which is right for stone and air and wrong for a creature: it
    // turned the Shadow Dragon purple at depth 3 and navy at depth 18, so a player could not learn
    // a species by its colour. This is the inverse of most of that cast, pre-applied here, so the
    // sprite comes out of the post chain with its own palette while the room around it still turns.
    // CharacterFactory sets it per level (style.js DEPTH_TINT_CLAMP); 1,1,1 = no compensation.
    uGradeComp: { value: new THREE.Color(1, 1, 1) },
    uRimDir: { value: new THREE.Vector3(0, 1, 0) }, uRimColor: { value: new THREE.Color(0, 0, 0) },
    uGradeAmb: { value: 0.88 }, uGradeCold: { value: 0.82 }, uGradeWarm: { value: 0.1 },
    uAmbientGain: { value: 1.15 }, uDirectGain: { value: 1.25 }, uWrap: { value: 0.55 }, uFloor: { value: 0.07 }, uEmissive: { value: 0.9 },
    // ceiling for non-emissive sprite pixels, kept under the bloom pass threshold so hand-pixelled
    // colour never smears into a glow (renderer.js sets the matching threshold)
    uBloomSafe: { value: 1.2 },
    uHemiSky: { value: new THREE.Color() }, uHemiGround: { value: new THREE.Color() }, uDirColor: { value: new THREE.Color() }, uDirDir: { value: new THREE.Vector3(0, 1, 0) },
    uPtPos: { value: Array.from({ length: MAX_POINTS }, () => new THREE.Vector4(0, 0, 0, 1)) }, uPtCol: { value: Array.from({ length: MAX_POINTS }, () => new THREE.Vector3()) },
    uSpPos: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Vector4(0, 0, 0, 1)) }, uSpCol: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Vector3()) },
    uSpDir: { value: Array.from({ length: MAX_SPOTS }, () => new THREE.Vector4(0, -1, 0, 1)) },
    fogTex: fog.uniforms.fogTex, fogSize: fog.uniforms.fogSize, fogTint: fog.uniforms.fogTint,
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, transparent: false, depthWrite: true, side: THREE.DoubleSide,
    // opaque sprites overwrite the target (RGB and the mask alpha) instead of blending, so
    // SPRITE_MASK_ALPHA reaches the post chain intact; update() swaps to normal blending on a fade
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.ZeroFactor, blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor, blendEquationAlpha: THREE.AddEquation,
    vertexShader: `
      uniform vec4 uRect; uniform float uFlip; uniform vec2 uSizeTex, uPivot, uSquash;
      uniform float uTexelPx, uPxPerWorld, uZLift; uniform vec2 uViewport; uniform vec3 uRight;
      varying vec2 vUv; varying vec2 vTex; varying vec2 vFogXZ; varying vec3 vLit;
      void main() {
        vUv = uv;
        float ux = uFlip > 0.5 ? 1.0 - uv.x : uv.x;
        vTex = vec2(mix(uRect.x, uRect.z, ux), mix(uRect.y, uRect.w, uv.y));
        // the pivot, projected: every vertex shares its w, so the quad is parallel to the screen
        vec4 anchor = projectionMatrix * viewMatrix * modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 world = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vFogXZ = world.xz;
        // corner offset in device pixels: whole texels, each exactly uTexelPx pixels
        vec2 off = vec2((uv.x - uPivot.x) * uSizeTex.x * uSquash.x, (uv.y - uPivot.y) * uSizeTex.y * uSquash.y) * uTexelPx;
        // sub-pixel snap: put the pivot on a whole pixel so every texel edge lands on a pixel edge
        vec2 apx = (anchor.xy / max(1e-6, anchor.w) * 0.5 + 0.5) * uViewport;
        off += floor(apx + 0.5) - apx;
        // the world point this texel would occupy if the sprite were a real standing figure: used
        // for lighting, and for DEPTH — the quad is flat in screen space but keeps the depth of an
        // upright body, so the head still draws in front of the stairs or crates it is standing on
        // while every texel stays exactly uTexelPx pixels.
        vec2 offWorld = off / max(1e-4, uPxPerWorld);
        vLit = world + uRight * offWorld.x + vec3(0.0, offWorld.y, 0.0);
        // uZLift = 1/cos(pitch): the body the depth pretends to be is as tall as the sprite LOOKS on
        // screen, which is what lets a hero standing on the stairs draw in front of their near frame.
        vec4 upright = projectionMatrix * viewMatrix * vec4(world + uRight * offWorld.x + vec3(0.0, offWorld.y * uZLift, 0.0), 1.0);
        float z = clamp(upright.z / max(1e-6, upright.w), -1.0, 1.0) * anchor.w;
        gl_Position = vec4(anchor.xy + (off * 2.0 / uViewport) * anchor.w, z, anchor.w);
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec2 uTexel; uniform vec4 uRect; uniform float uFlip;
      uniform vec3 uRight, uForward; uniform float uOpacity, uAlphaOut, uFlash; uniform vec3 uFlashColor, uTint;
      uniform vec3 uRimDir, uRimColor; uniform float uAmbientGain, uDirectGain, uFloor, uEmissive, uBloomSafe;
      uniform vec3 uGradeComp;
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
        // Fill is pulled to a warm neutral (see tone() above); every direct light keeps as much of
        // its own colour as its warmth deserves, so the room's torches key the character.
        vec3 amb = grade(mix(uHemiGround, uHemiSky, 0.5 + 0.5 * N.y), uGradeAmb);
        vec3 direct = lightAt(vLit, N);
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
          col += uRimColor * rim * rim * (0.35 + 0.65 * rim);   // tight: a wide rim eats the silhouette
        }
        col += albedo * emissive * uEmissive;
        col *= uTint;
        col *= uGradeComp;   // keep this creature's palette through the per-depth grade
        col = applyFog(col, vFogXZ);
        // Bloom guard: keep ordinary art below the bloom pass threshold with a soft knee (so the
        // ramp keeps its order) — only genuinely emissive pixels and the hit flash are allowed to glow.
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        if (emissive < 0.5 && lum > uBloomSafe) col *= (uBloomSafe + (lum - uBloomSafe) * 0.15) / lum;
        col = mix(col, uFlashColor * 2.2, uFlash);
        gl_FragColor = vec4(col, uAlphaOut);
      }`,
  });
  return mat;
}

/**
 * Contact shadow. Two lobes on one quad:
 *  - a small, NEAR-OPAQUE CORE ellipse no wider than the stance, flat across its middle and falling
 *    off over three or four screen pixels — this is the only bit that welds a character to the
 *    floor, and it has to be a hole in the tile, not a tint on it. A Gaussian is the wrong curve
 *    here: it has no plateau, so its darkest value is one texel wide and everything else is a
 *    smudge. This is a flat disc with a smoothstep rim instead;
 *  - a wide, very faint ambient-occlusion HALO out to the quad's edge that just dirties the tile.
 * The core drifts a little away from the key light so the grounding agrees with the cast shadow.
 */
function makeBlobMaterial(fog) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uStrength: { value: 1 }, uCore: { value: 0.3 }, uOffset: { value: new THREE.Vector2(0, 0) },
      // width of the core's falloff as a fraction of its radius: set per frame from the real
      // pixels-per-world so the rim is ~3-4 device pixels at any zoom
      uEdge: { value: 0.12 },
      fogTex: fog.uniforms.fogTex, fogSize: fog.uniforms.fogSize, fogTint: fog.uniforms.fogTint,
    },
    transparent: true, depthWrite: false,
    vertexShader: `varying vec2 vUv; varying vec2 vFogXZ; void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vFogXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uStrength, uCore, uEdge; uniform vec2 uOffset; varying vec2 vUv; varying vec2 vFogXZ; ${fog.glsl()}
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float rc = length((p - uOffset) / max(0.05, uCore));
        float core = 1.0 - smoothstep(1.0 - uEdge, 1.0 + uEdge, rc);   // flat plateau, hard rim
        float halo = pow(max(0.0, 1.0 - length(p)), 3.0);              // faint ambient-occlusion skirt
        float a = clamp(core * 0.9 + halo * 0.13, 0.0, 1.0) * uStrength;
        vec2 f = fogMask(vFogXZ); a *= smoothstep(0.0, 1.0, f.r);
        gl_FragColor = vec4(0.014, 0.011, 0.018, a);
      }`,
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
    // contact shadow
    this.blobMat = makeBlobMaterial(fog);
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.blobMat);
    this.blob.rotation.x = -Math.PI / 2; this.blob.position.y = 0.012; this.blob.scale.set(1, 0.62, 1);
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
    this.depthBias = 0.22;
    /** steady size relative to the hero (style.js SCALE) — applied by picking the integer texel size */
    this.scale = 1;
    /** transient hit/attack deformation only (see the header): 1,1 whenever nothing is deforming */
    this.squash = new THREE.Vector2(1, 1);
    this.opacity = 1; this.flash = 0;
    /** device pixels per sprite texel (snapped to an integer in sync()) and the world size of one texel */
    this.texelPx = 4; this.texelWorld = 1 / this.px;
    /** eased foot metrics for the contact shadow (see updateBlob) */
    this._footW = 12; this._footCx = 0; this._footLift = 0; this._footInit = false;
    this.lights = null; this._lightCount = -1;
    this._tmp = new THREE.Vector3(); this._tmp2 = new THREE.Vector3(); this._vp = new THREE.Vector2();
    this._q = new THREE.Quaternion(); this._up = new THREE.Vector3(0, 1, 0); this._xAxis = new THREE.Vector3(1, 0, 0);
    this.mesh.onBeforeRender = (renderer, scene, camera) => this.sync(renderer, scene, camera);
    this.setFrame(sheet.frames[0]);
  }

  /**
   * Pre-cancel most of the renderer's per-depth colour grade for this character, so its species
   * palette survives the post chain (see `uGradeComp`). CharacterFactory computes the colour from
   * `lighting.depthTint(depth)` and `style.DEPTH_TINT_CLAMP`.
   * @param {THREE.Color} c
   */
  setGradeCompensation(c) { this.material.uniforms.uGradeComp.value.copy(c); }

  /** Point the material at a frame of the atlas. */
  setFrame(fr) {
    const u = this.material.uniforms;
    u.uRect.value.set(fr.u0, fr.v0, fr.u1, fr.v1);
    u.uSizeTex.value.set(fr.w, fr.h);
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
    if (this.material.transparent !== fade) {
      this.material.transparent = fade;
      // while fading the sprite must composite normally; while opaque it overwrites so the mask tag
      // in the alpha channel survives for the post chain
      this.material.blending = fade ? THREE.NormalBlending : THREE.CustomBlending;
      this.material.needsUpdate = true;
    }
    u.uAlphaOut.value = fade ? this.opacity : SPRITE_MASK_ALPHA;
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

  /**
   * Size the quad in screen pixels, snap it to the pixel grid, and read the live lights.
   * Called from `mesh.onBeforeRender`, i.e. after the frame's matrices are up to date and before
   * the draw call uploads them — see the header for the projection maths.
   */
  sync(renderer, scene, camera) {
    const u = this.material.uniforms;
    const root = this.root;
    root.updateMatrixWorld(true);
    const wp = this._tmp.setFromMatrixPosition(root.matrixWorld);
    // pull the quad a little toward the camera along the ground: a hero standing on the stairs (or
    // any prop sharing his tile) must read in front of it, not be sliced through the waist
    const cx = camera.position.x - wp.x, cz = camera.position.z - wp.z;
    const yaw = Math.atan2(cx, cz);
    const inv = 1 / (Math.hypot(cx, cz) || 1);
    this.mesh.quaternion.identity();
    this.mesh.position.set(cx * inv * this.depthBias, 0, cz * inv * this.depthBias);
    this.mesh.updateMatrix(); this.mesh.updateMatrixWorld(true);
    u.uRight.value.set(Math.cos(yaw), 0, -Math.sin(yaw));
    u.uForward.value.set(Math.sin(yaw), 0, Math.cos(yaw));
    // ---- texel snapping ----
    const vp = renderer.getDrawingBufferSize(this._vp);
    u.uViewport.value.copy(vp);
    const fwd = this._tmp2.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const ax = wp.x + this.mesh.position.x - camera.position.x;
    const ay = wp.y - camera.position.y;
    const az = wp.z + this.mesh.position.z - camera.position.z;
    const depth = Math.max(0.05, ax * fwd.x + ay * fwd.y + az * fwd.z); // view-space depth of the pivot
    const pxPerWorld = (vp.y * 0.5 * (camera.zoom || 1)) / (Math.tan(camera.fov * Math.PI / 360) * depth);
    const pitch = Math.asin(Math.max(-1, Math.min(1, -fwd.y)));
    u.uZLift.value = 1 / Math.max(0.35, Math.cos(pitch)); // depth-only: see the vertex shader
    // the creature's size rides in HERE, on the integer texel, not on the quad (see the header)
    const want = (pxPerWorld / this.px) * this.scale;
    let S = Math.max(1, Math.round(want));
    if (Math.abs(want - this.texelPx) < 0.62) S = this.texelPx; // hysteresis: no flip-flop mid-zoom
    this.texelPx = S;
    this.texelWorld = S / pxPerWorld;
    u.uTexelPx.value = S;
    u.uPxPerWorld.value = pxPerWorld;
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
    let lx = 0, lz = 0;
    if (best) {
      const dx = best.position.x - wp.x, dy = best.position.y - (wp.y + 0.7), dz = best.position.z - wp.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      u.uRimDir.value.set(dx / len, dy / len, dz / len);
      const k = Math.min(0.85, bestW * 0.13);
      u.uRimColor.value.set(best.color.r * k, best.color.g * k, best.color.b * k);
      const flat = Math.hypot(dx, dz) || 1;
      lx = dx / flat; lz = dz / flat;
      this.updateCast(-dx, -dz, Math.hypot(dx, dz), best.position.y, k);
    } else { u.uRimColor.value.set(0, 0, 0); this.cast.visible = false; }
    this.updateBlob(lx, lz, yaw);
  }

  /**
   * Ground the character: the blob is sized from the frame's real foot span (packSheet measures it),
   * so it hugs the boots instead of a guessed ellipse, and its core drifts away from the key light.
   * The quad is turned to the camera's yaw so its squashed axis is the one the camera foreshortens.
   */
  updateBlob(lx, lz, yaw) {
    const fr = this.frame; if (!fr) return;
    const foot = fr.foot || { w: 12, cx: 0, drop: 0 };
    const sq = Math.abs(this.squash.x) || 1;
    // The measured span jumps frame to frame — one boot planted mid-stride, a cape hem swinging into
    // the bottom rows — so ease it: the pool breathes with the gait instead of snapping, and it still
    // grows properly as a dying body sprawls out.
    const k = this._footInit ? 0.25 : 1; this._footInit = true;
    this._footW += (foot.w - this._footW) * k;
    this._footCx += (foot.cx - this._footCx) * k;
    this._footLift += (Math.max(0, -foot.drop) - this._footLift) * k; // rows the feet are off the floor
    const footW = Math.max(0.12, this._footW * this.texelWorld * sq); // world width of the boots
    const halo = footW * 1.9;                                    // quad half-width: core + AO halo
    // lay flat (x = camera right), then yaw with the billboard
    this.blob.quaternion.setFromAxisAngle(this._xAxis, -Math.PI / 2).premultiply(this._q.setFromAxisAngle(this._up, yaw));
    this.blob.scale.set(halo * 2, halo * 1.3, 1);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);   // the quad's local +x in world
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);  // the quad's local +y in world
    const offx = this._footCx * this.texelWorld * sq * (this.flip ? -1 : 1);
    // centre it under the boots AS DRAWN: the quad is pulled `depthBias` toward the camera, which on
    // a pitched camera moves the feet a good 20 screen pixels down. Without this the whole dark core
    // hides behind the legs and only the faint outer skirt shows, which is what made the old blob
    // read as a vague smudge instead of contact.
    this.blob.position.set(rx * offx + this.mesh.position.x, 0.012, rz * offx + this.mesh.position.z);
    const uB = this.blobMat.uniforms;
    // The core is an ellipse HALF the stance across, so it never spills past the boots; the falloff
    // is pinned to ~3.5 device pixels whatever the zoom, which is what makes it read as contact
    // rather than as a soft pool of dirt.
    const coreWorld = footW * 0.5;
    uB.uCore.value = Math.min(0.85, coreWorld / halo);
    const pxPerWorld = this.texelPx / Math.max(1e-4, this.texelWorld);
    uB.uEdge.value = Math.min(0.5, Math.max(0.06, 1.75 / (pxPerWorld * coreWorld)));
    // the core sits a hair away from the key light, so it agrees with the stretched cast shadow
    uB.uOffset.value.set(-(lx * rx + lz * rz) * 0.05, -(lx * fx + lz * fz) * 0.05);
    uB.uStrength.value = this.opacity / (1 + this._footLift * 0.55); // a lifted boot casts less contact
  }

  /** Lay the silhouette shadow on the floor, away from the light, longer for low/near lights. */
  updateCast(ax, az, dist, lightH, strength) {
    const fr = this.frame; if (!fr) { this.cast.visible = false; return; }
    const w = fr.w * this.texelWorld * 0.9, h = fr.h * this.texelWorld * 0.85;
    const len = Math.max(0.5, Math.min(1.8, h * (h / Math.max(0.6, lightH)) * (1.2 / Math.max(1, dist * 0.5))));
    const n = Math.hypot(ax, az) || 1; ax /= n; az /= n;
    const rx = -az, rz = ax; // right vector on the floor, perpendicular to the shadow direction
    const p = this.castPos, hw = w * 0.5, y = 0.014;
    const px0 = (this.frame.px / this.frame.w - 0.5) * w * (this.flip ? -1 : 1);
    const bx = this.mesh.position.x, bz = this.mesh.position.z; // same offset as the drawn feet
    const set = (i, x, z) => { p[i * 3] = x + bx; p[i * 3 + 1] = y; p[i * 3 + 2] = z + bz; };
    set(0, rx * (-hw - px0), rz * (-hw - px0)); set(1, rx * (hw - px0), rz * (hw - px0));
    set(2, rx * (-hw - px0) + ax * len, rz * (-hw - px0) + az * len); set(3, rx * (hw - px0) + ax * len, rz * (hw - px0) + az * len);
    this.castGeo.attributes.position.needsUpdate = true;
    this.cast.visible = strength > 0.02 && this.opacity > 0.05;
    this.castMat.uniforms.uStrength.value = 0.3 * Math.min(1, strength * 1.5) * this.opacity;
  }

  dispose() { this.material.dispose(); this.blobMat.dispose(); this.castMat.dispose(); this.castGeo.dispose(); this.mesh.geometry.dispose(); this.blob.geometry.dispose(); }
}
