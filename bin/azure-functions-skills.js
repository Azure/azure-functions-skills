#!/usr/bin/env node

import { join } from 'node:path';

const args = process.argv.slice(2);
const command = args[0];
const TARGETS = ['ghcp', 'claude', 'codex'];
const DOCTOR_FORMATS = ['text', 'json', 'markdown', 'html'];

const HELP = `
@azure/functions-skills — Azure Functions skills for coding agents

Commands:
  install --local   Copy skills, MCP, and telemetry hooks into a workspace
  update --local    Replace workspace-local Azure Functions assets
  doctor            Analyze an Azure Functions project
  template list     List Azure Functions templates
  template apply    Apply an Azure Functions template
  build             Build local and plugin artifacts

Plugin installation is managed by the host coding agent, not this package.
`;

const DOCTOR_HELP = `
Usage: azure-functions-skills doctor [options]

Options:
  --dir <path>              Project directory (default: current directory)
  --checks <ids>            Comma-separated check IDs
  --severity <level>        Failure threshold (default: high)
  --format <text|json|markdown|html>
  --output <path>           Report output path
  --deep                    Run AI-assisted analysis
  --accept-deep-risk        Acknowledge elevated agent permissions
  --agent <name>            github-copilot, claude-code, or codex
  --timeout <seconds>       AI analysis timeout (default: 300)
`;

const TEMPLATE_APPLY_HELP = `
Usage: azure-functions-skills template apply --template <id> [options]

Options:
  --template <id>           Template identifier
  --dir <path>              Target directory (default: current directory)
  --language <name>         Disambiguate templates by language
  --resource <name>         Filter by resource type
  --iac <name>              Filter by infrastructure-as-code type
  --runtime-version <value> Replace runtime version tokens
  --mode <auto|new|add>     Apply mode (default: auto)
  --manifest-url <url>      Override the template manifest
  --dry-run                 Preview file changes
  --force                   Overwrite conflicting files
  --json                    Print JSON output
`;

if (command === '--version' || command === '-V') {
  const { readFileSync } = await import('node:fs');
  const packageJson = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8'));
  console.log(packageJson.version);
  process.exit(0);
}

if (command === 'help' && args[1] === 'doctor') {
  console.log(DOCTOR_HELP.trim());
  process.exit(0);
}

if (!command || command === '--help' || command === '-h' || command === 'help') {
  console.log(HELP.trim());
  process.exit(0);
}

if (command === 'install' || command === 'update') {
  await runLocalInstall(command);
} else if (command === 'template') {
  await runTemplateCommand();
} else if (command === 'build') {
  const { execFileSync } = await import('node:child_process');
  execFileSync(
    process.execPath,
    [join(import.meta.dirname, '..', 'lib', 'build', 'build.js'), ...args.slice(1)],
    { stdio: 'inherit' },
  );
} else if (command === 'doctor') {
  await runDoctorCommand();
} else if (command === 'telemetry') {
  await runTelemetryCommand();
} else {
  console.error(`Unknown command: ${command}`);
  console.error(HELP.trim());
  process.exit(1);
}

async function runTelemetryCommand() {
  try {
    const rawInput = await readStdin(16 * 1024);
    if (rawInput.trim().length === 0) {
      throw new Error('Telemetry input is required on stdin.');
    }
    const { parseTelemetryEvent, sendTelemetryEvent } = await import('../lib/telemetry/index.js');
    const event = parseTelemetryEvent(JSON.parse(rawInput));
    await sendTelemetryEvent(event);
    process.exit(0);
  } catch (error) {
    console.error(`Telemetry failed: ${errorMessage(error)}`);
    process.exit(1);
  }
}

async function readStdin(maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) {
      throw new Error(`Telemetry input exceeds ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

async function runLocalInstall(action) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage: azure-functions-skills ${action} --local [options]

Options:
  --local            Required; install package-bundled assets into the workspace
  --agent <name>     ghcp, claude, or codex (repeatable)
  --all              Install for all supported agents
  --dir <path>       Target directory (default: current directory)
  --dry-run          List files without writing them
  --no-telemetry     Disable telemetry for this workspace
`.trim());
    process.exit(0);
  }

  if (!args.includes('--local')) {
    console.error('This package no longer installs plugins. Use your coding agent to install the plugin, or pass --local for a workspace-local copy.');
    process.exit(1);
  }

  const selectedAgents = flagValues('--agent');
  const invalidAgent = selectedAgents.find(agent => !TARGETS.includes(agent));
  if (invalidAgent) {
    console.error(`Unknown agent: ${invalidAgent}. Available: ${TARGETS.join(', ')}`);
    process.exit(1);
  }

  const { detectAgents, installLocalSkills } = await import('../lib/setup/index.js');
  const agents = args.includes('--all')
    ? TARGETS
    : selectedAgents.length > 0
      ? selectedAgents
      : await detectAgents();
  const dir = getFlag('--dir') || process.cwd();
  const result = await installLocalSkills({
    targetDir: dir,
    agents,
    dryRun: args.includes('--dry-run'),
    telemetryEnabled: args.includes('--no-telemetry') ? false : undefined,
  });

  if (result.dryRun) {
    console.log(`Planned local ${action}:`);
    for (const file of result.plannedFiles) console.log(`  - ${file}`);
  } else {
    console.log(`Azure Functions Skills locally ${action === 'install' ? 'installed' : 'updated'}.`);
    console.log(`  Agents: ${result.agents.join(', ')}`);
    console.log(`  Files written: ${result.filesWritten}`);
  }
  if (result.packageUpdate.status === 'update-available') {
    console.log(`  Package update: ${result.packageUpdate.message}`);
  }
}

