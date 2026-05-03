import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateSkills } from '../src/build/validate-skills.js';
import { createTempDir, removeDir } from './helpers/fs.js';

let fixtureDir = '';

function createFixture(): string {
  fixtureDir = createTempDir('af-skills-validation-');
  const skillsDir = join(fixtureDir, 'skills');
  mkdirSync(skillsDir, { recursive: true });
  return skillsDir;
}

function writeSkill(
  skillsDir: string,
  dirName: string,
  options: { yamlId?: string; graphTarget?: string } = {},
): void {
  const skillDir = join(skillsDir, dirName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'skill.yaml'),
    `id: ${options.yamlId || dirName}\ntitle: ${dirName}\ndescription: "${dirName}"\ncategory: test\n`,
  );
  writeFileSync(
    join(skillDir, 'graph.yaml'),
    options.graphTarget
      ? `suggestions:\n  on_success:\n    - target: ${options.graphTarget}\n      reason: "next"\n`
      : 'suggestions:\n  on_success: []\n',
  );
  writeFileSync(join(skillDir, 'SKILL.md'), `# ${dirName}\n`);
}

afterEach(() => {
  removeDir(fixtureDir);
  fixtureDir = '';
});

describe('validateSkills', () => {
  it('accepts valid skill templates', () => {
    const skillsDir = createFixture();
    writeSkill(skillsDir, 'first-skill', { graphTarget: 'second-skill' });
    writeSkill(skillsDir, 'second-skill');

    const result = validateSkills(skillsDir);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports missing required files with clear errors', () => {
    const skillsDir = createFixture();
    writeSkill(skillsDir, 'missing-graph');
    rmSync(join(skillsDir, 'missing-graph', 'graph.yaml'));

    const result = validateSkills(skillsDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        skillId: 'missing-graph',
        file: 'graph.yaml',
        message: expect.stringContaining('Missing required file'),
      }),
    ]));
  });

  it('reports skill IDs that do not match directory names', () => {
    const skillsDir = createFixture();
    writeSkill(skillsDir, 'directory-name', { yamlId: 'different-id' });

    const result = validateSkills(skillsDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        skillId: 'different-id',
        message: expect.stringContaining('does not match directory'),
      }),
    ]));
  });

  it('reports graph targets that do not point to existing skills', () => {
    const skillsDir = createFixture();
    writeSkill(skillsDir, 'source-skill', { graphTarget: 'missing-skill' });

    const result = validateSkills(skillsDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        skillId: 'source-skill',
        message: expect.stringContaining('unknown skill target'),
      }),
    ]));
  });
});
