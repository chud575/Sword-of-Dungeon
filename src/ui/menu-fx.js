// Menu eye-candy shared by the title, death and victory screens: the metallic "FARGOAL" wordmark
// (inline SVG: gradient steel, bevel lighting, ember glow, a sheen sweep), ornamental dividers and a
// deterministic 2D particle layer (embers / gold motes / falling ash). Everything is procedural —
// no fonts, images or network. Particles advance only from `update(dt)` so `debug.step` keeps
// screenshots reproducible.
import { createRng } from '../core/rng.js';

let uid = 0;

/**
 * Metallic wordmark as inline SVG. `textLength` pins the width so any fallback serif renders the
 * same silhouette. Returns an HTML string.
 * @param {string} text
 * @param {{width?:number, height?:number, size?:number, ember?:string, cls?:string}} [opts]
 * @returns {string}
 */
export function logoSvg(text, { width = 1000, height = 240, size = 176, ember = '#ff6a12', cls = '' } = {}) {
  const id = 'lg' + (uid++);
  const y = Math.round(height * 0.72);
  const common = `x="50%" y="${y}" text-anchor="middle" font-size="${size}" font-weight="700" textLength="${Math.round(width * 0.92)}" lengthAdjust="spacingAndGlyphs" font-family="Cinzel,'Trajan Pro','Palatino Linotype','Book Antiqua',Palatino,'Liberation Serif','DejaVu Serif',Georgia,serif"`;
  return `<svg class="logo ${cls}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" aria-label="${text}">
  <defs>
    <linearGradient id="${id}-metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff9e2"/><stop offset=".18" stop-color="#f6dc93"/><stop offset=".44" stop-color="#d9ad48"/>
      <stop offset=".5" stop-color="#7a5314"/><stop offset=".56" stop-color="#c9a04a"/><stop offset=".8" stop-color="#f3d786"/><stop offset="1" stop-color="#fff5d0"/>
    </linearGradient>
    <linearGradient id="${id}-edge" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5a3c10"/><stop offset=".5" stop-color="#2a1a06"/><stop offset="1" stop-color="#160d03"/>
    </linearGradient>
    <linearGradient id="${id}-sheen" x1="0" y1="0" x2="1" y2="0" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".85"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      <animateTransform attributeName="gradientTransform" type="translate" from="-1 0" to="1.6 0" dur="6.5s" repeatCount="indefinite"/>
    </linearGradient>
    <filter id="${id}-bevel" x="-10%" y="-30%" width="120%" height="160%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="blur"/>
      <feSpecularLighting in="blur" surfaceScale="5" specularConstant=".9" specularExponent="30" lighting-color="#fff4cf" result="spec">
        <feDistantLight azimuth="250" elevation="48"/>
      </feSpecularLighting>
      <feComposite in="spec" in2="SourceAlpha" operator="in" result="specIn"/>
      <feComposite in="SourceGraphic" in2="specIn" operator="arithmetic" k1="0" k2="1" k3=".55" k4="0"/>
    </filter>
    <filter id="${id}-glow" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="16"/></filter>
    <filter id="${id}-soft" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="5"/></filter>
  </defs>
  <text ${common} fill="${ember}" opacity=".55" filter="url(#${id}-glow)" class="lg-ember">${text}</text>
  <text ${common} fill="#000" opacity=".85" filter="url(#${id}-soft)" transform="translate(0 9)">${text}</text>
  <text ${common} fill="url(#${id}-edge)" transform="translate(0 4)">${text}</text>
  <text ${common} fill="url(#${id}-metal)" stroke="#2c1a06" stroke-width="2.2" paint-order="stroke" filter="url(#${id}-bevel)">${text}</text>
  <text ${common} fill="url(#${id}-sheen)" style="mix-blend-mode:screen">${text}</text>
</svg>`;
}

