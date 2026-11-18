#!/usr/bin/env node

/**
 * Starter payload commands.
 *
 *   node lib/starter/cli.js build    # regenerate starter/ from templates
 *   node lib/starter/cli.js verify   # fail when starter/ differs from a fresh build
 *   node lib/starter/cli.js refresh-template <bundle>/<template> --ref <tag-or-sha> [--repository <owner/name>]
 *                                    # maintainer: replace an app template cache with one upstream commit
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStarterConfig } from './config.js';
import { buildRepositoryStarter, compareStarterFiles, writeStarterFiles } from './payload.js';
import { refreshTemplate } from './template-lock.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const [command, ...args] = process.argv.slice(2);

if (command === 'build' || command === 'verify') {
  const { files, config } = buildRepositoryStarter({ root: ROOT });
  const outputDir = join(ROOT, ...config.source.path.split('/'));
  if (command === 'build') {
    writeStarterFiles(files, outputDir);
    console.log(`✅ Starter payload → ${config.source.path}/ (${files.size} files)`);
  } else {
    const errors = compareStarterFiles(files, outputDir);
    if (errors.length > 0) {
      console.error('Generated starter payload is out of date. Run `npm run build:starter`.');
      for (const error of errors.slice(0, 50)) console.error(`  - ${error}`);
      if (errors.length > 50) console.error(`  ... and ${errors.length - 50} more`);
      process.exit(1);
    }
    console.log('✅ Starter payload is up to date.');
  }
} else if (command === 'refresh-template') {
  const [target, ...rest] = args;
  const option = (name: string): string | undefined => {
    const index = rest.indexOf(name);
    return index >= 0 ? rest[index + 1] : undefined;
  };
  const [bundle, template] = (target ?? '').split('/');
  const ref = option('--ref');
  if (!bundle || !template || !ref) {
    console.error('Usage: node lib/starter/cli.js refresh-template <bundle>/<template> --ref <tag-or-sha> [--repository <owner/name>]');
    process.exit(2);
  }
  const entry = await refreshTemplate({
    root: ROOT,
    config: loadStarterConfig(join(ROOT, 'starter.config.json')),
    lockPath: join(ROOT, 'starter.lock.json'),
    bundle,
    template,
    ref,
    repository: option('--repository'),
    token: process.env.GITHUB_TOKEN,
  });
  console.log(`✅ ${bundle}/${template} ← ${entry.repository}@${entry.ref} (${entry.commit}), ${Object.keys(entry.files).length} files. Run \`npm run build:starter\`.`);
} else {
  console.error('Usage: node lib/starter/cli.js build|verify|refresh-template');
  process.exit(2);
}
