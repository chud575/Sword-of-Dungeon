// Play bot: drives the real game through Playwright — starts a quest from the title screen with
// real clicks/keys (no debug shortcuts), then plays for N simulated seconds using keyboard input
// and auto-explore (X): fights adjacent monsters (held direction), drinks potions, casts spells,
// sacrifices at temples, buries gold, walks pits now and then, descends when it finds stairs,
// opens/closes the inventory and pause menu, click-to-moves, resizes the window, and finally
// exercises Save & quit -> Continue. Time is advanced with debug.step so runs are deterministic
// and fast under SwiftShader. State is logged every 30 simulated seconds; screenshots go to
// shots/play/ on death, victory and every level change.
// Exit code is non-zero on any page error, if the player never moved, or never changed depth.
// Usage: node tools/play.mjs [--seed 1 | --seeds 1,2,3] [--seconds 600] [--w 800] [--h 450] [--difficulty standard] [--quality low|high] [--maxwall 25] [--verbose]
import { startServer, launchBrowser, waitReady } from './browser.mjs';
import fs from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), (arr[i + 1] && !arr[i + 1].startsWith('--')) ? arr[i + 1] : true] : []).filter(Boolean));
const seeds = args.seeds ? String(args.seeds).split(',').map(Number) : [Number(args.seed || 1)];
const SECONDS = Number(args.seconds || 600);
const MAX_WALL = Number(args.maxwall || 25) * 60 * 1000; // minutes of wall clock per seed before the run is cut short
const W = Number(args.w || 800), H = Number(args.h || 450);
const difficulty = args.difficulty || 'standard';
const quality = args.quality || 'low'; // logic QA, not a beauty contest: the cheap render path is ~2x faster under SwiftShader
const verbose = !!args.verbose;
const OUT = 'shots/play';
fs.mkdirSync(OUT, { recursive: true });

// mulberry32 so bot decisions are reproducible per seed
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const KEY = { '0,-1': 'w', '0,1': 's', '-1,0': 'a', '1,0': 'd', '-1,-1': 'y', '1,-1': 'u', '-1,1': 'b', '1,1': 'n' };
const dirKey = (dx, dy) => KEY[`${Math.sign(dx)},${Math.sign(dy)}`];

