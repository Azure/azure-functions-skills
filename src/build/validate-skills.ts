#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadSkills } from './loader.js';

export interface SkillValidationError {
  skillId?: string;
  file?: string;
  message: string;
}

export interface SkillValidationResult {
  valid: boolean;
  errors: SkillValidationError[];
}

const REQUIRED_SKILL_FILES = ['skill.yaml', 'graph.yaml', 'SKILL.md'] as const;

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

    const skillYamlPath = join(skillDir, 'skill.yaml');
    if (existsSync(skillYamlPath)) {
      const declaredId = parseSkillId(readFileSync(skillYamlPath, 'utf-8'));
      if (!declaredId) {
        errors.push({
          skillId: dirName,
          file: 'skill.yaml',
          message: 'Missing required skill id in skill.yaml',
        });
      } else if (declaredId !== dirName) {
        errors.push({
          skillId: declaredId,
          file: 'skill.yaml',
          message: `Skill id '${declaredId}' does not match directory '${dirName}'`,
        });
      }
    }
  }

  if (errors.length === 0) {
    const skills = loadSkills(skillsDir);
    const skillIds = new Set(skills.map(skill => skill.id));

    for (const skill of skills) {
      const graphTargets = [
        ...skill.graph.suggestions.on_success,
        ...skill.graph.suggestions.on_failure,
      ];
      for (const suggestion of graphTargets) {
        if (!skillIds.has(suggestion.target)) {
          errors.push({
            skillId: skill.id,
            file: 'graph.yaml',
            message: `Graph references unknown skill target '${suggestion.target}'`,
          });
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function parseSkillId(skillYaml: string): string {
  const match = skillYaml.match(/^\s*id:\s*["']?(.+?)["']?\s*$/m);
  return match ? match[1].trim() : '';
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
