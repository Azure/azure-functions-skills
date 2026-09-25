import { afterEach, describe, expect, it } from 'vitest';
import { linkSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { generateReport, readBenchmark, relativeChange } from '../src/report.ts';
import { removeDirectory, temporaryDirectory } from './helpers.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) removeDirectory(root); });

function fixture() {
  const root = temporaryDirectory('skill-bench-report-');
  roots.push(root);
  const input = join(root, 'out');
  mkdirSync(input);
  const shared = join(root, 'PRIVATE-SOURCE', 'shared-skill');
  const target = join(root, 'PRIVATE-SOURCE', 'alpha');
  const cells = ['model-a', 'model-b'].flatMap(model => [false, true].map(enabled => ({
    index: 0, id: `alpha/basic/${enabled ? 'on' : 'off'}/${model}`,
    variant: `skill=${enabled ? 'on' : 'off'},model=${model}`, skill: 'alpha', scenario: 'basic',
    evalFile: 'evals/alpha/basic/eval.yaml', evalName: 'alpha-basic', model, enabled, runs: 1,
    stimuli: ['hello'], prompts: { hello: 'Say hello.\u0007\n' } as Record<string, string>,
    skills: enabled ? [shared, target] : [shared], sharedSkills: [shared],
    evalHash: 'b839dd0e746a0f09', configHash: 'abcdef0000000000',
    results: `${model}/${enabled ? 'on' : 'off'}/results.jsonl` as string | null,
    workspace: `${model}/${enabled ? 'on' : 'off'}/workspace` as string | null,
    workspaceError: null as string | null, exitCode: 0 as number | null,
  })));
  const manifest = {
    type: 'skill-bench-matrix', version: 1, vallyVersion: '0.16.0', title: 'Alpha bench',
    display: { models: { 'model-a': 'Model A' }, skills: {}, scenarios: {} },
    runId: '06b6578a-ad9f-4b21-8d90-d2ef8c7819a8', planHash: '0a81350e649a2fbc', cells,
  };
  const records: Record<string, unknown>[][] = cells.map((cell, index) => [{
    type: 'trial-result', itemId: `PRIVATE-ITEM-${index}`, evalName: cell.evalName,
    evalFilePath: join(root, 'PRIVATE-SOURCE', `.cell-${index}.json`),
    variant: 'main', stimulus: 'hello', model: cell.model, trialIndex: 0, totalTrials: 1,
    status: 'success', durationMs: 999,
    gradeResult: { passed: true, score: 1, details: [{ name: 'completed', passed: true, score: 1, evidence: 'PRIVATE-EVIDENCE' }] },
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
      if (cell.results === null || cell.results.includes('..') || cell.results.includes(':')) return;
      const file = join(input, cell.results);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, records[index].map(record => JSON.stringify(record)).join('\n'));
      if (cell.workspace !== null) mkdirSync(join(input, cell.workspace), { recursive: true });
    });
  }
  save();
  return { root, input, manifest, cells, records, save };
}

