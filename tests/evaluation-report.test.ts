import { afterEach, describe, expect, it } from 'vitest';
import { linkSync, mkdirSync, readFileSync, writeFileSync, readdirSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { generateReport, readBenchmark, relativeChange } from '../src/evaluation/report.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(removeDir));

// Selected native 0.16.0 fields and actual four-cell metrics, without raw traces.
function fixture() {
  const root = createTempDir('af-native-report-');
  roots.push(root);
  const input = join(root, 'native');
  mkdirSync(input);
  const variants = ['claude-sonnet-5', 'gpt-6-astra'].flatMap(model =>
    ['off', 'on'].map(skill => `skill=${skill},model=${model}`));
  const experiment = {
    runId: 'sanitized-matrix', name: 'typescript-http-model-skill-matrix',
    experimentHash: '1b980daef64f2374', vallyVersion: '0.16.0',
    planDigest: '0a81350e649a2fbc', variantNames: variants,
    baseline: variants[0],
  };
  const measured = [
    [405887, 3370, 409257, 21, 20, 123694],
    [829942, 5721, 835663, 32, 31, 245884],
    [114341, 2035, 116376, 9, 8, 85939],
    [276879, 4885, 281764, 13, 17, 137202],
  ];
  const evalFile = '../evals/azure-functions-create/typescript-http/eval.yaml';
  const cells = variants.map((variant, index) => {
    const model = variant.split('model=')[1];
    const on = variant.startsWith('skill=on');
    const environment = { skills: on ? ['C:\\private\\azure-functions-create'] : [] };
    const plan = {
      evalName: 'azure-functions-create-typescript-http', evalFile, variant, model,
      plannedStimulusCount: 1, plannedStimulusNames: ['typescript-http'], runs: 1,
      environment, stimuli: [{ name: 'typescript-http', environment, graders: [{ name: 'completed' }] }],
    };
    const summary = {
      type: 'experiment-run-summary', experiment: experiment.name, runId: experiment.runId,
      variant, evalFile, evalHash: 'b839dd0e746a0f09', configHash: `abcdef000000000${index}`,
      experimentHash: experiment.experimentHash, vallyVersion: '0.16.0',
      resolvedDefaults: { model, runs: 1 }, resolvedEnvironment: environment,
    };
    const [inputTokens, outputTokens, totalTokens, turnCount, toolCallCount, wallTimeMs] = measured[index];
    const trial = {
      type: 'trial-result', evalName: plan.evalName, variant, model, stimulus: 'typescript-http',
      shardKey: `${evalFile}::${variant}::${model}::typescript-http::trial-0`,
      status: 'success', durationMs: wallTimeMs + 10000,
      experiment: {
        name: experiment.name, runId: experiment.runId, variant, evalFile,
        evalHash: summary.evalHash, configHash: summary.configHash,
      },
      gradeResult: { passed: true, score: 1, details: [{ name: 'completed', passed: true, score: 1 }] },
      trajectory: {
        metrics: {
          tokenUsage: { inputTokens, outputTokens, totalTokens, cacheReadTokens: 999 },
          turnCount, toolCallCount, wallTimeMs, errorCount: 0, skillActivationCount: on ? 1 : 0,
        },
        metadata: { skillsLoaded: ['disabled-built-in'], private: 'PRIVATE-CANARY' },
        events: [{ prompt: 'PRIVATE-CANARY', token: 'PRIVATE-CANARY' }],
      },
      workspacePath: 'C:\\PRIVATE-CANARY', error: 'PRIVATE-CANARY',
    };
    return { plan, summary, trial };
  });
  const snapshot = {
    type: 'experiment-plan-snapshot', version: 1, vallyVersion: '0.16.0',
    planDigest: experiment.planDigest, evals: cells.map(c => c.plan),
  };
  function save() {
    writeFileSync(join(input, 'experiment-manifest.json'), JSON.stringify({
      type: 'experiment-manifest', version: 1, experiment,
    }));
    writeFileSync(join(input, 'plan-snapshot.json'), JSON.stringify(snapshot));
    cells.forEach(c => {
      const dir = join(input, c.plan.variant);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'run-summary.jsonl'), JSON.stringify(c.summary) + '\n');
      writeFileSync(join(dir, 'results.jsonl'), JSON.stringify(c.trial) + '\n');
    });
  }
  save();
  return { root, input, cells, experiment, snapshot, save };
}

