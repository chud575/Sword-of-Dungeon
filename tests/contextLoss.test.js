// contextLoss: a lost WebGL context must come back once, and must NOT become a storm.
//
// In Safari 26 the context was lost and three.js asked for it back about a thousand times a second:
// every restore re-uploaded the whole scene into a GPU process that could not take it, which lost it
// again. The game went black under a working HUD with nothing in the console, and WebGL broke for every
// other page in the browser until Safari was restarted. Headless Chromium cannot reproduce Safari's GPU
// process, but WEBGL_lose_context fires the same events, and the events are what Renderer's guard
// answers to (render/renderer.js onContextLost).
//
// The first gate is one this project did not have at all: every other browser tool drives frames
// through debug.step(), so nothing would notice if the requestAnimationFrame loop stopped drawing.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, launchBrowser, waitReady } from '../tools/browser.mjs';

let server, b;
before(async () => { server = await startServer(); b = await launchBrowser({ width: 960, height: 540 }); }, { timeout: 120000 });
after(async () => { await b?.close(); server?.stop(); });

/** Fraction of the drawing buffer that is not black. preserveDrawingBuffer is on, so this reads the last frame. */
function litFraction() {
  const gl = window.__game.renderer.gl.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  let n = 0;
  for (let i = 0; i < w * h; i++) if (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2] > 24) n++;
  return n / Math.max(1, w * h);
}

test('the game\'s own requestAnimationFrame loop keeps drawing a lit frame, with no debug stepping', { timeout: 180000 }, async () => {
  await b.page.goto(server.url, { waitUntil: 'load' });   // no ?debug: the title screen, as a player opens it
  await waitReady(b.page);
  const f0 = await b.page.evaluate(() => window.__game.renderer.frame);
  await b.page.waitForFunction((f) => window.__game.renderer.frame >= f + 3, f0, { timeout: 90000 });
  const lit = await b.page.evaluate(litFraction);
  assert.ok(lit > 0.5, `the loop is running but only ${(lit * 100).toFixed(1)}% of its frame is non-black`);
});

test('one lost context is restored, and the frame comes back lit', { timeout: 180000 }, async () => {
  await b.page.goto(server.url + '?debug=1&seed=42', { waitUntil: 'load' });
  await waitReady(b.page);
  const r = await b.page.evaluate(async () => {
    const R = window.__game.renderer, gl = R.gl.getContext(), ext = gl.getExtension('WEBGL_lose_context');
    const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
    const events = [];
    window.__game.bus.on('render:context', (p) => events.push(p.state));
    ext.loseContext(); await sleep(250);
    const whileLost = R.contextState;
    ext.restoreContext(); await sleep(500);
    for (let i = 0; i < 4; i++) R.render(1 / 60);
    return { events, whileLost, after: R.contextState, stillLost: gl.isContextLost() };
  });
  assert.equal(r.whileLost, 'lost');
  assert.equal(r.after, 'ok');
  assert.equal(r.stillLost, false, 'the browser did not restore the context — three.js never asked for it back');
  assert.deepEqual(r.events, ['lost', 'restored']);
  const lit = await b.page.evaluate(litFraction);
  assert.ok(lit > 0.5, `after the restore only ${(lit * 100).toFixed(1)}% of the frame is non-black`);
});

test('a burst of losses trips the guard: no further restore, no drawing, and a reload notice', { timeout: 180000 }, async () => {
  await b.page.goto(server.url + '?debug=1&seed=42', { waitUntil: 'load' });
  await waitReady(b.page);
  const errorsBefore = b.errors.length;
  const r = await b.page.evaluate(async () => {
    const R = window.__game.renderer, gl = R.gl.getContext(), ext = gl.getExtension('WEBGL_lose_context');
    const sleep = (ms) => new Promise((s) => setTimeout(s, ms));
    const events = [];
    window.__game.bus.on('render:context', (p) => events.push(p.state));
    let losses = 0;
    for (let i = 0; i < 8 && R.contextState !== 'dead'; i++) {
      ext.loseContext(); losses++; await sleep(200);
      if (R.contextState === 'dead') break;
      ext.restoreContext(); await sleep(350);
    }
    // the guard stopped three from calling preventDefault, so the browser must refuse to restore now
    ext.restoreContext(); await sleep(500);
    const frameBefore = R.frame;
    R.draw(); R.draw();
    const notice = [...document.querySelectorAll('.modal')].map((m) => m.textContent).find((t) => /Graphics reset/.test(t)) || null;
    return { losses, events, state: R.contextState, stillLost: gl.isContextLost(), drewWhileDead: R.frame !== frameBefore, notice: !!notice, reloadButton: /Reload/.test(notice || '') };
  });
  assert.equal(r.state, 'dead', `the guard never tripped after ${r.losses} losses (events: ${r.events.join(', ')})`);
  assert.equal(r.losses, 4, 'three losses inside a minute are allowed to recover; the fourth trips the guard');
  assert.deepEqual(r.events, ['lost', 'restored', 'lost', 'restored', 'lost', 'restored', 'dead']);
  assert.equal(r.stillLost, true, 'the browser restored a context the guard had given up on');
  assert.equal(r.drewWhileDead, false, 'draw() kept running on a dead context');
  assert.ok(r.notice && r.reloadButton, 'no "Graphics reset" notice with a Reload button was shown');
  assert.deepEqual(b.errors.slice(errorsBefore), [], 'the burst produced page errors');
});
