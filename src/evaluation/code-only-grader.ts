import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { createCopilotLlmClient, PromptGrader } from '@microsoft/vally';
import type { Grader, GraderInput, GraderRegistry, GraderResult } from '@microsoft/vally';

const name = 'functions-code-review';
// Stay below Vally's 32 KB per-file snapshot limit. Never truncate submitted code.
const maxBytes = 24_000;
const ids = [...Array.from({ length: 16 }, (_, index) => `DI-${String(index + 1).padStart(2, '0')}`),
  'DI-POST-01', 'DI-POST-02', 'DI-POST-03'];
const statuses = new Set(['pass', 'fail', 'blocked', 'not-applicable']);
const excluded = new Set(['bin', 'obj', 'node_modules', 'grading-evidence', 'dist', 'packages']);
const extensions = new Set(['.cs', '.csproj', '.props', '.targets']);
const configFiles = new Set(['host.json', 'global.json', '.gitignore']);

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Code review needs a structured deterministic result.');
  }
  return value as Record<string, unknown>;
}

function readSmall(root: string, path: string, limit = maxBytes): string {
  let current = root;
  for (const part of path.split('/')) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`Code review refuses a symbolic link: ${path}`);
  }
  if (lstatSync(current).size > limit) throw new Error(`Code review size limit exceeded: ${path}`);
  return readFileSync(current, 'utf8');
}

export function buildCodeReview(root: string) {
  // The full machine result can contain diagnostics. Only copy typed verdict fields.
  const result = record(JSON.parse(readSmall(root, 'grading-evidence/checklist.json', 1_000_000)));
  if (!['pass', 'fail', 'blocked'].includes(String(result.overall)) || !Array.isArray(result.requirements)) {
    throw new Error('Code review needs the deterministic overall status and requirement IDs.');
  }
  const requirements = result.requirements.map(value => {
    const row = record(value);
    if (typeof row.id !== 'string' || typeof row.status !== 'string' || !statuses.has(row.status)
      || typeof row.judgeRequired !== 'boolean') throw new Error('Invalid deterministic requirement status.');
    const notApplicable = row.status === 'not-applicable';
    if (notApplicable && row.id !== 'DI-03' && !row.id.startsWith('DI-POST-')) {
      throw new Error(`No N/A condition exists for ${row.id} in this scenario.`);
    }
    return {
      id: row.id, status: row.status, judgeRequired: row.judgeRequired,
      ...(notApplicable ? { reason: row.id === 'DI-03'
        ? 'The grader found no existing test project.' : 'No language stage was requested.' } : {}),
    };
  });
  if (requirements.length !== ids.length || !ids.every(id => requirements.filter(row => row.id === id).length === 1)) {
    throw new Error('The deterministic requirement IDs are missing, duplicate, or unknown.');
  }
  if (result.overall === 'pass' && requirements.some(row => row.status === 'fail' || row.status === 'blocked')) {
    throw new Error('The deterministic overall pass conflicts with a failed or blocked requirement.');
  }
  const files: { path: string; content: string }[] = [];
  let entries = 0;
  let bytes = 0;
  function visit(directory: string, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++entries > 1_000) throw new Error('Code review file inventory exceeds its size limit.');
      if (excluded.has(entry.name.toLowerCase()) || (entry.name.startsWith('.') && entry.name !== '.gitignore')) continue;
      const path = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Code review refuses a symbolic link: ${path}`);
      if (entry.isDirectory()) visit(join(directory, entry.name), path + '/');
      else if (entry.isFile() && (extensions.has(extname(entry.name).toLowerCase()) || configFiles.has(entry.name))) {
        const content = readSmall(root, path);
        bytes += Buffer.byteLength(content);
        if (bytes > maxBytes) throw new Error('Code review source exceeds its size limit.');
        files.push({ path, content });
      }
    }
  }
  visit(root);
  const review = {
    policy: 'code-only-v1',
    execution: { overall: result.overall, requirements },
    coverage: 'Emitted logs, transcript actions, and agent report quality are not assessed. DI-10 needs source review.',
    basis: readSmall(root, 'grading-evidence/review-basis.md'),
    files,
  };
  if (Buffer.byteLength(JSON.stringify(review)) > maxBytes) throw new Error('Code review bundle exceeds its size limit.');
  return review;
}

export async function gradeCodeOnly(input: GraderInput, judge: Pick<Grader, 'grade'>): Promise<GraderResult> {
  if (!input.trajectory?.workDir) throw new Error('Code review needs the submitted workspace.');
  const review = buildCodeReview(input.trajectory.workDir);
  if (review.execution.overall !== 'pass') {
    return {
      name, kind: 'code', status: review.execution.overall === 'blocked' ? 'error' : 'success',
      passed: false, score: 0,
      evidence: `Independent execution is ${review.execution.overall}. No model review was run.`,
      metadata: { policy: review.policy, requirements: review.execution.requirements },
    };
  }
  const projection = mkdtempSync(join(tmpdir(), 'functions-code-review-'));
  try {
    writeFileSync(join(projection, 'review.json'), JSON.stringify(review));
    const result = await judge.grade({
      ...input,
      trajectory: { ...input.trajectory, workDir: projection },
      config: { ...input.config, evidence: ['repo'], output_delivery: 'inline' },
    });
    return { ...result, name, metadata: { ...result.metadata, policy: review.policy } };
  } finally {
    rmSync(projection, { recursive: true, force: true });
  }
}

export function registerGraders(registry: GraderRegistry): void {
  registry.register({
    metadata: {
      name, description: 'Review Functions source without logs or execution transcripts.',
      // Vally uses this flag for rubric validation and judge defaults. Its plugin
      // API does not pass the shared client, so this plugin owns a lazy client.
      behavior: { requiresWorkspace: true, requiresLlmClient: true },
      determinism: 'llm', reference: 'reference-based', temporalScope: 'point-in-time', costProfile: 'high',
    },
    async grade(input) {
      if (typeof input.config?.model !== 'string' || !input.config.model.trim()) {
        throw new Error('Set an explicit model on the functions-code-review grader.');
      }
      return gradeCodeOnly(input, {
        async grade(projected) {
          const client = await createCopilotLlmClient();
          try {
            return await new PromptGrader(client).grade(projected);
          } finally {
            await client.shutdown();
          }
        },
      });
    },
  });
}
