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
  it('scaffolds a single SKILL.md template with frontmatter metadata', () => {
    fixtureDir = createTempDir('af-skills-new-skill-');
    const skillsDir = join(fixtureDir, 'skills');

    const result = createSkill(skillsDir, {
      id: 'azure-functions-example',
      title: 'Azure Functions Example',
      description: 'Example skill for tests',
      category: 'development',
    });

    expect(result.skillDir).toBe(join(skillsDir, 'azure-functions-example'));
    expect(existsSync(join(result.skillDir, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(result.skillDir, 'skill.yaml'))).toBe(false);
    expect(existsSync(join(result.skillDir, 'graph.yaml'))).toBe(false);

    const skillMd = readFileSync(join(result.skillDir, 'SKILL.md'), 'utf-8');
    expect(skillMd).toContain('name: azure-functions-example');
    expect(skillMd).toContain('title: "Azure Functions Example"');
    expect(skillMd).toContain('description: "Example skill for tests"');
    expect(skillMd).toContain('# Azure Functions Example');
  });

  it('quotes frontmatter strings that contain YAML-sensitive characters', () => {
    fixtureDir = createTempDir('af-skills-new-skill-');
    const skillsDir = join(fixtureDir, 'skills');

    const result = createSkill(skillsDir, {
      id: 'yaml-sensitive-skill',
      title: 'Title: With Colon',
      description: 'Use when input contains: colon or "quotes"',
    });

    const skillMd = readFileSync(join(result.skillDir, 'SKILL.md'), 'utf-8');
    expect(skillMd).toContain('title: "Title: With Colon"');
    expect(skillMd).toContain('description: "Use when input contains: colon or \\"quotes\\""');
  });

  it('refuses to overwrite an existing skill by default', () => {
    fixtureDir = createTempDir('af-skills-new-skill-');
    const skillsDir = join(fixtureDir, 'skills');
    createSkill(skillsDir, { id: 'existing-skill' });

    expect(() => createSkill(skillsDir, { id: 'existing-skill' })).toThrow(/already exists/);
  });
});
