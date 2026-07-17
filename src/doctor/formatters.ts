/**
 * Report formatters for doctor output.
 */
import type { DoctorCheckResult, DoctorReport, OutputFormat } from './types.js';

function statusIcon(status: DoctorCheckResult['status']): string {
  switch (status) {
    case 'pass': return '\u2705';
    case 'warn': return '\u26A0\uFE0F ';
    case 'fail': return '\u274C';
    case 'skip': return '\u23ED\uFE0F ';
  }
}

function padId(id: string, width = 22): string {
  return id.padEnd(width);
}

function formatTextReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push('Azure Functions Doctor');
  lines.push('');
  lines.push(`Project: ${report.workspace} (${report.language})`);
  lines.push('');

  if (report.tiers.builtin.ran && report.tiers.builtin.checks.length > 0) {
    lines.push('Built-in checks:');
    for (const c of report.tiers.builtin.checks) {
      const icon = statusIcon(c.status);
      lines.push(`  ${icon} ${padId(c.id)} ${c.message}`);
      if (c.recommendation && c.status !== 'pass') {
        lines.push(`${''.padEnd(28)}${c.recommendation}`);
      }
    }
    lines.push('');
  }

  if (report.tiers.ai.ran && report.tiers.ai.checks.length > 0) {
    const agentLabel = report.tiers.ai.agent ? ` (${report.tiers.ai.agent})` : '';
    lines.push(`AI analysis${agentLabel}:`);
    for (const c of report.tiers.ai.checks) {
      const icon = statusIcon(c.status);
      const fileSuffix = c.file ? ` ${c.file}${c.line ? `:${c.line}` : ''}` : '';
      lines.push(`  ${icon} ${padId(c.id)} ${c.message}${fileSuffix}`);
    }
    lines.push('');
  }

  const { summary } = report;
  const problems = summary.critical + summary.high;
  const warnings = summary.medium + summary.low;
  lines.push(`Summary: ${problems} problem(s), ${warnings} warning(s), ${summary.pass} passed`);

  return lines.join('\n');
}

function formatJsonReport(report: DoctorReport): string {
  return JSON.stringify(report, null, 2);
}

function formatMarkdownReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push('# Azure Functions Doctor Report');
  lines.push('');
  lines.push(`**Project:** ${report.workspace}  `);
  lines.push(`**Language:** ${report.language}  `);
  lines.push(`**Status:** ${report.summary.status === 'pass' ? 'PASS' : 'FAIL'}  `);
  lines.push('');
  lines.push('## Built-in Checks');
  lines.push('');
  lines.push('| Status | Check | Message |');
  lines.push('|--------|-------|---------|');
  for (const c of report.tiers.builtin.checks) {
    const icon = statusIcon(c.status);
    lines.push(`| ${icon} | ${c.id} | ${c.message} |`);
  }
  lines.push('');

  if (report.tiers.ai.ran && report.tiers.ai.checks.length > 0) {
    lines.push('## AI Analysis');
    lines.push('');
    lines.push('| Status | Check | Message |');
    lines.push('|--------|-------|---------|');
    for (const c of report.tiers.ai.checks) {
      const icon = statusIcon(c.status);
      lines.push(`| ${icon} | ${c.id} | ${c.message} |`);
    }
    lines.push('');
  }

  const { summary } = report;
  lines.push(`**Summary:** ${summary.critical + summary.high} problem(s), ${summary.medium + summary.low} warning(s), ${summary.pass} passed`);
  return lines.join('\n');
}

// ── HTML formatter ──

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const ALLOWED_STATUS: ReadonlySet<string> = new Set(['pass', 'warn', 'fail', 'skip']);
const ALLOWED_SEVERITY: ReadonlySet<string> = new Set(['critical', 'high', 'medium', 'low', 'info']);

/** Returns the value if it is in the allowlist, otherwise a safe fallback. */
function safeEnum(value: unknown, allowed: ReadonlySet<string>, fallback: string): string {
  return typeof value === 'string' && allowed.has(value) ? value : fallback;
}

function statusBadgeHtml(status: DoctorCheckResult['status']): string {
  const safe = safeEnum(status, ALLOWED_STATUS, 'skip');
  return `<span class="status status-${safe}">${safe.toUpperCase()}</span>`;
}

function severityBadgeHtml(sev: DoctorCheckResult['severity']): string {
  const safe = safeEnum(sev, ALLOWED_SEVERITY, 'info');
  return `<span class="sev sev-${safe}">${safe}</span>`;
}

