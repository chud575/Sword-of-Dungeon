// bundle: vite build -> ONE self-contained .html file.
//
// WHY THIS EXISTS SEPARATELY FROM `vite build`
// Two consumers want a single file and neither can fetch a sibling asset:
//   - the claude.ai artifact host, whose CSP forbids fetch() and data: URIs for scripts, and which
//     supplies its own <!doctype html><head>...<body> wrapper, so the file must be page CONTENT only;
//   - anyone who wants to open the game by double-clicking it, where file:// blocks module imports.
// So we build normally, then fold the emitted CSS and the emitted ES module back into the markup as
// inline <style> and <script type="module">. Everything else the game needs is already inside the
// JS: the art is procedural and the prop library ships as gzipped base64 in src/assets.
//
// Usage: node tools/bundle.mjs [out.html] [--standalone]
//   default out: dist/fargoal.html   (artifact-ready: no doctype/html/head/body)
//   --standalone wraps it in a full document so it opens from the filesystem.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const standalone = args.includes('--standalone');
const out = resolve(ROOT, args.find((a) => !a.startsWith('--')) || 'dist/fargoal.html');

console.log('vite build...');
execFileSync('npx', ['vite', 'build'], { cwd: ROOT, stdio: 'inherit' });

const assets = join(ROOT, 'dist/assets');
const files = readdirSync(assets);
// Sourcemaps are emitted next to the bundle and are worth tens of MB; they are never inlined.
const js = files.filter((f) => f.endsWith('.js'));
const css = files.filter((f) => f.endsWith('.css'));
if (js.length !== 1) throw new Error(`expected one JS chunk, got ${js.length}: ${js.join(', ')}`);

const code = readFileSync(join(assets, js[0]), 'utf8');
const styles = css.map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');

// The built index.html is only a shell; rebuilding it here is clearer than regex-surgery on it.
const body = `<title>Sword of Fargoal</title>
<style>${styles}</style>
<div id="app"><canvas id="game-canvas"></canvas><div id="ui-root"></div></div>
<script type="module">${code}</script>`;

const html = standalone
  ? `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<style>html,body{margin:0;height:100%;background:#050406;overflow:hidden}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`
  : `${body}\n`;

writeFileSync(out, html);
const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
console.log(`\n${out}`);
console.log(`  js ${kb(code.length)}  css ${kb(styles.length)}  page ${kb(statSync(out).size)}`);
console.log(standalone ? '  standalone: open it directly in a browser' : '  artifact-ready: page content only, no document wrapper');
