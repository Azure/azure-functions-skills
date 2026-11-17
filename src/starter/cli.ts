#!/usr/bin/env node

/**
 * Starter payload commands.
 *
 *   node lib/starter/cli.js build    # regenerate starter/ from templates
 *   node lib/starter/cli.js verify   # fail when starter/ differs from a fresh build
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRepositoryStarter, compareStarterFiles, writeStarterFiles } from './payload.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const command = process.argv[2];
const { files, config } = buildRepositoryStarter({ root: ROOT });
const outputDir = join(ROOT, ...config.source.path.split('/'));

if (command === 'build') {
  writeStarterFiles(files, outputDir);
  console.log(`✅ Starter payload → ${config.source.path}/ (${files.size} files)`);
} else if (command === 'verify') {
  const errors = compareStarterFiles(files, outputDir);
  if (errors.length > 0) {
    console.error('Generated starter payload is out of date. Run `npm run build:starter`.');
    for (const error of errors.slice(0, 50)) console.error(`  - ${error}`);
    if (errors.length > 50) console.error(`  ... and ${errors.length - 50} more`);
    process.exit(1);
  }
  console.log('✅ Starter payload is up to date.');
} else {
  console.error('Usage: node lib/starter/cli.js build|verify');
  process.exit(2);
}
