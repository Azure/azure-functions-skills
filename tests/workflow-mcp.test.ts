import { afterEach, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createTempDir, removeDir } from './helpers/fs.js';
import { listWorkflowTools, parsePlan, runWorkflow } from '../src/workflow/index.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(removeDir));
const mcpConfig = { servers: { fixture: {
  command: process.execPath, args: [resolve('tests', 'fixtures', 'workflow-mcp.mjs')],
} } };

it('discovers and calls a real explicit stdio server', async () => {
  const tools = await listWorkflowTools(mcpConfig, 'fixture');
  expect(tools.map(tool => tool.name)).toEqual(['echo']);
  const dir = createTempDir('workflow-mcp-');
  dirs.push(dir);
  const run = await runWorkflow(parsePlan({ version: 1, nodes: [{
    id: 'echo', action: { kind: 'mcp', server: 'fixture', tool: 'echo', arguments: { value: 'hello' } },
    exports: { value: '/value' },
  }], outputs: { value: { $ref: 'echo.value' } } }), { dir, mcpConfig });
  expect(run.status).toBe('succeeded');
  expect(run.outputs.value).toBe('hello');
});

it('does not turn an MCP tool error into success', async () => {
  const dir = createTempDir('workflow-mcp-error-');
  dirs.push(dir);
  const run = await runWorkflow(parsePlan({ version: 1, nodes: [{
    id: 'error', action: { kind: 'mcp', server: 'fixture', tool: 'error', arguments: {} },
  }] }), { dir, mcpConfig });
  expect(run.status).toBe('failed');
});
