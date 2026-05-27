#!/usr/bin/env node
/**
 * Generate an HTML report comparing doctor --deep AI findings against
 * expected results documented in tests/fixtures/doctor-bad-apps/expected-results.md.
 *
 * Reads each `<fixture>/doctor-result.json` (produced by running doctor against
 * the fixture) and matches AI findings to expected ones using keyword groups.
 *
 * Usage:
 *   node scripts/doctor-validation-report.mjs [--fixtures-dir <path>] [--output <path>]
 *
 * Defaults:
 *   --fixtures-dir  current working directory
 *   --output        <fixtures-dir>/ai-validation-report.html
 *
 * Typical workflow:
 *   .\scripts\doctor-e2e-setup.ps1 -Target <tmp> -DeepOnly
 *   cd <tmp>
 *   .\run-all.ps1 -Deep -Agent github-copilot
 *   node <repo>\scripts\doctor-validation-report.mjs --fixtures-dir .
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fixtures-dir' || a === '-d') out.fixturesDir = argv[++i];
    else if (a === '--output' || a === '-o') out.output = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
    else if (!a.startsWith('-') && !out.fixturesDir) out.fixturesDir = a;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: node doctor-validation-report.mjs [--fixtures-dir <path>] [--output <path>]`);
  process.exit(0);
}
const fixturesDir = resolve(args.fixturesDir || process.cwd());
const outputPath = resolve(args.output || join(fixturesDir, 'ai-validation-report.html'));

/**
 * Expected findings per fixture.
 * Each entry: { description, keywords: [[ANY_OF_GROUP_1], [ANY_OF_GROUP_2], ...] }
 * A finding matches if EVERY keyword group has at least one keyword in title+message+file.
 * Use lowercased substring matching.
 */
