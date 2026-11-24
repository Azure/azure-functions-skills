import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILLS_DIR = join(import.meta.dirname, '..', 'templates', 'skills');
const DOCS_DIR = join(import.meta.dirname, '..', 'docs');

function readSkill(...path: readonly string[]): string {
  return readFileSync(join(SKILLS_DIR, ...path), 'utf-8');
}

function readDoc(name: string): string {
  return readFileSync(join(DOCS_DIR, name), 'utf-8');
}

describe('Go project model guidance', () => {
  it('gates existing projects before selecting creation templates', () => {
    const createSkill = readSkill('azure-functions-create', 'SKILL.md');
    const goProject = readSkill('azure-functions-create', 'references', 'go-project.md');

    expect(createSkill).toContain('requested or detected as Go');
    expect(createSkill).toContain('existing app confirmed to use the Go worker');
    expect(createSkill).toContain('use the verified worker registration APIs');
    expect(createSkill).toContain('Path C is only for a new project in an approved empty directory');
    expect(createSkill).not.toMatch(/9\. DEPLOY: azd up/);
    expect(goProject).toContain('For an existing app, skip the scaffold steps');
  });

  it('keeps an unproven Go programming model unknown', () => {
    const routing = readSkill('azure-functions-common', 'references', 'routing.md');

    expect(routing).toContain('leave the programming model unknown');
    expect(routing).not.toContain('Without one of those signals, treat the app as a custom handler.');
  });

  it('keeps Go snippets behind the model and fallback gates', () => {
    const snippets = readSkill('azure-functions-create', 'references', 'language-snippets.md');

    expect(snippets).toContain('For Go, apply the existing-project and programming-model gate first.');
    expect(snippets).not.toContain('Go is the exception.');
  });
});

describe('Go deployment and migration guidance', () => {
  it('deploys only an approved plan, without template-based shortcuts', () => {
    const deploySkill = readSkill('azure-functions-deploy', 'SKILL.md');

    expect(deploySkill).not.toContain('.azure/plan.md');
    expect(deploySkill).not.toContain('metadata.template');
    expect(deploySkill).toContain('Pass `--approve` only with the `planId` the user approved.');
    expect(deploySkill).toContain('Apply the Go worker guidance below only after confirming');
    expect(readDoc('azure-skills-boundary.md')).not.toContain(
      'unless a documented shortcut applies',
    );
    expect(readDoc('azure-skills-boundary-jp.md')).not.toContain(
      'documented shortcut が適用される場合を除き',
    );
  });

  it('excludes Go custom handlers from worker-only doctor failures', () => {
    const checks = readSkill(
      'azure-functions-doctor',
      'references',
      'language-checks.md',
    );

    expect(checks).toMatch(/GO-004.*exclude source custom handlers/);
    expect(checks).toMatch(/GO-005.*exclude source custom handlers/);
  });

  it('separates the runnable baseline, migration candidate, and cutover', () => {
    const conversion = readSkill(
      'azure-functions-update',
      'references',
      'custom-handlers-to-go',
      'conversion.md',
    );
    const validation = readSkill(
      'azure-functions-update',
      'references',
      'custom-handlers-to-go',
      'validation.md',
    );

    expect(conversion).toContain('runnable baseline');
    expect(conversion).toContain('isolated migration candidate');
    expect(conversion).toContain('Do not permanently retire the baseline metadata');
    expect(validation).toContain('Validate the isolated migration candidate');
    expect(validation).toContain('Cutover is a separate approval');
    expect(conversion).toContain('until the approved rollback window is explicitly closed');
    expect(validation).toContain('until the approved rollback window closes');
  });
});
