#!/usr/bin/env node

/**
 * Starter payload commands.
 *
 *   node lib/starter/cli.js build    # regenerate starter/ from templates
 *   node lib/starter/cli.js verify   # fail when starter/ differs from a fresh build
 *   node lib/starter/cli.js refresh-template <bundle>/<template> [--manifest <url>]
 *                                    # maintainer: replace an app template cache with its manifest folder and ref
 *   node lib/starter/cli.js check-templates [--manifest <url>]
 *                                    # maintainer: list cached templates that differ from the manifest
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStarterConfig } from './config.js';
import { buildRepositoryStarter, compareStarterFiles, writeStarterFiles } from './payload.js';
import { checkTemplateManifest, fetchTemplateManifest, loadStarterLock, refreshTemplate } from './template-lock.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const [command, ...args] = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

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
  const [bundle, template] = (args[0] ?? '').split('/');
  if (!bundle || !template) {
    console.error('Usage: node lib/starter/cli.js refresh-template <bundle>/<template> [--manifest <url>]');
    process.exit(2);
  }
  const entry = await refreshTemplate({
    root: ROOT,
    config: loadStarterConfig(join(ROOT, 'starter.config.json')),
    lockPath: join(ROOT, 'starter.lock.json'),
    bundle,
    template,
    manifestUrl: option('--manifest'),
    token: process.env.GITHUB_TOKEN,
  });
  console.log(`✅ ${bundle}/${template} ← ${entry.manifestId}: ${entry.repository}/${entry.path}@${entry.ref} (${entry.commit}), ${Object.keys(entry.files).length} files. Run \`npm run build:starter\`.`);
} else if (command === 'check-templates') {
  const manifest = await fetchTemplateManifest(option('--manifest'));
  const messages = checkTemplateManifest(
    loadStarterConfig(join(ROOT, 'starter.config.json')),
    loadStarterLock(join(ROOT, 'starter.lock.json')),
    manifest,
  );
  if (messages.length > 0) {
    console.error(`Templates manifest ${manifest.version} differs from the cache:`);
    for (const message of messages) console.error(`  - ${message}`);
    process.exit(1);
  }
  console.log(`✅ The cached templates match templates manifest ${manifest.version}.`);
} else {
  console.error('Usage: node lib/starter/cli.js build|verify|refresh-template|check-templates');
  process.exit(2);
}
