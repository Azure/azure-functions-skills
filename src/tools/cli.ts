#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyDeploy } from './deploy/apply.js';
import { planDeploy } from './deploy/plan.js';
import { verifyDeploy } from './deploy/verify.js';
import { parseArgs, UsageError } from './shared/args.js';
import { createRunner, type Runner } from './shared/exec.js';
import { EXIT, fail, type ToolResult } from './shared/output.js';
import { redact } from './shared/redact.js';
import { DEFAULT_MANIFEST_URLS, findTemplates } from './template/find.js';
import { writeTemplate } from './template/write.js';

export interface CliDependencies {
  readonly run: Runner;
  readonly now: () => Date;
  readonly fetchStatus: (url: string) => Promise<number>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  /** Overrides the template manifest locations. Tests use this; the command line cannot. */
  readonly manifestUrls?: readonly string[];
}

const HTTP_TIMEOUT_MS = 30_000;

const USAGE = `Usage: functions-tools.mjs <group> <command> [options]

  deploy plan    --dir <path> [--env <name>] [--location <region>] [--subscription <id>]
                 [--set NAME=VALUE]... [--code-only]
                 Reads the project and writes a deployment plan. Changes nothing in Azure.
  deploy apply   --dir <path> --approve <plan-id> [--preview]
                 Runs the approved plan with azd. Resumes after a failed step.
  deploy verify  --dir <path> [--env <name>] [--app <name>] [--subscription <id>]
                 Lists the deployed functions and requests anonymous HTTP triggers.

  template find  --language <name> [--resource <name>] [--iac <name>]
                 Lists templates from the Azure Functions template manifest.
  template write --dir <path> (--template <id> | --from <mcp-result.json>)
                 [--language <name>] [--runtime-version <version>] [--mode new|add] [--dry-run]
                 Writes template files. Never overwrites an existing file.

Output is one JSON object on stdout.
Exit codes: 0 ran, 1 unexpected failure, 2 invalid arguments, 3 blocked before running, 4 a step failed.`;

export async function runCli(argv: readonly string[], dependencies: CliDependencies): Promise<ToolResult> {
  const command = argv.slice(0, 2).join(' ');
  const rest = argv.slice(2);
  try {
    if (command === 'deploy plan') {
      const args = parseArgs(rest, {
        strings: ['dir', 'env', 'location', 'subscription'], lists: ['set'], booleans: ['code-only'],
      });
      return await planDeploy({
        dir: required(args.strings, 'dir'),
        env: args.strings.env,
        location: args.strings.location,
        subscription: args.strings.subscription,
        set: args.lists.set ?? [],
        codeOnly: args.booleans['code-only'] ?? false,
      }, dependencies);
    }
    if (command === 'deploy apply') {
      const args = parseArgs(rest, { strings: ['dir', 'approve'], booleans: ['preview'] });
      return await applyDeploy({
        dir: required(args.strings, 'dir'),
        approve: required(args.strings, 'approve'),
        preview: args.booleans.preview ?? false,
      }, dependencies);
    }
    if (command === 'deploy verify') {
      const args = parseArgs(rest, { strings: ['dir', 'env', 'app', 'subscription'] });
      return await verifyDeploy({
        dir: required(args.strings, 'dir'),
        env: args.strings.env,
        app: args.strings.app,
        subscription: args.strings.subscription,
      }, dependencies);
    }
    if (command === 'template find') {
      const args = parseArgs(rest, { strings: ['language', 'resource', 'iac'] });
      return await findTemplates({
        language: required(args.strings, 'language'),
        resource: args.strings.resource,
        iac: args.strings.iac,
      }, { manifestUrls: dependencies.manifestUrls ?? DEFAULT_MANIFEST_URLS });
    }
    if (command === 'template write') {
      const args = parseArgs(rest, {
        strings: ['dir', 'template', 'from', 'language', 'runtime-version', 'mode'], booleans: ['dry-run'],
      });
      const mode = args.strings.mode;
      if (mode !== undefined && mode !== 'new' && mode !== 'add') throw new UsageError('--mode must be new or add');
      return await writeTemplate({
        dir: required(args.strings, 'dir'),
        template: args.strings.template,
        from: args.strings.from,
        language: args.strings.language,
        runtimeVersion: args.strings['runtime-version'],
        mode,
        dryRun: args.booleans['dry-run'] ?? false,
      }, { manifestUrls: dependencies.manifestUrls ?? DEFAULT_MANIFEST_URLS });
    }
    throw new UsageError(command ? `Unknown command: ${command}` : 'No command was given');
  } catch (error) {
    if (error instanceof UsageError) {
      return fail(command || 'usage', EXIT.usage, error.message, {
        findings: [{ id: 'USAGE', severity: 'error', title: error.message, detail: USAGE }],
      });
    }
    return fail(command, EXIT.unexpected, 'Unexpected failure', {
      findings: [{
        id: 'UNEXPECTED', severity: 'error', title: redact(error instanceof Error ? error.message : String(error)),
        fix: 'Follow the manual steps. Do not run the same command again.',
      }],
    });
  }
}

function required(strings: Readonly<Record<string, string>>, name: string): string {
  const value = strings[name];
  if (!value) throw new UsageError(`Missing required option --${name}`);
  return value;
}

async function fetchStatus(url: string): Promise<number> {
  const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  return response.status;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const result = await runCli(argv, {
    run: createRunner(),
    now: () => new Date(),
    fetchStatus,
    sleep: milliseconds => new Promise(resolve => { setTimeout(resolve, milliseconds); }),
  });
  process.stdout.write(`${JSON.stringify(result.body, null, 2)}\n`);
  process.exitCode = result.exitCode;
}

function isEntryPoint(): boolean {
  try {
    return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) await main();
