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

/** Procedural top-down bedrock: mottled stone with darker fissures, tiled without visible seams. */
function rockTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#161219';
  g.fillRect(0, 0, S, S);
  // Deterministic value noise — this is decoration, but keeping it seeded keeps frames identical.
  let seed = 0x9e3779b9;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S, y = rnd() * S, r = 2 + rnd() * 16;
    const v = 0.10 + rnd() * 0.16;
    g.fillStyle = `rgba(${(60 * v * 6) | 0},${(52 * v * 6) | 0},${(66 * v * 6) | 0},0.30)`;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Fissures: short dark strokes that give the mass some grain at this camera distance.
  g.strokeStyle = 'rgba(8,6,11,0.55)';
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
    // would flicker distractingly at the edge of vision. A flat dim tone reads as depth.
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, color: 0x2a2533, fog: false });
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
    const y = 0.92; // just under the wall caps, so walls still occlude it at the boundary

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
      mat.map = this.texture.clone();
      mat.map.needsUpdate = true;
      mat.map.repeat.set(w / 6, d / 6);
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
    this.scene.remove(this.group);
  }
}
