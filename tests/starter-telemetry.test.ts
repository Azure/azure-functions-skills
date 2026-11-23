import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleForSkill, telemetryDistribution } from '../src/telemetry/distribution.js';
import { parseHookEvent } from '../src/telemetry/hook-event.js';
import { parseTelemetryEvent } from '../src/telemetry/sender.js';
import { createTempDir, removeDir } from './helpers/fs.js';

let temp: string;

beforeAll(() => {
  temp = createTempDir('af-starter-telemetry ');
  const state = join(temp, '.azure-functions-skills');
  mkdirSync(state);
  writeFileSync(join(state, 'functions.json'), JSON.stringify({
    schemaVersion: 1, name: 'functions', commit: 'local',
    files: { '.claude/skills/azure-functions-help/SKILL.md': 'a'.repeat(64) },
  }));
  writeFileSync(join(state, 'hosted-skills.json'), JSON.stringify({
    schemaVersion: 1, name: 'hosted-skills', commit: 'local',
    files: { '.agents/skills/azure-functions-hosted-skills/references/models.md': 'b'.repeat(64) },
  }));
  writeFileSync(join(state, 'runtime.json'), JSON.stringify({
    files: { '.claude/skills/azure-functions-feedback/SKILL.md': 'c'.repeat(64) },
  }));
  writeFileSync(join(state, 'broken.json'), '{not json');
});

afterAll(() => removeDir(temp));

describe('telemetry distribution and bundle (D-019)', () => {
  it('derives the distribution from the runtime location', () => {
    expect(telemetryDistribution('/repo/.azure-functions-skills/runtime')).toBe('starter');
    expect(telemetryDistribution('C:\\repo\\.azure-functions-skills\\runtime\\')).toBe('starter');
    expect(telemetryDistribution('/repo/.claude/hooks/runtime')).toBe('workspace');
    expect(telemetryDistribution('/repo/.github/hooks/runtime')).toBe('workspace');
    expect(telemetryDistribution('/home/u/.copilot/plugins/azure-functions-skills/hooks/runtime')).toBe('plugin');
  });

  it('finds the bundle whose install record lists the skill', () => {
    const state = join(temp, '.azure-functions-skills');
    expect(bundleForSkill(state, 'azure-functions-help')).toBe('functions');
    expect(bundleForSkill(state, 'azure-functions-hosted-skills')).toBe('hosted-skills');
    expect(bundleForSkill(state, 'azure-functions-feedback')).toBe('none');
    expect(bundleForSkill(state, undefined)).toBe('none');
    expect(bundleForSkill(join(temp, 'missing'), 'azure-functions-help')).toBe('none');
  });

  it('adds runtime-owned properties and an explicit client to hook events', () => {
    const input = { tool_name: 'Read', hook_event_name: 'PostToolUse', tool_input: { file_path: '/r/.agents/skills/azure-functions-hosted-skills/references/models.md' } };
    const event = parseHookEvent(input, {}, {
      clientName: 'codex',
      distribution: 'starter',
      bundleFor: skill => (skill === 'azure-functions-hosted-skills' ? 'hosted-skills' : 'none'),
    });
    expect(event).toMatchObject({
      eventType: 'reference_file_read', clientName: 'codex', distribution: 'starter', bundle: 'hosted-skills',
    });
    expect(parseHookEvent(input, {})).not.toHaveProperty('distribution');
  });

  it('never takes distribution or bundle from hook input', () => {
    const event = parseHookEvent({ toolName: 'skill', toolArgs: { skill: 'azure-functions-help' }, distribution: 'plugin', bundle: 'evil' }, {}, {
      distribution: 'starter', bundleFor: () => 'functions',
    });
    expect(event).toMatchObject({ distribution: 'starter', bundle: 'functions' });
  });

  it('validates the new properties', () => {
    const base = { timestamp: '2026-11-15T00:00:00Z', eventType: 'skill_invocation', clientName: 'codex', pluginName: 'azure-functions-skills', skillName: 'azure-functions-help' };
    expect(parseTelemetryEvent({ ...base, distribution: 'starter', bundle: 'functions' })).toMatchObject({ distribution: 'starter', bundle: 'functions' });
    expect(() => parseTelemetryEvent({ ...base, distribution: 'npm' })).toThrow(/distribution/);
    expect(() => parseTelemetryEvent({ ...base, bundle: 'Bad Bundle' })).toThrow(/bundle/);
  });
});
