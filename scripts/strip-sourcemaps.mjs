#!/usr/bin/env node
/**
 * Strip TypeScript source map files from lib/ before publishing.
 *
 * Source maps in lib/*.js.map reference paths in src/ via sourceRoot.
 * Since src/ is no longer included in the published package (see
 * package.json `files`), the source maps would be dangling references
 * and add ~141 KB to the unpacked package size with no consumer benefit.
 *
 * This script is invoked by the `prepack` lifecycle hook, so dev
 * workflow is unaffected — local `npm run compile` still produces
 * .map files for in-tree debugging.
 *
 * Cross-platform: uses only Node.js fs APIs, no shell commands.
 */
import { readdirSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const libDir = join(__dirname, '..', 'lib');

let removed = 0;
let totalBytes = 0;

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`Skipping ${dir} (does not exist).`);
      return;
    }
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (entry.name.endsWith('.map')) {
      const size = statSync(full).size;
      unlinkSync(full);
      removed++;
      totalBytes += size;
    }
  }
}

walk(libDir);

const kb = (totalBytes / 1024).toFixed(1);
console.log(`Stripped ${removed} source map file(s) from lib/ (${kb} KB freed).`);
