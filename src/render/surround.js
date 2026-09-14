// surround: the rock the dungeon is carved out of.
//
// Without this the level floats in a black void: everything past the level bounds is empty space,
// which at the top-down camera reads as "the world stops here". This fills that space with dimly
// lit bedrock seen from above, so the dungeon sits inside a mountain instead of hanging in nothing.
//
// It deliberately does NOT reveal anything: the apron lives strictly OUTSIDE the level rectangle
// (four bands around it), so unexplored rooms and corridors inside the level stay hidden by the
// fog of war. Softening the *inside* black is done separately, in lighting.js's applyFog.
import * as THREE from 'three';

const MARGIN = 26; // tiles of rock drawn beyond each edge — past the far zoom stop's view
/**
 * How much of the rock texture's own value reaches the screen.
 *
 * The texture is painted at the value the bedrock INSIDE the level sits at, so that the apron and
 * the level read as one mass rather than meeting at a horizon (see rockTexture below). Judged in a
 * real frame that turned out to be too much: the ground outside the walls is not part of the board
 * and competes with it for attention. This dims it toward the void without going to the void —
 * 1.0 is the old flat grey, 0.0 is black.
 */
const SURROUND_DIM = 0.46;

/**
 * Procedural top-down bedrock: mottled stone with darker fissures, tiled without visible seams.
 *
 * THIS TEXTURE IS THE FINAL COLOUR. It used to be painted around #161219 and then multiplied AGAIN
 * by the material's 0x2a2533 — two dark values multiplied in linear space land at 0.0002, which is
 * black to four decimal places, so the mountain the dungeon sits inside was rendering as exactly
 * the void it exists to remove: 0.007 screen luminance off the 'default' frame, against 0.064 for
 * the in-level bedrock next to it. The material tint is now white and every value below is the
 * value that reaches the screen; it measures 0.158 against the bedrock's 0.150, so the apron and
 * the rock inside the level read as one mass and the seam between them stops being a horizon.
 */
function rockTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2526';
  g.fillRect(0, 0, S, S);
  // Deterministic value noise — this is decoration, but keeping it seeded keeps frames identical.
  let seed = 0x9e3779b9;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S, y = rnd() * S, r = 2 + rnd() * 16;
    const v = 0.42 + rnd() * 0.58;
    // Warm-neutral grey, not lavender: the grading pass already casts the shadows of every depth
    // band toward blue or violet, so a violet pigment here came out of the post chain as a purple
    // carpet laid around the level instead of as rock.
    g.fillStyle = `rgba(${(80 * v) | 0},${(70 * v) | 0},${(71 * v) | 0},0.40)`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Fissures: short dark strokes that give the mass some grain at this camera distance. Kept low
  // in contrast — at full strength on lit rock they read as scratches on the lens.
  g.strokeStyle = 'rgba(26,22,23,0.4)';
  for (let i = 0; i < 130; i++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI, len = 8 + rnd() * 34;
    g.lineWidth = 0.6 + rnd() * 1.5;
    g.beginPath(); g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * THE WOODS BEYOND THE MAP, from above: the forest has no mountain to be carved out of. Packed crowns
 * of trees — each a round clump lit on its north-west side with a dark rim toward the south-east —
 * over a dark leafy floor that shows in the gaps. Painted at the ground plane's value, like the rock.
 */
function woodsTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#1d3319';
  g.fillRect(0, 0, S, S);
  let seed = 0x7f4a7c15;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const blob = (x, y, r, fill) => {
    // draw wrapped so the texture tiles without a seam
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      if (x + ox < -r || x + ox > S + r || y + oy < -r || y + oy > S + r) continue;
      g.fillStyle = fill; g.beginPath(); g.arc(x + ox, y + oy, r, 0, Math.PI * 2); g.fill();
    }
  };
  const greens = [[46, 88, 38], [58, 104, 44], [40, 78, 36], [70, 112, 46]];
  for (let i = 0; i < 150; i++) {
    const x = rnd() * S, y = rnd() * S, r = 9 + rnd() * 13;
    const [cr, cg, cb] = greens[Math.floor(rnd() * greens.length)];
    blob(x + r * 0.18, y + r * 0.22, r * 1.02, 'rgba(12,22,11,0.75)');        // the rim / shade to the SE
    blob(x, y, r, `rgb(${cr},${cg},${cb})`);
    for (let k = 0; k < 4; k++) {                                              // clumps inside the crown
      const a = rnd() * Math.PI * 2, d = rnd() * r * 0.55, rr = r * (0.3 + rnd() * 0.25);
      blob(x + Math.cos(a) * d, y + Math.sin(a) * d, rr, `rgba(${cr + 14},${cg + 22},${cb + 8},0.55)`);
    }
    blob(x - r * 0.32, y - r * 0.34, r * 0.34, `rgba(${cr + 45},${cg + 55},${cb + 18},0.5)`);   // the lit NW shoulder
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Surround {
  /**
   * @param {{scene:THREE.Scene, bus:{on:Function}}} o
   */
  constructor({ scene, bus }) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'surround';
    this.group.renderOrder = -1;
    scene.add(this.group);

    this.texture = rockTexture();
    // Unlit on purpose: this is background mass far from every torch, and a lit material here
    // would flicker distractingly at the edge of vision. A flat dim tone reads as depth — and the
    // tone lives in the texture (see rockTexture), so this tint stays white.
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, fog: false });
    this.material.color.setScalar(SURROUND_DIM);
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.rotateX(-Math.PI / 2);

    bus?.on?.('level:enter', ({ level }) => this.build(level));
  }

  /** Lay four bands of rock around the level's rectangle, at the height of the wall tops. */
  build(level) {
    if (!level) return;
    for (const m of this.group.children) m.geometry !== this.geo && m.geometry?.dispose?.();
    this.group.clear();
    const W = level.width, H = level.height, M = MARGIN;
    const forest = level.biome === 'forest';
    // a dungeon's rock sits just under the wall caps, so walls still occlude it at the boundary; the
    // woods lie on the ground, so the trees past the map's edge stand in them
    const y = forest ? -0.02 : 0.92;
    const tex = forest ? (this.woods || (this.woods = woodsTexture())) : this.texture;

    // [x0, z0, x1, z1] bands: north, south, west, east — together an unbroken ring.
    const bands = [
      [-M, -M, W + M, 0],
      [-M, H, W + M, H + M],
      [-M, 0, 0, H],
      [W, 0, W + M, H],
    ];
    for (const [x0, z0, x1, z1] of bands) {
      const w = x1 - x0, d = z1 - z0;
      if (w <= 0 || d <= 0) continue;
      const mat = this.material.clone();
      mat.map = tex.clone();
      mat.map.needsUpdate = true;
      mat.map.repeat.set(w / (forest ? 11 : 6), d / (forest ? 11 : 6));
      // unlit, so it must sit at the value the fog of war leaves an unexplored wood at, not at daylight
      if (forest) mat.color.setScalar(0.24);
      const mesh = new THREE.Mesh(this.geo, mat);
      mesh.scale.set(w, 1, d);
      mesh.position.set(x0 + w / 2 - 0.5, y, z0 + d / 2 - 0.5);
      mesh.frustumCulled = false;
      this.group.add(mesh);
    }
  }

  dispose() {
    for (const m of this.group.children) m.material?.map?.dispose?.(), m.material?.dispose?.();
    this.group.clear();
    this.geo.dispose();
    this.texture.dispose();
    this.woods?.dispose?.();
    this.scene.remove(this.group);
  }
}
