// Browser lifecycle glue for save/continue reliability and focus safety:
//   - the tab going hidden pauses the game (like a blur) and writes a save,
//   - pagehide / beforeunload write a save (reload, back button, closed tab),
//   - a background autosave runs every `autosaveInterval` seconds of unpaused play,
//   - pausing from the menu saves too, and F5 / the 'save' action saves on demand.
// Automatic saves are skipped in ?debug=1 sessions (screenshot / QA tools must not write
// localStorage); explicit saves still work there.
import { saveGame } from './save.js';

export class Lifecycle {
  /** @param {{bus:import('./events.js').EventBus, getGame:()=>any, getSettings:()=>object, debugMode?:boolean, onSaved?:(info:{reason:string, ok:boolean})=>void}} opts */
  constructor({ bus, getGame, getSettings, debugMode = false, onSaved = null }) {
    this.bus = bus; this.getGame = getGame; this.getSettings = getSettings; this.debugMode = debugMode; this.onSaved = onSaved;
    this.playClock = 0; this.lastSave = { reason: '', at: 0, ok: null };
    this.saves = 0;
    this.onVisibility = () => { if (typeof document !== 'undefined' && document.hidden) this.hidden(); };
    this.onPageHide = () => this.autoSave('pagehide');
    this.onBeforeUnload = () => this.autoSave('unload');
    this.unsub = [
      bus.on('game:paused', (p) => { if (p.paused) this.autoSave('pause'); }),
      bus.on('game:start', () => { this.playClock = 0; }),
    ];
    if (typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
      window.addEventListener('pagehide', this.onPageHide);
      window.addEventListener('beforeunload', this.onBeforeUnload);
    }
  }

  detach() {
    for (const u of this.unsub) u(); this.unsub = [];
    if (typeof window === 'undefined') return;
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.onPageHide);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
  }

  /** The tab was hidden: pause (the sword timer stops with it) and save. */
  hidden() {
    const g = this.getGame();
    if (!g || g.over || this.debugMode) return;
    g.setPaused(true);
    this.autoSave('hidden');
  }

  /** Called once per frame with unpaused-play seconds; drives the periodic autosave. */
  update(dt) {
    const g = this.getGame();
    if (!g || g.over || g.paused || this.debugMode) return;
    const every = Number(this.getSettings().autosaveInterval) || 0;
    if (every <= 0) return;
    this.playClock += dt;
    if (this.playClock >= every) { this.playClock = 0; this.autoSave('periodic'); }
  }

  /** Automatic save (skipped in debug sessions). */
  autoSave(reason) {
    if (this.debugMode) return false;
    return this.saveNow(reason, { quiet: true });
  }

  /** Save right now. Returns true when written. */
  saveNow(reason = 'manual', { quiet = false } = {}) {
    const g = this.getGame();
    if (!g || g.over) return false;
    const ok = saveGame(g, { reason });
    this.lastSave = { reason, at: Date.now(), ok };
    if (ok) this.saves++;
    if (this.onSaved) this.onSaved({ reason, ok, quiet });
    return ok;
  }
}
