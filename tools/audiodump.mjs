// Audio dump: renders every procedural SFX and a 20 s adaptive-music showcase through an
// OfflineAudioContext inside the real page (so it exercises the shipped engine), then saves a
// waveform + log-frequency spectrogram PNG per sound to shots/audio/, a mix-balance chart, and a
// report (peak / RMS / crest / length) as JSON + console table.
// Usage: node tools/audiodump.mjs [--out shots/audio] [--only name] [--music-seconds 20] [--sr 44100] [--no-music]
import { startServer, launchBrowser, waitReady } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const outDir = args.out || 'shots/audio';
const only = args.only || null;
const musicSeconds = Number(args['music-seconds'] || 20);
const sampleRate = Number(args.sr || 44100);
const withMusic = !args['no-music'];

fs.mkdirSync(outDir, { recursive: true });
const server = await startServer();
const b = await launchBrowser({ width: 1280, height: 720 });
let code = 0;
try {
  await b.page.goto(server.url + '?debug=1&seed=42', { waitUntil: 'load' });
  // The audio module is self-contained, so a broken game page (someone mid-edit) must not block the dump.
  try { await waitReady(b.page, 15000); } catch { console.warn('game not ready (page errors?) — rendering the audio module standalone'); }

  // Everything below runs inside the page: build engine on an OfflineAudioContext, fire sounds, analyse, draw.
  // (Retried: a Vite full-reload from a concurrent file save would otherwise destroy the evaluation context.)
  let report;
  for (let attempt = 1; ; attempt++) {
    try { report = await renderAll(); break; } catch (e) {
      if (attempt >= 4 || !/context was destroyed|navigation/i.test(String(e))) throw e;
      console.warn(`page reloaded during render (attempt ${attempt}), retrying`);
      await b.page.goto(server.url + '?debug=1&seed=42', { waitUntil: 'load' });
      try { await waitReady(b.page, 15000); } catch { /* see above */ }
    }
  }
  async function renderAll() { return b.page.evaluate(async ({ only, musicSeconds, sampleRate, withMusic }) => {
    const mod = await import('/src/core/audio.js');
    const { AudioEngine } = mod;
    const { EventBus } = await import('/src/core/events.js');
    const { TILE } = await import('/src/core/constants.js');

    // ---------------------------------------------------------------- catalog
    /** @type {{name:string, seconds:number, run:(e:any, bus:any)=>void}[]} */
    let catalog;
    if (mod.CATALOG) catalog = mod.CATALOG.map((c) => ({ seconds: 2.5, ...c }));
    else {
      // legacy engine: drive it through its public methods / events
      const mk = (name, seconds, run) => ({ name, seconds, run });
      catalog = [
        mk('step-stone', 1, (e, bus) => { bus.emit('sfx:step', { tile: TILE.FLOOR }); }),
        mk('step-water', 1, (e, bus) => { bus.emit('sfx:step', { tile: TILE.WATER }); }),
        mk('hit-creature', 1.5, (e, bus) => bus.emit('sfx:hit', { family: 'creature', by: 'player' })),
        mk('hit-human', 1.5, (e, bus) => bus.emit('sfx:hit', { family: 'human', by: 'player' })),
        mk('hurt', 1.5, (e, bus) => bus.emit('sfx:hit', { family: 'creature', by: 'monster' })),
        mk('slain-creature', 2, (e, bus) => bus.emit('sfx:slain', { family: 'creature' })),
        mk('attacked', 2, (e, bus) => bus.emit('sfx:attacked', {})),
        mk('gold', 2, (e, bus) => bus.emit('item:picked', { item: { type: 'gold', gold: 120 } })),
        mk('potion', 2, (e, bus) => bus.emit('sfx:potion', {})),
        mk('spell-teleport', 2.5, (e, bus) => bus.emit('spell:cast', { spell: 'teleport' })),
        mk('stairs-down', 2.5, (e, bus) => bus.emit('sfx:stairs', { direction: 'down' })),
        mk('levelup', 4, (e, bus) => bus.emit('sfx:levelup', {})),
        mk('growl-creature', 2, (e, bus) => bus.emit('monster:noticed', { entity: { id: 1, type: 'ogre', family: 'creature', size: 1.3 } })),
        mk('growl-human', 2, (e, bus) => bus.emit('monster:noticed', { entity: { id: 2, type: 'barbarian', family: 'human', size: 1.1 } })),
        mk('trap-explosion', 2.5, (e, bus) => bus.emit('sfx:trap', { type: 'explosion' })),
        mk('sword-fanfare', 5, (e, bus) => bus.emit('sfx:sword', {})),
        mk('death-dirge', 5, (e, bus) => bus.emit('sfx:death', {})),
      ];
    }
    if (only) catalog = catalog.filter((c) => c.name === only || c.name.includes(only));

    // ---------------------------------------------------------------- engine factory
    function makeEngine(seconds, music = false) {
      const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
      const bus = new EventBus();
      let engine;
      if (mod.CATALOG) engine = new AudioEngine({ bus, ctx, music });
      else {
        const saved = window.AudioContext;
        window.AudioContext = function () { return ctx; };
        engine = new AudioEngine({ bus });
        engine.ensure(); engine.ensure = () => true; engine.ok = true;
        window.AudioContext = saved;
      }
      return { ctx, bus, engine };
    }

    // ---------------------------------------------------------------- analysis
    function analyse(buf) {
      const n = buf.length, ch = buf.numberOfChannels;
      let peak = 0, sum = 0, last = 0;
      for (let c = 0; c < ch; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < n; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; if (a > 0.001) last = Math.max(last, i); }
      }
      const rms = Math.sqrt(sum / (n * ch));
      const db = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -120);
      // "loudness-ish": RMS over the loudest 300 ms window
      const win = Math.floor(0.3 * buf.sampleRate); let best = 0; let acc = 0; const d0 = buf.getChannelData(0);
      for (let i = 0; i < n; i++) { acc += d0[i] * d0[i]; if (i >= win) acc -= d0[i - win] * d0[i - win]; if (i >= win - 1) best = Math.max(best, acc / win); }
      return { peakDb: +db(peak).toFixed(1), rmsDb: +db(rms).toFixed(1), loudDb: +db(Math.sqrt(best)).toFixed(1), crestDb: +(db(peak) - db(rms)).toFixed(1), lengthS: +(last / buf.sampleRate).toFixed(2), clipped: peak >= 0.999 };
    }

    // ---------------------------------------------------------------- FFT (radix-2, in-place)
    function fft(re, im) {
      const n = re.length;
      for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
        for (let i = 0; i < n; i += len) {
          let cr = 1, ci = 0;
          for (let j = 0; j < len / 2; j++) {
            const a = i + j, b = a + len / 2;
            const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
            re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
            const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
          }
        }
      }
    }

    // ---------------------------------------------------------------- drawing
    function colormap(v) { // 0..1 -> inferno-ish
      const stops = [[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]];
      const x = Math.max(0, Math.min(0.9999, v)) * (stops.length - 1), i = Math.floor(x), f = x - i;
      const a = stops[i], b = stops[i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
    function draw(name, buf, stats) {
      const W = 1200, WH = 190, SH = 340, TOP = 34, GAP = 26, LEFT = 56, BOTTOM = 26;
      const H = TOP + WH + GAP + SH + BOTTOM;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      g.fillStyle = '#0d0b10'; g.fillRect(0, 0, W, H);
      g.font = '15px monospace'; g.fillStyle = '#e8dcc0';
      g.fillText(`${name}   peak ${stats.peakDb} dBFS   rms ${stats.rmsDb}   loud(300ms) ${stats.loudDb}   crest ${stats.crestDb} dB   len ${stats.lengthS}s${stats.clipped ? '   CLIPPED' : ''}`, LEFT, 22);
      const n = buf.length, sr = buf.sampleRate, secs = n / sr;
      const PW = W - LEFT - 12;
      // waveform (L over R)
      const wy = TOP, mid = wy + WH / 2;
      g.fillStyle = '#17141d'; g.fillRect(LEFT, wy, PW, WH);
      g.strokeStyle = '#2a2533'; g.beginPath(); g.moveTo(LEFT, mid); g.lineTo(LEFT + PW, mid); g.stroke();
      const cols = [['#f2b544', 0.9], ['#5ab0e6', 0.55]];
      for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) {
        const d = buf.getChannelData(c);
        g.strokeStyle = cols[c][0]; g.globalAlpha = cols[c][1]; g.beginPath();
        for (let x = 0; x < PW; x++) {
          const i0 = Math.floor(x / PW * n), i1 = Math.max(i0 + 1, Math.floor((x + 1) / PW * n));
          let lo = 1, hi = -1;
          for (let i = i0; i < i1; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
          g.moveTo(LEFT + x + 0.5, mid - hi * (WH / 2 - 2)); g.lineTo(LEFT + x + 0.5, mid - lo * (WH / 2 - 2) + 0.01);
        }
        g.stroke(); g.globalAlpha = 1;
      }
      // dB guide lines at -6 / -12 / -24
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.fillStyle = 'rgba(255,255,255,0.45)'; g.font = '11px monospace';
      for (const db of [-6, -12, -24]) { const a = 10 ** (db / 20) * (WH / 2 - 2); for (const s of [-1, 1]) { g.beginPath(); g.moveTo(LEFT, mid - s * a); g.lineTo(LEFT + PW, mid - s * a); g.stroke(); } g.fillText(`${db}`, 22, mid - a + 4); }
      // spectrogram (log frequency 30 Hz .. 16 kHz)
      const sy = TOP + WH + GAP;
      const N = 2048, hop = Math.max(64, Math.floor(n / PW));
      const re = new Float32Array(N), im = new Float32Array(N), hann = new Float32Array(N);
      for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
      const mono = new Float32Array(n);
      for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels; }
      const fMin = 30, fMax = Math.min(16000, sr / 2), lmin = Math.log(fMin), lmax = Math.log(fMax);
      const img = g.createImageData(PW, SH);
      const px = img.data;
      const mags = new Float32Array(N / 2);
      for (let x = 0; x < PW; x++) {
        const start = Math.floor(x / PW * n);
        for (let i = 0; i < N; i++) { const s = start + i - N / 2; re[i] = (s >= 0 && s < n ? mono[s] : 0) * hann[i]; im[i] = 0; }
        fft(re, im);
        for (let k = 0; k < N / 2; k++) mags[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / (N / 4);
        for (let y = 0; y < SH; y++) {
          const fr = Math.exp(lmax - (y / SH) * (lmax - lmin)), fr2 = Math.exp(lmax - ((y + 1) / SH) * (lmax - lmin));
          const k0 = Math.max(0, Math.floor(fr2 / sr * N)), k1 = Math.min(N / 2 - 1, Math.max(k0, Math.ceil(fr / sr * N)));
          let m = 0; for (let k = k0; k <= k1; k++) if (mags[k] > m) m = mags[k];
          const db = m > 1e-7 ? 20 * Math.log10(m) : -140;
          const v = (db + 96) / 96;
          const [r, gg, bb] = colormap(v);
          const o = (y * PW + x) * 4; px[o] = r; px[o + 1] = gg; px[o + 2] = bb; px[o + 3] = 255;
        }
      }
      g.putImageData(img, LEFT, sy);
      // axes
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.strokeStyle = 'rgba(255,255,255,0.25)'; g.font = '11px monospace';
      for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
        if (f < fMin || f > fMax) continue;
        const y = sy + (lmax - Math.log(f)) / (lmax - lmin) * SH;
        g.beginPath(); g.moveTo(LEFT - 4, y); g.lineTo(LEFT, y); g.stroke();
        g.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, 14, y + 4);
      }
      const tickStep = secs > 8 ? 1 : secs > 3 ? 0.5 : 0.25;
      for (let t = 0; t <= secs + 1e-6; t += tickStep) {
        const x = LEFT + t / secs * PW;
        g.beginPath(); g.moveTo(x, sy + SH); g.lineTo(x, sy + SH + 5); g.stroke();
        g.fillText(`${t.toFixed(secs > 8 ? 0 : 2)}s`, x - 8, sy + SH + 18);
      }
      return cv.toDataURL('image/png');
    }

    // ---------------------------------------------------------------- run every SFX
    const results = [];
    for (const item of catalog) {
      const { ctx, bus, engine } = makeEngine(item.seconds);
      try { item.run(engine, bus); } catch (e) { results.push({ name: item.name, error: String(e && e.stack || e) }); continue; }
      const buf = await ctx.startRendering();
      const stats = analyse(buf);
      results.push({ name: item.name, ...stats, png: draw(item.name, buf, stats) });
    }
    // ---------------------------------------------------------------- music showcase
    if (withMusic && !only) {
      const { ctx, engine } = makeEngine(musicSeconds, true);
      let ok = false;
      try {
        if (engine.renderMusicShowcase) { engine.renderMusicShowcase(musicSeconds); ok = true; }
        else if (engine.ambient) { // legacy: drive the drone by hand
          engine.state.depth = 3; engine.updateAmbient(0.1);
          const A = engine.ambient, t = ctx.currentTime;
          A.out.gain.setValueAtTime(0.6, 0);
          A.cbOut.gain.setValueAtTime(0, 0); A.cbOut.gain.setTargetAtTime(0.32, 10, 0.5); A.cbOut.gain.setTargetAtTime(0, 16, 0.5);
          A.lp.frequency.setTargetAtTime(700, 10, 0.4); A.lp.frequency.setTargetAtTime(200, 16, 0.4);
          ok = true; void t;
        }
      } catch (e) { results.push({ name: 'music-showcase', error: String(e && e.stack || e) }); }
      if (ok) { const buf = await ctx.startRendering(); const stats = analyse(buf); results.push({ name: 'music-showcase', ...stats, png: draw('music-showcase (explore -> danger -> combat -> release)', buf, stats) }); }
    }
    // ---------------------------------------------------------------- mix balance chart
    const rows = results.filter((r) => !r.error);
    let chart = null;
    if (rows.length) {
      const W = 1200, RH = 16, H = 60 + rows.length * RH;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
      g.fillStyle = '#0d0b10'; g.fillRect(0, 0, W, H);
      g.font = '13px monospace'; g.fillStyle = '#e8dcc0'; g.fillText('Mix balance: peak (gold) and loudest-300ms RMS (blue) in dBFS per sound', 20, 22);
      const x0 = 260, x1 = W - 40, db2x = (db) => x0 + (Math.max(-60, db) + 60) / 60 * (x1 - x0);
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = '11px monospace';
      for (const d of [-60, -48, -36, -24, -18, -12, -6, 0]) { const x = db2x(d); g.beginPath(); g.moveTo(x, 40); g.lineTo(x, H - 10); g.stroke(); g.fillText(String(d), x - 8, 36); }
      rows.forEach((r, i) => {
        const y = 50 + i * RH;
        g.fillStyle = '#e8dcc0'; g.font = '12px monospace'; g.fillText(r.name, 20, y + 11);
        g.fillStyle = '#f2b544'; g.fillRect(x0, y + 2, db2x(r.peakDb) - x0, 5);
        g.fillStyle = '#5ab0e6'; g.fillRect(x0, y + 8, db2x(r.loudDb) - x0, 5);
      });
      chart = cv.toDataURL('image/png');
    }
    return { results, chart };
  }, { only, musicSeconds, sampleRate, withMusic }); }

  const table = [];
  for (const r of report.results) {
    if (r.error) { console.error(`ERROR ${r.name}: ${r.error}`); code = 1; continue; }
    fs.writeFileSync(path.join(outDir, `${r.name}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
    table.push({ name: r.name, peakDb: r.peakDb, rmsDb: r.rmsDb, loudDb: r.loudDb, crestDb: r.crestDb, lengthS: r.lengthS, clipped: r.clipped });
  }
  if (report.chart) fs.writeFileSync(path.join(outDir, '_mix-balance.png'), Buffer.from(report.chart.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(outDir, '_report.json'), JSON.stringify(table, null, 2));
  console.table(table);
  console.log(`wrote ${table.length} images to ${outDir}/`);
  if (b.errors.length) { console.error('PAGE ERRORS:\n' + b.errors.join('\n')); code = code || 1; }
} catch (e) { console.error(e); code = 1; }
finally { await b.close(); server.stop(); }
process.exit(code);
