// Frame-time probe: loads a scenario (default 'deep-level'), then times debug.step(16) over N frames
// in-page (performance.now) and breaks the cost down into simulation, render-side update and the
// GPU draw. SwiftShader numbers are ~10-30x a real GPU, so compare runs, not absolutes.
// Usage: node tools/perf.mjs [--scenario deep-level] [--frames 120] [--seed 42] [--w 1600] [--h 900] [--quality high|low]
import { startServer, launchBrowser, waitReady } from './browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const scenario = args.scenario || 'deep-level';
const frames = Number(args.frames || 120);
const seed = Number(args.seed || 42);
const W = Number(args.w || 1600), H = Number(args.h || 900);
const quality = args.quality || 'high';

const server = await startServer();
const b = await launchBrowser({ width: W, height: H });
let code = 0;
try {
  await b.page.goto(server.url + `?debug=1&seed=${seed}&quality=${quality}`, { waitUntil: 'load' });
  await waitReady(b.page);
  const ok = await b.page.evaluate((n) => window.__game.debug.runScenario(n, {}), scenario);
  if (!ok) throw new Error('unknown scenario ' + scenario);
  const r = await b.page.evaluate((frames) => {
    const G = window.__game, d = G.debug, g = G.game, R = G.renderer;
    const gl = R.gl.getContext(), px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // readback forces the GPU (or SwiftShader) to finish the frame
    for (let i = 0; i < 20; i++) { d.step(16); sync(); } // warm-up (shader compiles, pools)
    const t = { sim: 0, update: 0, draw: 0, total: 0 };
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      const a = performance.now();
      g.update(0.016);
      const b1 = performance.now();
      R.step(0.016); G.ui.update(0.016);
      const c = performance.now();
      R.draw(); sync();
      const e = performance.now();
      t.sim += b1 - a; t.update += c - b1; t.draw += e - c;
    }
    t.total = performance.now() - t0;
    const st = d.stats();
    return { ...t, calls: st.calls, triangles: st.triangles, views: st.views, particles: st.particles, mem: { ...R.gl.info.memory }, programs: R.gl.info.programs.length, entities: g.level.entities.length };
  }, frames);
  const per = (v) => (v / frames).toFixed(2);
  console.log(`${scenario} @ ${W}x${H} ${quality}: ${per(r.total)} ms/frame over ${frames} frames (sim ${per(r.sim)}, update ${per(r.update)}, draw ${per(r.draw)})`);
  console.log(`draw calls ${r.calls}, triangles ${r.triangles}, character views ${r.views}, entities ${r.entities}, particles ${r.particles}, geometries ${r.mem.geometries}, textures ${r.mem.textures}, programs ${r.programs}`);
  if (b.errors.length) { console.error('page errors:\n  ' + b.errors.join('\n  ')); code = 1; }
} catch (e) { console.error(e); code = 1; }
finally { await b.close(); server.stop(); }
process.exit(code);