/** One page.evaluate: everything the bot needs to know this tick (read-only). */
function snapshot() {
  const G = window.__game; const g = G.game; const ui = G.ui;
  if (!g) return { noGame: true };
  const p = g.player, lv = g.level;
  const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
  const band = (m) => { const x = (m.strength / Math.max(1, p.skill)) * 5; return x < 1 ? 'trivial' : x < 3 ? 'easy' : x < 6 ? 'even' : x < 12 ? 'hard' : 'deadly'; };
  const adj = g.visibleMonsters().map((m) => ({ id: m.id, type: m.type, dx: m.x - p.x, dy: m.y - p.y, d: cheb(m.x, m.y, p.x, p.y), hp: m.hp, state: m.state, band: band(m), special: m.special })).sort((a, b) => a.d - b.d);
  const away = (m) => { let best = null, bestD = -1; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if ((!dx && !dy) || !lv.canStep(p.x, p.y, dx, dy) || lv.isHazard(p.x + dx, p.y + dy) || lv.entityAt(p.x + dx, p.y + dy)) continue; const d = cheb(p.x + dx, p.y + dy, p.x + m.dx, p.y + m.dy); if (d > bestD) { bestD = d; best = { dx, dy }; } } return best; };
  let explored = 0, walkable = 0;
  for (let i = 0; i < lv.tiles.length; i++) if (lv.tiles[i] !== 0) { walkable++; if (lv.explored[i]) explored++; }
  const TILE = { STAIRS_DOWN: 3, STAIRS_UP: 4, PIT: 5, TEMPLE: 6 };
  const known = (t) => t && lv.isExplored(t.x, t.y);
  const temple = lv.temples.find((t) => known(t)) || null;
  const stairs = (lv.stairsDownAll && lv.stairsDownAll.length ? lv.stairsDownAll : (lv.stairsDown ? [lv.stairsDown] : [])).filter(known);
  const pit = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && lv.get(p.x + dx, p.y + dy) === TILE.PIT && lv.canStep(p.x, p.y, dx, dy)) pit.push({ dx, dy });
  const pathStep = (t) => { const path = t ? g.pathTo(t.x, t.y) : null; return path && path.length ? { dx: path[0].x - p.x, dy: path[0].y - p.y, len: path.length } : null; };
  return {
    over: g.over, paused: g.paused, depth: g.depth, elapsed: g.state.elapsed, time: g.state.time,
    x: p.x, y: p.y, hp: p.hp, maxHp: p.maxHp, gold: p.gold, xp: p.xp, level: p.level, kills: p.kills, hasSword: p.hasSword,
    spells: { ...p.spells }, potions: p.inventory.potion, beacons: p.inventory.beacon,
    status: p.statusEffects.map((s) => s.type), lightOn: g.lightOn(),
    tile: lv.get(p.x, p.y), onTemple: lv.isTemple(p.x, p.y), climbable: !!lv.climbableAt(p.x, p.y),
    combat: !!g.state.combat, adj, exploredFrac: explored / Math.max(1, walkable),
    templeStep: temple ? pathStep(temple) : null, stairsStep: stairs.length ? pathStep(stairs.sort((a, b) => cheb(a.x, a.y, p.x, p.y) - cheb(b.x, b.y, p.x, p.y))[0]) : null,
    stairsKnown: stairs.length > 0, pit, flee: adj.length && adj[0].d <= 2 ? away(adj[0]) : null,
    exploring: !!ui.hud.exploreBtn.classList.contains('on'), autoPaused: ui.hud.autoPaused,
    modal: ui.menus.top ? ui.menus.top.name : (ui.inventory.open ? 'inventory' : null), titleOpen: ui.menus.titleOpen,
    transition: !!G.renderer.cameraRig.transition, inputEnabled: G.debug.input.enabled,
    lastLog: g.state.log.length ? g.state.log[g.state.log.length - 1].text : '',
    canvas: { w: document.getElementById('game-canvas').width, h: document.getElementById('game-canvas').height },
  };
}

/** World tile -> client pixel via the renderer's camera (for real mouse clicks). */
function tileToClient({ x, y }) {
  const cam = window.__game.renderer.camera; cam.updateMatrixWorld();
  const mul = (m, v) => { const e = m.elements; const w = e[3] * v[0] + e[7] * v[1] + e[11] * v[2] + e[15]; return [(e[0] * v[0] + e[4] * v[1] + e[8] * v[2] + e[12]) / w, (e[1] * v[0] + e[5] * v[1] + e[9] * v[2] + e[13]) / w, (e[2] * v[0] + e[6] * v[1] + e[10] * v[2] + e[14]) / w]; };
  const v = mul(cam.projectionMatrix, mul(cam.matrixWorldInverse, [x, 0, y]));
  const r = document.getElementById('game-canvas').getBoundingClientRect();
  return { cx: r.left + (v[0] + 1) / 2 * r.width, cy: r.top + (1 - v[1]) / 2 * r.height, inside: Math.abs(v[0]) < 0.95 && Math.abs(v[1]) < 0.95 };
}

