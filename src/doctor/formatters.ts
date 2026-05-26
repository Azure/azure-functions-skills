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
      lines.push(`  ${icon} ${padId(c.id)}${c.message}`);
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
      lines.push(`  ${icon} ${padId(c.id)}${c.message}${fileSuffix}`);
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

export function formatReport(report: DoctorReport, format: OutputFormat): string {
  switch (format) {
    case 'json': return formatJsonReport(report);
    case 'markdown': return formatMarkdownReport(report);
    case 'text':
    default: return formatTextReport(report);
  }
}
