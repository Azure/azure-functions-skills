import { readFileSync, statSync } from 'node:fs';
import {
  inspectNode, LIMITS, listWorkflowTools, mcpConfigSchema, parsePlan, readRun,
  runWorkflow, summarize, validateWorkflow,
} from '../lib/workflow/index.js';

const HELP = `Usage: azure-functions-skills workflow <validate|run|status|inspect|tools> [options]

  validate --plan <file> --dir <workspace>   Check a plan without execution
  run --plan <file> --dir <workspace>        Execute a trusted plan
      --mcp-config <file>                   Explicit stdio server configuration
      --from <run-id> --reuse <id,id>        Import unchanged recorded successes
  status --run <run-id> --dir <workspace>    Read a compact run summary
  inspect --run <id> --node <id> --dir <workspace>
      --artifact <stdout|stderr|response|receipt>
      --offset <bytes> --limit <1..2048>     Read a bounded page
  tools --mcp-config <file> --server <id>    List tool names (starts the server)
      --tool <name>                        Show one tool schema
  --format <json|text>                      Output format (default: json)

The runner is not a sandbox. Review all commands, fallbacks, and server settings.
Unknown outcomes are NOT automatically replayed. See docs/workflow-runner.md.`;

function readJson(path) {
  if (statSync(path).size > LIMITS.artifact) throw new Error('Input file exceeds 16 MiB.');
  return JSON.parse(readFileSync(path, 'utf8'));
}
function flags(args, allowed) {
  const result = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!allowed.includes(key)) throw new Error(`Unsupported option ${key}.`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}.`);
    if (result.has(key)) throw new Error(`Duplicate option ${key}.`);
    result.set(key, value);
  }
  return result;
}
function required(options, key) {
  const value = options.get(key);
  if (!value) throw new Error(`Required option: ${key}.`);
  return value;
}
function emit(value, format, max = LIMITS.summary) {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) + 1 > max) throw new Error('Output exceeds the limit; request a smaller selection.');
  const pretty = format === 'text' ? JSON.stringify(value, null, 2) : json;
  console.log(Buffer.byteLength(pretty) + 1 <= max ? pretty : json);
}
function failure(error, code, runId) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ error: message.slice(0, 1500), ...(runId ? { runId } : {}) }));
  return code;
}
export async function runWorkflowCommand(args) {
  if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(HELP); return 0; }
  const verb = args[0];
  const shared = ['--dir', '--format'];
  const allowed = {
    run: ['--plan', '--mcp-config', '--from', '--reuse'],
    validate: ['--plan', '--mcp-config', '--from', '--reuse'],
    status: ['--run'],
    inspect: ['--run', '--node', '--artifact', '--offset', '--limit'],
    tools: ['--mcp-config', '--server', '--tool'],
  };
  let options;
  let plan;
  let config;
  let runOptions;
  let format;
  let dir;
  let runId;
  let readResult;
  try {
    if (!Object.hasOwn(allowed, verb)) throw new Error(`Unknown workflow operation ${verb}.`);
    options = flags(args.slice(1), [...shared, ...allowed[verb]]);
    format = options.get('--format') ?? 'json';
    if (!['json', 'text'].includes(format)) throw new Error('Use --format json or text.');
    dir = options.get('--dir') ?? process.cwd();
    if (verb === 'run' || verb === 'validate') {
      plan = parsePlan(readJson(required(options, '--plan')));
      config = options.has('--mcp-config') ? mcpConfigSchema.parse(readJson(options.get('--mcp-config'))) : undefined;
      runOptions = { dir, mcpConfig: config, from: options.get('--from'), reuse: options.get('--reuse')?.split(',') };
      validateWorkflow(plan, runOptions);
    }
    if (verb === 'tools') {
      required(options, '--server');
      config = mcpConfigSchema.parse(readJson(required(options, '--mcp-config')));
    }
    if (verb === 'status' || verb === 'inspect') required(options, '--run');
    if (verb === 'status') readResult = summarize(readRun(dir, options.get('--run')));
    if (verb === 'inspect') {
      required(options, '--node');
      const artifact = options.get('--artifact');
      if (artifact && !['stdout', 'stderr', 'response', 'receipt'].includes(artifact)) throw new Error('Unknown artifact kind.');
      readResult = inspectNode(dir, options.get('--run'), options.get('--node'), {
        artifact,
        offset: options.has('--offset') ? Number(options.get('--offset')) : undefined,
        limit: options.has('--limit') ? Number(options.get('--limit')) : undefined,
      });
    }
  } catch (error) { return failure(error, 2); }
  try {
    if (verb === 'validate') { emit(validateWorkflow(plan, runOptions), format); return 0; }
    if (verb === 'run') {
      const controller = new globalThis.AbortController();
      const interrupt = () => controller.abort();
      process.on('SIGINT', interrupt);
      process.on('SIGTERM', interrupt);
      try {
        const run = await runWorkflow(plan, { ...runOptions, signal: controller.signal, onRunCreated: id => { runId = id; } });
        emit(summarize(run), format);
        return controller.signal.aborted ? 130 : run.status === 'succeeded' ? 0 : 1;
      } finally {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', interrupt);
      }
    }
    if (verb === 'status') emit(readResult, format);
    else if (verb === 'inspect') emit(readResult, format, LIMITS.inspect);
    else {
      const tools = await listWorkflowTools(config, options.get('--server'));
      const name = options.get('--tool');
      const selected = name ? tools.find(tool => tool.name === name) : undefined;
      if (name && !selected) throw new Error(`Tool ${name} was not found.`);
      emit(selected ?? { tools: tools.map(tool => tool.name) }, format);
    }
    return 0;
  } catch (error) { return failure(error, 1, runId); }
}
