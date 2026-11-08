import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SKILL_DIR = join(import.meta.dirname, '..', 'templates', 'skills', 'azure-functions-hosted-skills');

interface WorkflowTask {
  readonly id: string;
  readonly type: string;
  readonly tool?: string;
  readonly agent?: string;
  readonly task?: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly depends_on?: readonly string[];
  readonly for_each?: string;
  readonly when?: {
    readonly ref: string;
    readonly operator: string;
    readonly value: unknown;
  };
}

interface WorkflowPlan {
  readonly tasks: readonly WorkflowTask[];
}

function readReference(name: string): string {
  return readFileSync(join(SKILL_DIR, 'references', name), 'utf-8');
}

describe('Hosted Skills Dynamic Workflows guidance', () => {
  it('links the workflow reference and supplemental infrastructure from the authoring guidance', () => {
    for (const path of [
      'SKILL.md',
      join('references', 'dynamic-workflows.md'),
      join('references', 'infra-and-deployment.md'),
      join('references', 'testing.md'),
      join('references', 'troubleshooting.md'),
    ]) {
      const source = join(SKILL_DIR, path);
      const content = readFileSync(source, 'utf-8');
      for (const match of content.matchAll(/\]\((\.\.?\/[^)#]+)(?:#[^)]*)?\)/g)) {
        expect(existsSync(resolve(dirname(source), match[1]!)), `${path}: ${match[1]}`).toBe(true);
      }
    }
    expect(readFileSync(join(SKILL_DIR, 'SKILL.md'), 'utf-8')).toContain('./references/dynamic-workflows.md');
    expect(readReference('infra-and-deployment.md')).toContain('../assets/infra/app/durable-task-scheduler.bicep');
  });

  it('keeps illustrative plans within v1 task types, dependencies and reference rules', () => {
    const examples = [...readReference('dynamic-workflows.md').matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)];
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      const plan = JSON.parse(example[1]!) as WorkflowPlan;
      expect(plan.tasks.length).toBeGreaterThan(0);
      expect(plan.tasks.length).toBeLessThanOrEqual(50);
      const ids = new Set(plan.tasks.map(task => task.id));
      expect(ids.size).toBe(plan.tasks.length);
      for (const task of plan.tasks) {
        expect(task.id).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(['item', 'index']).not.toContain(task.id);
        expect(['tool', 'wait', 'sub_agent']).toContain(task.type);
        for (const dependency of task.depends_on ?? []) {
          expect(ids.has(dependency)).toBe(true);
          expect(dependency).not.toBe(task.id);
        }
        if (task.type === 'tool') expect(task.tool).toBeTruthy();
        if (task.type === 'sub_agent') {
          expect(task.agent).toBeTruthy();
          expect(task.task).toBeTruthy();
        }
        if (task.for_each) {
          expect(['tool', 'sub_agent']).toContain(task.type);
          expect(task.for_each).toMatch(/^\$\{[A-Za-z0-9_-]+\.result(?:\.[A-Za-z0-9_]+)*\}$/);
        }
        if (task.when) expect(['equals', 'not_equals']).toContain(task.when.operator);
        for (const match of JSON.stringify(task).matchAll(/\$\{([A-Za-z0-9_-]+)(?:\.[^}]+)?\}/g)) {
          const target = match[1]!;
          if (target === 'item' || target === 'index') {
            expect(task.for_each).toBeTruthy();
          } else {
            expect(task.depends_on).toContain(target);
          }
        }
      }
    }
  });

  it('uses matching DTS host and app-setting names without changing the HTTP route prefix', () => {
    const content = readReference('infra-and-deployment.md');
    const hostExamples = [...content.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
      .filter(match => match[1]!.trimStart().startsWith('{'))
      .map(match => JSON.parse(match[1]!) as {
        extensions?: {
          http?: { routePrefix?: string };
          durableTask?: { hubName: string; storageProvider: { type: string; connectionStringName: string } };
        };
      })
      .filter(example => example?.extensions?.durableTask);
    expect(hostExamples).toHaveLength(1);
    expect(hostExamples[0]?.extensions).toMatchObject({
      http: { routePrefix: '' },
      durableTask: {
        hubName: '%TASKHUB_NAME%',
        storageProvider: {
          type: 'azureManaged',
          connectionStringName: 'DURABLE_TASK_SCHEDULER_CONNECTION_STRING',
        },
      },
    });
    const bicep = readFileSync(join(SKILL_DIR, 'assets', 'infra', 'app', 'durable-task-scheduler.bicep'), 'utf-8');
    expect(bicep).toContain('DURABLE_TASK_SCHEDULER_CONNECTION_STRING:');
    expect(bicep).toContain('TASKHUB_NAME: taskHub.name');
    expect(bicep).toContain('Authentication=ManagedIdentity;ClientID=${managedIdentityClientId}');
    expect(bicep).not.toContain('Authentication=None');
    expect(bicep).toContain('scope: taskHub');
    expect(bicep).toContain('0ad04412-c4d5-4796-b79c-f76d14c8d402');
  });

  it('explicitly allows public IPv4 traffic in the approved new-scheduler asset', () => {
    const bicep = readFileSync(join(SKILL_DIR, 'assets', 'infra', 'app', 'durable-task-scheduler.bicep'), 'utf-8');
    expect(bicep).toContain("publicNetworkAccess: 'Enabled'");
    expect(bicep).toMatch(/ipAllowlist:\s*\[\s*'0\.0\.0\.0\/0'\s*\]/);
    const guidance = readReference('infra-and-deployment.md');
    expect(guidance).toContain("ipAllowlist: ['0.0.0.0/0']");
    expect(guidance).toMatch(/empty allowlist\s+denies all traffic/);
    expect(guidance).toContain('Do not deploy this asset over an existing scheduler');
  });
});
