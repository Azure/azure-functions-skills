#!/usr/bin/env node

/**
 * Local release helper for @azure/functions-skills.
 *
 * This repository does NOT publish to npm. The package is published by a
 * downstream Microsoft mirror pipeline triggered by tags pushed here.
 *
 * The helper does:
 *   1. Verifies main is clean and matches origin/main.
 *   2. Verifies npm has not already published this version.
 *   3. Bumps package.json / package-lock.json when needed.
 *   4. Regenerates the plugin payload.
 *   5. Runs npm ci and npm run check.
 *   6. Creates an annotated git tag.
 *   7. Pushes main (if bumped) and the tag.
 *
 * The tag push triggers `.github/workflows/draft-release.yml`, which creates a
 * draft GitHub Release with auto-generated notes. The mirror pipeline picks up
 * the tag separately and publishes the npm package.
 *
 * Nothing in this script handles npm credentials or publishes anywhere.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

function printHelp() {
  console.log(`Local release helper for @azure/functions-skills

Usage:
  npm run release:local -- <version> [options]

Examples:
  npm run release:local -- 0.0.5-preview --yes
  npm run release:local -- 0.0.5-preview --dry-run

What it does:
  1. Verifies main is clean and matches origin/main.
  2. Verifies npm has not already published this version.
  3. Bumps package.json/package-lock.json when needed, commits, and pushes main.
  4. Runs npm ci and npm run check.
  5. Creates an annotated tag.
  6. Pushes the tag, which triggers draft-release.yml to create a draft GitHub Release.

What it does NOT do:
  - Publish to npm. The downstream mirror pipeline handles that.
  - Create a GitHub Release directly. The draft-release.yml workflow handles that.

Options:
  --yes              Skip the interactive confirmation prompt.
  --dry-run          Print mutating commands without running them.
  --skip-npm-ci      Do not run npm ci.
  --skip-check       Do not run npm run check.
  --no-push-main     Do not push the version-bump commit to origin/main.
  -h, --help         Show this help.
`);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    skipCheck: false,
    skipNpmCi: false,
    skipPushMain: false,
    yes: false,
  };
  let version = null;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') return { help: true, options, version };
    if (arg === '--yes') options.yes = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--skip-npm-ci') options.skipNpmCi = true;
    else if (arg === '--skip-check') options.skipCheck = true;
    else if (arg === '--no-push-main') options.skipPushMain = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else if (!version) version = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  return { help: false, options, version };
}

function normalizeVersion(input) {
  if (!input) throw new Error('Version is required. Example: npm run release:local -- 0.0.5-preview --yes');
  const version = input.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid version: ${input}`);
  }
  return version;
}

function run(cmd, args, { cwd = process.cwd(), dryRun = false, capture = false } = {}) {
  if (dryRun) {
    console.log(`[dry-run] ${cmd} ${args.join(' ')}`);
    return capture ? '' : undefined;
  }
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')} (exit ${result.status})`);
  }
  return capture ? (result.stdout?.trim() ?? '') : undefined;
}

function tryRun(cmd, args, { cwd = process.cwd() } = {}) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf-8',
    shell: process.platform === 'win32',
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function assertCleanMain() {
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { capture: true });
  if (branch !== 'main') {
    throw new Error(`Release must be cut from main; current branch is ${branch}.`);
  }
  const dirty = run('git', ['status', '--porcelain'], { capture: true });
  if (dirty) {
    throw new Error(`Working tree must be clean. Uncommitted changes:\n${dirty}`);
  }
  run('git', ['fetch', 'origin', 'main'], {});
  const head = run('git', ['rev-parse', 'HEAD'], { capture: true });
  const originMain = run('git', ['rev-parse', 'origin/main'], { capture: true });
  if (head !== originMain) {
    throw new Error(`main must match origin/main before release.\nHEAD:        ${head}\norigin/main: ${originMain}`);
  }
}

function readPackageJson() {
  return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
}

function assertVersionIsAvailable(packageName, version) {
  // Verify the version has not already been published to npm by the mirror.
  const result = tryRun('npm', ['view', `${packageName}@${version}`, 'version']);
  if (result.ok && result.stdout.trim() === version) {
    throw new Error(`${packageName}@${version} is already published to npm.`);
  }
}

function assertTagIsAvailable(tag) {
  const localTag = run('git', ['tag', '--list', tag], { capture: true });
  if (localTag) throw new Error(`Local tag already exists: ${tag}`);
  const remote = tryRun('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  if (remote.ok && remote.stdout.includes(tag)) {
    throw new Error(`Remote tag already exists: ${tag}`);
  }
}

async function promptToContinue(summary, options) {
  console.log(summary);
  if (options.yes) {
    console.log('Skipping confirmation (--yes provided).');
    return;
  }
  if (!process.stdin.isTTY) {
    throw new Error('Interactive confirmation required. Re-run with --yes for non-interactive runs.');
  }
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await readline.question('Continue? Type "release" to proceed: ')).trim();
  readline.close();
  if (answer !== 'release') throw new Error('Release cancelled.');
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelp();
    return;
  }

  const version = normalizeVersion(parsed.version);
  const tag = `v${version}`;
  const { options } = parsed;

  assertCleanMain();

  const pkg = readPackageJson();
  assertVersionIsAvailable(pkg.name, version);
  assertTagIsAvailable(tag);

  await promptToContinue(`Preparing release:
  package: ${pkg.name}
  version: ${version}
  tag:     ${tag}

Note: this script does NOT publish to npm. The downstream mirror pipeline
picks up the pushed tag and publishes ${pkg.name}@${version}.
`, options);

  if (pkg.version !== version) {
    run('npm', ['version', version, '--no-git-tag-version'], { dryRun: options.dryRun });
    run('npm', ['run', 'build:plugin-payload'], { dryRun: options.dryRun });
    run('git', [
      'add',
      'package.json',
      'package-lock.json',
      '.github/plugins/azure-functions-skills',
      '.plugin/marketplace.json',
      '.claude-plugin/marketplace.json',
    ], { dryRun: options.dryRun });
    run('git', ['commit', '-m', `chore: prepare ${tag} release`], { dryRun: options.dryRun });
    if (!options.skipPushMain) run('git', ['push', 'origin', 'main'], { dryRun: options.dryRun });
  } else {
    console.log(`package.json is already at ${version}; no version-bump commit needed.`);
  }

  if (!options.skipNpmCi) run('npm', ['ci', '--ignore-scripts'], { dryRun: options.dryRun });
  if (!options.skipCheck) run('npm', ['run', 'check'], { dryRun: options.dryRun });
  else if (!existsSync(join(process.cwd(), 'dist'))) run('npm', ['run', 'build'], { dryRun: options.dryRun });

  run('npm', ['pack', '--dry-run']);
  run('git', ['tag', '-a', tag, '-m', tag], { dryRun: options.dryRun });
  run('git', ['push', 'origin', tag], { dryRun: options.dryRun });

  console.log(`✅ Tag ${tag} pushed. A draft GitHub Release will be created by draft-release.yml.`);
  console.log(`   The downstream mirror pipeline will publish ${pkg.name}@${version} to npm separately.`);
}

try {
  await main();
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
