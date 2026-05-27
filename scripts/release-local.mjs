#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';

const DEFAULT_REPO = 'Azure/azure-functions-skills';

function printHelp() {
  console.log(`Local release helper for @azure/functions-skills

Usage:
  npm run release:local -- <version> [options]

Examples:
  npm run release:local -- 0.12.0 --yes
  npm run release:local -- v0.12.0 --github-account TsuyoshiUshio --yes
  npm run release:local -- 0.12.0 --dry-run

What it does:
  1. Verifies main is clean and matches origin/main.
  2. Verifies .github/workflows/publish.yml will not publish on tag push.
  3. Bumps package.json/package-lock.json when needed, commits, and pushes main.
  4. Runs npm ci, npm run check, and npm pack --dry-run.
  5. Creates a local annotated tag.
  6. Publishes @azure/functions-skills to npm.
  7. Pushes the tag.
  8. Best-effort: creates a GitHub Release with plugin bundle zip.

Options:
  --yes                     Skip the interactive confirmation prompt.
  --dry-run                 Print mutating commands without running them.
  --skip-npm-ci             Do not run npm ci.
  --skip-check              Do not run npm run check.
  --skip-npm-publish        Do not publish to npm.
  --skip-github-release     Do not create a GitHub Release.
  --require-github-release  Fail if GitHub Release creation is unavailable.
  --no-push-main            Do not push the version-bump commit to origin/main.
  --repo <owner/name>       GitHub repository for release creation. Default: ${DEFAULT_REPO}.
  --github-account <user>   Run gh auth switch before GitHub Release operations.
  -h, --help                Show this help.
`);
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    githubAccount: null,
    repo: DEFAULT_REPO,
    requireGitHubRelease: false,
    skipCheck: false,
    skipGitHubRelease: false,
    skipNpmCi: false,
    skipNpmPublish: false,
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
    else if (arg === '--skip-npm-publish') options.skipNpmPublish = true;
    else if (arg === '--skip-github-release') options.skipGitHubRelease = true;
    else if (arg === '--require-github-release') options.requireGitHubRelease = true;
    else if (arg === '--no-push-main') options.skipPushMain = true;
    else if (arg === '--repo' && argv[i + 1]) options.repo = argv[++i];
    else if (arg === '--github-account' && argv[i + 1]) options.githubAccount = argv[++i];
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else if (!version) version = arg;
    else throw new Error(`Unexpected argument: ${arg}`);
  }

  return { help: false, options, version };
}

function normalizeVersion(input) {
  if (!input) throw new Error('Version is required. Example: npm run release:local -- 0.12.0 --yes');
  const version = input.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid version: ${input}`);
  }
  return version;
}

function commandForLog(command, args) {
  return [command, ...args].map(part => /\s/.test(part) ? JSON.stringify(part) : part).join(' ');
}

function run(command, args, { allowFailure = false, capture = false, cwd = process.cwd(), dryRun = false } = {}) {
  const label = commandForLog(command, args);
  if (dryRun) {
    console.log(`[dry-run] ${label}`);
    return '';
  }

  console.log(`$ ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: capture ? 'pipe' : 'inherit',
  });

  if (result.error && !allowFailure) throw result.error;
  if ((result.status ?? 1) !== 0 && !allowFailure) {
    const details = capture ? `${result.stdout || ''}${result.stderr || ''}`.trim() : '';
    throw new Error(`Command failed: ${label}${details ? `\n${details}` : ''}`);
  }

  return capture ? (result.stdout || '').trim() : '';
}

function tryRun(command, args, { cwd = process.cwd() } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    status: result.status,
  };
}

function assertCleanMain() {
  const branch = run('git', ['branch', '--show-current'], { capture: true });
  if (branch !== 'main') throw new Error(`Run this from main. Current branch: ${branch || '(detached)'}`);

  const status = run('git', ['status', '--porcelain'], { capture: true });
  if (status) throw new Error(`Working tree must be clean before release:\n${status}`);

  run('git', ['fetch', 'origin', 'main', '--tags']);
  const head = run('git', ['rev-parse', 'HEAD'], { capture: true });
  const originMain = run('git', ['rev-parse', 'origin/main'], { capture: true });
  if (head !== originMain) {
    throw new Error(`main must match origin/main before release.\nHEAD:        ${head}\norigin/main: ${originMain}`);
  }
}

function assertPublishWorkflowDisabled() {
  const workflowPath = join(process.cwd(), '.github', 'workflows', 'publish.yml');
  if (!existsSync(workflowPath)) return;
  const workflow = readFileSync(workflowPath, 'utf8');
  const hasTagTrigger = /push:\s*[\s\S]*?tags:\s*[\s\S]*?['"]?v\*/m.test(workflow);
  const hasDisabledJob = /if:\s*\$\{\{\s*false\s*\}\}/m.test(workflow);
  if (hasTagTrigger && !hasDisabledJob) {
    throw new Error('publish.yml still appears to publish on v* tag pushes. Disable it before running this script.');
  }
}

function readPackageJson() {
  return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
}

function assertVersionIsAvailable(packageName, version) {
  const result = tryRun('npm', ['view', `${packageName}@${version}`, 'version']);
  if (result.ok && result.stdout.trim() === version) {
    throw new Error(`${packageName}@${version} is already published to npm.`);
  }
}

function assertTagIsAvailable(tag) {
  const localTag = run('git', ['tag', '--list', tag], { capture: true });
  if (localTag) throw new Error(`Local tag already exists: ${tag}`);

  const remoteTag = run('git', ['ls-remote', '--tags', 'origin', tag], { capture: true });
  if (remoteTag) throw new Error(`Remote tag already exists: ${tag}`);
}

async function promptToContinue(summary, options) {
  console.log(summary);
  if (options.dryRun || options.yes) return;
  if (!process.stdin.isTTY) throw new Error('Refusing to run without --yes in a non-interactive terminal.');

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await readline.question('Continue? Type "release" to proceed: ')).trim();
  readline.close();
  if (answer !== 'release') throw new Error('Release cancelled.');
}

