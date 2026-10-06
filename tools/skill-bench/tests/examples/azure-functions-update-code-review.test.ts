import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PromptGrader } from '@microsoft/vally';
import type { GraderInput, LlmClient, LlmJudgeOptions } from '@microsoft/vally';
import { removeDirectory as removeDir, temporaryDirectory as createTempDir } from '../helpers.ts';
import { buildCodeReview, gradeCodeOnly } from '../../examples/azure-functions-update/plugins/functions-code-review.ts';

let root: string;
const ids = [...Array.from({ length: 16 }, (_, index) => `DI-${String(index + 1).padStart(2, '0')}`),
  'DI-POST-01', 'DI-POST-02', 'DI-POST-03'];
const summary = () => ({
  overall: 'pass',
  requirements: ids.map(id => ({ id, status: 'pass', judgeRequired: true, evidence: ['PRIVATE_LOG_CONTENT'] })),
});
function put(path: string, text: string) {
  const target = join(root, path);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, text);
}

beforeEach(() => {
  root = createTempDir('af-code-review-');
  put('Program.cs', 'builder.Services.AddSingleton<GreetingService>();');
  put('UpgradeApp.csproj', '<Project Sdk="Azure.Functions.Sdk/1.0.1" />');
  put('grading-evidence/checklist.json', JSON.stringify(summary()));
  put('grading-evidence/review-basis.md', 'Use the approved target framework.');
});
afterEach(() => removeDir(root));

describe('buildCodeReview', () => {
  it('includes final code and structured statuses, not logs, transcripts, skill text or reports', () => {
    for (const file of ['.migration/report.json', '.migration/host.log', 'notes.md',
      'grading-evidence/func-stdout.log', 'bin/generated.cs', 'obj/generated.cs',
      'azure-functions-update/SKILL.md', 'local.settings.json']) {
      put(file, 'PRIVATE_LOG_CONTENT');
    }
    put('Functions/Hello.cs', 'public class Hello {}');
    const review = buildCodeReview(root);
    expect(review.files.map(file => file.path)).toEqual(['Functions/Hello.cs', 'Program.cs', 'UpgradeApp.csproj']);
    expect(JSON.stringify(review)).not.toContain('PRIVATE_LOG_CONTENT');
    expect(review.execution.requirements).toHaveLength(19);
    expect(readFileSync(join(root, '.migration/host.log'), 'utf8')).toBe('PRIVATE_LOG_CONTENT');
  });

  it('does not send N/A reasons or error output that may contain log text', () => {
    const result = summary();
    result.requirements[2] = { ...result.requirements[2], status: 'not-applicable' };
    put('grading-evidence/checklist.json', JSON.stringify({ ...result, logs: 'PRIVATE_LOG_CONTENT',
      executionFailure: 'PRIVATE_LOG_CONTENT' }));
    expect(JSON.stringify(buildCodeReview(root))).not.toContain('PRIVATE_LOG_CONTENT');
  });

  it('rejects missing IDs and contradictory successful summaries', () => {
    put('grading-evidence/checklist.json', JSON.stringify({ ...summary(), requirements: [] }));
    expect(() => buildCodeReview(root)).toThrow(/requirement IDs/);
    const result = summary();
    result.requirements[0].status = 'blocked';
    put('grading-evidence/checklist.json', JSON.stringify(result));
    expect(() => buildCodeReview(root)).toThrow(/overall pass/);
  });

  it('fails explicitly rather than truncating oversized code', () => {
    put('Program.cs', 'x'.repeat(30_000));
    expect(() => buildCodeReview(root)).toThrow(/size limit/);
  });

  it('does not read code through symbolic links', () => {
    const outside = createTempDir('af-code-review-link-');
    try {
      writeFileSync(join(outside, 'Outside.cs'), 'DO_NOT_READ');
      symlinkSync(outside, join(root, 'Linked'), process.platform === 'win32' ? 'junction' : 'dir');
      expect(() => buildCodeReview(root)).toThrow(/symbolic link/);
    } finally {
      removeDir(join(root, 'Linked'));
      removeDir(outside);
    }
  });
});

