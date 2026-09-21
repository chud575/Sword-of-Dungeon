// Which art draws the props, in one place. Every builder asks here instead of parsing the URL itself
// (`?props=kit` lived in freeport.js, `?props=supplied` in supplied.js, and nothing knew about the rest).
//
//   default     the owner's Freeport models, then the kit's solid pieces, then the painted billboards
//   kit         the kit's solid pieces instead of the Freeport models
//   supplied    ONLY the owner's Top-Down packs; a type they cannot cover draws nothing
//   sheet       the owner's own sprite sheet (props/props2d.js) for the FURNITURE and the big
//               silhouettes, with every type it does not name left on its solid piece — the owner keeps
//               the 3D floor clutter, which reads well as the perspective shifts past it
//   flat        NO 3D AT ALL (2026-09-20, owner: "wipe out all the 3d assets and see how some 2d assets
//               look... less realism and more pragmatism so that the user can identify what they are
//               looking at"). Every standing prop, decal and wall piece is the painted 2D art, drawn on a
//               quad facing the camera — which is what the near-plan camera at tilt 0 wants: a board seen
//               from above with its pieces drawn face-on, the way a sprite sheet draws them.
let MODE = (() => {
  try {
    const v = new URLSearchParams(location.search).get('props');
    return ['kit', 'supplied', 'flat', 'sheet'].includes(v) ? v : 'default';
  } catch { return 'default'; }
})();

export function propsMode() { return MODE; }
/**
 * Switch the mode at runtime. For the PLATES ONLY (debug/scenarios.js): the URL is how a player picks a
 * mode, but a scenario has to be able to set one, or `npm run smoke` — which runs every scenario on one
 * page with no query of its own — never builds a supplied or a sheet prop at all. It did not, and a
 * missing table in props2d.js broke `?props=sheet` outright with every gate still green.
 */
export function setPropsMode(m) { MODE = ['kit', 'supplied', 'flat', 'sheet'].includes(m) ? m : 'default'; }
/** True when no mesh may be built: the flat 2D test. */
export function flatProps() { return MODE === 'flat'; }
/** True when the owner's sprite sheet stands in for the furniture. */
export function sheetProps() { return MODE === 'sheet'; }