/** Horizontal sword divider (blade, guard, grip, pommel) in gold. */
export function swordRule(cls = '') {
  return `<svg class="sword-rule ${cls}" viewBox="0 0 600 24" preserveAspectRatio="none" aria-hidden="true">
  <defs><linearGradient id="sr-blade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e8c15a" stop-opacity="0"/><stop offset=".15" stop-color="#fff2c4"/><stop offset=".5" stop-color="#e8c15a"/><stop offset=".85" stop-color="#fff2c4"/><stop offset="1" stop-color="#e8c15a" stop-opacity="0"/></linearGradient></defs>
  <path d="M0 12 L250 12" stroke="url(#sr-blade)" stroke-width="2"/><path d="M40 9.5 L250 9.5" stroke="url(#sr-blade)" stroke-width=".6" opacity=".6"/>
  <path d="M350 12 L600 12" stroke="url(#sr-blade)" stroke-width="2"/><path d="M350 9.5 L560 9.5" stroke="url(#sr-blade)" stroke-width=".6" opacity=".6"/>
  <path d="M258 12 L272 6 L328 6 L342 12 L328 18 L272 18 Z" fill="#0d0905" stroke="#e8c15a" stroke-width="1"/>
  <path d="M300 4 L306 12 L300 20 L294 12 Z" fill="#ffe6a0"/>
  <circle cx="262" cy="12" r="2.2" fill="#e8c15a"/><circle cx="338" cy="12" r="2.2" fill="#e8c15a"/>
</svg>`;
}

/** A small ornamental divider line with a centre diamond, used under panel headings. */
export function ornament(cls = '') { return `<div class="orn ${cls}"><i></i><b></b><i></i></div>`; }

/** Panel heading block: eyebrow line, title, optional sub-line, divider. */
export function heading({ eyebrow = '', title, sub = '', cls = '', orn = '' } = {}) {
  return `<div class="mhead ${cls}">${eyebrow ? `<div class="eyebrow">${eyebrow}</div>` : ''}<h1>${title}</h1>${sub ? `<div class="subtitle">${sub}</div>` : ''}${ornament(orn)}</div>`;
}

/** Skull rating used on difficulty cards. */
export function skulls(n, max = 4) {
  let s = '<span class="skulls" aria-hidden="true">';
  for (let i = 0; i < max; i++) s += `<i class="${i < n ? 'on' : ''}"></i>`;
  return s + '</span>';
}

/**
 * Deterministic 2D particle overlay. Modes: 'embers' (rising sparks from a band), 'gold' (slow golden
 * motes drifting up with sparkle), 'ash' (grey flakes sinking through a red mist). The canvas fills
 * its parent; call `update(dt)` from the UI tick and `dispose()` when the screen closes.
 */
export class ParticleLayer {
  /**
   * @param {HTMLElement} parent
   * @param {{mode?:'embers'|'gold'|'ash', count?:number, seed?:string|number, origin?:{x:number,y:number,w:number,h:number}}} [opts]
   */
  constructor(parent, { mode = 'embers', count = 110, seed = 'menu-fx', origin = null } = {}) {
    this.mode = mode; this.count = count;
    this.rng = createRng(seed);
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fx-layer ' + mode;
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.origin = origin || (mode === 'embers' ? { x: 0.2, y: 0.36, w: 0.6, h: 0.12 } : mode === 'gold' ? { x: 0.05, y: 0.55, w: 0.9, h: 0.5 } : { x: -0.1, y: -0.15, w: 1.2, h: 0.1 });
    this.p = [];
    this.t = 0;
    this.w = 0; this.h = 0;
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.resize();
    for (let i = 0; i < count; i++) { const q = this.spawn(); q.life = this.rng.float(0, q.max); this.p.push(q); }
    // pre-roll so the very first frame already has an established field
    for (let i = 0; i < 90; i++) this.step(1 / 30);
    this.draw();
  }