async function playSeed(seed) {
  const server = await startServer();
  const b = await launchBrowser({ width: W, height: H });
  const page = b.page;
  const rnd = rng(seed * 2654435761);
  const chance = (p) => rnd() < p;
  const log = (...a) => console.log(`[seed ${seed}]`, ...a);
  const problems = [];
  const stats = { deaths: 0, descents: 0, maxDepth: 1, moves: 0, kills: 0, sacrifices: 0, spells: 0, potions: 0, pits: 0, flees: 0, menus: 0, clicks: 0, ticks: 0, restarts: 0 };
  let pending = null; // snapshot taken right after the last step (saves a round-trip per tick)
  const snap = async () => { const s = pending || await page.evaluate(() => window.__bot.snapshot()); pending = null; return s; };
  const step = async (ms) => { pending = await page.evaluate((ms) => { window.__game.debug.step(ms); return window.__bot.snapshot(); }, ms); stats.ticks++; };
  // any real input invalidates the cached snapshot (the game may react synchronously to it)
  const press = async (k) => { pending = null; await page.keyboard.press(k); };
  const keyDown = async (k) => { pending = null; await page.keyboard.down(k); };
  const click = async (x, y) => { pending = null; await page.mouse.click(x, y); stats.clicks++; };
  const shot = async (name) => { const f = `${OUT}/seed${seed}-${name}.png`; await page.screenshot({ path: f }); if (verbose) log('shot', f); };
  const t0 = Date.now();
  try {
    await page.goto(server.url + `?quality=${quality}`, { waitUntil: 'load' });
    await waitReady(page);
    await page.evaluate(`window.__bot = { snapshot: ${snapshot.toString()}, tileToClient: ${tileToClient.toString()} };`);
    await page.mouse.move(2, 2); // menus pre-select on hover: park the cursor
    // ---- title screen -> New Game -> difficulty card -> seed -> Begin (all real UI interaction)
    await page.waitForSelector('#title', { timeout: 15000 });
    await page.click('#title button.menu-item:has-text("New Game")');
    await page.waitForSelector('#ng-seed', { timeout: 5000 });
    await page.click(`.card[data-d="${difficulty}"]`);
    await page.fill('#ng-name', 'PlayBot');
    await page.fill('#ng-seed', String(seed));
    await page.click('#ng-start');
    await page.waitForFunction(() => !document.getElementById('title') && window.__game.game && !window.__game.ui.menus.isOpen, null, { timeout: 5000 });
    await page.evaluate(() => window.__game.debug.setLoop(false)); // debug.step is the only clock from here on: runs are reproducible per seed
    const started = await snap();
    if (String(await page.evaluate(() => window.__game.game.seed)) !== String(seed)) problems.push(`game seed mismatch (wanted ${seed})`);
    log(`started: ${difficulty}, depth ${started.depth}, at ${started.x},${started.y}, ${started.hp}/${started.maxHp} hp`);
    await shot('start');

    const start = { x: started.x, y: started.y };
    let movedEver = false, depthChanged = false;
    let lastDepth = started.depth, lastLogAt = 0, levelEnteredAt = 0, lastMenuAt = 0, lastResizeAt = 0;
    let exploreExhausted = false, fightTicks = 0, lastPos = `${started.x},${started.y}`, stuckTicks = 0;
    let elapsed = 0, lastMoveAt = 0, stuckReported = false, simBase = 0; // simBase: simulated seconds spent in earlier (dead) quests of this run
    const viewports = [[W, H], [800, 500], [1280, 720]];

    while (simBase + elapsed < SECONDS) {
      if (Date.now() - t0 > MAX_WALL) { log(`wall-clock budget hit at ${fmt(simBase + elapsed)} simulated seconds`); break; }
      const s = await snap();
      if (s.noGame) { problems.push('game object vanished'); break; }
      elapsed = s.elapsed;
      // ---- bookkeeping
      const pos = `${s.x},${s.y}`;
      if (pos !== lastPos) { stats.moves++; lastPos = pos; stuckTicks = 0; lastMoveAt = elapsed; } else stuckTicks++;
      if (elapsed - lastMoveAt > 120 && !s.combat && !s.adj.length && !stuckReported) { stuckReported = true; problems.push(`player stuck at ${pos} on depth ${s.depth} for ${fmt(elapsed - lastMoveAt)} (${s.lastLog})`); }
      if (s.x !== start.x || s.y !== start.y) movedEver = true;
      if (s.depth !== lastDepth) {
        depthChanged = true; stats.descents++; stats.maxDepth = Math.max(stats.maxDepth, s.depth);
        log(`depth ${lastDepth} -> ${s.depth} at ${fmt(elapsed)} (${s.lastLog})`);
        await shot(`depth${s.depth}`);
        lastDepth = s.depth; levelEnteredAt = elapsed; exploreExhausted = false;
      }
      if (elapsed - lastLogAt >= 30) {
        lastLogAt = elapsed;
        log(`t=${fmt(simBase + elapsed)} depth ${s.depth} pos ${s.x},${s.y} hp ${s.hp}/${s.maxHp} lvl ${s.level} xp ${s.xp} gold ${s.gold} kills ${s.kills} explored ${(s.exploredFrac * 100).toFixed(0)}% spells ${Object.entries(s.spells).filter(([, n]) => n).map(([k, n]) => `${k}:${n}`).join(',') || '-'} pot ${s.potions} status [${s.status}] ${s.exploring ? 'exploring' : ''} ${s.combat ? 'FIGHT' : ''} ${s.modal ? 'modal:' + s.modal : ''}${s.paused ? ' paused' : ''}`);
      }
      stats.kills = s.kills;
      // ---- game over: wait for the end screen, screenshot, Try again
      if (s.over) {
        stats.deaths++;
        await page.waitForSelector('.modal.death, .modal.victory', { timeout: 8000 }).catch(async () => { await step(2000); });
        await step(200);
        log(`GAME OVER #${stats.deaths} at ${fmt(elapsed)} depth ${s.depth}: ${s.lastLog}`);
        await shot(`death${stats.deaths}`);
        const again = stats.deaths === 1;
        const btn = await page.$(`.modal.death button.menu-item:has-text("${again ? 'Try again' : 'New quest'}"), .modal.victory button.menu-item:has-text("${again ? 'Try again' : 'New quest'}")`);
        if (!btn) { problems.push('no end screen / restart button after game over'); break; }
        pending = null; await btn.click();
        if (!again) {
          // a different dungeon this time so the run keeps covering new ground
          await page.waitForSelector('#ng-seed', { timeout: 5000 });
          await page.fill('#ng-seed', String(seed * 1000 + stats.deaths));
          await page.keyboard.press('Enter'); // Enter inside the seed field must begin the quest
          stats.restarts++;
        }
        await page.waitForFunction(() => window.__game.game && !window.__game.game.over && !window.__game.ui.menus.isOpen, null, { timeout: 5000 });
        await page.evaluate(() => window.__game.debug.setLoop(false));
        const ns = await snap();
        simBase += elapsed; elapsed = ns.elapsed; lastLogAt = 0;
        lastDepth = ns.depth; levelEnteredAt = ns.elapsed; lastPos = `${ns.x},${ns.y}`; lastMoveAt = ns.elapsed; exploreExhausted = false;
        continue;
      }
      // ---- a menu is open (pause from blur, or one we opened): close it with Esc
      if (s.modal) { await press('Escape'); await step(100); continue; }
      if (s.titleOpen) { problems.push('title screen reappeared mid-run'); break; }
      if (s.transition || !s.inputEnabled) { await step(300); continue; }
      if (s.autoPaused) { await step(50); } // any key below resumes it (that is the contract)

      // ---- decide one action
      const near = s.adj[0];
      const adjacent = near && near.d <= 1 ? near : null;
      const lowHp = s.hp < s.maxHp * 0.35, healthy = s.hp >= s.maxHp * 0.7;
      let tick = 400;
      const scary = near && (near.band === 'deadly' || (near.band === 'hard' && s.hp < s.maxHp * 0.6) || near.special === 'mage' || near.special === 'demon');
      if (lowHp && s.potions > 0 && (adjacent || s.hp < s.maxHp * 0.2)) { await press('q'); stats.potions++; await step(150); continue; }
      if (adjacent && (s.hp < s.maxHp * 0.25 || scary) && s.spells.teleport > 0 && chance(0.7)) { await press(chance(0.5) ? '1' : 't'); stats.spells++; await step(300); continue; }
      if (adjacent && s.spells.invisibility > 0 && scary && !s.status.includes('invisible')) { await press(chance(0.5) ? '4' : 'i'); stats.spells++; await step(100); continue; }
      if (adjacent && s.spells.shield > 0 && !s.status.includes('shield')) { await press(chance(0.5) ? '2' : 'Shift+S'); stats.spells++; await step(100); continue; }
      if (near && near.d <= 2 && scary && !s.combat && s.flee && chance(0.85)) {
        // back away from something that would kill us (it may still catch us: that is the game)
        await press(dirKey(s.flee.dx, s.flee.dy)); stats.flees++; await step(170); continue;
      }
      if (adjacent) {
        // bump-attack: hold the direction for a few rounds, then release (disengages a fight we started)
        const k = dirKey(adjacent.dx, adjacent.dy);
        await keyDown(k); await step(chance(0.5) ? 350 : 700); await page.keyboard.up(k);
        fightTicks++;
        continue;
      }
      if (s.combat) { await step(200); continue; } // forced fight we cannot walk out of: wait a round
      if (s.spells.light > 0 && !s.lightOn && !s.status.includes('light') && chance(0.4)) { await press(chance(0.5) ? '5' : 'Shift+L'); stats.spells++; await step(100); continue; }
      if (s.status.includes('light') && !s.lightOn && chance(0.5)) { await press('o'); await step(100); continue; }
      if (s.spells.regeneration > 0 && s.hp < s.maxHp * 0.6 && chance(0.5)) { await press(chance(0.5) ? '3' : 'r'); stats.spells++; await step(100); continue; }
      if (s.spells.invisibility > 0 && near && near.d <= 4 && chance(0.3)) { await press(chance(0.5) ? '4' : 'i'); stats.spells++; await step(100); continue; }
      if (s.spells.drift > 0 && s.pit.length && chance(0.5)) { await press(chance(0.5) ? '6' : 'f'); stats.spells++; await step(100); continue; }
      if (s.onTemple && s.gold > 0) { await press(chance(0.5) ? ' ' : 'Enter'); stats.sacrifices++; await step(300); continue; }
      if (s.climbable && chance(0.05)) { await press(' '); await step(1500); continue; }
      if (!healthy && !near && !s.exploring && s.exploredFrac > 0.3 && chance(0.6)) { await press('z'); await step(700); continue; }
      if (s.tile === 3 /* STAIRS_DOWN */) {
        const rest = s.hp < s.maxHp * 0.5 && !near;
        if (rest && chance(0.7)) { await press('z'); await step(600); continue; }
        if (chance(0.5)) await press(' '); else { const c = await page.evaluate((t) => window.__bot.tileToClient(t), { x: s.x, y: s.y }); await click(c.cx, c.cy); }
        await step(1500); continue;
      }
      if (s.pit.length && s.hp > s.maxHp * 0.7 && chance(0.02)) { const d = s.pit[0]; await press(dirKey(d.dx, d.dy)); stats.pits++; await step(800); continue; }
      if (s.gold > 0 && chance(0.01)) { await press('Shift+B'); await step(100); continue; }
      if (s.beacons > 0 && chance(0.02)) { await press('='); await step(100); continue; }
      // menus: inventory / pause / help every so often (tests input while a menu is open)
      if (elapsed - lastMenuAt > 45 && !near) {
        lastMenuAt = elapsed; stats.menus++;
        const which = chance(0.5) ? 'Tab' : chance(0.5) ? 'Escape' : '?';
        await press(which); await step(200);
        await press('ArrowDown'); await press('w'); await press('s'); // must NOT move the player
        const before = await snap();
        await step(200);
        const after = await snap();
        if (!before.modal) problems.push(`${which} did not open a menu at ${fmt(elapsed)}`);
        if (after.x !== s.x || after.y !== s.y) problems.push(`player moved while menu '${before.modal}' was open`);
        if (!after.paused) problems.push(`game not paused while menu '${before.modal}' open`);
        await press('Escape'); await step(100);
        const closed = await snap();
        if (closed.modal) { await press('Escape'); await step(100); }
        continue;
      }
      // resize the window now and then
      if (elapsed - lastResizeAt > 150) {
        lastResizeAt = elapsed;
        const [vw, vh] = viewports[Math.floor(rnd() * viewports.length)];
        await page.setViewportSize({ width: vw, height: vh });
        await page.waitForTimeout(80);
        await step(100);
        const c = await page.evaluate(() => { const cv = document.getElementById('game-canvas'); return { w: cv.width, h: cv.height, cw: cv.clientWidth, ch: cv.clientHeight, aspect: window.__game.renderer.camera.aspect }; });
        if (Math.abs(c.aspect - vw / vh) > 0.02) problems.push(`camera aspect ${c.aspect.toFixed(3)} after resize to ${vw}x${vh}`);
        if (c.cw !== vw || c.ch !== vh) problems.push(`canvas ${c.cw}x${c.ch} does not fill viewport ${vw}x${vh}`);
        if (verbose) log(`resized to ${vw}x${vh}: canvas ${c.w}x${c.h}`);
        continue;
      }
      // navigation: temple when carrying gold, stairs when the level is explored enough or we linger
      const linger = elapsed - levelEnteredAt;
      if (s.templeStep && s.gold >= 30 && chance(0.8)) { await press(dirKey(s.templeStep.dx, s.templeStep.dy)); await step(170); continue; }
      const wantStairs = s.stairsKnown && ((healthy && (exploreExhausted || s.exploredFrac > 0.7 || linger > 150)) || linger > 300 || (lowHp && near && s.stairsStep && s.stairsStep.len <= 3));
      if (wantStairs && s.stairsStep) {
        if (s.stairsStep.len > 3 && chance(0.15)) {
          // click-to-move onto the stairs (real mouse) when they are on screen
          const target = await page.evaluate(() => { const lv = window.__game.game.level; const p = window.__game.game.player; const all = (lv.stairsDownAll && lv.stairsDownAll.length ? lv.stairsDownAll : [lv.stairsDown]).filter((t) => lv.isExplored(t.x, t.y)); all.sort((a, b) => Math.max(Math.abs(a.x - p.x), Math.abs(a.y - p.y)) - Math.max(Math.abs(b.x - p.x), Math.abs(b.y - p.y))); return all[0]; });
          const c = await page.evaluate((t) => window.__bot.tileToClient(t), target);
          if (c.inside) { await click(c.cx, c.cy); await step(1200); continue; }
        }
        await press(dirKey(s.stairsStep.dx, s.stairsStep.dy)); await step(170); continue;
      }
      if (!s.exploring) {
        if (s.lastLog.startsWith('Nothing left to explore')) exploreExhausted = true;
        if (!exploreExhausted || chance(0.3)) { await press('x'); await step(tick); continue; }
        // nothing to explore and no known stairs path: wander / click somewhere explored
        if (chance(0.3)) {
          const t = await page.evaluate(() => { const lv = window.__game.game.level; const p = window.__game.game.player; const opts = []; for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) { const x = p.x + dx, y = p.y + dy; if (lv.isExplored(x, y) && lv.isWalkable(x, y) && !lv.isHazard(x, y)) opts.push({ x, y }); } return opts[Math.floor(opts.length / 2)] || null; });
          if (t) { const c = await page.evaluate((t) => window.__bot.tileToClient(t), t); if (c.inside) { await click(c.cx, c.cy); await step(800); continue; } }
        }
        const dirs = ['w', 'a', 's', 'd', 'y', 'u', 'b', 'n'];
        await press(dirs[Math.floor(rnd() * dirs.length)]); await step(170); continue;
      }
      if (stuckTicks > 12 && s.exploring) { await press('x'); await step(100); await press('x'); } // re-plan
      await step(tick);
    }

    // ---- Save & quit -> Continue round-trip (real menu clicks)
    for (let i = 0; i < 20; i++) { const s = await snap(); if (s.over) break; if (s.modal) { await press('Escape'); await step(100); continue; } if (s.transition || !s.inputEnabled) { await step(300); continue; } break; }
    const before = await snap();
    if (!before.over) {
      await press('Escape'); await step(100);
      await page.waitForSelector('.modal button.menu-item:has-text("Save & quit")', { timeout: 5000 });
      pending = null; await page.click('.modal button.menu-item:has-text("Save & quit")');
      await page.waitForSelector('#title', { timeout: 5000 });
      await step(300);
      const cont = await page.$('#title button.menu-item:has-text("Continue")');
      const disabled = cont ? await cont.getAttribute('disabled') : 'missing';
      if (disabled !== null) problems.push(`Continue is ${disabled === 'missing' ? 'missing' : 'disabled'} after Save & quit`);
      else {
        pending = null; await cont.click();
        await page.waitForFunction(() => !document.getElementById('title') && window.__game.game, null, { timeout: 5000 });
        await page.evaluate(() => window.__game.debug.setLoop(false));
        await step(200);
        const after = await snap();
        if (after.depth !== before.depth || after.x !== before.x || after.y !== before.y || after.xp !== before.xp || after.gold !== before.gold) problems.push(`Continue restored depth ${after.depth} pos ${after.x},${after.y} xp ${after.xp} gold ${after.gold}; expected depth ${before.depth} pos ${before.x},${before.y} xp ${before.xp} gold ${before.gold}`);
        else log(`save/continue ok: depth ${after.depth} pos ${after.x},${after.y}`);
        // play a little more on the restored game to make sure it is alive
        await press('x'); await step(2000);
        const later = await snap();
        if (later.elapsed <= after.elapsed) problems.push('restored game does not advance');
        await shot('continued');
      }
    }
    // ---- renderer resource check: rebuild a few levels and see that GPU memory does not grow without bound
    const mem = await page.evaluate(() => { const r = window.__game.renderer; const g = window.__game.game; const info = r.gl.info.memory; const a = { ...info }; for (let i = 0; i < 6; i++) { g.goToDepth(g.depth + 1 + (i % 2)); r.render(0); } const b = { ...info }; for (let i = 0; i < 6; i++) { g.goToDepth(g.depth + 1 + (i % 2)); r.render(0); } const c = { ...info }; return { a, b, c }; }).catch((e) => ({ err: String(e) }));
    if (mem.err) problems.push('memory check failed: ' + mem.err);
    else { const grow = mem.c.geometries - mem.b.geometries; log(`gl memory: geometries ${mem.a.geometries} -> ${mem.b.geometries} -> ${mem.c.geometries}, textures ${mem.c.textures}`); if (grow > 8) problems.push(`geometries keep growing across level changes (+${grow} per 6 levels)`); }
  } catch (e) { problems.push('exception: ' + (e.stack || e)); }
  finally {
    for (const err of b.errors) problems.push('page error: ' + err);
    if (!(await page.isClosed())) await shot('end').catch(() => {});
    await b.close(); server.stop();
  }
  return { seed, stats, problems, wall: Date.now() - t0 };
}

function fmt(sec) { sec = Math.max(0, Math.floor(sec || 0)); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }

let failed = 0;
for (const seed of seeds) {
  const r = await playSeed(seed);
  const s = r.stats;
  const verdict = [];
  if (!s.moves) verdict.push('player never changed position');
  if (!s.descents) verdict.push('player never changed depth');
  verdict.push(...r.problems);
  console.log(`[seed ${seed}] ${verdict.length ? 'FAIL' : 'ok'}: ${fmt(r.wall / 1000)} wall, ticks ${s.ticks}, moves ${s.moves}, descents ${s.descents}, max depth ${s.maxDepth}, deaths ${s.deaths}, kills ${s.kills}, potions ${s.potions}, spells ${s.spells}, sacrifices ${s.sacrifices}, pits ${s.pits}, menus ${s.menus}, clicks ${s.clicks}`);
  for (const v of verdict) console.log(`[seed ${seed}]   - ${v}`);
  if (verdict.length) failed++;
}
console.log(failed ? `PLAY FAILED (${failed} seed${failed > 1 ? 's' : ''})` : 'PLAY OK');
process.exit(failed ? 1 : 0);
