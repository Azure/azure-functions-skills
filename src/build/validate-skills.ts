#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseMarkdownFrontmatter } from './loader.js';

export interface SkillValidationError {
  skillId?: string;
  file?: string;
  message: string;
}

export interface SkillValidationResult {
  valid: boolean;
  errors: SkillValidationError[];
}

const REQUIRED_SKILL_FILES = ['SKILL.md'] as const;

export function validateSkills(skillsDir: string): SkillValidationResult {
  const errors: SkillValidationError[] = [];

  if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) {
    return {
      valid: false,
      errors: [{ message: `Skills directory does not exist: ${skillsDir}` }],
    };
  }

  const skillDirs = readdirSync(skillsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();

  for (const dirName of skillDirs) {
    const skillDir = join(skillsDir, dirName);
    for (const file of REQUIRED_SKILL_FILES) {
      const filePath = join(skillDir, file);
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        errors.push({
          skillId: dirName,
          file,
          message: `Missing required file: ${file}`,
        });
      }
    }

    const skillMarkdownPath = join(skillDir, 'SKILL.md');
    if (existsSync(skillMarkdownPath)) {
      const { frontmatter } = parseMarkdownFrontmatter(readFileSync(skillMarkdownPath, 'utf-8'));
      const declaredName = frontmatter.name || '';
      if (!declaredName) {
        errors.push({
          skillId: dirName,
          file: 'SKILL.md',
          message: 'Missing required skill name in SKILL.md frontmatter',
        });
      } else if (declaredName !== dirName) {
        errors.push({
          skillId: declaredName,
          file: 'SKILL.md',
          message: `Skill name '${declaredName}' does not match directory '${dirName}'`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function runCli(): void {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const root = join(__dirname, '..', '..');
  const skillsDir = process.argv[2] || join(root, 'templates', 'skills');
  const result = validateSkills(skillsDir);

  if (result.valid) {
    console.log(`✅ Skill templates are valid: ${skillsDir}`);
    return;
  }

  console.error(`❌ Skill template validation failed: ${skillsDir}`);
  for (const error of result.errors) {
    const prefix = [error.skillId, error.file].filter(Boolean).join(' / ');
    console.error(`- ${prefix ? `${prefix}: ` : ''}${error.message}`);
  }
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
