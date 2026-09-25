import { parseArgs } from 'node:util';
import { loadConfig } from './config.ts';
import { selectCells } from './plan.ts';
import type { Selection } from './plan.ts';
import { failureSummary, generateReport, readBenchmark } from './report.ts';
import { defaultDependencies, runBench } from './run.ts';
import type { RunDependencies } from './run.ts';

export const usage = `Usage: skill-bench <command> [options]

Commands:
  plan      Show the selected cells. Reads the configuration only.
  dry-run   Stage, verify and validate the selected cells. No model call.
  run       Run the selected cells with Vally. This uses paid model calls.
  report    Make benchmark.json and index.html from a run output.

Selection (plan, dry-run, run):
  --config <file>     skill-bench.config.json (required)
  --all | --skill <name>...
  --tier <name> | --model <id>...

Run options (dry-run, run):
  --trusted           Confirm that the eval and plugin code is reviewed.
  --run-root <dir>    Existing directory for staged cells. It must not be in
                      a repository or below agent configuration.
  --output <dir>      New directory for results (run only).
  --site <dir>        Also write the dashboard to a new directory (run only).
  --registry <url>    HTTPS npm registry for the cells.

Report options:
  --input <dir>       A run output directory.
  --output <dir>      A new or empty directory for the dashboard.

Other:
  --json              Print the plan as JSON.
  --help              Show this help.
`;

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

const consoleIo: CliIo = { out: text => console.log(text), err: text => console.error(text) };

function selection(values: Record<string, unknown>): Selection {
  return {
    all: values.all === true,
    skills: values.skill as string[] | undefined,
    tier: values.tier as string | undefined,
    models: values.model as string[] | undefined,
  };
}

/** Run the CLI and return the process exit code. */
export async function main(argv: string[], io: CliIo = consoleIo, source: NodeJS.ProcessEnv = process.env,
  dependencies: RunDependencies = defaultDependencies): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args: argv, allowPositionals: true, strict: true,
      options: {
        config: { type: 'string' }, all: { type: 'boolean' }, skill: { type: 'string', multiple: true },
        tier: { type: 'string' }, model: { type: 'string', multiple: true }, trusted: { type: 'boolean' },
        'run-root': { type: 'string' }, output: { type: 'string' }, input: { type: 'string' },
        site: { type: 'string' }, registry: { type: 'string' }, json: { type: 'boolean' }, help: { type: 'boolean' },
      },
    });
    const [command, ...extra] = positionals;
    if (values.help || command === undefined || command === 'help') {
      io.out(usage);
      return command === undefined && !values.help ? 1 : 0;
    }
    if (extra.length > 0) throw new Error(`unexpected argument "${extra[0]}".`);
    if (command === 'report') {
      if (!values.input || !values.output) throw new Error('report needs --input <run output> and --output <new directory>.');
      io.out(generateReport(values.input, values.output));
      for (const line of failureSummary(readBenchmark(values.input))) io.out(line);
      return 0;
    }
    if (!['plan', 'dry-run', 'run'].includes(command)) {
      throw new Error(`unknown command "${command}"; use plan, dry-run, run or report.`);
    }
    if (!values.config) throw new Error('use --config <skill-bench.config.json>.');
    if (command === 'plan') {
      const cells = selectCells(loadConfig(values.config), selection(values));
      if (values.json) io.out(JSON.stringify(cells.map(({ id, skill, scenario, model, arm, evalId }) =>
        ({ id, skill, scenario, model, arm, evalId })), null, 2));
      else {
        for (const cell of cells) io.out(cell.id);
        io.out(`${cells.length} cells.`);
      }
      return 0;
    }
    if (values.site && command !== 'run') throw new Error('--site is only for run.');
    const result = await runBench({
      config: values.config, selection: selection(values), dryRun: command === 'dry-run',
      runRoot: values['run-root'], output: values.output, trusted: values.trusted, registry: values.registry,
    }, source, { ...dependencies, log: io.out });
    if (result.output) {
      io.out(`Results: ${result.output}`);
      if (values.site) io.out(`Dashboard: ${generateReport(result.output, values.site)}`);
      try {
        for (const line of failureSummary(readBenchmark(result.output))) io.out(line);
      } catch (error) {
        io.err(`skill-bench: cannot summarize the results: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return result.exitCode;
  } catch (error) {
    io.err(`skill-bench: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