async function runTemplateCommand() {
  const action = args[1];
  if (action !== 'list' && action !== 'apply') {
    console.error('Usage: azure-functions-skills template list|apply [options]');
    process.exit(1);
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(action === 'apply'
      ? TEMPLATE_APPLY_HELP.trim()
      : 'Usage: azure-functions-skills template list [options]');
    return;
  }
  const { listFunctionTemplates, applyFunctionTemplate } = await import('../lib/templates/index.js');
  const options = parseTemplateOptions(args.slice(2));
  try {
    if (action === 'list') {
      const result = await listFunctionTemplates(options);
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else printTemplateList(result.templates);
      return;
    }

    if (!options.template) {
      console.error('Missing required option: --template <id>');
      process.exit(1);
    }
    const result = await applyFunctionTemplate(options.dir, options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(result.dryRun ? 'Planned template apply:' : 'Template applied.');
    console.log(`  Template: ${result.template.id}`);
    console.log(`  Mode: ${result.mode}`);
    for (const file of result.filesWritten) console.log(`  + ${file}`);
    for (const file of result.skippedFiles) console.log(`  - ${file} (skipped)`);
    console.log(`  Files written: ${result.filesWritten.length}`);
    if (result.skippedFiles.length > 0) console.log(`  Files skipped: ${result.skippedFiles.length}`);
  } catch (error) {
    console.error(`Template ${action} failed: ${errorMessage(error)}`);
    process.exit(1);
  }
}

async function runDoctorCommand() {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(DOCTOR_HELP.trim());
    return;
  }
  const { runDoctor, formatReport } = await import('../lib/doctor/index.js');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  const dir = getFlag('--dir') || process.cwd();
  const output = getFlag('--output') || join(dir, '.azure-functions-doctor', 'doctor-report.json');
  const checksFlag = getFlag('--checks');
  const format = getFlag('--format') || 'text';
  try {
    if (!DOCTOR_FORMATS.includes(format)) {
      throw new Error(`Unsupported report format: ${format}. Available: ${DOCTOR_FORMATS.join(', ')}`);
    }
    const { report, exitCode } = await runDoctor({
      dir,
      deep: args.includes('--deep') && !args.includes('--no-deep'),
      acceptDeepRisk: args.includes('--accept-deep-risk'),
      agent: getFlag('--agent'),
      timeout: Number.parseInt(getFlag('--timeout') || '300', 10),
      format,
      output,
      checks: checksFlag ? checksFlag.split(',').map(value => value.trim()) : undefined,
      severity: getFlag('--severity') || 'high',
    });
    console.log(formatReport(report, 'text'));
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, formatReport(report, format));
    process.exit(exitCode);
  } catch (error) {
    console.error(`Doctor failed: ${errorMessage(error)}`);
    process.exit(2);
  }
}

function parseTemplateOptions(commandArgs) {
  const options = {
    dir: process.cwd(),
    mode: 'auto',
    dryRun: false,
    force: false,
    json: false,
  };
  for (let index = 0; index < commandArgs.length; index++) {
    const argument = commandArgs[index];
    if (argument === '--dir' && commandArgs[index + 1]) options.dir = commandArgs[++index];
    else if (argument === '--language' && commandArgs[index + 1]) options.language = commandArgs[++index];
    else if (argument === '--template' && commandArgs[index + 1]) options.template = commandArgs[++index];
    else if (argument === '--resource' && commandArgs[index + 1]) options.resource = commandArgs[++index];
    else if (argument === '--iac' && commandArgs[index + 1]) options.iac = commandArgs[++index];
    else if (argument === '--runtime-version' && commandArgs[index + 1]) options.runtimeVersion = commandArgs[++index];
    else if (argument === '--mode' && commandArgs[index + 1]) options.mode = commandArgs[++index];
    else if (argument === '--manifest-url' && commandArgs[index + 1]) options.manifestUrl = commandArgs[++index];
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--force') options.force = true;
    else if (argument === '--json') options.json = true;
  }
  if (!['auto', 'new', 'add'].includes(options.mode)) {
    console.error(`Unknown template apply mode: ${options.mode}. Available: auto, new, add`);
    process.exit(1);
  }
  return options;
}

function printTemplateList(templates) {
  if (templates.length === 0) {
    console.log('No templates found.');
    return;
  }
  for (const template of templates) {
    console.log(`${template.id} — ${template.displayName}`);
    if (template.shortDescription) console.log(`  ${template.shortDescription}`);
  }
}

function flagValues(flag) {
  const values = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === flag && args[index + 1]) values.push(args[++index]);
  }
  return values;
}

function getFlag(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
