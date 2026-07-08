#!/usr/bin/env node
/**
 * Audit the repository for references to NPM_TOKEN or other npm publish
 * credentials. This repo does NOT publish to npm — the downstream Microsoft
 * mirror pipeline handles publishing. Any reference to `NPM_TOKEN` or
 * `secrets.NPM_TOKEN` in workflows, scripts, or CI is a footgun:
 *
 *   - Someone may add the secret to GitHub repo settings to "make it work"
 *   - That secret then becomes a high-value target for credential theft
 *   - A compromised token bypasses code review entirely (durabletask pattern)
 *
 * This script searches workflow / script files for such references and prints
 * a warning. Documentation files (`.md`) are intentionally NOT scanned —
 * docs may legitimately discuss the policy. The script does not access any
 * GitHub admin APIs.
 *
 * Exit code 0: no references found (clean). Exit code 1: references found
 * (require manual review).
 *
 * Usage: node scripts/audit-npm-token.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const REPO_ROOT = process.cwd();

const IGNORE_DIRS = new Set([
  'node_modules',
  'lib',
  'dist',
  '.git',
  'coverage',
  'reports',
  'docs', // policy docs may discuss the patterns — not a real risk surface
  'azure-pipelines', // internal AzDO mirror pipelines intentionally publish packages
]);

const SCAN_EXTENSIONS = new Set([
  '.yml',
  '.yaml',
  '.json',
  '.mjs',
  '.cjs',
  '.js',
  '.ts',
  '.sh',
  '.ps1',
]);

// Patterns that indicate a place where npm publish credentials might be used.
const PATTERNS = [
  /NPM_TOKEN/,
  /secrets\.NPM_TOKEN/,
  /NODE_AUTH_TOKEN/,
  /\bnpm\s+publish\b/,
];

// This audit script itself describes the patterns — exclude it from matches.
const SELF_PATH = 'scripts/audit-npm-token.mjs';

const findings = [];

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!SCAN_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const rel = full.slice(REPO_ROOT.length + 1).replaceAll('\\', '/');
    if (rel === SELF_PATH) continue;
    if (rel.startsWith('PLAN-')) continue;
    try {
      const size = statSync(full).size;
      if (size > 500_000) continue; // skip very large generated files
      const content = readFileSync(full, 'utf-8');
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        for (const pattern of PATTERNS) {
          if (pattern.test(lines[i])) {
            findings.push({
              file: rel,
              line: i + 1,
              text: lines[i].trim().slice(0, 200),
              pattern: pattern.source,
            });
            break;
          }
        }
      }
    } catch {
      // Skip binary or unreadable files
    }
  }
}

walk(REPO_ROOT);

if (findings.length === 0) {
  console.log('✅ No NPM_TOKEN / npm publish references found in workflows or scripts.');
  console.log('   Reminder: confirm GitHub repo Settings → Secrets has no NPM_TOKEN secret.');
  process.exit(0);
}

console.error('⚠️  Found references to npm publish credentials in workflows or scripts.');
console.error('   This repository does NOT publish to npm — the mirror pipeline does.');
console.error('   These references are footguns. Review each finding:');
console.error('');
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    matches /${f.pattern}/`);
  console.error(`    > ${f.text}`);
  console.error('');
}
console.error('Action items:');
console.error('  1. Verify GitHub repo Settings → Secrets has no NPM_TOKEN configured.');
console.error('     If it exists, remove it (this repo does not publish).');
console.error('  2. Remove the offending lines, or document why they are intentional.');
console.error('  3. Re-run this audit until it reports clean.');
process.exit(1);
