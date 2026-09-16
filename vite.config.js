import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';

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

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', strictPort: false },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2000 },
  plugins: [precacheManifest()],
});
