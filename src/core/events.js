// Tiny synchronous event bus. Listeners on '*' receive (name, payload); listeners on a prefix
// pattern such as 'fx:*' receive (payload, name) for every event whose name starts with 'fx:'.

export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
    this.debugLog = null; // set to an array to record every emitted event {name, payload}
  }

  /**
   * Subscribe. Returns an unsubscribe function.
   * @param {string} name
   * @param {Function} fn
   */
  on(name, fn) {
    let set = this.listeners.get(name);
    if (!set) { set = new Set(); this.listeners.set(name, set); }
    set.add(fn);
    return () => this.off(name, fn);
  }

  /** Subscribe for a single emission. */
  once(name, fn) {
    const off = this.on(name, (payload, n) => { off(); fn(payload, n); });
    return off;
  }

  off(name, fn) {
    const set = this.listeners.get(name);
    if (set) { set.delete(fn); if (!set.size) this.listeners.delete(name); }
  }

  /** Emit an event synchronously to exact, prefix ('x:*') and wildcard ('*') listeners. */
  emit(name, payload) {
    if (this.debugLog) this.debugLog.push({ name, payload });
    const exact = this.listeners.get(name);
    if (exact) for (const fn of [...exact]) fn(payload, name);
    const colon = name.indexOf(':');
    if (colon > 0) {
      const pref = this.listeners.get(name.slice(0, colon + 1) + '*');
      if (pref) for (const fn of [...pref]) fn(payload, name);
    }
    const all = this.listeners.get('*');
    if (all) for (const fn of [...all]) fn(name, payload);
  }

  /** Remove every listener. */
  clear() { this.listeners.clear(); }
}

/** Global bus shared by game, renderer, UI and audio. */
export const bus = new EventBus();
