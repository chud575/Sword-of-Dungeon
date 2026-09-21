import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * precache.json for the home-screen web app's service worker (public/sw.js): every file the build emits plus the
 * public/ files, without source maps, and a version hash of the list. Build only — the dev server never sees it.
 */
function precacheManifest() {
  return {
    name: 'fargoal-precache',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      for (const f of ['manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png']) files.push(f);
      files.sort();
      const version = createHash('sha1').update(files.join('\n')).digest('hex').slice(0, 12);
      this.emitFile({ type: 'asset', fileName: 'precache.json', source: JSON.stringify({ version, files }, null, 1) });
    },
  };
}

/**
 * A BUILD STAMP YOU CAN READ OFF THE SCREEN (owner, 2026-09-20: "I need version numbers printed in one
 * of those panels... so i can be sure that im on the right version before telling you to fix something").
 *
 * It is a hash of every source file's path and modification time, plus the newest of those times — so it
 * changes whenever any code does, and two people looking at the same stamp are looking at the same code.
 * The virtual module is INVALIDATED on every file change, so a reload always recomputes it rather than
 * serving the stamp the dev server started with. In a real build it is fixed at build time.
 */
function buildStamp() {
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (/\.(js|css|html|json)$/.test(e.name)) out.push(full);
    }
    return out;
  };
  const compute = () => {
      const root = path.resolve('src');
      let newest = 0;
      const h = createHash('sha1');
      for (const f of walk(root).sort()) {
        const st = fs.statSync(f);
        if (st.mtimeMs > newest) newest = st.mtimeMs;
        h.update(path.relative(root, f) + ':' + Math.round(st.mtimeMs));
      }
      const d = new Date(newest);
      const two = (n) => String(n).padStart(2, '0');
      // The TIME is the version — it is the only part you can compare. The hash is a fingerprint: two
      // builds are the same or they are not, and 6cf41ba is neither higher nor lower than 728306c
      // (owner asked, 2026-09-20, and was right to).
      const stamp = {
        time: `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`,
        epoch: Math.round(newest),
        hash: h.digest('hex').slice(0, 7),
        dev: true,
      };
      return stamp;
  };
  // INJECTED INTO THE PAGE, NOT IMPORTED. A virtual module would have to be resolved by Vite, and
  // `node --test` imports these files directly — one import of it anywhere in the source and every
  // node-side test dies on an unresolvable specifier. A script tag in the HTML costs the source nothing.
  return {
    name: 'fargoal-build-stamp',
    transformIndexHtml() {
      return [{
        tag: 'script',
        injectTo: 'head',
        children: `window.__BUILD = ${JSON.stringify(compute())};`,
      }];
    },
  };
}

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', strictPort: false },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2000 },
  plugins: [precacheManifest(), buildStamp()],
});
