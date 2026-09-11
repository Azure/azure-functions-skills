import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

  it('separates execution errors, grader failures, and actual grader score', () => {
    const f = fixture();
    f.cells[0].trial.status = 'error';
    f.cells[1].trial.gradeResult.passed = false;
    f.cells[1].trial.gradeResult.score = 0.25;
    f.save();
    const c = readBenchmark(f.input).comparisons[0];
    expect(c.off).toMatchObject({ executionErrors: 1, failed: 0, passed: 0, successRate: 0 });
    expect(c.on).toMatchObject({ executionErrors: 0, failed: 1, passed: 0, successRate: 0, score: 0.25 });
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
