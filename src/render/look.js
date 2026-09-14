// THE LOOK SWITCH. The default (no URL param) is the board look chosen in the look lab: a neutral grey
// flagstone floor painted as clean stone (no per-texel noise, soft bevels) at 64 texels a tile, pale
// 2x2-block wall tops, darker wall faces, a soft shadow band at the wall foot, no cool lean in the
// shallow band, no film grain, and wall torches hung low with a short reach so they pool on the floor.
//
// `?look=0` restores the previous look (the per-room colour fields, the 32-texel speckled stone), for
// side-by-side comparison only. Read once at startup; build code consults the flags, never the URL.
const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('look') : null;
const legacy = q === '0';
export const LOOK = {
  legacy,
  base: !legacy,          // architecture and palette: grey floor, pale block caps, dark faces, foot band, no cool lean, grain 0, low torches
  clean: !legacy,         // the clean stone painter, at 64 texels a tile
  fieldLinear: false,     // 64-texel field sampled NEAREST on the shader's texel snap (true: linear, no snap)
};