// Run the inline dashboard script with a small DOM stand-in; no browser dependency.
function render(html: string, search: string) {
  const data = /<script id="benchmark-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)?.[1];
  const script = /<script type="module">([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!data || !script) throw new Error('Missing dashboard script');
  class Element {
    textContent = '';
    innerHTML = '';
    value = '';
    href = '';
    addEventListener() {}
  }
  const elements = new Map<string, Element>();
  const node = (selector: string) => {
    let element = elements.get(selector);
    if (!element) { element = new Element(); elements.set(selector, element); }
    return element;
  };
  node('#benchmark-data').textContent = data;
  const document = {
    documentElement: { lang: '' }, title: '',
    querySelector: node,
    querySelectorAll: () => [node('.brand'), node('.nav-link')],
  };
  runInNewContext(script, { document, location: { search, href: '' }, URLSearchParams });
  return { node, document };
}

describe('readBenchmark', () => {
  it('pairs ON and OFF within each model and keeps labels and prompts', () => {
    const f = fixture();
    const data = readBenchmark(f.input);
    expect(data.title).toBe('Alpha bench');
    expect(data.display.models).toEqual({ 'model-a': 'Model A' });
    expect(data.provenance).toEqual({ runId: f.manifest.runId, planHash: f.manifest.planHash, vallyVersion: '0.16.0', transport: 'vally-eval' });
    expect(data.comparisons.map(c => c.model)).toEqual(['model-a', 'model-b']);
    expect(data.comparisons.map(c => [c.off?.metrics.totalTokens, c.on?.metrics.totalTokens])).toEqual([[100, 101], [102, 103]]);
    expect(data.comparisons[0].on).toMatchObject({ planned: 1, samples: 1, passed: 1, successRate: 100, workspace: 'model-a/on/workspace' });
    expect(data.comparisons[0].prompt).toBe('Say hello.');
    expect(relativeChange(101, 100)).toBeCloseTo(1);
    expect(relativeChange(1, 0)).toBeNull();
  });

  it.each(['null-result', 'empty-results', 'summary-only'])('keeps %s unexecuted, with no score', kind => {
    const f = fixture();
    if (kind === 'null-result') f.cells[0].results = null;
    if (kind === 'empty-results') f.records[0] = [];
    if (kind === 'summary-only') f.records[0].shift();
    f.save();
    expect(readBenchmark(f.input).comparisons[0].off).toMatchObject({
      planned: 1, samples: 0, unexecuted: 1, passed: 0, failed: 0, successRate: null, score: null,
      metrics: { totalTokens: null },
    });
  });

  it('keeps ungraded, skipped, execution errors and grader errors distinct', () => {
    const f = fixture();
    f.records[0][0].gradeResult = null;
    f.records[1][0].status = 'skipped';
    f.records[2][0].status = 'error';
    f.records[2][0].gradeResult = null;
    f.records[3][0].gradeResult = { passed: true, score: 1, details: [{ name: 'completed', status: 'error', passed: true, score: 1 }] };
    f.save();
    const [a, b] = readBenchmark(f.input).comparisons;
    expect(a.off).toMatchObject({ samples: 1, passed: 0, failed: 0, successRate: null, score: null });
    expect(a.on).toMatchObject({ skipped: 1, samples: 0, successRate: null });
    expect(b.off).toMatchObject({ executionErrors: 1, passed: 0, successRate: 0 });
    expect(b.on).toMatchObject({ failed: 1, passed: 0, successRate: 0 });
  });

  it.each([
    'model', 'variant', 'enabled', 'duplicate-trial', 'trial-index', 'stimulus', 'eval-name', 'missing-grade',
    'off-target', 'extra-skill', 'target-shared', 'relative-skill', 'unsafe-label', 'plan-hash', 'eval-path',
    'duplicate-results', 'unknown-record', 'version', 'type',
  ])('rejects inconsistent %s data', kind => {
    const f = fixture();
    const cell = f.cells[0];
    const row = f.records[0][0];
    if (kind === 'model') row.model = 'another-model';
    if (kind === 'variant') row.variant = 'skill=on,model=model-a';
    if (kind === 'enabled') cell.enabled = true;
    if (kind === 'duplicate-trial') f.records[0].splice(1, 0, { ...row, itemId: 'another-item' });
    if (kind === 'trial-index') row.trialIndex = 1;
    if (kind === 'stimulus') row.stimulus = 'unplanned';
    if (kind === 'eval-name') row.evalName = 'unplanned';
    if (kind === 'missing-grade') delete row.gradeResult;
    if (kind === 'off-target') cell.skills.push(join(f.root, 'alpha'));
    if (kind === 'extra-skill') cell.skills.push(join(f.root, 'extra'));
    if (kind === 'target-shared') { cell.sharedSkills = [join(f.root, 'alpha')]; cell.skills = [...cell.sharedSkills]; }
    if (kind === 'relative-skill') { cell.sharedSkills = ['shared-skill']; cell.skills = ['shared-skill']; }
    if (kind === 'unsafe-label') cell.model = '</script>';
    if (kind === 'plan-hash') f.manifest.planHash = 'not-a-hash';
    if (kind === 'eval-path') cell.evalFile = '../' + cell.evalFile;
    if (kind === 'duplicate-results') f.cells[1].results = cell.results;
    if (kind === 'unknown-record') f.records[0].push({ type: 'custom-result' });
    if (kind === 'version') f.manifest.version = 2;
    if (kind === 'type') f.manifest.type = 'vally-eval-matrix';
    f.save();
    expect(() => readBenchmark(f.input)).toThrow();
  });

  it.each(['traversal', 'absolute', 'link-escape', 'hard-link-alias'])('rejects %s result paths', kind => {
    const f = fixture();
    if (kind === 'traversal') f.cells[0].results = '../outside.jsonl';
    if (kind === 'absolute') f.cells[0].results = join(f.root, 'outside.jsonl');
    if (kind === 'link-escape') {
      const target = join(f.root, 'outside');
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, 'results.jsonl'), JSON.stringify(f.records[0][0]));
      symlinkSync(target, join(f.input, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      f.cells[0].results = 'linked/results.jsonl';
    }
    if (kind === 'hard-link-alias') {
      linkSync(join(f.input, 'model-a', 'off', 'results.jsonl'), join(f.input, 'alias.jsonl'));
      f.cells[1].results = 'alias.jsonl';
    }
    writeFileSync(join(f.input, 'matrix-manifest.json'), JSON.stringify(f.manifest));
    expect(() => readBenchmark(f.input)).toThrow(/path|inside|distinct/);
  });
});

describe('generateReport', () => {
  it('writes benchmark.json and a dashboard with only safe fields', () => {
    const f = fixture();
    const site = join(f.root, 'site');
    const html = readFileSync(generateReport(f.input, site), 'utf8');
    expect(readdirSync(site).sort()).toEqual(['benchmark.json', 'index.html']);
    expect(JSON.parse(readFileSync(join(site, 'benchmark.json'), 'utf8')).title).toBe('Alpha bench');
    expect(html).not.toMatch(/PRIVATE-|evalFilePath|sharedSkills|policyAnswers|cacheReadTokens|itemId/);
    const comparison = readBenchmark(f.input).comparisons[0];
    const view = render(html, `?skill=${comparison.id}`);
    const detail = view.node('#app').innerHTML;
    expect(detail).toContain('Model A');
    expect(detail).toContain('matrix-manifest.json');
    expect(detail).toContain('model-a/on/workspace');
    const dashboard = render(html, '');
    expect(dashboard.node('#brand-title').textContent).toBe('Alpha bench');
    expect(dashboard.document.title).toBe('Alpha bench | Benchmarks');
  });

  it('refuses a non-empty or overlapping output', () => {
    const f = fixture();
    const site = join(f.root, 'site');
    mkdirSync(site);
    writeFileSync(join(site, 'old.txt'), 'x');
    expect(() => generateReport(f.input, site)).toThrow(/empty/);
    expect(() => generateReport(f.input, join(f.input, 'site'))).toThrow(/overlap/);
  });

  it('shows an empty dashboard when the template has no data', () => {
    const template = readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');
    expect(template.split('/* BENCHMARK_DATA */ null')).toHaveLength(2);
    expect(template).not.toMatch(/azure/i);
    expect(() => render(template, '')).not.toThrow();
  });
});
