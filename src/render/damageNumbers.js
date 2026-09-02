// Floating combat text: canvas-rendered sprites with an outline and glow, an ease-out-back pop,
// eased rise with a sideways drift, and automatic staggering so stacked hits never overlap.
import * as THREE from 'three';

const W = 320, H = 112;
const STYLES = {
  normal: { color: '#ffffff', glow: null, font: 'bold', size: 60 },
  player: { color: '#ff6a58', glow: 'rgba(255,60,30,0.7)', font: 'bold', size: 62 },
  crit: { color: '#ffd866', glow: 'rgba(255,190,60,0.95)', font: 'bold italic', size: 70 },
  heal: { color: '#8cf0a0', glow: 'rgba(80,230,120,0.7)', font: 'bold', size: 56 },
  gold: { color: '#ffd866', glow: 'rgba(255,200,80,0.8)', font: 'bold', size: 54 },
  magic: { color: '#c8b0ff', glow: 'rgba(180,140,255,0.8)', font: 'bold', size: 52 },
  banner: { color: '#ffe8a0', glow: 'rgba(255,210,90,1)', font: 'bold', size: 58 },
  blocked: { color: '#ffd43b', glow: 'rgba(255,212,59,0.6)', font: 'bold', size: 44 },
};

function easeOutBack(k) { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2); }
function easeOutCubic(k) { return 1 - Math.pow(1 - k, 3); }

export class DamageNumbers {
  constructor(scene, rng) {
    this.scene = scene; this.rng = rng;
    this.pool = []; this.active = [];
    this.recent = []; // {x, z, t}
    this.time = 0;
    this.flip = 1;
  }

  /**
   * @param {number} x @param {number} z @param {string} text
   * @param {{style?:keyof typeof STYLES, color?:string, size?:number, y?:number, life?:number, rise?:number}} [o]
   */
  spawn(x, z, text, o = {}) {
    const st = STYLES[o.style] || STYLES.normal;
    let s = this.pool.pop();
    if (!s) {
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      s = new THREE.Sprite(mat); s.userData.canvas = canvas; s.userData.tex = tex; s.renderOrder = 20;
    }
    const ctx = s.userData.canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    let px = Math.round(st.size * Math.min(1.35, o.size ?? 1));
    ctx.font = `${st.font} ${px}px Georgia, "Times New Roman", serif`;
    const tw = ctx.measureText(text).width;
    if (tw > W - 28) { px = Math.floor(px * (W - 28) / tw); ctx.font = `${st.font} ${px}px Georgia, "Times New Roman", serif`; }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    if (st.glow) { ctx.shadowColor = st.glow; ctx.shadowBlur = 18; }
    ctx.lineWidth = 11; ctx.strokeStyle = 'rgba(0,0,0,0.92)'; ctx.strokeText(text, W / 2, H / 2 + 2);
    ctx.shadowBlur = 0;
    const grad = ctx.createLinearGradient(0, H / 2 - px / 2, 0, H / 2 + px / 2);
    const col = o.color || st.color;
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.35, col); grad.addColorStop(1, col);
    ctx.fillStyle = grad; ctx.fillText(text, W / 2, H / 2 + 2);
    s.userData.tex.needsUpdate = true;
    // stagger: count recent numbers at this spot
    const now = this.time;
    this.recent = this.recent.filter((r) => now - r.t < 0.5);
    const stacked = this.recent.filter((r) => Math.abs(r.x - x) < 0.7 && Math.abs(r.z - z) < 0.7).length;
    this.recent.push({ x, z, t: now });
    this.flip = -this.flip;
    const size = o.size ?? 1;
    const u = s.userData;
    u.t = 0; u.size = size; u.life = o.life ?? 1.15; u.rise = o.rise ?? 0.95;
    u.x0 = x + this.flip * stacked * 0.22; u.z0 = z; u.y0 = (o.y ?? 0.95) + stacked * 0.3;
    u.vx = this.flip * this.rng.float(0.05, 0.3) * (stacked ? 1.4 : 1);
    u.w = (W / H) * 0.62 * size; u.h = 0.62 * size;
    s.material.opacity = 1;
    s.scale.set(0.001, 0.001, 1);
    s.position.set(u.x0, u.y0, u.z0);
    this.scene.add(s);
    this.active.push(s);
  }

  update(dt) {
    this.time += dt;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i], u = s.userData;
      u.t += dt;
      const t = u.t, k = Math.min(1, t / u.life);
      const rise = easeOutCubic(Math.min(1, t / (u.life * 0.85)));
      s.position.set(u.x0 + u.vx * t, u.y0 + u.rise * rise, u.z0 + u.vx * 0.3 * t);
      const pop = t < 0.24 ? easeOutBack(t / 0.24) : 1;
      s.scale.set(u.w * pop, u.h * pop, 1);
      s.material.opacity = k < 0.62 ? 1 : Math.max(0, 1 - (k - 0.62) / 0.38);
      if (k >= 1) { this.scene.remove(s); this.active.splice(i, 1); this.pool.push(s); }
    }
  }
}