function maybeSwitchGitHubAccount(options) {
  if (!options.githubAccount || options.skipGitHubRelease) return;
  run('gh', ['auth', 'switch', '-h', 'github.com', '-u', options.githubAccount], { dryRun: options.dryRun });
}

function canCreateGitHubRelease(options) {
  if (options.skipGitHubRelease) return false;
  if (options.dryRun) return true;
  const gh = tryRun('gh', ['auth', 'status']);
  if (!gh.ok) return false;
  const repo = tryRun('gh', ['repo', 'view', options.repo, '--json', 'nameWithOwner']);
  return repo.ok;
}

function quotePowerShellPath(path) {
  return `'${path.replace(/'/g, "''")}'`;
}

function compressDirectory(sourceDir, zipPath, options) {
  if (process.platform === 'win32') {
    run('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Compress-Archive -Path ${quotePowerShellPath(sourceDir)} -DestinationPath ${quotePowerShellPath(zipPath)} -Force`,
    ], { dryRun: options.dryRun });
    return;
  }

  const distDir = join(process.cwd(), 'dist');
  run('zip', ['-r', zipPath, `${basename(sourceDir)}/`], { cwd: distDir, dryRun: options.dryRun });
}

function buildReleaseNotes(version) {
  return `## Azure Functions Skills v${version}

AI assistant plugins for Azure Functions — one-command setup for GitHub Copilot, Claude Code, and Codex.

### Install with npm

\`\`\`bash
npx @azure/functions-skills@${version} setup
npx @azure/functions-skills@${version} chat
\`\`\`

### Plugin bundles

Download the plugin payload zip and register the extracted directory with your agent's plugin-from-source flow.

| Artifact | Download |
| --- | --- |
| Cross-tool plugin payload | \`azure-functions-skills-plugin-${version}.zip\` |

### What's new

See the auto-generated changelog below.
`;
}

function createReleaseAssets(version, options) {
  const releaseDir = mkdtempSync(join(tmpdir(), `azure-functions-skills-v${version}-`));
  const assets = [];

  const sourceDir = join(process.cwd(), 'dist', 'plugin', 'azure-functions-skills');
  if (!existsSync(sourceDir) && !options.dryRun) {
    throw new Error(`Missing ${sourceDir}. Run npm run build first.`);
  }
  const zipPath = join(releaseDir, `azure-functions-skills-plugin-${version}.zip`);
  compressDirectory(sourceDir, zipPath, options);
  assets.push(zipPath);

  const notesPath = join(releaseDir, 'release_notes.md');
  if (options.dryRun) console.log(`[dry-run] write ${notesPath}`);
  else writeFileSync(notesPath, buildReleaseNotes(version));

  return { assets, notesPath };
}

function maybeCreateGitHubRelease(tag, version, options) {
  const available = canCreateGitHubRelease(options);
  if (!available) {
    const message = 'GitHub Release creation is unavailable for the current gh auth/repo context; skipping release creation.';
    if (options.requireGitHubRelease) throw new Error(message);
    console.warn(`⚠️  ${message}`);
    return;
  }

  const existing = !options.dryRun ? tryRun('gh', ['release', 'view', tag, '--repo', options.repo]) : { ok: false };
  if (existing.ok) throw new Error(`GitHub Release already exists: ${tag}`);

  const { assets, notesPath } = createReleaseAssets(version, options);
  run('gh', [
    'release',
    'create',
    tag,
    ...assets,
    '--repo',
    options.repo,
    '--title',
    tag,
    '--notes-file',
    notesPath,
    '--generate-notes',
  ], { dryRun: options.dryRun });
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
  assertPublishWorkflowDisabled();
  maybeSwitchGitHubAccount(options);

  const pkg = readPackageJson();
  assertVersionIsAvailable(pkg.name, version);
  assertTagIsAvailable(tag);

  await promptToContinue(`Preparing release:
  package: ${pkg.name}
  version: ${version}
  tag:     ${tag}
  repo:    ${options.repo}
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

  if (!options.skipNpmCi) run('npm', ['ci'], { dryRun: options.dryRun });
  if (!options.skipCheck) run('npm', ['run', 'check'], { dryRun: options.dryRun });
  else if (!existsSync(join(process.cwd(), 'dist'))) run('npm', ['run', 'build'], { dryRun: options.dryRun });

  run('npm', ['pack', '--dry-run']);
  run('git', ['tag', '-a', tag, '-m', tag], { dryRun: options.dryRun });

  if (!options.skipNpmPublish) run('npm', ['publish', '--access', 'public'], { dryRun: options.dryRun });
  else console.log('Skipping npm publish by request.');

  run('git', ['push', 'origin', tag], { dryRun: options.dryRun });
  maybeCreateGitHubRelease(tag, version, options);

  console.log(`✅ Release ${tag} complete.`);
}

try {
  await main();
} catch (error) {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
