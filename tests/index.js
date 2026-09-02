// Entry point so `node --test tests/` runs every *.test.js in this directory (Node >= 20).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).sort();
for (const f of files) await import(pathToFileURL(path.join(dir, f)).href);
