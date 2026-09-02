// Directed integration flows through the real UI (keys, clicks) plus the debug API for setup:
// stairs transition, pits, sword timer + victory + defeat screens, save & continue, window resize,
// fog of war after stairs, input while menus are open, audio without a user gesture, monster pathing
// through corridors and renderer resource churn across level changes. Each flow is a named check;
// the exit code is non-zero if any check fails or the page logs an error.
// Usage: node tools/flows.mjs [--seed 7] [--only name]
import { startServer, launchBrowser, waitReady } from './browser.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const seed = Number(args.seed || 7);
const server = await startServer();
const b = await launchBrowser({ width: 1280, height: 720 });
const page = b.page;
const results = [];
const ev = (fn, arg) => page.evaluate(fn, arg);
const step = (ms) => ev((ms) => window.__game.debug.step(ms), ms);
const snap = () => ev(() => { const g = window.__game.game, p = g.player; return { depth: g.depth, x: p.x, y: p.y, hp: p.hp, over: g.over, paused: g.paused, elapsed: g.state.elapsed, tile: g.level.get(p.x, p.y), modal: window.__game.ui.menus.top ? window.__game.ui.menus.top.name : (window.__game.ui.inventory.open ? 'inventory' : null), exploring: window.__game.ui.hud.exploreBtn.classList.contains('on'), transition: !!window.__game.renderer.cameraRig.transition, inputEnabled: window.__game.debug.input.enabled, lastLog: g.state.log.length ? g.state.log[g.state.log.length - 1].text : '' }; });
/** Start a fresh, unfrozen game through the title screen (real clicks), loop stopped so debug.step drives time. */
async function fresh(s = seed) {
  await ev(() => { window.__game.debug.resume(); window.__game.ui.settings.autoPauseOnSight = false; window.__game.ui.app.toTitle(); });
  await page.click('#title button.menu-item:has-text("New Game")');
  await page.fill('#ng-seed', String(s));
  await page.click('#ng-start');
  await page.waitForFunction(() => !document.getElementById('title') && !window.__game.ui.menus.isOpen);
  await ev(() => window.__game.debug.setLoop(false));
  await step(100);
}
const flows = {
  async 'stairs-transition'() {
    await fresh();
    await ev(() => { const g = window.__game.game; const sd = g.level.stairsDown; g.teleportTo(sd.x, sd.y); for (const m of g.level.monsters) m.speed = 0; });
    await page.keyboard.press(' ');
    let s = await snap();
    expect(s.transition && !s.inputEnabled, 'transition starts and input is disabled');
    await page.keyboard.down('w'); await step(300); await page.keyboard.up('w');
    s = await snap();
    expect(s.depth === 1 && s.tile === 3, `player stays on the stairs during the dive (depth ${s.depth}, tile ${s.tile})`);
    await step(800);
    s = await snap();
    expect(s.depth === 2 && !s.transition && s.inputEnabled, `arrived on depth 2 with input back (depth ${s.depth}, transition ${s.transition}, input ${s.inputEnabled})`);
    expect(s.tile === 4, 'arrived on the up staircase');
    // stairs up from depth 2 with a real click on the player
    const c = await ev(() => { const r = window.__game.renderer, g = window.__game.game; r.camera.updateMatrixWorld(); const v = new (r.camera.position.constructor)(g.player.x, 0, g.player.y).project(r.camera); const rc = r.canvas.getBoundingClientRect(); return { x: rc.left + (v.x + 1) / 2 * rc.width, y: rc.top + (1 - v.y) / 2 * rc.height }; });
    await page.mouse.click(c.x, c.y);
    await step(1200);
    s = await snap();
    expect(s.depth === 1, `clicked yourself on the up stairs: back on depth 1 (depth ${s.depth})`);
  },
  async 'fog-after-stairs'() {
    await fresh();
    await ev(() => { const g = window.__game.game; g.teleportTo(g.level.stairsDown.x, g.level.stairsDown.y); });
    await page.keyboard.press(' ');
    await step(1500);
    const r = await ev(() => { const G = window.__game, g = G.game, lv = g.level, f = G.renderer.fog; let mism = 0, exp = 0; for (let i = 0; i < lv.tiles.length; i++) { const te = lv.explored[i] ? 1 : 0, tv = lv.visible[i] ? 1 : 0; if (te) exp++; if (Math.abs(f.explored[i] - te) > 0.05 || Math.abs(f.visible[i] - tv) > 0.05) mism++; } return { mism, exp, depth: g.depth, w: f.width, h: f.height, lw: lv.width, lh: lv.height, allLit: f.override }; });
    expect(r.depth === 2 && r.mism === 0 && r.exp > 0 && r.exp < r.lw * r.lh * 0.5, `fog texture matches the new level's masks (${r.mism} mismatches, ${r.exp} explored, override ${r.allLit})`);
    expect(r.w === r.lw && r.h === r.lh, 'fog texture sized to the level');
  },
  async 'pit'() {
    await fresh();
    const r = await ev(() => { const g = window.__game.game, p = g.player, lv = g.level; const TILE = { PIT: 5 }; let spot = null; for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const t = lv.get(p.x + d[0], p.y + d[1]); if (t === 1 || t === 2) { spot = d; break; } } if (!spot) return null; lv.set(p.x + spot[0], p.y + spot[1], TILE.PIT); window.__game.renderer.rebuildLevel(); for (const m of lv.monsters) m.speed = 0; g.give('potion', 3); return spot; });
    expect(!!r, 'found a floor tile next to the player for a pit');
    if (!r) return;
    await page.keyboard.press(r[0] > 0 ? 'd' : r[0] < 0 ? 'a' : r[1] > 0 ? 's' : 'w');
    await step(1500);
    const s = await snap();
    expect(s.depth >= 3 && s.depth <= 6, `fell/climbed 2-5 levels (depth ${s.depth}, ${s.lastLog})`);
    const cl = await ev(() => { const g = window.__game.game; return { climb: !!g.level.climbableAt(g.player.x, g.player.y), marker: window.__game.renderer.dungeon.climbViews.length, hp: g.player.hp, over: g.over }; });
    expect(cl.climb && cl.marker === 1, `climbable marker placed on arrival (climbable ${cl.climb}, views ${cl.marker})`);
    expect(!cl.over, `survived the fall (hp ${cl.hp})`);
    await page.keyboard.press(' ');
    await step(1500);
    const s2 = await snap();
    expect(s2.depth === 1, `climbed back up to depth 1 via the pit (depth ${s2.depth})`);
  },
  async 'sword-victory'() {
    await fresh();
    await ev(() => { const g = window.__game.game; g.give('sword'); g.teleportTo(g.level.stairsUp.x, g.level.stairsUp.y); for (const m of g.level.monsters) m.speed = 0; });
    await step(50);
    let s = await ev(() => ({ timer: window.__game.game.state.quest.timer, hud: document.querySelector('#hud-depth').classList.contains('sword'), t: document.querySelector('#hud-depth .timer .t').textContent }));
    expect(s.timer > 1999.9 && s.timer <= 2000 && s.hud && /^33:(19|20)$/.test(s.t), `timer started at 2000 and the HUD shows it (${s.timer.toFixed(2)}, HUD ${s.t})`);
    await step(3000);
    s = await ev(() => ({ timer: window.__game.game.state.quest.timer, t: document.querySelector('#hud-depth .timer .t').textContent }));
    expect(Math.abs(s.timer - 1996.95) < 0.15 && s.t === '33:16', `timer counts down in sim time (${s.timer.toFixed(2)}, HUD ${s.t})`);
    await page.keyboard.press('Enter');
    await step(1200);
    const v = await snap();
    expect(v.depth === 0 && v.over, `ascending from depth 1 with the sword reaches the surface and wins (depth ${v.depth}, over ${v.over})`);
    await step(2600);
    await page.waitForSelector('.modal.victory', { timeout: 5000 }).catch(() => {});
    const m = await ev(() => { const el = document.querySelector('.modal.victory'); return el ? el.textContent : ''; });
    expect(/quest is complete/i.test(m) && /Time to spare/.test(m), 'victory screen with stats');
    await page.click('.modal.victory button.menu-item:has-text("Try again")');
    await page.waitForFunction(() => !window.__game.ui.menus.isOpen && !window.__game.game.over);
    const again = await snap();
    expect(again.depth === 1 && !again.over, 'Try again restarts on depth 1');
  },
  async 'sword-timeout'() {
    await fresh();
    await ev(() => { const g = window.__game.game; g.give('sword'); g.state.quest.timer = 2; });
    await step(2500);
    const s = await snap();
    expect(s.over && /OUT OF TIME/.test(s.lastLog), `timer runs out -> game over (${s.lastLog})`);
    await step(2000);
    await page.waitForSelector('.modal.death', { timeout: 5000 }).catch(() => {});
    const t = await ev(() => { const el = document.querySelector('.modal.death'); return el ? el.textContent : ''; });
    expect(/Out of time/.test(t), 'death screen says Out of time');
    // game keys must not reach the game while the end screen is up (Space/Enter would legitimately pick the highlighted entry)
    const before = await ev(() => { const p = window.__game.game.player; return { x: p.x, y: p.y }; });
    await page.keyboard.press('d'); await page.keyboard.press('x'); await page.keyboard.press('q'); await step(300);
    const after = await ev(() => { const p = window.__game.game.player; return { x: p.x, y: p.y, over: window.__game.game.over }; });
    expect(after.over && after.x === before.x && after.y === before.y, 'end screen swallows input');
    await page.keyboard.press('Escape'); await step(100);
    expect(await ev(() => !!document.querySelector('.modal.death')), 'Esc does not dismiss the death screen');
  },
  async 'defeat-slain'() {
    await fresh();
    await ev(() => { const g = window.__game.game, p = g.player; const s = [[1, 0], [-1, 0], [0, 1], [0, -1]].map((d) => ({ x: p.x + d[0], y: p.y + d[1] })).find((t) => g.level.isWalkable(t.x, t.y) && !g.level.entityAt(t.x, t.y)); const m = g.spawnMonster('war-lord', s.x, s.y, { depth: 20, state: 'hunt' }); m.lastSeen = { x: p.x, y: p.y }; p.hp = 1; });
    await step(4000);
    const s = await snap();
    expect(s.over && /SLAIN/.test(s.lastLog), `slain by the war lord (${s.lastLog})`);
    await page.waitForSelector('.modal.death', { timeout: 5000 }).catch(() => {});
    const t = await ev(() => { const el = document.querySelector('.modal.death'); return el ? el.textContent : ''; });
    expect(/Thou art slain/.test(t) && /war lord/i.test(t), 'death screen names the killer');
    await page.click('.modal.death button.menu-item:has-text("New quest")');
    await page.waitForSelector('#ng-start', { timeout: 3000 });
    expect(true, 'New quest opens the new-game panel');
    await page.click('#ng-back'); await step(50);
    expect(await ev(() => !!document.querySelector('.modal.death')), 'Back returns to the death screen');
  },
  async 'menus-block-input'() {
    await fresh();
    for (const [key, name] of [['Tab', 'inventory'], ['Escape', 'pause'], ['?', 'help']]) {
      await page.keyboard.press(key); await step(100);
      const s = await snap();
      expect(s.modal === name && s.paused && !s.inputEnabled, `${key} opens '${s.modal}', pauses and disables input`);
      // game keys only (hotkeys such as Q/1-6 inside the inventory legitimately use things)
      await page.keyboard.press('d'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('x'); await page.keyboard.press('z'); await step(400);
      const s2 = await snap();
      expect(s2.x === s.x && s2.y === s.y && s2.elapsed === s.elapsed && !s2.exploring && s2.modal === s.modal, `keys inside '${s.modal}' do not move the player, start exploring or advance time (modal now '${s2.modal}')`);
      await page.keyboard.press('Escape'); await step(50);
      const s3 = await snap();
      expect(!s3.modal && !s3.paused && s3.inputEnabled, `Escape closes '${s.modal}' -> resumed (modal ${s3.modal}, paused ${s3.paused})`);
    }
    // held movement key when a menu opens must not keep moving after it closes
    await page.keyboard.down('d'); await page.keyboard.press('Escape'); await step(100); await page.keyboard.up('d'); await page.keyboard.press('Escape'); await step(600);
    const held = await ev(() => window.__game.game.heldDir);
    expect(!held, 'held direction is dropped when a menu opens');
  },
  async 'save-continue'() {
    await fresh();
    await ev(() => { const g = window.__game.game; g.give('gold', 33); g.give('shield', 2); g.teleportTo(g.level.stairsDown.x, g.level.stairsDown.y); });
    await page.keyboard.press(' '); await step(1500);
    const before = await ev(() => { const g = window.__game.game, p = g.player; return { depth: g.depth, x: p.x, y: p.y, gold: p.gold, shield: p.spells.shield, xp: p.xp, saved: !!localStorage.getItem('fargoal.save.standard') }; });
    expect(before.depth === 2 && before.saved, 'autosave written after the level change');
    await page.keyboard.press('Escape'); await step(100);
    await page.click('.modal button.menu-item:has-text("Save & quit")');
    await page.waitForSelector('#title', { timeout: 5000 });
    const cont = await page.$('#title button.menu-item:has-text("Continue")');
    expect(cont && (await cont.getAttribute('disabled')) === null, 'Continue is enabled on the title screen');
    await cont.click();
    await page.waitForFunction(() => !document.getElementById('title') && window.__game.game);
    await ev(() => window.__game.debug.setLoop(false));
    await step(300);
    const after = await ev(() => { const g = window.__game.game, p = g.player; return { depth: g.depth, x: p.x, y: p.y, gold: p.gold, shield: p.spells.shield, xp: p.xp, paused: g.paused, input: window.__game.debug.input.enabled, views: window.__game.renderer.views.size, ents: g.level.entities.length, fogOverride: window.__game.renderer.fog.override }; });
    expect(after.depth === before.depth && after.x === before.x && after.y === before.y && after.gold === before.gold && after.shield === before.shield && after.xp === before.xp, `restored state matches (${JSON.stringify(after)})`);
    expect(!after.paused && after.input && after.views === after.ents && after.fogOverride === null, 'restored game is live, rendered and fogged');
    await page.keyboard.press('x'); await step(2000);
    const later = await snap();
    expect(later.elapsed > 0.5 && (later.x !== after.x || later.y !== after.y), `restored game plays on (moved to ${later.x},${later.y})`);
  },
  async 'resize'() {
    await fresh();
    for (const [w, h] of [[800, 500], [1600, 900], [1024, 768]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(60);
      await step(100);
      const c = await ev(() => { const cv = document.getElementById('game-canvas'); const r = window.__game.renderer; const rt = r.composer.renderTarget1; return { cw: cv.clientWidth, ch: cv.clientHeight, w: cv.width, h: cv.height, aspect: r.camera.aspect, rtw: rt.width, rth: rt.height, pr: r.gl.getPixelRatio() }; });
      expect(c.cw === w && c.ch === h && c.w === Math.round(w * c.pr) && c.h === Math.round(h * c.pr), `canvas follows the viewport ${w}x${h} (client ${c.cw}x${c.ch}, buffer ${c.w}x${c.h})`);
      expect(Math.abs(c.aspect - w / h) < 1e-3 && c.rtw === Math.round(w * c.pr) && c.rth === Math.round(h * c.pr), `camera aspect and composer targets resized (${c.aspect.toFixed(3)}, ${c.rtw}x${c.rth})`);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  },
  async 'audio-no-gesture'() {
    // reload with no input at all, let the title tune / hover sfx fire, then check nothing threw
    await page.goto(server.url + `?seed=${seed}`, { waitUntil: 'load' });
    await waitReady(page);
    const errs0 = b.errors.length;
    const r = await ev(() => { const a = window.__game.ui.audio; const bus = window.__game.bus; bus.emit('sfx:ui', { kind: 'hover' }); bus.emit('sfx:step', { tile: 1 }); a.title(); a.update(0.1, null); return { ctx: !!a.ctx, ok: a.ok, blocked: a.blocked, state: a.ctx ? a.ctx.state : null }; });
    expect(b.errors.length === errs0, `audio calls before any gesture do not throw (ctx ${r.ctx}, state ${r.state}, ok ${r.ok})`);
    await page.mouse.click(5, 5);
    await page.waitForTimeout(100);
    const r2 = await ev(() => { const a = window.__game.ui.audio; return { state: a.ctx ? a.ctx.state : null, ok: a.ok }; });
    expect(r2.state === 'running' || r2.state === 'suspended', `audio context exists after a gesture (${r2.state})`);
    await page.goto(server.url + `?seed=${seed}`, { waitUntil: 'load' });
    await waitReady(page);
  },
  async 'monster-corridor-pathing'() {
    await fresh();
    // find a corridor tile with a 1-wide passage: place the player at one end and a hunter a few tiles down the corridor
    const r = await ev(() => {
      const g = window.__game.game, lv = g.level; const T = { CORRIDOR: 2 };
      const corr = []; for (let y = 1; y < lv.height - 1; y++) for (let x = 1; x < lv.width - 1; x++) if (lv.get(x, y) === T.CORRIDOR) corr.push({ x, y });
      // pick a corridor tile whose 6-step BFS path stays inside corridor
      for (const c of corr) {
        const dist = lv.distanceMap(c.x, c.y, false, (x, y) => lv.get(x, y) === T.CORRIDOR);
        let far = null; for (const d of corr) { const v = dist[lv.idx(d.x, d.y)]; if (v >= 6 && v <= 9 && (!far || v > dist[lv.idx(far.x, far.y)])) far = d; }
        if (!far) continue;
        for (const m of lv.monsters) lv.removeEntity(m);
        g.teleportTo(c.x, c.y);
        const m = g.spawnMonster('ogre', far.x, far.y, { depth: 1, state: 'hunt' });
        if (!m) continue;
        m.lastSeen = { x: c.x, y: c.y }; m.speed = 3; m.moveTimer = 0;
        return { start: far, player: c, d: dist[lv.idx(far.x, far.y)] };
      }
      return null;
    });
    if (!r) { expect(true, 'no long corridor on this level (skipped)'); return; }
    await step(6000);
    const s = await ev(() => { const g = window.__game.game; const m = g.level.monsters[0]; const p = g.player; return { m: m ? { x: m.x, y: m.y, state: m.state } : null, p: { x: p.x, y: p.y }, combat: !!g.state.combat, log: g.state.log.slice(-3).map((l) => l.text) }; });
    const near = s.m && Math.max(Math.abs(s.m.x - s.p.x), Math.abs(s.m.y - s.p.y)) <= 1;
    expect(near || s.combat || !s.m, `ogre walked ${r.d} corridor tiles to the player (${JSON.stringify(s.m)} vs ${JSON.stringify(s.p)}, combat ${s.combat}; log: ${s.log.join(' / ')})`);
  },
  async 'level-churn-memory'() {
    await fresh();
    // the count of uploaded geometries wobbles with what got drawn before disposal (frustum culling), so compare the peak of two long churns
    const mem = await ev(() => { const r = window.__game.renderer, g = window.__game.game; const read = () => ({ ...r.gl.info.memory, programs: r.gl.info.programs.length, views: r.views.size, children: r.scene.children.length }); const churn = (n) => { let peak = null; for (let i = 0; i < n; i++) { g.goToDepth(2 + (i % 5)); window.__game.debug.step(100); const m = read(); if (!peak || m.geometries > peak.geometries) peak = m; } return peak; }; churn(80); const a = churn(40); const b = churn(40); return { a, b }; });
    expect(mem.b.geometries - mem.a.geometries <= 8 && mem.b.textures - mem.a.textures <= 0 && mem.b.programs - mem.a.programs <= 0 && mem.b.children - mem.a.children <= 4, `GPU resources bounded across 160 level changes (peak geometries ${mem.a.geometries}->${mem.b.geometries}, textures ${mem.a.textures}->${mem.b.textures}, programs ${mem.a.programs}->${mem.b.programs}, scene children ${mem.a.children}->${mem.b.children})`);
  },
};

let current = '';
function expect(cond, what) { results.push({ flow: current, ok: !!cond, what }); console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`); }
let failed = 0;
try {
  await page.goto(server.url + `?seed=${seed}`, { waitUntil: 'load' }); // the real (non-debug) boot: title screen, autosave, auto-pause
  await waitReady(page);
  for (const [name, fn] of Object.entries(flows)) {
    if (args.only && args.only !== name) continue;
    current = name; console.log(name);
    const errs = b.errors.length;
    try { await fn(); } catch (e) { expect(false, 'exception: ' + (e.message || e).split('\n')[0]); }
    const newErrs = b.errors.slice(errs);
    if (newErrs.length) expect(false, 'page errors: ' + newErrs.join(' | '));
    await page.screenshot({ path: `shots/play/flow-${name}.png` }).catch(() => {});
  }
} catch (e) { console.error(e); failed++; }
finally { await b.close(); server.stop(); }
failed += results.filter((r) => !r.ok).length;
console.log(failed ? `FLOWS FAILED (${failed})` : 'FLOWS OK');
process.exit(failed ? 1 : 0);
