import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import type { Arm, Scenario } from './metrics.js';
import { MEASURED_EXECUTOR } from './executor.js';

export const DEPLOY_FIXTURE_SHA = 'cba392291ff7b6c994548aabaa8c06eb4055be54';
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const configSchema = z.object({
  version: z.literal(1),
  model: z.string().regex(/^[a-zA-Z0-9._:-]+$/),
  repetitions: z.number().int().min(1).max(3),
  cacheAccounting: z.enum(['included-in-input', 'separate-input', 'unknown']),
  cacheAccountingEvidence: z.string().min(1).optional(),
  mcpVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  azureSkillsRoot: z.string().min(1),
  azureSkillsSha: sha,
  reviewedSha: sha,
  subscriptionId: z.string().uuid(),
  location: z.string().regex(/^[a-z0-9]+$/),
  budgetUsd: z.number().positive(),
  minimumTokenReduction: z.number().min(0).max(1),
}).strict().refine(config => config.cacheAccounting === 'unknown' || config.cacheAccountingEvidence,
  'Known cache accounting requires provider/version evidence.');
export type BenchmarkConfig = z.infer<typeof configSchema>;

export function parseBenchmarkConfig(input: unknown): BenchmarkConfig {
  return configSchema.parse(input);
}

export function buildEvalSpec(config: BenchmarkConfig, scenario: Scenario, arm: Arm, repo: string, policy: string) {
  if (scenario === 'deploy' && arm === 'C') throw new Error('Deploy arm C is outside the approved experiment.');
  const azureSkills = ['azure-prepare', 'azure-validate', 'azure-deploy'];
  const skills = [
    `azure-functions-${scenario}`, 'azure-functions-common', 'azure-functions-best-practices',
    ...(arm === 'B' ? ['azure-functions-workflow'] : []),
  ].map(name => resolve(repo, 'templates', 'skills', name));
  skills.push(...azureSkills.map(name => resolve(config.azureSkillsRoot, name)));
  return {
    name: `workflow-benchmark-${scenario}`,
    defaults: { runs: 1, timeout: '30m', executor: MEASURED_EXECUTOR, model: config.model },
    environment: {
      skills,
      files: [{ src: resolve(policy), dest: 'benchmark-policy.md' },
        ...(arm === 'B' ? [{ src: join(dirname(resolve(policy)), 'workflow-mcp.json'), dest: 'workflow-mcp.json' }] : [])],
      mcpServers: {
        azure: { type: 'stdio', command: 'npx',
          args: ['-y', `@azure/mcp@${config.mcpVersion}`, 'server', 'start', '--namespace', 'functions'], timeout: '120s' },
      },
      commands: scenario === 'deploy' ? [
        'git init -q .',
        'git remote add origin https://github.com/Azure-Samples/functions-quickstart-typescript-azd.git',
        `git fetch --depth 1 -q origin ${DEPLOY_FIXTURE_SHA}`,
        'git checkout -q FETCH_HEAD',
      ] : [],
    },
    stimuli: [{
      name: `${scenario}-typescript-http-fc1`,
      prompt: [
        'Read benchmark-policy.md for this trial, then complete the task.',
        scenario === 'create'
          ? 'Use azure-functions-create to create a TypeScript Node.js 22 HTTP-trigger Functions app in this workspace. Discover the supported template through Azure MCP. Use the HTTP azd template targeting Flex Consumption. Expose GET /api/httpTrigger?name=Workflow returning "Hello, Workflow!". Build and perform a real local HTTP request. Do not deploy to Azure.'
          : 'Use azure-functions-deploy and the required Azure prepare/validate/deploy skills to deploy the existing TypeScript HTTP Flex Consumption app. Use only the approved AZURE_SUBSCRIPTION_ID, AZURE_LOCATION, AZURE_RESOURCE_GROUP and AZURE_ENV_NAME from the environment. Do not create another resource group. Report the HTTPS hostname. Do not delete resources; the harness owns cleanup.',
        'Keep function-level HTTP authorization and managed identity. Do not weaken security to pass.',
        'Do not retrieve or display deployed function keys; the independent harness performs the authenticated Azure HTTP request.',
        'Use only an already-running local emulator. Do not install or start another emulator.',
        'If required permissions, approval, prerequisites or configuration are missing, stop and report the blocker.',
        'Use the selected model without delegating to subagents or switching models.',
        'The agent host uses Node 24+. The Functions app must use Node 22: WORKFLOW_WORKER_NODE and WORKFLOW_WORKER_NPM identify its pinned executable and npm CLI. Run app npm commands with those paths, and prefix child PATH with the worker executable directory for app build, func and azd commands. Do not change the parent agent host runtime.',
      ].join('\n'),
      tags: { tier: 'workflow-benchmark', scenario, arm },
      constraints: { max_turns: 80, max_duration: '25m' },
      graders: [{
        type: 'skill-invocation',
        config: { required: [`azure-functions-${scenario}`, ...(scenario === 'deploy' ? azureSkills : [])] },
      }, {
        type: 'program',
        name: 'independent-probe',
        config: { program: process.execPath, args: [join(resolve(repo), 'lib', 'workflow-evaluation', 'cli.js'), 'probe', scenario], timeout: '5m' },
      }, {
        type: 'completed',
        config: {},
      }],
    }],
  };
}

export function benchmarkPolicy(arm: Arm, cli: string): string {
  const entry = JSON.stringify(resolve(cli));
  const common = [
    '# Trial policy',
    'Follow the normal Functions and Azure Skills approval and validation requirements.',
    'Do not inspect other trial workspaces or results. Do not optimize for a grader or omit verification.',
    'The harness collects usage from the initial prompt through the final response; discovery, planning and recovery count.',
  ];
  if (arm === 'A') return [...common, 'Use the existing skill workflow. Do not use the experimental workflow runner.'].join('\n');
  const helper = `The existing deterministic template helper is available as: node ${entry} template apply <discovered-template-id> --language TypeScript --runtime-version 22 --dir . --json. Use it only if the discovered template and required files match; otherwise follow the original skill and report the mismatch.`;
  return [...common, helper, arm === 'B'
    ? `Explicit opt-in: load azure-functions-workflow and batch already-decided operations with node ${entry} workflow. Generate the plan yourself within this trial. workflow-mcp.json explicitly configures the same pinned Azure MCP for runner calls; discover its real tool names and schemas. Do not bypass MCP discovery or the Azure Skills chain. Use the same template helper, not a newly invented materializer.`
    : 'Call that same template helper directly without a DAG. Do not use the workflow runner. Keep discovery, decisions and verification in the original skill.'].join('\n');
}
