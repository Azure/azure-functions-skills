#!/usr/bin/env node

import { join } from 'node:path';

const args = process.argv.slice(2);
const command = args[0];

const HELP = `
@azure/functions-skills — Azure Functions skills for coding agents

Commands:
  template list     List Azure Functions templates
  template apply    Apply an Azure Functions template
  build             Build agent-specific and plugin artifacts

Plugin installation is managed by the host coding agent, not this package.
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

if (!command || command === '--help' || command === '-h' || command === 'help') {
  console.log(HELP.trim());
  process.exit(0);
}

if (command === 'template') {
  await runTemplateCommand();
} else if (command === 'build') {
  const { execFileSync } = await import('node:child_process');
  execFileSync(
    process.execPath,
    [join(import.meta.dirname, '..', 'lib', 'build', 'build.js'), ...args.slice(1)],
    { stdio: 'inherit' },
  );
} else if (command === 'telemetry') {
  if (args[1] === 'deployment-observed') {
    await runDeploymentObservedTelemetryCommand();
  } else {
    await runTelemetryCommand();
  }
} else {
  console.error(`Unknown command: ${command}`);
  console.error(HELP.trim());
  process.exit(1);
}

async function runDeploymentObservedTelemetryCommand() {
  try {
    const dirIndex = args.indexOf('--dir');
    const dir = (dirIndex >= 0 && args[dirIndex + 1]) || process.cwd();
    const {
      parseDeploymentObservationInput,
      collectDeploymentObservation,
      readWorkspaceTelemetryState,
    } = await import('../lib/telemetry/index.js');
    const rawInput = await readStdin(16 * 1024);
    if (rawInput.trim().length === 0) {
      throw new Error('Deployment observation telemetry input is required on stdin.');
    }
    const input = parseDeploymentObservationInput(JSON.parse(rawInput));
    // Workspaces from earlier local installs can keep an opt-out in telemetry.config.json.
    const configPaths = [
      join(dir, '.github', 'hooks', 'telemetry.config.json'),
      join(dir, '.claude', 'hooks', 'telemetry.config.json'),
      join(dir, '.codex', 'hooks', 'telemetry.config.json'),
    ];
    if (readWorkspaceTelemetryState(configPaths) !== 'active') {
      process.stdout.write('disabled\n');
      return;
    }
    const result = await collectDeploymentObservation(input, { workspaceTelemetryEnabled: undefined });
    process.stdout.write(`${result.status}\n`);
  } catch {
    process.stdout.write('failed\n');
  } finally {
    process.exit(0);
  }
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

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
