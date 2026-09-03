// Small DOM helpers shared by the quality-of-life overlays (core/input.js and friends).

/** Overlay host: the UI root (pointer-events: none; children opt back in) or the body. */
export function uiRoot() {
  return (typeof document !== 'undefined' && (document.getElementById('ui-root') || document.body)) || null;
}

/** Create an element with a class list and inner HTML. */
export function el(tag, cls = '', html = '') {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** The main UI bundle (window.__game.ui) when the app has booted. */
export function uiBundle() { return (typeof globalThis !== 'undefined' && globalThis.__game && globalThis.__game.ui) || null; }

/** The app's shared modal bookkeeping (main.js setModal via a panel context), if reachable. */
function modalCtx() {
  const ui = uiBundle();
  const ctx = ui && ((ui.hud && ui.hud.ctx) || (ui.inventory && ui.inventory.ctx));
  return ctx && typeof ctx.setModal === 'function' ? ctx : null;
}

/**
 * Open/close a modal through the app's shared bookkeeping (pauses the game, disables game input,
 * stops auto-walk). Returns false when the app is not booted, so callers can fall back to a plain pause.
 */
export function setModal(open, who = 'qol') {
  const ctx = modalCtx();
  if (!ctx) return false;
  ctx.setModal(open, who);
  return true;
}

/** Is any other panel (menu, inventory, title) open? */
export function otherModalOpen() {
  const ui = uiBundle();
  if (!ui) return false;
  if (ui.menus && (ui.menus.isOpen || ui.menus.titleOpen)) return true;
  if (ui.inventory && ui.inventory.open) return true;
  const ctx = modalCtx();
  return !!(ctx && ctx.isModal && ctx.isModal());
}

export function fmtNum(n) { return Number(n || 0).toLocaleString('en-US'); }