function matrixFixture() {
  const root = createTempDir('af-matrix-report-');
  roots.push(root);
  const input = join(root, 'matrix');
  mkdirSync(input);
  const shared = join(root, 'PRIVATE-SOURCE', 'shared-skill');
  const target = join(root, 'PRIVATE-SOURCE', 'azure-functions-create');
  const cells = ['claude-sonnet-5', 'gpt-6-astra'].flatMap(model => [false, true].map(enabled => ({
    variant: `skill=${enabled ? 'on' : 'off'},model=${model}`,
    evalFile: 'evals/azure-functions-create/typescript-http/eval.yaml',
    evalName: 'azure-functions-create-typescript-http', model, enabled, runs: 1,
    stimuli: ['typescript-http'], skills: enabled ? [shared, target] : [shared],
    sharedSkills: [shared], evalHash: 'b839dd0e746a0f09', configHash: 'abcdef0000000000',
    results: `${model}/${enabled ? 'on' : 'off'}/results.jsonl` as string | null,
    workspace: `${model}/${enabled ? 'on' : 'off'}/workspace` as string | null,
    workspaceError: null as string | null,
    exitCode: 0 as number | null,
  })));
  const manifest = {
    type: 'vally-eval-matrix', version: 1, vallyVersion: '0.16.0',
    runId: '06b6578a-ad9f-4b21-8d90-d2ef8c7819a8', planHash: '0a81350e649a2fbc', cells,
  };
  const records: Record<string, unknown>[][] = cells.map((cell, index) => [{
    type: 'trial-result', itemId: `PRIVATE-ITEM-${index}`, evalName: cell.evalName,
    evalFilePath: join(root, 'PRIVATE-SOURCE', `.matrix-${index}.json`),
    variant: 'main', stimulus: cell.stimuli[0], model: cell.model, trialIndex: 0, totalTrials: 1,
    status: 'success', durationMs: 999,
    gradeResult: {
      passed: true, score: 1, details: [{ name: 'completed', passed: true, score: 1, evidence: 'PRIVATE-EVIDENCE' }],
    },
    trajectory: {
      metadata: { model: cell.model, policyAnswers: 'PRIVATE-ANSWERS' },
      metrics: {
        tokenUsage: { totalTokens: 100 + index, inputTokens: 90, outputTokens: 10, cacheReadTokens: 9999 },
        turnCount: 2, toolCallCount: 1, wallTimeMs: 123, errorCount: 0, skillActivationCount: Number(cell.enabled),
      },
      events: [{ content: 'PRIVATE-TRANSCRIPT' }],
    },
  }, { type: 'run-summary', passed: true, jsonlPath: 'PRIVATE-OUTPUT', evals: [] }]);
  function save() {
    writeFileSync(join(input, 'matrix-manifest.json'), JSON.stringify(manifest));
    cells.forEach((cell, index) => {
      if (cell.results === null || cell.results.includes('..')) return;
      const file = join(input, cell.results);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, records[index].map(record => JSON.stringify(record)).join('\n'));
      if (cell.workspace !== null) mkdirSync(join(input, cell.workspace), { recursive: true });
    });
  }
  save();
  return { root, input, manifest, cells, records, save };
}

// Exercise the existing inline renderer without adding a browser dependency.
function render(html: string, search: string) {
  const data = /<script id="benchmark-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!data || !script) throw new Error('Missing dashboard script');
  class Element {
    textContent = '';
    innerHTML = '';
    value = '';
    href = '';
    listeners = new Map<string, (event: { target: { value: string } }) => void>();
    addEventListener(type: string, handler: (event: { target: { value: string } }) => void) {
      this.listeners.set(type, handler);
    }
  }
  const elements = new Map<string, Element>();
  const node = (selector: string) => {
    let element = elements.get(selector);
    if (!element) { element = new Element(); elements.set(selector, element); }
    return element;
  };
  node('#benchmark-data').textContent = data;
  const location = { search, href: '' };
  const document = {
    documentElement: { lang: '' }, title: '',
    querySelector: node,
    querySelectorAll: () => [node('.brand'), node('.nav-link')],
  };
  runInNewContext(script, { document, location, URLSearchParams });
  return { node, location, document };
}

