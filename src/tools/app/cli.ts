import { parseArgs } from './args.js';
import { AzureClient, type AzureClientDeps } from './azure.js';
import { docsCommands } from './commands/docs.js';
import { invokeCommands } from './commands/invoke.js';
import { logStreamCommands } from './commands/logstream.js';
import { networkCommands } from './commands/network.js';
import { opsCommands } from './commands/ops.js';
import { readCommands } from './commands/read.js';
import { restCommands } from './commands/rest.js';
import { settingsCommands } from './commands/settings.js';
import { slotsCommands } from './commands/slots.js';
import type { CommandSpec } from './commands/types.js';
import { EXIT, ToolError, errorEnvelope, successEnvelope, type CommandResult, type Envelope, type ExitCode } from './output.js';
import { scrubText } from './redact.js';

export const COMMANDS: readonly CommandSpec[] = [...docsCommands, ...readCommands, ...logStreamCommands, ...invokeCommands, ...settingsCommands, ...opsCommands, ...slotsCommands, ...networkCommands, ...restCommands];

export interface CliDeps extends AzureClientDeps {
  referencesDir: string;
  assetsDir: string;
  now: () => Date;
  readInput: (source: string) => Promise<string>;
}

export interface CliResult {
  exitCode: ExitCode;
  /** JSON envelope, or only `data` with `--lean` on success. */
  output: unknown;
}

const BOOLEAN_FLAGS = new Set(['lean', 'help', 'approve', 'all', 'full', 'create-subnet', 'create-vnet', 'connection-string', 'sticky']);
const FALLBACK = [
  'Fall back to REST now: `docs search <task>` then `docs get <id>` for a recipe, `api find <words>` for the operation, then `rest <METHOD> <path>`.',
  'Writes still need a plan and user approval. Never guess a URL.',
];

function help(): CommandResult {
  return {
    summary: 'functions-app: Azure Functions operations over Azure REST APIs. Output is JSON; exit codes: 0 ok, 2 usage, 3 unsupported (fall back to REST), 4 Azure error, 5 approval needed, 6 pre-check failed. Every --app command also takes --slot <name>, --resource-group, and --subscription. Run `<command> --help` for output fields and limits.',
    data: COMMANDS.map(command => ({ usage: command.usage, description: command.description })),
  };
}

function findCommand(positionals: readonly string[]): { spec: CommandSpec; rest: string[] } | undefined {
  for (const words of [2, 1]) {
    const name = positionals.slice(0, words).join(' ');
    const spec = COMMANDS.find(command => command.name === name);
    if (spec) return { spec, rest: positionals.slice(words) };
  }
  return undefined;
}

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<CliResult> {
  let commandName = argv.filter(arg => !arg.startsWith('--')).slice(0, 2).join(' ') || 'help';
  try {
    const args = parseArgs(argv, BOOLEAN_FLAGS);
    const lean = args.flags.get('lean') === true;
    if (args.positionals.length === 0 || args.positionals[0] === 'help') {
      return { exitCode: EXIT.ok, output: successEnvelope('help', help()) };
    }
    const match = findCommand(args.positionals);
    if (!match) {
      throw new ToolError(EXIT.unsupported, `"${args.positionals.slice(0, 2).join(' ')}" is not a functions-app command.`, {
        data: COMMANDS.map(command => command.name),
        next: FALLBACK,
      });
    }
    commandName = match.spec.name;
    if (args.flags.get('help') === true) {
      return { exitCode: EXIT.ok, output: successEnvelope(commandName, { summary: match.spec.description, data: { usage: match.spec.usage, details: match.spec.details } }) };
    }
    const context = { client: new AzureClient(deps), referencesDir: deps.referencesDir, assetsDir: deps.assetsDir, now: deps.now, sleep: deps.sleep, fetch: deps.fetch, readInput: deps.readInput };
    const result = await match.spec.handler({ ...args, positionals: match.rest }, context);
    const envelope = successEnvelope(commandName, result);
    return { exitCode: EXIT.ok, output: lean ? envelope.data ?? null : envelope };
  } catch (error) {
    return { exitCode: exitCodeOf(error), output: toErrorEnvelope(commandName, error) };
  }
}

function exitCodeOf(error: unknown): ExitCode {
  return error instanceof ToolError ? error.exitCode : EXIT.failed;
}

function toErrorEnvelope(command: string, error: unknown): Envelope {
  if (error instanceof ToolError) {
    const next = error.options.next ?? (error.exitCode === EXIT.azure ? azureNext(command) : []);
    return errorEnvelope(command, error.exitCode, error.message, { ...error.options, next });
  }
  const message = error instanceof Error ? error.message : String(error);
  return errorEnvelope(command, EXIT.failed, `Unexpected failure: ${scrubText(message)}`, { next: FALLBACK });
}

function azureNext(command: string): string[] {
  return command.startsWith('docs') || command.startsWith('api')
    ? []
    : ['Follow the findings. For a read, you may retry once with `rest GET <path>`. Never resend a write until `changes` or a GET shows it did not apply.'];
}
