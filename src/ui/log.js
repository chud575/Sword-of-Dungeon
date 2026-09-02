// Message log: categorised colours, the last lines fade after a while, hover (or click) to expand
// the scrollable history. Replays the game's stored log on start/load.
const MAX_LINES = 120;
const FADE_AFTER = 9; // seconds before a line dims

export class MessageLog {
  /** @param {{root:HTMLElement, bus:import('../core/events.js').EventBus, getGame:()=>any}} ctx */
  constructor(ctx) {
    this.ctx = ctx; this.bus = ctx.bus;
    this.el = document.createElement('div');
    this.el.className = 'panel hud'; this.el.id = 'log';
    this.el.innerHTML = '<div class="corners"><i></i><i></i><i></i><i></i></div><div class="lines"></div><div class="hint">hover to expand · click to pin</div>';
    this.lines = this.el.querySelector('.lines');
    this.el.addEventListener('click', () => this.el.classList.toggle('expanded'));
    ctx.root.appendChild(this.el);
    this.entries = []; // {el, time}
    this.unsub = [
      this.bus.on('log', (e) => this.add(e)),
      this.bus.on('game:start', () => this.replay()),
    ];
  }

  /** Rebuild from the current game's stored log. */
  replay() {
    this.lines.innerHTML = ''; this.entries = [];
    const g = this.ctx.getGame(); if (!g) return;
    for (const e of g.state.log.slice(-40)) this.add(e, true);
  }

  add(entry, silent = false) {
    const g = this.ctx.getGame();
    const now = g ? g.state.time : 0;
    const line = document.createElement('div');
    const shout = /^[A-Z0-9 !'.?:,\-()]+$/.test(entry.text) && entry.text.length < 32;
    line.className = `line k-${entry.kind || 'info'}${shout ? ' shout' : ''}`;
    line.innerHTML = `<span class="t">${fmt(entry.time ?? now)}</span>${escape(entry.text)}`;
    this.lines.appendChild(line);
    this.entries.push({ el: line, time: entry.time ?? now });
    if (silent && now - (entry.time ?? 0) > FADE_AFTER) line.classList.add('old');
    while (this.entries.length > MAX_LINES) { const e = this.entries.shift(); e.el.remove(); }
    this.lines.scrollTop = this.lines.scrollHeight;
  }

  update() {
    const g = this.ctx.getGame(); if (!g) return;
    const now = g.state.time;
    for (const e of this.entries) { const old = now - e.time > FADE_AFTER; if (old !== e.old) { e.old = old; e.el.classList.toggle('old', old); } }
  }

  dispose() { for (const u of this.unsub) u(); this.el.remove(); }
}

function fmt(t) { t = Math.max(0, Math.floor(t || 0)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
function escape(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