describe('native benchmark report', () => {
  it('pairs four real measurements within each model without counting cache tokens twice', () => {
    const f = fixture();
    const data = readBenchmark(f.input);
    expect(data.comparisons).toHaveLength(2);
    expect(data.comparisons.map(c => c.model)).toEqual(['claude-sonnet-5', 'gpt-6-astra']);
    const [sonnet, astra] = data.comparisons;
    expect([sonnet.off?.samples, sonnet.on?.samples, astra.off?.samples, astra.on?.samples]).toEqual([1, 1, 1, 1]);
    expect([sonnet.off?.metrics.totalTokens, sonnet.on?.metrics.totalTokens,
      astra.off?.metrics.totalTokens, astra.on?.metrics.totalTokens]).toEqual([409257, 835663, 116376, 281764]);
    expect(astra.on?.metrics).toMatchObject({ turnCount: 13, toolCallCount: 17, wallTimeMs: 137202, skillActivationCount: 1 });
    expect(astra.off?.metrics.skillActivationCount).toBe(0);
    expect(astra.on?.score).toBe(1);
    expect(astra.on?.successRate).toBe(100);
    expect(relativeChange(astra.on?.metrics.totalTokens ?? null, astra.off?.metrics.totalTokens ?? null)).toBeCloseTo(142.1152, 3);
  });

  describe('standalone Vally matrix report', () => {
    it('pairs four cells by model and labels hashes as local transport metadata', () => {
      const f = matrixFixture();
      const data = readBenchmark(f.input);
      expect(data.provenance).toMatchObject({
        transport: 'vally-eval', experiment: 'plugin-skill-benchmark', hashSource: 'local-matrix-plan',
        runId: f.manifest.runId, experimentHash: f.manifest.planHash, planDigest: f.manifest.planHash,
      });
      expect(data.comparisons.map(c => c.model)).toEqual(['claude-sonnet-5', 'gpt-6-astra']);
      expect(data.comparisons.map(c => [c.off?.metrics.totalTokens, c.on?.metrics.totalTokens]))
        .toEqual([[100, 101], [102, 103]]);
      expect(data.comparisons[0].on).toMatchObject({ planned: 1, samples: 1, passed: 1, successRate: 100 });
      expect(data.comparisons[0].on?.workspace).toBe('claude-sonnet-5/on/workspace');
      expect(data.comparisons[0].prompt).toContain('Create a new TypeScript Azure Functions v4 HTTP app');
    });

    it('accepts omitted standalone model, variant and single-trial indices', () => {
      const f = matrixFixture();
      for (const rows of f.records) {
        for (const key of ['model', 'variant', 'trialIndex', 'totalTrials']) delete rows[0][key];
      }
      f.save();
      expect(readBenchmark(f.input).comparisons[0].off?.passed).toBe(1);
    });

    it.each(['null-result', 'empty-results', 'summary-only', 'all-null'])(
      'keeps %s unexecuted, without a passing or failing score', kind => {
        const f = matrixFixture();
        if (kind === 'null-result') f.cells[0].results = null;
        if (kind === 'all-null') f.cells.forEach(cell => { cell.results = null; cell.exitCode = null; });
        if (kind === 'empty-results') f.records[0] = [];
        if (kind === 'summary-only') f.records[0].shift();
        f.save();
        expect(readBenchmark(f.input).comparisons[0].off).toMatchObject({
          planned: 1, samples: 0, unexecuted: 1, passed: 0, failed: 0, successRate: null, score: null,
          metrics: { totalTokens: null },
        });
      });

    it('keeps ungraded, skipped, execution errors and grader errors distinct', () => {
      const f = matrixFixture();
      f.records[0][0].gradeResult = null;
      f.records[1][0].status = 'skipped';
      f.records[2][0].status = 'error';
      f.records[2][0].gradeResult = null;
      f.records[3][0].gradeResult = { name: 'grader-error', status: 'error', passed: false, score: 0 };
      f.save();
      const [a, b] = readBenchmark(f.input).comparisons;
      expect(a.off).toMatchObject({ samples: 1, passed: 0, failed: 0, successRate: null, score: null });
      expect(a.on).toMatchObject({ skipped: 1, samples: 0, successRate: null });
      expect(b.off).toMatchObject({ executionErrors: 1, passed: 0, successRate: 0 });
      expect(b.on).toMatchObject({ failed: 1, passed: 0, successRate: 0, score: 0 });
    });

    it.each(['top-level', 'detail'])('does not accept a successful verdict for a %s grader error', kind => {
      const f = matrixFixture();
      const error = { name: 'completed', status: 'error', passed: true, score: 1 };
      f.records[0][0].gradeResult = kind === 'top-level' ? error : { passed: true, score: 1, details: [error] };
      f.save();
      expect(readBenchmark(f.input).comparisons[0].off?.passed).toBe(0);
    });

    it.each([
      'model', 'metadata-model', 'variant', 'enabled', 'duplicate-trial', 'duplicate-item', 'trial-index', 'total-trials',
      'stimulus', 'eval-name', 'missing-grade', 'shared-difference', 'missing-dependency', 'extra-skill',
      'off-target', 'duplicate-dependency', 'target-dependency', 'relative-skill', 'unsafe-label',
      'eval-hash', 'plan-hash', 'config-hash', 'eval-path', 'duplicate-results', 'duplicate-cell',
      'unknown-record', 'version',
    ])('rejects inconsistent %s data', kind => {
      const f = matrixFixture();
      const cell = f.cells[0];
      const row = f.records[0][0];
      if (kind === 'model') row.model = 'another-model';
      if (kind === 'metadata-model') row.trajectory = { metadata: { model: 'another-model' } };
      if (kind === 'variant') row.variant = 'skill=on,model=claude-sonnet-5';
      if (kind === 'enabled') cell.enabled = true;
      if (kind === 'duplicate-trial') f.records[0].splice(1, 0, { ...row, itemId: 'another-item' });
      if (kind === 'duplicate-item') {
        f.cells.forEach(c => { c.runs = 2; });
        row.totalTrials = 2;
        f.records[0].splice(1, 0, { ...row, trialIndex: 1 });
      }
      if (kind === 'trial-index') row.trialIndex = 1;
      if (kind === 'total-trials') row.totalTrials = 2;
      if (kind === 'stimulus') row.stimulus = 'unplanned';
      if (kind === 'eval-name') row.evalName = 'unplanned';
      if (kind === 'missing-grade') delete row.gradeResult;
      if (kind === 'shared-difference') { cell.sharedSkills = []; cell.skills = []; }
      if (kind === 'missing-dependency') f.cells[1].skills.shift();
      if (kind === 'extra-skill') cell.skills.push(join(f.root, 'extra-skill'));
      if (kind === 'off-target') cell.skills.push(join(f.root, 'azure-functions-create'));
      if (kind === 'duplicate-dependency') { cell.sharedSkills.push(cell.sharedSkills[0]); cell.skills.push(cell.skills[0]); }
      if (kind === 'target-dependency') {
        cell.sharedSkills = [join(f.root, 'azure-functions-create')]; cell.skills = [...cell.sharedSkills];
      }
      if (kind === 'relative-skill') { cell.sharedSkills = ['shared-skill']; cell.skills = ['shared-skill']; }
      if (kind === 'unsafe-label') cell.model = '</script>';
      if (kind === 'eval-hash') cell.evalHash = 'aaaaaaaaaaaaaaaa';
      if (kind === 'plan-hash') f.manifest.planHash = 'not-a-hash';
      if (kind === 'config-hash') cell.configHash = 'not-a-hash';
      if (kind === 'eval-path') cell.evalFile = '../' + cell.evalFile;
      if (kind === 'duplicate-results') f.cells[1].results = cell.results;
      if (kind === 'duplicate-cell') { f.cells.push({ ...cell, results: null }); f.records.push([]); }
      if (kind === 'unknown-record') f.records[0].push({ type: 'custom-result' });
      if (kind === 'version') f.manifest.version = 2;
      f.save();
      expect(() => readBenchmark(f.input)).toThrow();
    });

    it('allows dependency order changes without changing the dependency set', () => {
      const f = matrixFixture();
      for (const cell of f.cells) {
        const other = join(f.root, 'PRIVATE-SOURCE', 'another-dependency');
        cell.sharedSkills.push(other);
        cell.skills.push(other);
        if (cell.enabled) cell.sharedSkills.reverse();
      }
      f.save();
      expect(readBenchmark(f.input).comparisons).toHaveLength(2);
    });

    it.each(['traversal', 'absolute', 'link-escape', 'link-alias', 'hard-link-alias'])('rejects %s result paths', kind => {
      const f = matrixFixture();
      if (kind === 'traversal') f.cells[0].results = '../outside.jsonl';
      if (kind === 'absolute') f.cells[0].results = join(f.root, 'outside.jsonl');
      if (kind === 'link-escape' || kind === 'link-alias') {
        const target = kind === 'link-escape' ? join(f.root, 'outside') : join(f.input, 'claude-sonnet-5', 'off');
        mkdirSync(target, { recursive: true });
        if (kind === 'link-escape') writeFileSync(join(target, 'results.jsonl'), JSON.stringify(f.records[0][0]));
        symlinkSync(target, join(f.input, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
        f.cells[kind === 'link-alias' ? 1 : 0].results = 'linked/results.jsonl';
      }
      if (kind === 'hard-link-alias') {
        linkSync(join(f.input, 'claude-sonnet-5', 'off', 'results.jsonl'), join(f.input, 'alias.jsonl'));
        f.cells[1].results = 'alias.jsonl';
      }
      writeFileSync(join(f.input, 'matrix-manifest.json'), JSON.stringify(f.manifest));
      expect(() => readBenchmark(f.input)).toThrow(/path|inside|distinct/);
    });

    it('keeps separate planned stimuli and does not use summaries as verdicts', () => {
      const f = matrixFixture();
      for (const cell of f.cells) cell.stimuli.push('not-executed');
      f.records[0][1].passed = false;
      f.save();
      const data = readBenchmark(f.input);
      expect(data.comparisons).toHaveLength(4);
      for (const comparison of data.comparisons.filter(c => c.scenario === 'not-executed')) {
        expect(comparison.on).toMatchObject({ samples: 0, unexecuted: 1, successRate: null });
        expect(comparison.off).toMatchObject({ samples: 0, unexecuted: 1, successRate: null });
      }
      expect(data.comparisons.find(c => c.scenario === 'typescript-http')?.off?.passed).toBe(1);
    });

    it('does not replace absent metrics or change an incomplete mean denominator', () => {
      const f = matrixFixture();
      for (const [index, cell] of f.cells.entries()) {
        cell.runs = 2;
        const first = f.records[index][0];
        first.totalTrials = 2;
        f.records[index].splice(1, 0, {
          ...first, itemId: `second-${index}`, trialIndex: 1, trajectory: { metrics: { turnCount: 4 } },
        });
      }
      f.save();
      expect(readBenchmark(f.input).comparisons[0].on).toMatchObject({
        samples: 2, passed: 2, metrics: { totalTokens: null, turnCount: 3 },
      });
    });

    it('does not fall back to a native manifest when a matrix manifest is invalid', () => {
      const f = fixture();
      writeFileSync(join(f.input, 'matrix-manifest.json'), JSON.stringify({ type: 'experiment-manifest' }));
      expect(() => readBenchmark(f.input)).toThrow(/vally-eval-matrix/);
    });

    it('renders only safe fields from standalone results and local provenance', () => {
      const f = matrixFixture();
      const html = readFileSync(generateReport(f.input, join(f.root, 'site')), 'utf8');
      expect(html).not.toMatch(/PRIVATE-|evalFilePath|sharedSkills|policyAnswers|cacheReadTokens|itemId/);
      expect(html).toContain('"transport":"vally-eval"');
      const comparison = readBenchmark(f.input).comparisons[0];
      const detail = render(html, `?skill=${comparison.id}`).node('#app').innerHTML;
      expect(detail).toContain('Enabled: 1/1');
      expect(detail).toContain('matrix-manifest.json');
      expect(detail).toContain('Workspace snapshot');
      expect(detail).toContain('claude-sonnet-5/on/workspace');
      expect(detail).not.toMatch(/experiment-manifest|plan-snapshot|native shard keys/);
      expect(render(html, '').node('#app').innerHTML).toContain('Vally standalone matrix');
    });
  });

  it('does not treat provenance summaries or empty result files as grader failures', () => {
    const f = fixture();
    writeFileSync(join(f.input, f.cells[0].plan.variant, 'results.jsonl'), '');
    const arm = readBenchmark(f.input).comparisons[0].off;
    expect(arm).toMatchObject({ planned: 1, samples: 0, unexecuted: 1, failed: 0, successRate: null, score: null });
    expect(arm?.metrics.totalTokens).toBeNull();
  });

  it('keeps multiple skills with the same scenario separate when only Astra is selected', () => {
    const f = fixture();
    f.experiment.variantNames.splice(0, 2);
    f.experiment.baseline = f.experiment.variantNames[0];
    f.cells.splice(0, 2);
    f.snapshot.evals.splice(0, 2);
    f.save();
    for (const cell of f.cells) {
      const other = structuredClone(cell);
      const evalFile = cell.plan.evalFile.replace('azure-functions-create', 'another-skill');
      const replaceSkill = (value: string) => value.replace('azure-functions-create', 'another-skill');
      other.plan.evalFile = evalFile;
      other.plan.environment.skills = other.plan.environment.skills.map(replaceSkill);
      other.plan.stimuli[0].environment.skills = other.plan.environment.skills;
      other.summary.evalFile = evalFile;
      other.summary.resolvedEnvironment = other.plan.environment;
      other.trial.experiment.evalFile = evalFile;
      other.trial.shardKey = other.trial.shardKey.replace(cell.plan.evalFile, evalFile);
      f.snapshot.evals.push(other.plan);
      const dir = join(f.input, cell.plan.variant);
      writeFileSync(join(dir, 'run-summary.jsonl'), [cell.summary, other.summary].map(v => JSON.stringify(v)).join('\n'));
      writeFileSync(join(dir, 'results.jsonl'), [cell.trial, other.trial].map(v => JSON.stringify(v)).join('\n'));
    }
    writeFileSync(join(f.input, 'plan-snapshot.json'), JSON.stringify(f.snapshot));
    const comparisons = readBenchmark(f.input).comparisons;
    expect(comparisons.map(c => c.skill).sort()).toEqual(['another-skill', 'azure-functions-create']);
    expect(new Set(comparisons.map(c => c.id)).size).toBe(2);
    for (const c of comparisons) {
      expect(c.model).toBe('gpt-6-astra');
      expect(c.on?.samples).toBe(1);
      expect(c.off?.samples).toBe(1);
    }
    const html = readFileSync(generateReport(f.input, join(f.root, 'subset-site')), 'utf8');
    for (const c of comparisons) {
      const view = render(html, `?skill=${c.id}`);
      expect(view.node('#app').innerHTML).toContain(c.skill);
      expect(view.node('#app').innerHTML).toContain('281,764');
    }
  });

  it('separates execution errors, grader failures, and actual grader score', () => {    const f = fixture();
    f.cells[0].trial.status = 'error';
    f.cells[1].trial.gradeResult.passed = false;
    f.cells[1].trial.gradeResult.score = 0.25;
    f.save();
    const c = readBenchmark(f.input).comparisons[0];
    expect(c.off).toMatchObject({ executionErrors: 1, failed: 0, passed: 0, successRate: 0 });
    expect(c.on).toMatchObject({ executionErrors: 0, failed: 1, passed: 0, successRate: 0, score: 0.25 });
  });

  it('averages each named grader per arm so a zero-weight quality judge stays visible', () => {
    const f = fixture();
    for (const cell of f.cells) {
      cell.trial.gradeResult.details.push({
        name: 'code-quality', passed: true, score: cell.plan.variant.startsWith('skill=on') ? 0.9 : 0.5,
      });
    }
    f.save();
    const c = readBenchmark(f.input).comparisons[0];
    expect(c.on?.graderScores).toEqual({ completed: 1, 'code-quality': 0.9 });
    expect(c.off?.graderScores).toEqual({ completed: 1, 'code-quality': 0.5 });
    // A non-gating judge must not change the verdict it is reported beside.
    expect(c.on?.passed).toBe(1);
    expect(c.off?.passed).toBe(1);
  });

  it('shows the reviewed scenario prompt from this checkout, never native free text', () => {
    const f = fixture();
    for (const cell of f.cells) {
      cell.trial.gradeResult.details.push({ name: 'code-quality', passed: true, score: 0.8 });
    }
    f.save();
    const c = readBenchmark(f.input).comparisons[0];
    expect(c.prompt).toContain('Create a new TypeScript Azure Functions v4 HTTP app');
    // The block scalar must be dedented and must stop before the next key.
    expect(c.prompt?.startsWith(' ')).toBe(false);
    expect(c.prompt).not.toContain('constraints:');
    // The judge grader also has a `prompt:` key; it must not be mistaken for it.
    expect(c.prompt).not.toContain('You judge the Azure Functions app');
    expect(c.prompt).not.toContain('PRIVATE-CANARY');
    const html = readFileSync(generateReport(f.input, join(f.root, 'prompt-site')), 'utf8');
    const view = render(html, `?skill=${c.id}`);
    const rendered = view.node('#app').innerHTML;
    expect(rendered).toContain('Create a new TypeScript Azure Functions v4 HTTP app');
    expect(rendered).toContain('Hello, &lt;name&gt;!');
    expect(rendered).toContain('code-quality');
    expect(rendered).not.toContain('PRIVATE-CANARY');
  });

  it('omits the prompt rather than guessing when the scenario spec is unavailable', () => {
    const f = fixture();
    for (const cell of f.cells) {
      const evalFile = cell.plan.evalFile.replace('typescript-http/eval.yaml', 'unregistered/eval.yaml');
      cell.plan.evalFile = evalFile;
      cell.summary.evalFile = evalFile;
      cell.trial.experiment.evalFile = evalFile;
      cell.trial.shardKey = cell.trial.shardKey.replace('typescript-http/eval.yaml', 'unregistered/eval.yaml');
    }
    f.save();
    expect(readBenchmark(f.input).comparisons[0].prompt).toBeNull();
  });

  it('matches the scenario name literally rather than as a regular expression', () => {
    // A scenario identifier may contain `.`, so an unescaped interpolation would
    // let `typescript.http` match the unrelated `typescript-http` specification.
    const f = fixture();
    for (const cell of f.cells) {
      cell.plan.plannedStimulusNames = ['typescript.http'];
      cell.plan.stimuli[0].name = 'typescript.http';
      cell.trial.stimulus = 'typescript.http';
      cell.trial.shardKey = cell.trial.shardKey.replace('::typescript-http::', '::typescript.http::');
    }
    f.save();
    expect(readBenchmark(f.input).comparisons[0].prompt).toBeNull();
  });

  it('preserves missing metrics and missing counterpart rather than using zero', () => {
    const f = fixture();
    Reflect.deleteProperty(f.cells[0].trial.trajectory.metrics.tokenUsage, 'totalTokens');
    f.experiment.variantNames.splice(1, 1);
    f.snapshot.evals.splice(1, 1);
    f.cells.splice(1, 1);
    f.save();
    const c = readBenchmark(f.input).comparisons[0];
    expect(c.off?.metrics.totalTokens).toBeNull();
    expect(c.on).toBeNull();
    expect(relativeChange(null, 10)).toBeNull();
    expect(relativeChange(10, 0)).toBeNull();
    expect(relativeChange(0, 10)).toBe(-100);
  });

  it('excludes skipped trials from the success-rate denominator', () => {
    const f = fixture();
    f.cells[0].trial.status = 'skipped';
    f.save();
    expect(readBenchmark(f.input).comparisons[0].off).toMatchObject({
      planned: 1, samples: 0, skipped: 1, unexecuted: 0, failed: 0, successRate: null,
    });
  });

  it('uses all executed samples for means and does not change denominators for missing data', () => {
    const f = fixture();
    f.cells[0].plan.runs = 2;
    f.cells[0].summary.resolvedDefaults.runs = 2;
    f.save();
    const second = structuredClone(f.cells[0].trial);
    second.shardKey = second.shardKey.replace('trial-0', 'trial-1');
    second.trajectory.metrics.turnCount = 1;
    Reflect.deleteProperty(second.trajectory.metrics.tokenUsage, 'totalTokens');
    writeFileSync(join(f.input, f.cells[0].plan.variant, 'results.jsonl'),
      [f.cells[0].trial, second].map(c => JSON.stringify(c)).join('\n'));
    expect(readBenchmark(f.input).comparisons[0].off).toMatchObject({
      samples: 2, successRate: 100, metrics: { turnCount: 11, totalTokens: null },
    });
  });

  it.each(['duplicate', 'run', 'plan', 'model', 'metric', 'summary', 'identity', 'unsafe-label', 'eval-hash'])(
    'rejects invalid %s input instead of blending or silently accepting it', kind => {
      const f = fixture();
      if (kind === 'run') f.cells[0].trial.experiment.runId = 'another-run';
      if (kind === 'plan') f.snapshot.planDigest = 'wrong';
      if (kind === 'model') f.cells[0].trial.model = 'another-model';
      if (kind === 'metric') f.cells[0].trial.trajectory.metrics.turnCount = -1;
      if (kind === 'summary') f.cells[0].summary.type = 'run-summary';
      if (kind === 'identity') f.cells[0].trial.shardKey += '-wrong';
      if (kind === 'unsafe-label') f.cells[0].plan.evalName = '</script><img src=x>';
      if (kind === 'eval-hash') {
        f.cells[0].summary.evalHash = 'different';
        f.cells[0].trial.experiment.evalHash = 'different';
      }
      f.save();
      if (kind === 'duplicate') writeFileSync(join(f.input, f.cells[0].plan.variant, 'results.jsonl'),
        [f.cells[0].trial, f.cells[0].trial].map(c => JSON.stringify(c)).join('\n'));
      expect(() => readBenchmark(f.input)).toThrow();
    });

  it('rejects malformed JSON and absent required provenance', () => {
    const f = fixture();
    writeFileSync(join(f.input, 'experiment-manifest.json'), '{');
    expect(() => readBenchmark(f.input)).toThrow(/experiment-manifest.json/);
  });

  it('generates a self-contained static site containing only safe selected native fields', () => {
    const f = fixture();
    const output = join(f.root, 'site');
    const htmlPath = generateReport(f.input, output);
    const html = readFileSync(htmlPath, 'utf8');
    expect(readdirSync(output).sort()).toEqual(['azure-functions-skills-logo.png', 'index.html']);
    expect(html).toContain('835663');
    expect(html).toContain('281764');
    expect(html).not.toMatch(/PRIVATE-CANARY|disabled-built-in|cacheReadTokens|workspacePath|DESIGN SAMPLE|const n = 20|Linux \/ 2 vCPU/);
    expect(html).toContain('application/json');
    expect(html).not.toMatch(/fetch\(|<script[^>]+src=/);
    expect(html).toContain('Not comparable');
    expect(() => generateReport(f.input, output)).toThrow(/empty/);
    expect(() => generateReport(f.input, join(f.input, 'public'))).toThrow(/overlap/);
  });

  it('renders real detail IDs and chooses the first available model, not a mock default', () => {
    const f = fixture();
    const html = readFileSync(generateReport(f.input, join(f.root, 'site')), 'utf8');
    const id = readBenchmark(f.input).comparisons[0].id;
    const view = render(html, `?skill=${id}`);
    expect(view.document.title).toContain('Claude Sonnet 5');
    expect(view.node('#app').innerHTML).toContain('835,663');
    expect(view.node('#app').innerHTML).not.toContain('281,764');
    expect(view.node('#app').innerHTML).toContain('Enabled: 1/1');
    const japanese = render(html, `?skill=${id}&model=gpt-6-astra&lang=ja`);
    expect(japanese.document.documentElement.lang).toBe('ja');
    expect(japanese.node('#app').innerHTML).toContain('281,764');
    expect(japanese.node('#app').innerHTML).toContain('少数試行');
    expect(render(html, '?skill=unknown').node('#app').innerHTML).toContain('Comparison not found');
  });

  it('keeps hostile query strings inert and preserves URL state on language changes', () => {
    const f = fixture();
    const html = readFileSync(generateReport(f.input, join(f.root, 'site')), 'utf8');
    const payload = '</script><img src=x onerror=alert(1)>';
    const view = render(html, `?q=${encodeURIComponent(payload)}`);
    expect(view.node('#search').value).toBe(payload);
    expect(view.node('#app').innerHTML).not.toContain(payload);
    expect(view.node('#cards').innerHTML).toContain('No matching skills');
    view.node('#model').value = 'gpt-6-astra';
    view.node('#language').listeners.get('change')?.({ target: { value: 'ja' } });
    const query = new URL(view.location.href, 'https://example.invalid').searchParams;
    expect(query.get('q')).toBe(payload);
    expect(query.get('model')).toBe('gpt-6-astra');
    expect(query.get('lang')).toBe('ja');
  });
});
