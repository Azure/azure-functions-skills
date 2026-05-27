#!/usr/bin/env node
/**
 * Reject disallowed lifecycle scripts in package.json.
 *
 * Lifecycle scripts that run on `npm install` (`preinstall`, `postinstall`)
 * are a classic supply-chain attack surface (durabletask, @antv, et al).
 * This repo deliberately ships none. The only allowed lifecycle hook is
 * `prepack`, which runs only at maintainer-time during `npm pack` / publish
 * preparation (not on user install).
 *
 * Fails CI if any disallowed script is present.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DISALLOWED = ['preinstall', 'postinstall', 'postpack', 'prepublish', 'prepublishOnly'];

const pkgPath = join(process.cwd(), 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const scripts = pkg.scripts ?? {};

const present = DISALLOWED.filter(name => typeof scripts[name] === 'string');

if (present.length > 0) {
  console.error('❌ package.json defines disallowed lifecycle scripts:');
  for (const name of present) {
    console.error(`   - ${name}: ${scripts[name]}`);
  }
  console.error('');
  console.error('   These run on every `npm install` and are a supply-chain attack surface.');
  console.error('   Only `prepack` is allowed (maintainer-time, no user impact).');
  console.error('   See CONTRIBUTING.md → Security policy for skill and CI changes.');
  process.exit(1);
}

console.log('✅ package.json defines no disallowed lifecycle scripts.');
