import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import { put, removeDirectory, temporaryDirectory, writeProject } from './helpers.ts';

let root: string;
beforeEach(() => { root = temporaryDirectory('skill-bench-config-'); });
afterEach(() => removeDirectory(root));

function rewrite(file: string, change: (value: Record<string, unknown>) => void): void {
  const value = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  change(value);
  writeFileSync(file, JSON.stringify(value));
}

describe('loadConfig', () => {
  it('resolves every path relative to the configuration file', () => {
    const file = writeProject(root);
    const config = loadConfig(file);
    const base = realpathSync(join(root, 'bench'));
    expect(config.baseDir).toBe(base);
    expect(config.models).toEqual(['model-a', 'model-b', 'model-c']);
    expect(config.skills.alpha.skillDir).toBe(realpathSync(join(root, 'skills', 'alpha')));
    expect(config.skills.alpha.evals).toEqual([{
      scenario: 'basic', id: 'evals/alpha/basic/eval.yaml',
      file: join(base, 'evals', 'basic', 'eval.yaml'), directory: join(base, 'evals', 'basic'),
    }]);
    expect(config.disabledSkills).toEqual(['unrelated-skill']);
    expect(config.timeout).toBe('10m');
    expect(config.sharedSkills).toEqual([]);
  });

  it('loads shared skills, plugins and preflight modules as absolute paths', () => {
    put(root, 'bench/plugins/grader.ts', 'export function registerGraders() {}');
    put(root, 'bench/plugins/check.ts', 'export const preflight = { name: "check" };');
    const file = writeProject(root, {
      sharedSkills: { helper: { skillDir: '../skills/helper' } },
      skills: { alpha: {
        skillDir: '../skills/alpha', files: ['SKILL.md'], evals: ['evals/basic/eval.yaml'],
        plugins: { graders: ['plugins/grader.ts'], preflight: [{ module: 'plugins/check.ts', options: { a: 1 } }] },
      } },
    });
    const config = loadConfig(file);
    expect(config.sharedSkills.map(skill => skill.name)).toEqual(['helper']);
    expect(config.skills.alpha.files).toEqual(['SKILL.md']);
    expect(config.skills.alpha.graders).toEqual([realpathSync(join(root, 'bench', 'plugins', 'grader.ts'))]);
    expect(config.skills.alpha.preflight).toEqual([
      { module: realpathSync(join(root, 'bench', 'plugins', 'check.ts')), options: { a: 1 } },
    ]);
  });

  it('rejects unknown keys so a typo cannot silently change the benchmark', () => {
    const file = writeProject(root, { sharedSkill: {} });
    expect(() => loadConfig(file)).toThrow(/unknown key "sharedSkill"/);
  });

  it('requires tiers to place every registered model in exactly one tier', () => {
    const file = writeProject(root, { tiers: { fast: ['model-a'] } });
    expect(() => loadConfig(file)).toThrow(/exactly one tier/);
    const other = writeProject(root, { tiers: { fast: ['model-a', 'model-x'], slow: ['model-b', 'model-c'] } });
    expect(() => loadConfig(other)).toThrow(/registered models/);
  });

  it('requires a SKILL.md whose name matches the registered skill', () => {
    const file = writeProject(root);
    put(root, 'skills/alpha/SKILL.md', '---\nname: beta\n---\n');
    expect(() => loadConfig(file)).toThrow(/name "beta".*"alpha"/);
  });

  it('rejects eval files that are not <scenario>/eval.yaml and duplicate scenarios', () => {
    const file = writeProject(root);
    rewrite(file, value => { (value.skills as Record<string, Record<string, unknown>>).alpha.evals = ['evals/basic/other.yaml']; });
    expect(() => loadConfig(file)).toThrow(/eval\.yaml/);
    put(root, 'bench/more/basic/eval.yaml', 'name: other');
    rewrite(file, value => {
      (value.skills as Record<string, Record<string, unknown>>).alpha.evals = ['evals/basic/eval.yaml', 'more/basic/eval.yaml'];
    });
    expect(() => loadConfig(file)).toThrow(/duplicate scenario/);
  });

  it('keeps shared, measured and disabled skill names distinct', () => {
    const shared = writeProject(root, { sharedSkills: { alpha: { skillDir: '../skills/alpha' } } });
    expect(() => loadConfig(shared)).toThrow(/both measured and shared/);
    const disabled = writeProject(root, { disabledSkills: ['alpha'] });
    expect(() => loadConfig(disabled)).toThrow(/disabledSkills/);
  });

  it('rejects skill file lists that leave the skill directory or omit SKILL.md', () => {
    const file = writeProject(root);
    rewrite(file, value => { (value.skills as Record<string, Record<string, unknown>>).alpha.files = ['../helper/SKILL.md']; });
    expect(() => loadConfig(file)).toThrow(/relative/);
    rewrite(file, value => { (value.skills as Record<string, Record<string, unknown>>).alpha.files = ['references/notes.md']; });
    expect(() => loadConfig(file)).toThrow(/SKILL\.md/);
  });

  it('rejects a missing plugin module and an invalid timeout', () => {
    const file = writeProject(root, { skills: { alpha: {
      skillDir: '../skills/alpha', evals: ['evals/basic/eval.yaml'], plugins: { graders: ['plugins/missing.ts'] },
    } } });
    expect(() => loadConfig(file)).toThrow(/missing\.ts/);
    const timeout = writeProject(root, { timeout: 'forever' });
    expect(() => loadConfig(timeout)).toThrow(/timeout/);
  });

  it('refuses a skill directory that is a symbolic link', () => {
    const file = writeProject(root);
    symlinkSync(join(root, 'skills', 'alpha'), join(root, 'skills', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    rewrite(file, value => { (value.skills as Record<string, Record<string, unknown>>).alpha.skillDir = '../skills/linked'; });
    expect(() => loadConfig(file)).toThrow(/symbolic link/);
  });
});
