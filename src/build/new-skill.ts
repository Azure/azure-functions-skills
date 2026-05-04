#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface CreateSkillOptions {
  id: string;
  title?: string;
  description?: string;
  category?: string;
  force?: boolean;
}

export interface CreateSkillResult {
  skillDir: string;
  files: string[];
}

export function createSkill(skillsDir: string, options: CreateSkillOptions): CreateSkillResult {
  const id = normalizeSkillId(options.id);
  const title = options.title || toTitle(id);
  const description = options.description || `${title} workflow guidance`;
  const category = options.category || 'development';
  const skillDir = join(skillsDir, id);

  if (existsSync(skillDir) && !options.force) {
    throw new Error(`Skill already exists: ${id}`);
  }

  mkdirSync(skillDir, { recursive: true });

  const files = [
    writeSkillMarkdown(skillDir, { id, title, description, category }),
  ];

  return { skillDir, files };
}

function normalizeSkillId(id: string): string {
  const normalized = id.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    throw new Error(`Invalid skill id '${id}'. Use lowercase kebab-case.`);
  }
  return normalized;
}

function toTitle(id: string): string {
  return id
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function writeSkillMarkdown(
  skillDir: string,
  metadata: { id: string; title: string; description: string; category: string },
): string {
  const filePath = join(skillDir, 'SKILL.md');
  writeFileSync(
    filePath,
    [
      '---',
      `name: ${metadata.id}`,
      `title: ${quoteYamlString(metadata.title)}`,
      `description: ${quoteYamlString(metadata.description)}`,
      `category: ${metadata.category}`,
      '---',
      '',
      `# ${metadata.title}`,
      '',
      `> ${metadata.description}`,
      '',
      '## Workflow',
      '',
      'Describe the step-by-step workflow for this skill.',
      '',
      '## Verification',
      '',
      'Describe how agents should verify the outcome.',
      '',
    ].join('\n'),
  );
  return filePath;
}

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}

function parseArgs(args: string[]): CreateSkillOptions & { skillsDir?: string } {
  const [id, ...rest] = args;
  if (!id || id === '--help' || id === '-h') {
    throw new Error('Usage: node lib/build/new-skill.js <skill-id> [--skills-dir <path>] [--title <title>] [--description <text>] [--category <category>] [--force]');
  }

  const options: CreateSkillOptions & { skillsDir?: string } = { id };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--skills-dir' && rest[i + 1]) options.skillsDir = rest[++i];
    else if (arg === '--title' && rest[i + 1]) options.title = rest[++i];
    else if (arg === '--description' && rest[i + 1]) options.description = rest[++i];
    else if (arg === '--category' && rest[i + 1]) options.category = rest[++i];
    else if (arg === '--force') options.force = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function runCli(): void {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const root = join(__dirname, '..', '..');
    const options = parseArgs(process.argv.slice(2));
    const skillsDir = options.skillsDir || join(root, 'templates', 'skills');
    const result = createSkill(skillsDir, options);
    console.log(`✅ Created skill: ${result.skillDir}`);
    for (const file of result.files) {
      console.log(`  - ${file}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