  resize() {
    const r = this.canvas.parentElement ? this.canvas.parentElement.getBoundingClientRect() : { width: innerWidth, height: innerHeight };
    const dpr = Math.min(1.5, (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1);
    this.w = Math.max(1, Math.round(r.width || innerWidth)); this.h = Math.max(1, Math.round(r.height || innerHeight));
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  spawn() {
    const r = this.rng, o = this.origin;
    const q = { x: o.x + r.next() * o.w, y: o.y + r.next() * o.h, life: 0, max: 1, size: 1, vx: 0, vy: 0, hue: 0, sway: r.float(0, Math.PI * 2), spin: r.float(0.8, 2.2) };
    if (this.mode === 'embers') { q.max = r.float(1.6, 4.2); q.size = r.float(0.8, 2.6); q.vy = -r.float(0.035, 0.11); q.vx = r.float(-0.012, 0.012); q.hue = r.float(0, 1); }
    else if (this.mode === 'gold') { q.max = r.float(3, 7); q.size = r.float(0.9, 2.4); q.vy = -r.float(0.012, 0.04); q.vx = r.float(-0.01, 0.01); q.hue = r.float(0, 1); }
    else { q.max = r.float(5, 9); q.size = r.float(1, 3.2); q.vy = r.float(0.02, 0.05); q.vx = r.float(-0.01, 0.015); q.hue = r.float(0, 1); }
    return q;
  }

  step(dt) {
    this.t += dt;
    for (let i = 0; i < this.p.length; i++) {
      const q = this.p[i];
      q.life += dt;
      if (q.life >= q.max) { this.p[i] = this.spawn(); continue; }
      const s = Math.sin(this.t * q.spin + q.sway);
      q.x += (q.vx + s * (this.mode === 'ash' ? 0.02 : 0.008)) * dt;
      q.y += q.vy * dt * (this.mode === 'embers' ? 1 + q.life * 0.25 : 1);
    }
  }

  /** @param {number} dt seconds */
  update(dt) { this.step(Math.min(dt, 0.1)); this.draw(); }

  draw() {
    const c = this.ctx, w = this.w, h = this.h;
    c.clearRect(0, 0, w, h);
    c.globalCompositeOperation = this.mode === 'ash' ? 'source-over' : 'lighter';
    for (const q of this.p) {
      const k = q.life / q.max;
      const fade = k < 0.15 ? k / 0.15 : k > 0.6 ? (1 - k) / 0.4 : 1;
      if (fade <= 0) continue;
      const x = q.x * w, y = q.y * h;
      if (this.mode === 'embers') {
        const flick = 0.75 + 0.25 * Math.sin(this.t * 9 + q.sway * 5);
        const a = fade * flick;
        const col = q.hue < 0.55 ? `rgba(255,${120 + (q.hue * 120) | 0},40,` : `rgba(255,${200 + (q.hue * 50) | 0},${90 + (q.hue * 90) | 0},`;
        const g = c.createRadialGradient(x, y, 0, x, y, q.size * 5);
        g.addColorStop(0, col + (a * 0.9) + ')'); g.addColorStop(0.35, col + (a * 0.35) + ')'); g.addColorStop(1, col + '0)');
        c.fillStyle = g; c.beginPath(); c.arc(x, y, q.size * 5, 0, Math.PI * 2); c.fill();
        c.fillStyle = `rgba(255,240,200,${a})`; c.beginPath(); c.arc(x, y, q.size * 0.55, 0, Math.PI * 2); c.fill();
      } else if (this.mode === 'gold') {
        const tw = 0.55 + 0.45 * Math.sin(this.t * 3.2 + q.sway * 7);
        const a = fade * tw;
        const g = c.createRadialGradient(x, y, 0, x, y, q.size * 6);
        g.addColorStop(0, `rgba(255,236,170,${a * 0.85})`); g.addColorStop(0.4, `rgba(232,193,90,${a * 0.28})`); g.addColorStop(1, 'rgba(232,193,90,0)');
        c.fillStyle = g; c.beginPath(); c.arc(x, y, q.size * 6, 0, Math.PI * 2); c.fill();
        c.fillStyle = `rgba(255,252,235,${a})`; c.beginPath(); c.arc(x, y, q.size * 0.6, 0, Math.PI * 2); c.fill();
        if (q.hue > 0.7) { c.strokeStyle = `rgba(255,246,210,${a * 0.6})`; c.lineWidth = 0.8; c.beginPath(); c.moveTo(x - q.size * 3, y); c.lineTo(x + q.size * 3, y); c.moveTo(x, y - q.size * 3); c.lineTo(x, y + q.size * 3); c.stroke(); }
      } else {
        const a = fade * 0.85;
        const grey = 150 + (q.hue * 80) | 0;
        c.fillStyle = `rgba(${grey},${grey - 8},${grey - 14},${a})`;
        c.beginPath(); c.ellipse(x, y, q.size, q.size * 0.6, q.sway + this.t * 0.6, 0, Math.PI * 2); c.fill();
      }
    }
    c.globalCompositeOperation = 'source-over';
  }

  dispose() { window.removeEventListener('resize', this.onResize); this.canvas.remove(); }
}