const EXPECTED = {
  'node-deep-client-reuse': [
    { id: 'CQ-001/JS-006', desc: 'CosmosClient created inside handler (should be module-level)',
      keywords: [['cosmosclient', 'cosmos client', 'cosmos db client'], ['per invocation', 'inside handler', 'module-level', 'reuse', 'each invocation', 'every request', 'singleton']] },
    { id: 'CQ-004', desc: 'Fire-and-forget promise — items.create not awaited',
      keywords: [['await', 'fire-and-forget', 'fire and forget', 'unawaited', 'not awaited', 'floating promise']] },
    { id: 'CQ-007', desc: 'No try/catch around external fetch()',
      keywords: [['try', 'catch', 'error handling', 'exception']] },
  ],
  'node-deep-anonymous-admin': [
    { id: 'SC-002', desc: 'Anonymous auth on admin/destructive endpoint',
      keywords: [['anonymous', 'authlevel'], ['admin', 'delete', 'destructive', 'auth', 'unauthenticated']] },
    { id: 'SC-009', desc: 'SQL injection via unvalidated userId',
      keywords: [['sql injection', 'sql', 'injection', 'parameteriz', 'sanitiz', 'unvalidat']] },
    { id: 'CQ-003', desc: 'CPU-intensive computeHash blocking',
      keywords: [['cpu', 'blocking', 'expensive', 'sync', 'computehash', 'iteration', 'hash', 'tight loop']] },
  ],
  'node-deep-secrets-obfuscated': [
    { id: 'SC-001', desc: 'Storage account key split across variables',
      keywords: [['secret', 'key', 'credential', 'connection string', 'hardcod'], ['split', 'concatenat', 'obfuscat', 'accountkey', 'storage']] },
    { id: 'JS-005', desc: 'tsconfig CommonJS vs ESM mismatch',
      keywords: [['tsconfig', 'module', 'commonjs', 'esm', 'esmodule', 'cjs']] },
  ],
  'node-deep-durable-nondeterministic': [
    { id: 'Durable', desc: 'Date.now() in orchestrator',
      keywords: [['date.now', 'date now', 'currentutcdatetime', 'current utc']] },
    { id: 'Durable', desc: 'Math.random() in orchestrator',
      keywords: [['math.random', 'random', 'non-deterministic', 'nondeterministic', 'deterministic']] },
    { id: 'Durable', desc: 'fetch() in orchestrator',
      keywords: [['fetch', 'http', 'callhttp', 'activity']] },
    { id: 'Durable', desc: 'setTimeout in orchestrator',
      keywords: [['settimeout', 'createtimer', 'timer']] },
  ],
  'node-deep-eventhub-no-idempotency': [
    { id: 'CQ-005/EH-005', desc: 'Payment without idempotency key',
      keywords: [['idempot'], ['payment', 'charge', 'replay', 'duplicate']] },
    { id: 'EH-004', desc: 'Throwing blocks checkpoint',
      keywords: [['throw', 'exception', 'checkpoint', 'batch', 'block']] },
    { id: 'CQ-005', desc: 'Irreversible side effect (email) before state tracking',
      keywords: [['email', 'side effect', 'irreversible', 'before', 'order', 'tracking']] },
  ],
  'node-deep-servicebus-autocomplete': [
    { id: 'autoComplete', desc: 'autoComplete conflict with throw',
      keywords: [['autocomplete', 'auto complete', 'auto-complete'], ['conflict', 'throw', 'retry', 'manual']] },
    { id: 'DP-004', desc: 'Connection name mismatch ServiceBusConnection vs ServiceBusConn',
      keywords: [['connection'], ['mismatch', 'servicebusconn', 'servicebusconnection', 'binding', 'setting']] },
    { id: 'EH-003', desc: 'No dead-letter strategy',
      keywords: [['dead-letter', 'dead letter', 'dlq', 'poison']] },
  ],
  'node-deep-output-binding-errors': [
    { id: 'CQ-008', desc: 'Cosmos DB output binding without conflict handling',
      keywords: [['output binding', 'cosmos'], ['conflict', 'throttl', 'error', 'failure', 'no way to handle']] },
    { id: 'CQ-007', desc: 'Returns success without verifying output binding',
      keywords: [['success', 'verif', 'confirm', 'binding succeed', 'before', 'return']] },
  ],
  'python-deep-blocking-sync': [
    { id: 'PY-002', desc: 'requests library — synchronous HTTP',
      keywords: [['requests', 'sync', 'synchronous'], ['http', 'block', 'await', 'aiohttp', 'httpx']] },
    { id: 'CQ-006', desc: 'time.sleep blocking worker',
      keywords: [['time.sleep', 'sleep'], ['block', 'worker', 'thread', 'async', 'asyncio']] },
    { id: 'PY-004/CQ-001', desc: 'BlobServiceClient per invocation',
      keywords: [['blobserviceclient', 'blob service client', 'blob client'], ['per invocation', 'each call', 'module', 'reuse', 'inside', 'handler']] },
  ],
  'python-deep-v1-incomplete-deps': [
    { id: 'PY-001', desc: 'Using v1 programming model',
      keywords: [['v1', 'v2', 'programming model', 'decorator', '__init__'], ['v1', 'function.json', 'v2', 'decorator', 'migrate']] },
    { id: 'PY-003', desc: 'azure-cosmos missing from requirements.txt',
      keywords: [['azure-cosmos', 'cosmos'], ['requirements', 'dependenc', 'missing', 'import']] },
  ],
  'python-deep-v2-async-antipatterns': [
    { id: 'PY-002', desc: 'requests.get in async handler blocks event loop',
      keywords: [['requests'], ['async', 'event loop', 'block', 'sync', 'await']] },
    { id: 'PY-004', desc: 'CosmosClient per invocation in async handler',
      keywords: [['cosmosclient', 'cosmos client', 'cosmos db client'], ['per invocation', 'each', 'module', 'reuse', 'inside', 'handler']] },
    { id: 'CQ-002', desc: 'Mutable global state',
      keywords: [['global', 'mutable', 'shared state', 'request_counter', 'processed_items', 'error_log'], ['state', 'global', 'shared', 'cross', 'across']] },
    { id: 'Module-init', desc: 'Module-level HTTP call at cold start',
      keywords: [['module', 'cold start', 'import', 'startup', 'top-level', 'top level'], ['requests', 'http', 'fetch', 'call', 'block']] },
  ],
  'python-deep-secrets-sql-injection': [
    { id: 'SC-001 (SAS)', desc: 'SAS token hardcoded with sig parameter',
      keywords: [['sas', 'token', 'sig', 'blob_sas'], ['hardcod', 'secret', 'credential', 'key', 'embedded']] },
    { id: 'SC-001 (DB)', desc: 'DB password Pwd=SuperSecret123 hardcoded',
      keywords: [['password', 'pwd', 'db_connection', 'connection string', 'credential'], ['hardcod', 'secret', 'plain', 'embedded']] },
    { id: 'SC-009 (id)', desc: 'SQL injection via f-string with user_id',
      keywords: [['sql injection', 'injection', 'f-string', 'fstring', 'string interpolation'], ['user_id', 'id', 'parameter', 'sanitiz', 'sql']] },
    { id: 'SC-009 (columns)', desc: 'SQL injection via columns/table_name',
      keywords: [['sql injection', 'injection', 'f-string', 'fstring', 'interpolation'], ['column', 'table', 'identifier', 'dynamic']] },
    { id: 'CQ-007', desc: 'No try/except around pyodbc operations',
      keywords: [['try', 'except', 'error handling', 'exception'], ['pyodbc', 'cursor', 'connect', 'execute', 'database']] },
  ],
  'csharp-deep-blocking-async': [
    { id: 'CS-001 (.Result)', desc: '.Result on GetAsync deadlock risk',
      keywords: [['.result', 'result blocking', 'sync over async'], ['deadlock', 'block', 'async', 'getasync']] },
    { id: 'CS-001 (.Wait)', desc: '.Wait() on PostAsync',
      keywords: [['.wait', 'wait()', 'sync over async'], ['block', 'async', 'postasync', 'deadlock']] },
    { id: 'CS-003', desc: 'No CancellationToken parameter',
      keywords: [['cancellationtoken', 'cancellation token', 'cancel'], ['parameter', 'missing', 'run', 'method']] },
    { id: 'CS-004', desc: 'new HttpClient() instead of IHttpClientFactory',
      keywords: [['new httpclient', 'httpclient'], ['ihttpclientfactory', 'factory', 'singleton', 'socket exhaust', 'per request', 'reuse']] },
    { id: 'async void', desc: 'async void RunAsync exceptions crash',
      keywords: [['async void'], ['exception', 'crash', 'unhandled']] },
  ],
  'csharp-deep-inprocess-antipatterns': [
    { id: 'CS-002', desc: 'In-process model — should migrate to isolated',
      keywords: [['in-process', 'in process', 'inprocess', 'isolated'], ['migrate', 'model', 'isolated worker', 'isolated-process']] },
    { id: 'CS-004', desc: 'Static HttpClient with finalizer disposal',
      keywords: [['httpclient'], ['finalizer', 'dispose', 'static', '~processitem', 'destructor']] },
    { id: 'DI', desc: 'HttpClient as singleton instead of IHttpClientFactory',
      keywords: [['ihttpclientfactory', 'httpclient factory', 'di anti'], ['singleton', 'register', 'startup', 'di', 'inject']] },
    { id: 'CS-003', desc: 'No CancellationToken on Run',
      keywords: [['cancellationtoken', 'cancellation token'], ['parameter', 'missing', 'run']] },
  ],
  'java-deep-client-reuse': [
    { id: 'JV-001', desc: 'Maven plugin version 1.18.0 outdated',
      keywords: [['maven plugin', 'azure-functions-maven', 'plugin version'], ['1.18', 'outdated', 'old', 'upgrade', 'update']] },
    { id: 'JV-002', desc: 'Java 11 nearing EOL',
      keywords: [['java 11', 'java11'], ['eol', 'end of life', 'support', 'deprecated', 'upgrade', 'java 17', 'java 21']] },
    { id: 'JV-003', desc: 'BlobServiceClient/CosmosClient inside handler',
      keywords: [['blobserviceclient', 'cosmosclient', 'cosmos client', 'blob client'], ['per invocation', 'inside', 'handler', 'reuse', 'singleton', 'each call']] },
    { id: 'CQ-005', desc: 'ServiceBus order processing without idempotency',
      keywords: [['idempot'], ['order', 'servicebus', 'service bus', 'message', 'duplicate', 'replay']] },
    { id: 'CQ-007', desc: 'Empty catch block',
      keywords: [['empty catch', 'swallow', 'silent', 'catch'], ['exception', 'error', 'log', 'silent']] },
    { id: 'Resource', desc: 'CosmosClient never closed',
      keywords: [['cosmosclient', 'cosmos client'], ['close', 'leak', 'dispose', 'shut']] },
  ],
  'powershell-deep-install-module': [
    { id: 'PS-002', desc: 'profile.ps1 heavy with module install/API calls',
      keywords: [['profile.ps1', 'profile'], ['cold start', 'slow', 'install-module', 'heavy', 'startup']] },
    { id: 'PS-003', desc: 'Install-Module in TimerTrigger handler',
      keywords: [['install-module', 'install module'], ['handler', 'run.ps1', 'timer', 'every invocation', 'per invocation']] },
    { id: 'CQ-002', desc: '$env:RUN_COUNT / $global:ProcessedCount state',
      keywords: [['$env', '$global', 'env:', 'global:', 'run_count', 'processedcount'], ['state', 'shared', 'across', 'persist', 'instance']] },
  ],
  'powershell-deep-managed-deps': [
    { id: 'PS-001', desc: 'managedDependency enabled but requirements.psd1 missing',
      keywords: [['manageddependency', 'managed dependency'], ['requirements.psd1', 'missing', 'enabled', 'true']] },
    { id: 'CQ-002', desc: '$global:UserCache as cross-invocation cache',
      keywords: [['$global', 'global:', 'usercache'], ['cache', 'state', 'cross-invocation', 'per-worker', 'shared']] },
    { id: 'CQ-007', desc: 'No error handling around Invoke-RestMethod',
      keywords: [['invoke-restmethod', 'invoke restmethod'], ['try', 'catch', 'error', 'exception', 'handling']] },
  ],
  'node-supply-chain-postinstall': [
    { id: 'SC-101', desc: 'Module-load side effect (detached spawn at require)',
      keywords: [['spawn', 'detached', 'unref', 'module load', 'import time', 'at load'], ['side effect', 'module', 'load', 'import', 'startup']] },
    { id: 'SC-103', desc: 'Silent error suppression around the spawn',
      keywords: [['empty catch', 'silent', 'swallow', 'try', 'catch'], ['error', 'suppress', 'silent', 'empty']] },
  ],
  'node-supply-chain-tracked-env': [
    { id: 'SC-109', desc: 'Hardcoded production secrets in source',
      keywords: [['hardcod', 'secret', 'password', 'key', 'token'], ['db_password', 'aws_access', 'production', 'source', 'literal']] },
  ],
  'node-supply-chain-dropper-pattern': [
    { id: 'SC-101', desc: 'IIFE runs at module load',
      keywords: [['iife', 'self-executing', 'immediately', 'module load', 'import time'], ['side effect', 'load', 'startup']] },
    { id: 'SC-102', desc: 'Fetch then execute downloaded file',
      keywords: [['fetch', 'download', 'https.get', 'urlretrieve', 'retrieve'], ['execute', 'spawn', 'subprocess', 'run']] },
    { id: 'SC-104', desc: 'Raw IP host (C2 indicator)',
      keywords: [['raw ip', 'ip address', '192.0.2', '192.', 'numeric host'], ['c2', 'command and control', 'host', 'url']] },
    { id: 'SC-108', desc: 'Anti-analysis gates (Linux only, CPU >2, skip Russian)',
      keywords: [['linux', 'platform', 'cpu count', 'cpus', 'locale', 'lang'], ['sandbox', 'gate', 'evasion', 'skip', 'anti-analysis']] },
  ],
  'node-supply-chain-credential-collector': [
    { id: 'SC-105', desc: 'Systematic credential harvest from filesystem and env',
      keywords: [['.aws/credentials', '.ssh', '.kube', '.npmrc', 'aws', 'credentials'], ['harvest', 'collect', 'enumerate', 'read', 'walk']] },
    { id: 'SC-105 (env)', desc: 'Env variable regex harvest (TOKEN|SECRET|KEY|PASSWORD)',
      keywords: [['env', 'environment', 'process.env'], ['token', 'secret', 'key', 'password', 'regex', 'match', 'filter']] },
    { id: 'SC-106', desc: 'Persistence via .bashrc append',
      keywords: [['.bashrc', 'bashrc', 'profile', 'shell init'], ['persistence', 'append', 'install', 'autostart']] },
  ],
  'python-supply-chain-c2-import': [
    { id: 'SC-101', desc: 'Top-level import-time code runs at module load',
      keywords: [['top-level', 'module load', 'import time', 'at import'], ['side effect', 'runs at import', 'before handler']] },
    { id: 'SC-102', desc: 'urlretrieve + Popen pattern',
      keywords: [['urlretrieve', 'urllib', 'download', 'request'], ['popen', 'subprocess', 'execute', 'spawn', 'run']] },
    { id: 'SC-103', desc: 'Bare except: pass silences everything',
      keywords: [['bare except', 'except:', 'except pass', 'silent', 'swallow'], ['except', 'pass', 'error', 'suppress']] },
    { id: 'SC-104', desc: 'Hardcoded C2-shaped host',
      keywords: [['check.example', 'rcd-host', 'hardcod', 'host'], ['c2', 'command and control', 'url', 'domain']] },
    { id: 'SC-108', desc: 'Linux-only + Russian-locale skip + low-CPU exit',
      keywords: [['linux', 'platform.system', 'locale', 'lang'], ['russian', 'ru', 'cpu', 'count', 'gate', 'sandbox', 'evasion']] },
  ],
};