function categoryLabel(category: string): string {
  const s = String(category ?? '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderCheck(c: DoctorCheckResult): string {
  const safeStatus = safeEnum(c.status, ALLOWED_STATUS, 'skip');
  const fileLine = c.file
    ? `<div class="check-file">${escapeHtml(c.file)}${c.line !== undefined && c.line !== null ? `:${escapeHtml(c.line)}` : ''}</div>`
    : '';
  const rec = c.recommendation
    ? `<div class="check-rec"><strong>Recommendation:</strong> ${escapeHtml(c.recommendation)}</div>`
    : '';
  return `
    <div class="check check-${safeStatus}">
      <div class="check-head">
        ${statusBadgeHtml(c.status)}
        ${severityBadgeHtml(c.severity)}
        <span class="check-cat">${escapeHtml(categoryLabel(c.category))}</span>
        <span class="check-id">${escapeHtml(c.id)}</span>
      </div>
      <div class="check-title">${escapeHtml(c.title)}</div>
      <div class="check-msg">${escapeHtml(c.message)}</div>
      ${fileLine}
      ${rec}
    </div>`;
}

function formatHtmlReport(report: DoctorReport): string {
  const { summary, tiers } = report;
  const overallStatus = summary.status === 'pass' ? 'PASS' : 'FAIL';
  const overallClass = summary.status === 'pass' ? 'status-pass' : 'status-fail';
  const aiAgent = tiers.ai.agent ? ` (${tiers.ai.agent})` : '';
  const aiDurationStr = tiers.ai.durationMs ? `${(tiers.ai.durationMs / 1000).toFixed(1)}s` : '—';

  const builtinChecks = tiers.builtin.checks;
  const aiChecks = tiers.ai.checks;
  const builtinIssues = builtinChecks.filter(c => c.status === 'fail' || c.status === 'warn');
  const builtinPasses = builtinChecks.filter(c => c.status === 'pass' || c.status === 'skip');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Azure Functions Doctor Report</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; max-width: 1200px; margin: 2em auto; padding: 0 1.2em; color: #1a1a1a; line-height: 1.55; background: #fff; }
  h1 { border-bottom: 3px solid #0078d4; padding-bottom: 0.3em; margin-bottom: 0.4em; }
  h2 { color: #0078d4; margin-top: 2em; border-bottom: 1px solid #e1e4e8; padding-bottom: 0.3em; }
  h3 { color: #444; margin-top: 1.5em; }
  code { font-family: "Cascadia Code", Consolas, monospace; background: #f3f4f6; padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.92em; }
  .meta { color: #57606a; font-size: 0.9em; }

  .overall-status { display: inline-block; font-size: 1.6em; font-weight: 700; padding: 0.15em 0.8em; border-radius: 6px; margin: 0.4em 0 0.8em; }
  .overall-status.status-pass { background: #dafbe1; color: #1a7f37; }
  .overall-status.status-fail { background: #ffebe9; color: #cf222e; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.9em; margin: 1.2em 0 2em; }
  .card { background: #f6f8fa; border-left: 4px solid #0078d4; padding: 0.7em 1em; border-radius: 4px; }
  .card.card-critical { border-left-color: #a40e26; }
  .card.card-high { border-left-color: #d83b01; }
  .card.card-medium { border-left-color: #b88200; }
  .card.card-low { border-left-color: #797775; }
  .card.card-pass { border-left-color: #1a7f37; }
  .card .num { font-size: 1.7em; font-weight: 700; color: #1a1a1a; line-height: 1.1; }
  .card .label { color: #57606a; font-size: 0.82em; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 0.2em; }

  .check { background: #fff; border: 1px solid #e1e4e8; border-left-width: 4px; border-radius: 5px; padding: 0.7em 1em; margin: 0.6em 0; }
  .check.check-fail { border-left-color: #cf222e; background: #fff8f8; }
  .check.check-warn { border-left-color: #d4a72c; background: #fffbf0; }
  .check.check-pass { border-left-color: #1a7f37; }
  .check.check-skip { border-left-color: #8b949e; background: #fafbfc; opacity: 0.8; }

  .check-head { display: flex; align-items: center; gap: 0.5em; flex-wrap: wrap; margin-bottom: 0.35em; font-size: 0.85em; }
  .check-title { font-weight: 600; font-size: 1.02em; color: #1a1a1a; }
  .check-msg { color: #444; margin-top: 0.3em; font-size: 0.94em; }
  .check-file { font-family: "Cascadia Code", Consolas, monospace; color: #0969da; font-size: 0.85em; margin-top: 0.35em; }
  .check-rec { margin-top: 0.4em; font-size: 0.92em; padding: 0.4em 0.7em; background: rgba(255,255,255,0.6); border-left: 3px solid #0078d4; border-radius: 3px; }
  .check-cat { color: #57606a; font-size: 0.85em; }
  .check-id { font-family: "Cascadia Code", Consolas, monospace; color: #57606a; font-size: 0.82em; margin-left: auto; }

  .status { display: inline-block; padding: 0.08em 0.5em; border-radius: 10px; font-size: 0.72em; font-weight: 700; letter-spacing: 0.04em; }
  .status-pass { background: #dafbe1; color: #1a7f37; }
  .status-fail { background: #ffebe9; color: #cf222e; }
  .status-warn { background: #fff8c5; color: #7a5800; }
  .status-skip { background: #eaeef2; color: #57606a; }

  .sev { display: inline-block; padding: 0.06em 0.45em; border-radius: 3px; font-size: 0.72em; font-weight: 700; text-transform: uppercase; color: #fff; }
  .sev-critical { background: #a40e26; }
  .sev-high { background: #d83b01; }
  .sev-medium { background: #b88200; }
  .sev-low { background: #797775; }
  .sev-info { background: #5c5c5c; }

  details { margin: 0.6em 0; }
  details summary { cursor: pointer; font-weight: 600; color: #0078d4; padding: 0.3em 0; }
  details[open] summary { margin-bottom: 0.5em; }

  .ai-error { background: #ffebe9; color: #cf222e; padding: 0.6em 1em; border-radius: 4px; margin: 0.6em 0; border-left: 4px solid #cf222e; }
  .empty { color: #57606a; font-style: italic; padding: 0.5em 0; }

  footer { margin-top: 3em; padding-top: 1em; border-top: 1px solid #e1e4e8; color: #57606a; font-size: 0.85em; text-align: center; }
</style>
</head>
<body>
  <h1>⚡ Azure Functions Doctor</h1>
  <div class="overall-status ${overallClass}">${overallStatus}</div>
  <p class="meta">
    <strong>Project:</strong> <code>${escapeHtml(report.workspace)}</code><br>
    <strong>Language:</strong> ${escapeHtml(report.language)} ·
    <strong>Generated:</strong> ${escapeHtml(report.timestamp)}
  </p>

  <div class="cards">
    <div class="card card-critical"><div class="num">${summary.critical}</div><div class="label">Critical</div></div>
    <div class="card card-high"><div class="num">${summary.high}</div><div class="label">High</div></div>
    <div class="card card-medium"><div class="num">${summary.medium}</div><div class="label">Medium</div></div>
    <div class="card card-low"><div class="num">${summary.low}</div><div class="label">Low</div></div>
    <div class="card card-pass"><div class="num">${summary.pass}</div><div class="label">Passed</div></div>
    <div class="card"><div class="num">${summary.total}</div><div class="label">Total</div></div>
  </div>

  <h2>Built-in Checks (Tier 1)</h2>
  ${builtinIssues.length === 0 && builtinPasses.length === 0 ? '<p class="empty">No checks ran.</p>' : ''}
  ${builtinIssues.length > 0 ? `
    <h3>Issues (${builtinIssues.length})</h3>
    ${builtinIssues.map(renderCheck).join('')}
  ` : ''}
  ${builtinPasses.length > 0 ? `
    <details>
      <summary>Passed / skipped checks (${builtinPasses.length})</summary>
      ${builtinPasses.map(renderCheck).join('')}
    </details>
  ` : ''}

  ${tiers.ai.ran || tiers.ai.error ? `
    <h2>AI Analysis (Tier 2)${escapeHtml(aiAgent)}</h2>
    <p class="meta">Duration: ${aiDurationStr}${tiers.ai.ran ? ` · Findings: ${aiChecks.length}` : ''}</p>
    ${tiers.ai.error ? `<div class="ai-error"><strong>AI tier error:</strong> ${escapeHtml(tiers.ai.error)}</div>` : ''}
    ${aiChecks.length > 0 ? aiChecks.map(renderCheck).join('') : (tiers.ai.ran ? '<p class="empty">No AI findings reported.</p>' : '')}
  ` : ''}

  <footer>
    Azure Functions Doctor · <a href="https://github.com/Azure/azure-functions-skills">github.com/Azure/azure-functions-skills</a>
  </footer>
</body>
</html>`;
}

export function formatReport(report: DoctorReport, format: OutputFormat): string {
  switch (format) {
    case 'json': return formatJsonReport(report);
    case 'markdown': return formatMarkdownReport(report);
    case 'html': return formatHtmlReport(report);
    case 'text':
    default: return formatTextReport(report);
  }
}