describe('gradeCodeOnly', () => {
  const stimulus = { name: 'migration', prompt: 'Keep the target framework.', rubric: ['Preserve the source contract.'] };
  const input = (): GraderInput => ({
    stimulus,
    trajectory: {
      id: 'test', workDir: root, stimulus, events: [],
      output: 'PRIVATE_LOG_CONTENT', diff: 'PRIVATE_LOG_CONTENT',
      metadata: { model: 'HIDDEN_MODEL', skillsLoaded: ['HIDDEN_SKILL'], executor: 'test', sessionID: 'test' },
      metrics: {
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
          callCount: 0, byModel: {} },
        toolCallCount: 0, toolCallBreakdown: {}, simulatedToolCallCount: 0,
        skillActivationCount: 0, skillActivationBreakdown: {}, turnCount: 0, wallTimeMs: 0, errorCount: 0,
      },
    },
    config: { model: 'gpt-6-astra', scoring: 'binary' },
  });

  it('keeps large logs and arm identity out of the actual Vally prompt, without a model call', async () => {
    put('.migration/host.log', 'PRIVATE_LOG_CONTENT'.repeat(20_000));
    let calls = 0;
    const client: LlmClient = {
      async judge<T>(request: LlmJudgeOptions<T>) {
        calls++;
        expect(request.workspace).toBeUndefined();
        expect(request.userMessage).toContain('builder.Services.AddSingleton');
        expect(request.userMessage).toContain('DI-16');
        expect(request.userMessage).not.toMatch(/PRIVATE_LOG_CONTENT|HIDDEN_MODEL|HIDDEN_SKILL/);
        expect(request.userMessage.length).toBeLessThan(32_000);
        const parsed = request.tool.parameters.safeParse({
          rubric_scores: [{ criterion: stimulus.rubric[0], score: 1, reasoning: 'Source is complete.' }],
          overall_score: 1, overall_reasoning: 'Source is complete.',
        });
        if (!parsed.success) throw new Error(parsed.error.message);
        return { args: parsed.data, latencyMs: 0, remindersUsed: 0 };
      },
      async shutdown() {},
    };
    expect((await gradeCodeOnly(input(), new PromptGrader(client))).passed).toBe(true);
    expect(calls).toBe(1);
  });

  it('gives the built-in judge only a bounded projection and leaves original evidence untouched', async () => {
    put('.migration/transcript.log', 'PRIVATE_LOG_CONTENT');
    let projection = '';
    const grade = vi.fn(async (request: GraderInput) => {
      projection = request.trajectory?.workDir ?? '';
      expect(projection).not.toBe(root);
      expect(request.config).toMatchObject({ evidence: ['repo'], output_delivery: 'inline' });
      expect(readdirSync(projection)).toEqual(['review.json']);
      expect(readFileSync(join(projection, 'review.json'), 'utf8')).not.toContain('PRIVATE_LOG_CONTENT');
      return { name: 'prompt', kind: 'llm' as const, passed: true, score: 1, evidence: 'Source accepted.' };
    });
    expect((await gradeCodeOnly(input(), { grade })).passed).toBe(true);
    expect(() => readdirSync(projection)).toThrow();
    expect(readFileSync(join(root, '.migration/transcript.log'), 'utf8')).toBe('PRIVATE_LOG_CONTENT');
  });

  it('does not invoke a paid judge when execution failed or is blocked', async () => {
    const result = summary();
    result.overall = 'blocked';
    result.requirements[0].status = 'blocked';
    put('grading-evidence/checklist.json', JSON.stringify(result));
    const grade = vi.fn();
    const verdict = await gradeCodeOnly(input(), { grade });
    expect(verdict.passed).toBe(false);
    expect(verdict.status).toBe('error');
    expect(grade).not.toHaveBeenCalled();
  });

  it('explains failed checks with titles, reasons and hints but no evidence', async () => {
    const result = summary() as { overall: string; requirements: Record<string, unknown>[] };
    result.overall = 'fail';
    result.requirements[12] = { ...result.requirements[12], status: 'fail', title: 'Runtime configuration',
      reason: 'The worker runtime is not documented.' };
    put('grading-evidence/checklist.json', JSON.stringify(result));
    put('grading-evidence/definition-of-done.json', JSON.stringify({
      requirements: ids.map(id => ({ id, title: `Title ${id}`, ...(id === 'DI-13' ? { hint: 'Document the setting.' } : {}) })),
    }));
    const verdict = await gradeCodeOnly(input(), { grade: vi.fn() });
    const metadata = verdict.metadata as { summary: string; checks: Record<string, unknown>[] };
    expect(metadata.summary).toMatch(/machine checks did not pass.*LLM review did not run/i);
    expect(metadata.checks).toHaveLength(19);
    expect(metadata.checks[12]).toEqual({ id: 'DI-13', status: 'fail', title: 'Title DI-13',
      reason: 'The worker runtime is not documented.', hint: 'Document the setting.' });
    expect(metadata.checks[0]).toEqual({ id: 'DI-01', status: 'pass', title: 'Title DI-01' });
    expect(JSON.stringify(verdict)).not.toContain('PRIVATE_LOG_CONTENT');
  });

  it('adds a summary when the judge fails the review', async () => {
    const grade = vi.fn(async () => ({ name: 'prompt', kind: 'llm' as const, passed: false, score: 0, evidence: 'Rejected.' }));
    const verdict = await gradeCodeOnly(input(), { grade });
    expect((verdict.metadata as { summary: string }).summary).toMatch(/LLM review did not pass/);
    expect((verdict.metadata as { checks: unknown[] }).checks).toHaveLength(19);
  });
});
