import { describe, expect, it } from 'vitest';
import { parseHookEvent } from '../src/telemetry/hook-event.js';

describe('parseHookEvent', () => {
  it.each([
    [{ toolName: 'skill', toolArgs: { skill: 'azure-functions-help' } }, 'copilot-cli'],
    [{
      hook_event_name: 'PostToolUse',
      tool_name: 'Skill',
      tool_input: { skill: 'azure-functions-skills:azure-functions-help' },
    }, 'claude-code'],
    [{
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      transcript_path: 'C:\\Code - Insiders\\private.json',
      tool_input: { file_path: 'C:\\repo\\.agents\\skills\\azure-functions-help\\SKILL.md' },
    }, 'Visual Studio Code - Insiders'],
  ])('normalizes supported host inputs without sending raw arguments', (input, clientName) => {
    expect(parseHookEvent({ ...input, session_id: 'session-1', prompt: 'private' }, {}))
      .toEqual({
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
        eventType: 'skill_invocation',
        clientName,
        pluginName: 'azure-functions-skills',
        skillName: 'azure-functions-help',
        sessionId: 'session-1',
      });
  });

  it('keeps Functions tool names and bundled file references only', () => {
    expect(parseHookEvent({ toolName: 'functions_project_get' }, { COPILOT_CLI: '1' }))
      .toMatchObject({ eventType: 'tool_invocation', toolName: 'functions_project_get', clientName: 'copilot-cli' });
    expect(parseHookEvent({
      tool_name: 'Read',
      tool_input: { file_path: '/home/.claude/plugins/cache/azure-functions-skills/azure-functions-skills/0.0.6-preview/skills/azure-functions-hosted-skills/references/infra-and-deployment.md' },
    }, {})).toMatchObject({
      eventType: 'reference_file_read',
      fileReference: 'azure-functions-hosted-skills/references/infra-and-deployment.md',
    });

  });

  it('accepts a workspace-relative skill path', () => {
    expect(parseHookEvent({
      toolName: 'view', toolArgs: { path: '.github/skills/azure-functions-help/SKILL.md' },
    }, {})).toMatchObject({ eventType: 'skill_invocation', skillName: 'azure-functions-help' });
  });

  it.each([
    ['skill', { skill: 'azure-functions-help', secret: 'private-input' }, {
      eventType: 'skill_invocation', skillName: 'azure-functions-help',
    }],
    ['view', { path: '.github/skills/azure-functions-hosted-skills/references/infra-and-deployment.md' }, {
      eventType: 'reference_file_read', fileReference: 'azure-functions-hosted-skills/references/infra-and-deployment.md',
    }],
  ])('decodes serialized %s arguments without keeping raw input', (toolName, toolArgs, event) => {
    const parsed = parseHookEvent({ toolName, toolArgs: JSON.stringify(toolArgs) }, {});
    expect(parsed).toMatchObject(event);
    expect(parsed).not.toHaveProperty('toolArgs');
    expect(parsed).not.toHaveProperty('secret');
  });

  it.each(['{invalid', 'null', '[]', '"private"', '123'])(
    'does not create an event from invalid serialized arguments: %s',
    toolArgs => {
      expect(parseHookEvent({ toolName: 'skill', toolArgs }, {})).toBeUndefined();
      expect(parseHookEvent({ toolName: 'view', toolArgs }, {})).toBeUndefined();
    },
  );

  it.each([
    null, [], {}, { toolName: 'Bash', toolArgs: { command: 'private' } },
    { toolName: 'skill', toolArgs: { skill: 'azure-functions-private-customer' } },
    { toolName: 'Read', tool_input: { file_path: '/private/azure-functions-help/SKILL.md' } },
    { toolName: 'Read', tool_input: { file_path: '/repo/.github/skills/azure-functions-help/../../secret' } },
    { toolName: 'Read', tool_input: { file_path: '/repo/.github/skills/azure-functions-help/customer.txt' } },
  ])('does not create an event for unrelated or invalid input: %j', input => {
    expect(parseHookEvent(input, {})).toBeUndefined();
  });
});
