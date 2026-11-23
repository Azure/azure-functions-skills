import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  options: { frontmatterName?: string; includeFrontmatter?: boolean; description?: string } = {},
): void {
  const skillDir = join(skillsDir, dirName);
  mkdirSync(skillDir, { recursive: true });
  const includeFrontmatter = options.includeFrontmatter ?? true;
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    includeFrontmatter
      ? `---\nname: ${options.frontmatterName || dirName}\ntitle: ${dirName}\ndescription: "${options.description ?? dirName}"\ncategory: test\n---\n\n# ${dirName}\n`
      : `# ${dirName}\n`,
  );
}

afterEach(() => {
  removeDir(fixtureDir);
  fixtureDir = '';
});

describe('validateSkills', () => {
  it('accepts valid skill templates', () => {
    const skillsDir = createFixture();
    writeSkill(skillsDir, 'first-skill');
    writeSkill(skillsDir, 'second-skill');

    const result = validateSkills(skillsDir);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts skill templates without skill.yaml or graph.yaml', () => {
    const skillsDir = createFixture();
    writeSkill(skillsDir, 'metadata-in-skill-md');

    const result = validateSkills(skillsDir);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a description with exactly 1024 characters', () => {
    const skillsDir = createFixture();
    writeSkill(skillsDir, 'at-limit', { description: 'a'.repeat(1024) });

    expect(validateSkills(skillsDir)).toEqual({ valid: true, errors: [] });
  });

  it('reports a description with more than 1024 characters', () => {
    const skillsDir = createFixture();
    writeSkill(skillsDir, 'over-limit', { description: 'a'.repeat(1025) });

    expect(validateSkills(skillsDir)).toEqual({
      valid: false,
      errors: [{
        skillId: 'over-limit',
        file: 'SKILL.md',
        message: 'Skill description must be at most 1024 characters (found 1025)',
      }],
    });
  });

  it('reports skill IDs that do not match directory names', () => {
    const skillsDir = createFixture();
    writeSkill(skillsDir, 'directory-name', { frontmatterName: 'different-id' });

    const result = validateSkills(skillsDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        skillId: 'different-id',
        file: 'SKILL.md',
        message: expect.stringContaining('does not match directory'),
      }),
    ]));
  });

  it('reports missing SKILL.md frontmatter name', () => {
    const skillsDir = createFixture();
    writeSkill(skillsDir, 'missing-frontmatter', { includeFrontmatter: false });

    const result = validateSkills(skillsDir);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({
        skillId: 'missing-frontmatter',
        file: 'SKILL.md',
        message: expect.stringContaining('Missing required skill name'),
      }),
    ]));
  });
});
