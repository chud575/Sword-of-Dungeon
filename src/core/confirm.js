// Undo-safe confirmation prompt ("Descend with the Sword?"). One prompt at a time; the game is
// paused through the app's modal bookkeeping while it is open. Keyboard: Enter / Space / Y accept,
// Esc / N stay, ←→ or Tab move the highlight; gamepad A/B map onto the same two answers.
import { el, esc, uiRoot, setModal } from './qolDom.js';

export class Confirm {
  /** @param {{bus:import('./events.js').EventBus, getGame:()=>any}} opts */
  constructor({ bus, getGame }) {
    this.bus = bus; this.getGame = getGame;
    this.root = null; this.current = null; this.sel = 0; this.modal = false;
    /** Log of decisions (tests / debugging): {kind, accepted, at}. */
    this.history = [];
  }

  get isOpen() { return !!this.current; }

  /**
   * Show a prompt. Resolves the returned promise with true (accepted) or false.
   * @param {{kind:string, title:string, text:string, clock?:string, danger?:boolean, eyebrow?:string, acceptLabel?:string, cancelLabel?:string, onAccept?:Function, onCancel?:Function}} spec
   */
  open(spec) {
    if (this.current) this.close(false);
    const host = uiRoot();
    if (!host) return Promise.resolve(false);
    const danger = spec.danger !== false;
    const root = el('div', `qol-prompt${danger ? ' danger' : ''}`, `
      <div class="box panel">
        <div class="sigil">${danger ? '!' : '✦'}</div>
        <div class="eyebrow">${esc(spec.eyebrow || 'A moment of doubt')}</div>
        <h1>${esc(spec.title || 'Are you sure?')}</h1>
        ${spec.clock ? `<div class="clock">${esc(spec.clock)}</div>` : ''}
        <p>${esc(spec.text || '')}</p>
        <div class="btns">
          <button class="cancel" data-i="0">${esc(spec.cancelLabel || 'Stay')}<kbd>Esc</kbd></button>
          <button class="accept primary" data-i="1">${esc(spec.acceptLabel || 'Go on')}<kbd>Enter</kbd></button>
        </div>
        <div class="foot">The game waits while you decide</div>
      </div>`);
    root.querySelector('.cancel').addEventListener('click', () => this.close(false));
    root.querySelector('.accept').addEventListener('click', () => this.close(true));
    root.addEventListener('pointerdown', (e) => { if (e.target === root) this.close(false); });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    host.appendChild(root);
    this.root = root; this.sel = 1; this.highlight();
    this.modal = setModal(true, 'confirm');
    const game = this.getGame();
    if (!this.modal && game && !game.over) { game.setPaused(true); this.pausedHere = true; }
    this.bus.emit('sfx:ui', { kind: 'open' });
    this.bus.emit('confirm:open', { kind: spec.kind });
    return new Promise((resolve) => { this.current = { spec, resolve }; });
  }

  highlight() {
    if (!this.root) return;
    this.root.querySelectorAll('.btns button').forEach((b) => b.classList.toggle('selected', Number(b.dataset.i) === this.sel));
  }

  /** Close with a decision (false when dismissed). */
  close(accepted) {
    const cur = this.current;
    if (!cur) return;
    this.current = null;
    if (this.root) { this.root.remove(); this.root = null; }
    if (this.modal) setModal(false, 'confirm');
    else if (this.pausedHere) { const g = this.getGame(); if (g && !g.over) g.setPaused(false); }
    this.modal = false; this.pausedHere = false;
    this.history.push({ kind: cur.spec.kind, accepted: !!accepted, at: Date.now() });
    this.bus.emit('sfx:ui', { kind: accepted ? 'click' : 'close' });
    this.bus.emit('confirm:closed', { kind: cur.spec.kind, accepted: !!accepted });
    if (accepted && cur.spec.onAccept) cur.spec.onAccept();
    if (!accepted && cur.spec.onCancel) cur.spec.onCancel();
    cur.resolve(!!accepted);
  }

  /** Keyboard handling while open. Returns true when the key was consumed. */
  handleKey(e) {
    if (!this.current) return false;
    const k = e.key;
    if (k === 'Enter' || k === ' ') { this.close(this.sel === 1); return true; }
    if (k === 'y' || k === 'Y') { this.close(true); return true; }
    if (k === 'Escape' || k === 'n' || k === 'N' || k === 'Backspace') { this.close(false); return true; }
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'Tab' || k === 'a' || k === 'd' || k === 'h' || k === 'l') { this.sel = this.sel ? 0 : 1; this.highlight(); return true; }
    return true; // swallow everything else: no movement leaks through a prompt
  }

  /** Gamepad: A accepts, B dismisses. */
  handlePad(button) {
    if (!this.current) return false;
    if (button === 0) this.close(true); else if (button === 1) this.close(false);
    return true;
  }
}
