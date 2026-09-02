// Shared headless-browser helpers for screenshot/smoke/QA tools.
// Launches a Vite dev server on a free port and a headless Chromium with software WebGL2.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function startServer() {
  const proc = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '0', '--strictPort', 'false'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' },
  });
  const url = await new Promise((resolve, reject) => {
    let buf = '';
    const onData = (d) => {
      buf += d.toString();
      const m = buf.match(/http:\/\/127\.0\.0\.1:(\d+)\/?/);
      if (m) resolve(`http://127.0.0.1:${m[1]}/`);
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('exit', (c) => reject(new Error('vite exited early: ' + c + '\n' + buf)));
    setTimeout(() => reject(new Error('vite start timeout\n' + buf)), 30000);
  });
  return { url, stop: () => { try { proc.kill('SIGTERM'); } catch {} } };
}

export async function launchBrowser({ width = 1600, height = 900 } = {}) {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  const logs = [];
  page.on('console', (m) => { logs.push(`[${m.type()}] ${m.text()}`); if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + (e.stack || e.message)));
  return { browser, page, errors, logs, close: () => browser.close() };
}

/** Wait for the game to signal readiness via window.__GAME_READY (set by src/main.js). */
export async function waitReady(page, timeout = 60000) {
  await page.waitForFunction(() => window.__GAME_READY === true, null, { timeout });
}

/** Advance the game deterministically: calls window.__game.debug.step(ms) if present, else waits. */
export async function advance(page, ms) {
  const stepped = await page.evaluate((ms) => {
    if (window.__game?.debug?.step) { window.__game.debug.step(ms); return true; }
    return false;
  }, ms);
  if (!stepped) await page.waitForTimeout(ms);
  else await page.waitForTimeout(50);
}