function loadFixtureResult(fixtureDir) {
  const reportPath = join(fixtureDir, 'doctor-result.json');
  if (!existsSync(reportPath)) return null;
  try {
    const content = readFileSync(reportPath, 'utf-8');
    // Strip ANSI sequences if any
    // eslint-disable-next-line no-control-regex
    const cleaned = content.replace(/\u001b\[[0-9;]*m/g, '');
    return JSON.parse(cleaned);
  } catch (err) {
    console.error(`Failed to parse ${reportPath}: ${err.message}`);
    return null;
  }
}

function findingHaystack(check) {
  return [
    check.title || '',
    check.message || '',
    check.id || '',
    check.file || '',
    check.recommendation || '',
  ].join(' ').toLowerCase();
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function statusBadge(matched, total) {
  if (total === 0) return `<span class="badge badge-na">N/A</span>`;
  const pct = Math.round((matched / total) * 100);
  let cls = 'badge-bad';
  if (pct === 100) cls = 'badge-good';
  else if (pct >= 60) cls = 'badge-mid';
  return `<span class="badge ${cls}">${matched}/${total} (${pct}%)</span>`;
}

function severityBadge(sev) {
  const cls = `sev-${sev}`;
  return `<span class="sev ${cls}">${escapeHtml(sev)}</span>`;
}

function statusGlyph(matched) {
  return matched
    ? `<span class="glyph glyph-ok">✓ matched</span>`
    : `<span class="glyph glyph-miss">✗ missed</span>`;
}

// ── Build report data ──

const fixtures = readdirSync(fixturesDir, { withFileTypes: true })
  .filter(e => e.isDirectory())
  .map(e => e.name)
  .filter(name => EXPECTED[name])
  .sort();

const fixtureResults = [];
let totalExpected = 0;
let totalMatched = 0;
let totalExtra = 0;

for (const name of fixtures) {
  const fixtureDir = join(fixturesDir, name);
  const report = loadFixtureResult(fixtureDir);
  if (!report) {
    fixtureResults.push({ name, error: 'doctor-result.json not found or invalid' });
    continue;
  }

  const aiChecks = report.tiers?.ai?.checks || [];
  const aiError = report.tiers?.ai?.error;
  const aiDuration = report.tiers?.ai?.durationMs;
  const expected = EXPECTED[name] || [];
  const usedAiChecks = new Set();

  const expectations = expected.map(exp => {
    // Find a matching AI check that's not yet used
    let matchedCheck = null;
    for (const check of aiChecks) {
      if (usedAiChecks.has(check)) continue;
      const hay = findingHaystack(check);
      const allGroupsHit = exp.keywords.every(group =>
        group.some(kw => hay.includes(kw.toLowerCase()))
      );
      if (allGroupsHit) {
        matchedCheck = check;
        usedAiChecks.add(check);
        break;
      }
    }
    return { ...exp, matched: matchedCheck };
  });

  const extras = aiChecks.filter(c => !usedAiChecks.has(c));
  const matchedCount = expectations.filter(e => e.matched).length;

  totalExpected += expectations.length;
  totalMatched += matchedCount;
  totalExtra += extras.length;

  fixtureResults.push({
    name,
    language: report.language,
    summary: report.summary,
    aiError,
    aiDuration,
    aiCount: aiChecks.length,
    expectations,
    extras,
    matchedCount,
  });
}

const recall = totalExpected > 0 ? (totalMatched / totalExpected) * 100 : 0;

// ── Render HTML ──

const generatedAt = new Date().toISOString();

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Doctor Deep AI Validation Report</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 1400px; margin: 2em auto; padding: 0 1em; color: #1a1a1a; line-height: 1.5; }
  h1 { border-bottom: 3px solid #0078d4; padding-bottom: 0.3em; }
  h2 { color: #0078d4; margin-top: 2em; border-bottom: 1px solid #ddd; padding-bottom: 0.2em; }
  h3 { color: #444; margin-top: 1.5em; }
  .meta { color: #666; font-size: 0.9em; }
  .overall { display: flex; gap: 1em; margin: 1em 0; flex-wrap: wrap; }
  .card { background: #f3f9fd; border-left: 4px solid #0078d4; padding: 0.8em 1.2em; border-radius: 4px; flex: 1; min-width: 180px; }
  .card .num { font-size: 1.8em; font-weight: bold; color: #0078d4; }
  .card .label { color: #555; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em; }

  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.92em; }
  th, td { padding: 0.6em 0.8em; text-align: left; vertical-align: top; border-bottom: 1px solid #e8e8e8; }
  th { background: #f5f5f5; font-weight: 600; }
  tr:hover { background: #fafbfc; }

  .badge { display: inline-block; padding: 0.15em 0.6em; border-radius: 10px; font-size: 0.85em; font-weight: 600; }
  .badge-good { background: #dff6dd; color: #107c10; }
  .badge-mid { background: #fff4ce; color: #855700; }
  .badge-bad { background: #fde7e9; color: #a4262c; }
  .badge-na { background: #e1e1e1; color: #555; }

  .sev { display: inline-block; padding: 0.05em 0.45em; border-radius: 3px; font-size: 0.8em; font-weight: 600; text-transform: uppercase; }
  .sev-critical { background: #a80000; color: white; }
  .sev-high { background: #d83b01; color: white; }
  .sev-medium { background: #ca5010; color: white; }
  .sev-low { background: #797775; color: white; }
  .sev-info { background: #5c5c5c; color: white; }

  .glyph-ok { color: #107c10; font-weight: 600; }
  .glyph-miss { color: #a4262c; font-weight: 600; }

  .fixture { border: 1px solid #e1e1e1; border-radius: 6px; padding: 1em 1.5em; margin: 1em 0; background: white; }
  .fixture-header { display: flex; align-items: center; gap: 1em; flex-wrap: wrap; }
  .fixture-name { font-size: 1.15em; font-weight: 600; font-family: Consolas, monospace; }
  .fixture-meta { color: #666; font-size: 0.85em; }

  .finding { background: #fafafa; border-left: 3px solid #ccc; padding: 0.7em 1em; margin: 0.5em 0; border-radius: 3px; }
  .finding-matched { border-left-color: #107c10; }
  .finding-missed { border-left-color: #a4262c; background: #fef5f5; }
  .finding-extra { border-left-color: #0078d4; background: #f3f9fd; }
  .finding-title { font-weight: 600; }
  .finding-id { font-family: Consolas, monospace; color: #666; font-size: 0.9em; }
  .finding-msg { color: #555; font-size: 0.88em; margin-top: 0.3em; }
  .finding-file { font-family: Consolas, monospace; color: #0078d4; font-size: 0.85em; }

  details summary { cursor: pointer; padding: 0.5em 0; font-weight: 600; color: #0078d4; }
  details[open] summary { margin-bottom: 0.5em; }

  .legend { display: flex; gap: 1.5em; margin: 1em 0; font-size: 0.9em; flex-wrap: wrap; }
  .legend-item { display: flex; align-items: center; gap: 0.4em; }
  .legend-swatch { width: 16px; height: 16px; border-radius: 2px; border-left-width: 3px; border-left-style: solid; }

  .error-msg { background: #fde7e9; color: #a4262c; padding: 0.5em 1em; border-radius: 4px; margin: 0.5em 0; }
</style>
</head>
<body>
  <h1>⚡ Doctor Deep — AI Validation Report</h1>
  <p class="meta">Generated: ${generatedAt} · Workspace: <code>${escapeHtml(fixturesDir)}</code></p>

  <h2>Overall Summary</h2>
  <div class="overall">
    <div class="card"><div class="num">${fixtures.length}</div><div class="label">Fixtures</div></div>
    <div class="card"><div class="num">${totalExpected}</div><div class="label">Expected findings</div></div>
    <div class="card"><div class="num">${totalMatched}</div><div class="label">Matched by AI</div></div>
    <div class="card"><div class="num">${recall.toFixed(0)}%</div><div class="label">Recall</div></div>
    <div class="card"><div class="num">${totalExtra}</div><div class="label">Extra findings</div></div>
  </div>

  <div class="legend">
    <div class="legend-item"><div class="legend-swatch" style="border-left-color:#107c10; background:#fafafa;"></div>Matched (expected ∩ found)</div>
    <div class="legend-item"><div class="legend-swatch" style="border-left-color:#a4262c; background:#fef5f5;"></div>Missed (expected ∩ ¬ found)</div>
    <div class="legend-item"><div class="legend-swatch" style="border-left-color:#0078d4; background:#f3f9fd;"></div>Extra (unexpected, may be valid)</div>
  </div>

  <h2>Per-Fixture Results</h2>
  <table>
    <thead>
      <tr>
        <th>Fixture</th>
        <th>Lang</th>
        <th>Status</th>
        <th>AI Total</th>
        <th>Expected Recall</th>
        <th>Extras</th>
        <th>AI Duration</th>
      </tr>
    </thead>
    <tbody>
      ${fixtureResults.map(f => f.error ? `
      <tr>
        <td><a href="#${escapeHtml(f.name)}"><code>${escapeHtml(f.name)}</code></a></td>
        <td colspan="6"><span class="error-msg">Error: ${escapeHtml(f.error)}</span></td>
      </tr>` : `
      <tr>
        <td><a href="#${escapeHtml(f.name)}"><code>${escapeHtml(f.name)}</code></a></td>
        <td>${escapeHtml(f.language)}</td>
        <td>${f.summary?.status === 'fail' ? '<span class="badge badge-bad">fail</span>' : '<span class="badge badge-good">pass</span>'}</td>
        <td>${f.aiCount}</td>
        <td>${statusBadge(f.matchedCount, f.expectations.length)}</td>
        <td>${f.extras.length}</td>
        <td>${f.aiDuration ? (f.aiDuration / 1000).toFixed(1) + 's' : '—'}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <h2>Detailed Findings</h2>
  ${fixtureResults.map(f => f.error ? `
  <div class="fixture" id="${escapeHtml(f.name)}">
    <div class="fixture-header">
      <div class="fixture-name">${escapeHtml(f.name)}</div>
    </div>
    <div class="error-msg">${escapeHtml(f.error)}</div>
  </div>` : `
  <div class="fixture" id="${escapeHtml(f.name)}">
    <div class="fixture-header">
      <div class="fixture-name">${escapeHtml(f.name)}</div>
      <div>${statusBadge(f.matchedCount, f.expectations.length)}</div>
      <div class="fixture-meta">${escapeHtml(f.language)} · ${f.aiCount} AI checks · ${f.aiDuration ? (f.aiDuration / 1000).toFixed(1) + 's' : '—'}</div>
    </div>
    ${f.aiError ? `<div class="error-msg">AI tier error: ${escapeHtml(f.aiError)}</div>` : ''}

    <h3>Expected findings (${f.matchedCount}/${f.expectations.length} matched)</h3>
    ${f.expectations.length === 0 ? '<p class="meta">No expected findings configured for this fixture.</p>' : f.expectations.map(exp => `
    <div class="finding ${exp.matched ? 'finding-matched' : 'finding-missed'}">
      <div class="finding-title">
        ${statusGlyph(!!exp.matched)} <span class="finding-id">[${escapeHtml(exp.id)}]</span> ${escapeHtml(exp.desc)}
      </div>
      ${exp.matched ? `
        <div class="finding-msg">
          → matched: <strong>${escapeHtml(exp.matched.title)}</strong> ${severityBadge(exp.matched.severity)}
          ${exp.matched.file ? `<br><span class="finding-file">${escapeHtml(exp.matched.file)}${exp.matched.line ? ':' + exp.matched.line : ''}</span>` : ''}
          <details><summary>Show AI message</summary><div>${escapeHtml(exp.matched.message)}</div></details>
        </div>
      ` : `<div class="finding-msg" style="color:#a4262c">AI did not produce a matching finding.</div>`}
    </div>`).join('')}

    ${f.extras.length > 0 ? `
    <h3>Extra findings (not in expected list — may still be valid)</h3>
    ${f.extras.map(extra => `
    <div class="finding finding-extra">
      <div class="finding-title">
        <span class="finding-id">[${escapeHtml(extra.id)}]</span> ${escapeHtml(extra.title)} ${severityBadge(extra.severity)}
      </div>
      <div class="finding-msg">${escapeHtml(extra.message)}</div>
      ${extra.file ? `<div class="finding-file">${escapeHtml(extra.file)}${extra.line ? ':' + extra.line : ''}</div>` : ''}
    </div>`).join('')}
    ` : ''}
  </div>`).join('')}

  <h2>Notes</h2>
  <ul>
    <li><strong>Matching strategy:</strong> Each expected finding has groups of keywords; a match requires <em>every group</em> to have at least one keyword present in the AI finding's title/message/file/id.</li>
    <li><strong>Recall</strong> = matched expected findings ÷ total expected findings.</li>
    <li><strong>Extras</strong> are AI findings not matching any expected entry. These may be valid (LLM found additional issues) or hallucinations (false positives).</li>
    <li>This report is <strong>advisory</strong> — LLM output is non-deterministic; rerun to see variability.</li>
  </ul>
</body>
</html>`;

writeFileSync(outputPath, html, 'utf-8');
console.log(`Report written: ${outputPath}`);
console.log(`Overall: ${totalMatched}/${totalExpected} expected findings matched (${recall.toFixed(1)}% recall)`);
console.log(`Extras: ${totalExtra} AI findings not in expected list`);
