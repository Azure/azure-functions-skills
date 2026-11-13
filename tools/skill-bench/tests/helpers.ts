import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function temporaryDirectory(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDirectory(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export function put(root: string, path: string, content: string): string {
  const file = join(root, ...path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

export const minimalEval = (name: string) => `name: ${name}
description: Minimal test eval.
defaults:
  executor: copilot-sdk
  model: model-a
  runs: 1
  timeout: 5m
agent_environment:
  files:
    - src: fixtures/app.txt
      dest: app.txt
stimuli:
  - name: ${name}-stimulus
    prompt: |
      Say hello.
    graders:
      - name: completed
        type: completed
`;

export const skillFile = (name: string) => `---
name: ${name}
description: Test skill ${name}.
---

# ${name}
`;

// A minimal workspace with one measured skill, one shared skill and one eval.
export function writeProject(root: string, extra: Record<string, unknown> = {}): string {
  put(root, 'skills/alpha/SKILL.md', skillFile('alpha'));
  put(root, 'skills/alpha/references/notes.md', 'Alpha notes.');
  put(root, 'skills/helper/SKILL.md', skillFile('helper'));
  put(root, 'bench/evals/basic/eval.yaml', minimalEval('alpha-basic'));
  put(root, 'bench/evals/basic/fixtures/app.txt', 'fixture');
  const config = {
    title: 'Test bench',
    models: ['model-a', 'model-b', 'model-c'],
    tiers: { fast: ['model-a'], slow: ['model-b', 'model-c'] },
    disabledSkills: ['unrelated-skill'],
    skills: {
      alpha: { skillDir: '../skills/alpha', evals: ['evals/basic/eval.yaml'] },
    },
    ...extra,
  };
  return put(root, 'bench/skill-bench.config.json', JSON.stringify(config, null, 2));
}
