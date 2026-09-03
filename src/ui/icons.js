// Procedural inline-SVG icon set for the HUD / log (no external assets). Every glyph is a 24x24
// line drawing in `currentColor` with a translucent body fill, so it tints from CSS (`color:`).
// Usage: el.innerHTML = icon('shield') — returns a trusted static SVG string.

const S = (body, extra = '') => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;
const F = 'fill="currentColor" fill-opacity=".18"';

const ICONS = {
  // --- spells
  teleport: S(`<circle cx="12" cy="12" r="9" stroke-dasharray="3.2 2.6" opacity=".7"/><path d="M12 12c-1.2-2.2.6-4.4 2.6-3.6 2.6 1 2.4 4.6-.2 5.9-3.2 1.6-6.9-1-6.4-4.7.5-4.4 5.7-6.4 9-3.8" ${F}/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>`),
  shield: S(`<path d="M12 2.5 19.5 5.2v6.2c0 4.7-3.2 8.2-7.5 10.1C7.7 19.6 4.5 16.1 4.5 11.4V5.2Z" ${F}/><path d="M12 6v11.6M8.2 9.5h7.6" opacity=".8"/>`),
  regeneration: S(`<path d="M12 20.5 5.3 13.9C3 11.7 3.2 8.2 5.6 6.4c2.1-1.6 4.9-1.2 6.4.9 1.5-2.1 4.3-2.5 6.4-.9 2.4 1.8 2.6 5.3.3 7.5Z" ${F}/><path d="M12 9.6v6M9 12.6h6" stroke-width="1.9"/>`),
  invisibility: S(`<path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" ${F}/><circle cx="12" cy="12" r="2.6"/><path d="M4.5 19.5 19.5 4.5" stroke-width="1.9"/>`),
  light: S(`<circle cx="12" cy="12" r="3.8" ${F}/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>`),
  drift: S(`<path d="M20.5 3.5c-6.5.5-11.7 4.3-13.9 9.6-.7 1.8-.9 3.5-.6 5.1 6-.3 11.2-3.8 13.4-9.2.7-1.8 1-3.7 1.1-5.5Z" ${F}/><path d="M3.5 20.5 15 9M8.3 12.4l1.2 3.8M11.6 9.4l1.3 3.7"/>`),
  // --- items & actions
  potion: S(`<path d="M9.5 3h5M10.5 3v4.2L5.9 14.6A4.5 4.5 0 0 0 9.8 21h4.4a4.5 4.5 0 0 0 3.9-6.4L13.5 7.2V3" ${F}/><path d="M7.3 14.5h9.4" opacity=".9"/><path d="M8 17.5c1.2 1 3 1.4 4.6.5" opacity=".6"/>`),
  beacon: S(`<path d="M12 2.5 15.5 9 12 15.5 8.5 9Z" ${F}/><path d="M12 15.5v6M8.5 21.5h7M4 9h2M18 9h2M6 4.5l1.4 1.4M18 4.5l-1.4 1.4" opacity=".8"/>`),
  lamp: S(`<path d="M9 3.5h6M12 3.5v2.5M8 6h8l1.2 3H6.8Z" ${F}/><path d="M7.5 9h9v7.2c0 1.6-1.2 2.8-2.8 2.8H10.3c-1.6 0-2.8-1.2-2.8-2.8Z" ${F}/><path d="M12 11.5c-1.2 1.6-1.4 3.2 0 4.6 1.4-1.4 1.2-3 0-4.6Z" fill="currentColor" stroke="none" opacity=".8"/><path d="M9.5 21.5h5"/>`),
  bury: S(`<path d="M13.5 3.5 20.5 10.5M17 7 8.4 15.6" stroke-width="1.9"/><path d="M8.4 15.6 5 13.5l-1.5 3.8 3.2 3.2 3.8-1.5Z" ${F}/><path d="M15 2.5h4.5V7" opacity=".7"/>`),
  wait: S(`<path d="M14.5 3.2A8.8 8.8 0 1 0 20.8 12a7 7 0 0 1-6.3-8.8Z" ${F}/><path d="M17 4.5l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6Z" fill="currentColor" stroke="none" opacity=".9"/>`),
  // --- status / stats
  sword: S(`<path d="M5 19 16.5 7.5M14 5l5 5" stroke-width="1.9"/><path d="M13.5 4.5 19.5 3l-1.5 6Z" ${F}/><path d="M7.5 16.5 4 20M6 14.5l3.5 3.5M3.2 20.8l1.6-1.6" stroke-width="1.9"/>`),
  enchant: S(`<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6Z" ${F}/><path d="M5 16l.8 2.2L8 19l-2.2.8L5 22l-.8-2.2L2 19l2.2-.8ZM19 15l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6Z" fill="currentColor" stroke="none" opacity=".85"/>`),
  maps: S(`<path d="M4 6.5c1.5-1 3.5-1 5 0s3.5 1 5 0 3.5-1 5 0v11c-1.5-1-3.5-1-5 0s-3.5 1-5 0-3.5-1-5 0Z" ${F}/><path d="M9 6.8v11M14 6.8v11" opacity=".6"/><path d="M6.5 11.5l3-1.5 2 2 3-2.5" opacity=".8"/>`),
  temple: S(`<path d="M4.5 21.5h15M6 21.5v-8M18 21.5v-8M4 13.5c2-6 6-9 8-9s6 3 8 9Z" ${F}/><path d="M12 11.5c-1.4 1.8-1.5 3.6 0 5 1.5-1.4 1.4-3.2 0-5Z" fill="currentColor" stroke="none" opacity=".9"/>`),
  coin: S(`<circle cx="12" cy="12" r="8.5" ${F}/><circle cx="12" cy="12" r="5.6" opacity=".7"/><path d="M12 8.6l1 2.2 2.4.3-1.8 1.6.5 2.4-2.1-1.2-2.1 1.2.5-2.4-1.8-1.6 2.4-.3Z" fill="currentColor" stroke="none" opacity=".9"/>`),
  skill: S(`<path d="M4 4l11 11M20 4 9 15" stroke-width="1.8"/><path d="M4 4h3.5v3.5M20 4h-3.5v3.5" opacity=".8"/><path d="M6.5 17.5 4 20M17.5 17.5 20 20M5 15.5l3.5 3.5M19 15.5l-3.5 3.5" stroke-width="1.8"/>`),
  skull: S(`<path d="M12 3a7 7 0 0 0-7 7c0 2.5 1.2 4.4 3 5.6V19h8v-3.4c1.8-1.2 3-3.1 3-5.6a7 7 0 0 0-7-7Z" ${F}/><circle cx="9.3" cy="10.5" r="1.6" fill="currentColor" stroke="none"/><circle cx="14.7" cy="10.5" r="1.6" fill="currentColor" stroke="none"/><path d="M10 19v2.5M14 19v2.5M12 13.5l-1 1.8h2Z" opacity=".9"/>`),
  stairs: S(`<path d="M3 20h4v-4h4v-4h4V8h4V4" ${F}/><path d="M3 20h18" opacity=".6"/>`),
  hourglass: S(`<path d="M6.5 3h11M6.5 21h11M8 3v3.2c0 2.2 1.6 3.6 3 5.8-1.4 2.2-3 3.6-3 5.8V21M16 3v3.2c0 2.2-1.6 3.6-3 5.8 1.4 2.2 3 3.6 3 5.8V21" ${F}/><path d="M9.5 18.5h5l-2.5-3.4Z" fill="currentColor" stroke="none" opacity=".9"/>`),
  alert: S(`<path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" ${F}/><path d="M12 7.5v5.5" stroke-width="2"/><circle cx="12" cy="16.5" r="1.1" fill="currentColor" stroke="none"/>`),
  star: S(`<path d="M12 2.8l2.6 6 6.4.6-4.9 4.3 1.5 6.3L12 16.7 6.4 20l1.5-6.3L3 9.4l6.4-.6Z" ${F}/>`),
  heart: S(`<path d="M12 20.5 5.3 13.9C3 11.7 3.2 8.2 5.6 6.4c2.1-1.6 4.9-1.2 6.4.9 1.5-2.1 4.3-2.5 6.4-.9 2.4 1.8 2.6 5.3.3 7.5Z" ${F}/>`),
  pin: S(`<path d="M9 3h6l-1 6 3.5 3.5v1.5h-4V21l-1.5 1.5L10.5 21v-7H6.5v-1.5L10 9Z" ${F}/>`),
};

/**
 * @param {string} name icon id (see ICONS)
 * @returns {string} inline SVG markup (static, safe to inject)
 */
export function icon(name) { return ICONS[name] || ICONS.star; }
export const ICON_NAMES = Object.keys(ICONS);
