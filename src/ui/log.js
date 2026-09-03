// Message log: categorised colours with a glowing category mark, the newest line slides in with a
// gold wash, older lines dim after a while; hover (or click to pin) expands the scrollable history.
// Replays the game's stored log on start/load. Styles live in ./hud.css (imported by hud.js).
import { icon } from './icons.js';

const MAX_LINES = 120;
const FADE_AFTER = 9; // seconds before a line dims

export class MessageLog {
  /** @param {{root:HTMLElement, bus:import('../core/events.js').EventBus, getGame:()=>any}} ctx */
  constructor(ctx) {
    this.ctx = ctx; this.bus = ctx.bus;
    this.el = document.createElement('div');
    this.el.className = 'panel hud ornate'; this.el.id = 'log';
    this.el.innerHTML = `<div class="corners"><i></i><i></i><i></i><i></i></div><div class="filet"></div><div class="lines"></div>
      <div class="foot"><span class="pin">${icon('pin')}<span class="pin-t">Hover to expand · click to pin</span></span><span class="cnt"></span></div>`;
    this.lines = this.el.querySelector('.lines');
    this.pinText = this.el.querySelector('.pin-t');
    this.count = this.el.querySelector('.foot .cnt');
    this.el.addEventListener('click', () => { const on = this.el.classList.toggle('expanded'); this.pinText.textContent = on ? 'Pinned · click to release' : 'Hover to expand · click to pin'; });
    ctx.root.appendChild(this.el);
    this.entries = []; // {el, time, old}
    this.total = 0;
    this.unsub = [
      this.bus.on('log', (e) => this.add(e)),
      this.bus.on('game:start', () => this.replay()),
    ];
  }

  /** Rebuild from the current game's stored log. */
  replay() {
    this.lines.innerHTML = ''; this.entries = []; this.total = 0;
    const g = this.ctx.getGame(); if (!g) return;
    const all = g.state.log;
    this.total = Math.max(0, all.length - Math.min(40, all.length));
    for (const e of all.slice(-40)) this.add(e, true);
  }

  add(entry, silent = false) {
    const g = this.ctx.getGame();
    const now = g ? g.state.time : 0;
    const time = entry.time ?? now;
    const line = document.createElement('div');
    const shout = /^[A-Z0-9 !'.?:,\-()]+$/.test(entry.text) && entry.text.length < 32;
    line.className = `line k-${entry.kind || 'info'}${shout ? ' shout' : ''}${silent ? '' : ' fresh'}`;
    line.innerHTML = `${escape(entry.text)}<span class="t">${fmt(time)}</span>`;
    this.lines.appendChild(line);
    const rec = { el: line, time, old: false };
    this.entries.push(rec);
    if (silent && now - time > FADE_AFTER) { rec.old = true; line.classList.add('old'); }
    while (this.entries.length > MAX_LINES) { const e = this.entries.shift(); e.el.remove(); }
    this.total++;
    this.count.textContent = `${this.total} ${this.total === 1 ? 'entry' : 'entries'}`;
    this.lines.scrollTop = this.lines.scrollHeight;
  }

  update() {
    const g = this.ctx.getGame(); if (!g) return;
    const now = g.state.time;
    for (const e of this.entries) { const old = now - e.time > FADE_AFTER; if (old !== e.old) { e.old = old; e.el.classList.toggle('old', old); if (old) e.el.classList.remove('fresh'); } }
  }

  dispose() { for (const u of this.unsub) u(); this.el.remove(); }
}

function fmt(t) { t = Math.max(0, Math.floor(t || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
function escape(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
