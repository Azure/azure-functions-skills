import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSkill } from '../src/build/new-skill.js';
import { createTempDir, removeDir } from './helpers/fs.js';

let fixtureDir = '';

afterEach(() => {
  removeDir(fixtureDir);
  fixtureDir = '';
});

describe('createSkill', () => {
  it('scaffolds the required skill template files', () => {
    fixtureDir = createTempDir('af-skills-new-skill-');
    const skillsDir = join(fixtureDir, 'skills');

    const result = createSkill(skillsDir, {
      id: 'azure-functions-example',
      title: 'Azure Functions Example',
      description: 'Example skill for tests',
      category: 'development',
    });

    expect(result.skillDir).toBe(join(skillsDir, 'azure-functions-example'));
    expect(existsSync(join(result.skillDir, 'skill.yaml'))).toBe(true);
    expect(existsSync(join(result.skillDir, 'graph.yaml'))).toBe(true);
    expect(existsSync(join(result.skillDir, 'SKILL.md'))).toBe(true);

    expect(readFileSync(join(result.skillDir, 'skill.yaml'), 'utf-8')).toContain('id: azure-functions-example');
    expect(readFileSync(join(result.skillDir, 'graph.yaml'), 'utf-8')).toContain('on_success');
    expect(readFileSync(join(result.skillDir, 'SKILL.md'), 'utf-8')).toContain('# Azure Functions Example');
  });

  it('refuses to overwrite an existing skill by default', () => {
    fixtureDir = createTempDir('af-skills-new-skill-');
    const skillsDir = join(fixtureDir, 'skills');
    createSkill(skillsDir, { id: 'existing-skill' });

    expect(() => createSkill(skillsDir, { id: 'existing-skill' })).toThrow(/already exists/);
  });
});
