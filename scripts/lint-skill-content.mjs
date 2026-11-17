#!/usr/bin/env node
/**
 * Lint skill content for high-risk shell or remote-execution patterns.
 *
 * Skills are loaded into the workspace and read by an LLM agent which may
 * execute shell commands under user permission. A skill that instructs the
 * agent to fetch and execute remote content is a textbook supply-chain
 * vector — once installed, the agent obeys.
 *
 * This script scans templates/skills/** (canonical source) for patterns
 * that look like remote code execution. It also scans the starter sources
 * (templates/starter/**) and the generated starter payload. The starter's
 * one-liners are an approved exception (FRD-0004, D-023): a download-then-run
 * line is allowed only in a generated start.md and only for the configured
 * raw installer URL.
 *
 * Fails CI if any are found. A reviewer-approved override can use an inline
 * `<!-- skill-lint: allow <reason> -->` comment on the same line, but PRs
 * with such overrides should call out the justification.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const REPO_ROOT = process.cwd();
const SKILLS_ROOT = join(REPO_ROOT, 'templates', 'skills');
const STARTER_CONFIG = join(REPO_ROOT, 'starter.config.json');
const starterSource = existsSync(STARTER_CONFIG)
  ? JSON.parse(readFileSync(STARTER_CONFIG, 'utf-8')).source
  : null;
const STARTER_PAYLOAD = starterSource ? starterSource.path : null;
const STARTER_RAW_BASE = starterSource
  ? `https://raw.githubusercontent.com/${starterSource.repository}/${starterSource.branch}/${starterSource.path}`
  : null;
const ROOTS = [
  { dir: SKILLS_ROOT, extensions: ['.md'] },
  { dir: join(REPO_ROOT, 'templates', 'starter'), extensions: ['.md', '.sh', '.ps1'] },
  ...(STARTER_PAYLOAD ? [{ dir: join(REPO_ROOT, ...STARTER_PAYLOAD.split('/')), extensions: ['.md', '.sh', '.ps1'] }] : []),
];

// Each pattern: { name, regex, reason }
const PATTERNS = [
  {
    name: 'curl-pipe-shell',
    regex: /\bcurl\b[^|\n]*\|\s*(?:sh|bash|zsh|fish)\b/i,
    reason: 'curl <url> | sh — remote-code-execution dropper pattern',
  },
  {
    name: 'wget-pipe-shell',
    regex: /\bwget\b[^|\n]*\|\s*(?:sh|bash|zsh|fish)\b/i,
    reason: 'wget <url> | sh — remote-code-execution dropper pattern',
  },
  {
    name: 'eval-dollar-paren',
    regex: /\beval\s+["']?\$\(/,
    reason: 'eval $(...) — dynamic shell execution of command output',
  },
  {
    name: 'iex-invoke-expression',
    regex: /Invoke-Expression\s*[(`'"\s].*[Dd]ownload/i,
    reason: 'Invoke-Expression on downloaded content (PowerShell RCE pattern)',
  },
  {
    name: 'iex-shorthand',
    regex: /\biex\s*[(`'"\s].*[Dd]ownload/i,
    reason: 'iex on downloaded content (PowerShell RCE pattern)',
  },
  {
    name: 'base64-decode-execute',
    regex: /base64\s+(?:-d|--decode)[^|\n]*\|\s*(?:sh|bash|node|python)/i,
    reason: 'base64 -d | sh — obfuscated remote code execution',
  },
  {
    name: 'scriptblock-remote',
    regex: /\[scriptblock\]::Create\(\s*\(?\s*(?:Invoke-RestMethod|Invoke-WebRequest|irm|iwr)\b/i,
    reason: 'Script block created from downloaded content (PowerShell RCE pattern)',
  },
  {
    name: 'download-then-run',
    regex: /\b(?:curl|wget)\b.*\s(?:-o|-O|--output)\s+\S+.*;\s*(?:sh|bash)\s/,
    reason: 'Download to a file, then run it with a shell (RCE pattern)',
  },
  {
    name: 'raw-ip-url',
    regex: /https?:\/\/(?:\d{1,3}\.){3}\d{1,3}\b/,
    reason: 'URL with raw IP address — anomalous, often used in malware C2',
  },
  {
    // Anti-malware engines (Windows Defender, etc.) ship signatures for the
    // exact IOCs from real supply-chain attacks. Documentation that quotes
    // those IOCs verbatim gets the published package quarantined. Always
    // use a placeholder like <ATTACKER-HOST>/<PAYLOAD> in skill content.
    name: 'durabletask-ioc-domain',
    regex: /\bcheck\.git-service\.com\b/i,
    reason: 'Verbatim durabletask C2 domain triggers anti-malware (Trojan:JS/ShaiWorm). Replace with <ATTACKER-HOST>.',
  },
  {
    name: 'durabletask-ioc-payload',
    regex: /\b(?:rope|managed)\.pyz\b/,
    reason: 'Verbatim durabletask payload filename triggers anti-malware (Trojan:JS/ShaiWorm). Replace with <PAYLOAD>.',
  },
];

const ALLOW_COMMENT = /<!--\s*skill-lint:\s*allow\s+(.+?)\s*-->/i;

const findings = [];

// The exact one-liners that src/starter/build.ts generates (powerShellCommand,
// posixCommand). The whole line must match, so nothing can be prepended,
// appended, or hidden in a comment next to the approved URL.
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const NAME = '[a-z0-9][a-z0-9-]*';
const AGENT = '(?:<agent>|copilot|claude|codex)';
const STARTER_ONE_LINERS = STARTER_RAW_BASE ? {
  'scriptblock-remote': new RegExp(`^& \\(\\[scriptblock\\]::Create\\(\\(Invoke-RestMethod '${escapeRegExp(`${STARTER_RAW_BASE}/install.ps1`)}'\\)\\)\\) -Bundle ${NAME}(?: -Template ${NAME})? -Agent ${AGENT} -Json$`),
  'download-then-run': new RegExp(`^${escapeRegExp(`(set -eu; installer=$(mktemp); trap 'rm -f "$installer"' EXIT; curl -fsSL --proto '=https' --proto-redir '=https' '${STARTER_RAW_BASE}/install.sh' -o "$installer"; sh "$installer" --bundle `)}${NAME}(?: --template ${NAME})? --agent ${AGENT} --json\\)$`),
} : {};

function isApprovedStarterOneLiner(rel, line, pattern) {
  const expected = STARTER_ONE_LINERS[pattern.name];
  if (!expected || !STARTER_PAYLOAD) return false;
  if (!rel.startsWith(`${STARTER_PAYLOAD}/`) || !rel.endsWith('/start.md')) return false;
  return expected.test(line);
}

function walk(dir, extensions) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, extensions);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!extensions.includes(extname(entry.name).toLowerCase())) continue;
    const rel = full.slice(REPO_ROOT.length + 1).replaceAll('\\', '/');
    const size = statSync(full).size;
    if (size > 1_000_000) continue;
    const content = readFileSync(full, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const pattern of PATTERNS) {
        if (pattern.regex.test(line)) {
          // Check for allowlist override on the same line
          const allow = line.match(ALLOW_COMMENT);
          if (allow) continue;
          if (isApprovedStarterOneLiner(rel, line, pattern)) continue;
          findings.push({
            file: rel,
            line: i + 1,
            pattern: pattern.name,
            reason: pattern.reason,
            text: line.trim().slice(0, 200),
          });
        }
      }
    }
  }
}

for (const root of ROOTS) walk(root.dir, root.extensions);

if (findings.length === 0) {
  console.log('✅ Skill content lint: no risky shell/RCE patterns found in templates/skills/**, templates/starter/**, or the starter payload');
  process.exit(0);
}

console.error('❌ Skill content lint failed. Found high-risk patterns in skill markdown:');
console.error('');
for (const f of findings) {
  console.error(`  ${f.file}:${f.line} [${f.pattern}]`);
  console.error(`    ${f.reason}`);
  console.error(`    > ${f.text}`);
  console.error('');
}
console.error('Options:');
console.error('  1. Remove the offending content from the skill.');
console.error('  2. If the pattern is intentional documentation, add an inline marker:');
console.error('         <!-- skill-lint: allow <one-sentence reason> -->');
console.error('     on the same line. PRs with allowlist comments require explicit reviewer attention.');
process.exit(1);
