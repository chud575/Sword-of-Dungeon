// THE MOBILE RUNTIME PROFILE. Decided once, at import, and never re-evaluated: a phone does not stop
// being a phone, and a profile that flipped mid-run would rebuild the floor field at a new density.
//
// Mobile means any of:
//   - the Capacitor iOS shell (window.Capacitor.isNativePlatform()),
//   - iOS / iPadOS Safari, including iPadOS reporting itself as "Macintosh" with touch points,
//   - a touch screen whose primary pointer is coarse.
// Overrides, for testing the profile on a desktop browser: `?mobile=1` / `?mobile=0`, and a build-time
// `VITE_MOBILE=on|off` (used to A/B the native app's memory with and without the profile).
//
// What the profile changes (main.js, renderer.js, touch.js, lifecycle.js, ui/phone.css and the phone blocks of vellum.css / module.css under body.mobile):
//   quality 'low' unless ?quality= is given, touch controls on, a 32-texel floor field instead of 64,
//   half-resolution bloom, the compact phone HUD, and no page zoom / scroll / selection / callout.
// Desktop is untouched: every one of those is gated on MOBILE.mobile.

function detect() {
  const out = { mobile: false, native: false, ios: false, reason: 'desktop' };
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return out;
  let forced = null;
  try {
    const q = new URLSearchParams(location.search).get('mobile');
    if (q === '1' || q === 'on') forced = true;
    else if (q === '0' || q === 'off') forced = false;
  } catch { /* ignore */ }
  try {
    const env = import.meta.env && import.meta.env.VITE_MOBILE;
    if (forced === null && env === 'on') forced = true;
    else if (forced === null && env === 'off') forced = false;
  } catch { /* ignore */ }

  try { out.native = !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()); } catch { /* ignore */ }
  const ua = navigator.userAgent || '';
  const touchPoints = navigator.maxTouchPoints || 0;
  out.ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);
  let coarse = false;
  try { coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; } catch { /* ignore */ }

  if (forced !== null) { out.mobile = forced; out.reason = forced ? 'forced' : 'forced-off'; }
  else if (out.native) { out.mobile = true; out.reason = 'capacitor'; }
  else if (out.ios) { out.mobile = true; out.reason = 'ios'; }
  else if (touchPoints > 0 && coarse) { out.mobile = true; out.reason = 'coarse-touch'; }
  return out;
}

/** @type {{mobile:boolean, native:boolean, ios:boolean, reason:string}} */
export const MOBILE = detect();

/** Floor-field texels per tile on this device: 64 is the desktop look, 32 a quarter of the memory. */
export const MOBILE_FIELD_TEXELS = 32;
/** Bloom render-target scale on this device (1 = the desktop resolution). */
export const MOBILE_BLOOM_SCALE = 0.5;

/** A standalone home-screen launch (iOS `navigator.standalone`, or display-mode fullscreen/standalone). */
export function isStandalone() {
  try {
    if (navigator.standalone) return true;
    return typeof matchMedia === 'function' && (matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches);
  } catch { return false; }
}
