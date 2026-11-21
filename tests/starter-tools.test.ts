import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadStarterConfig, STARTER_OSES } from '../src/starter/config.js';
import { ROOT, TOOLS } from './helpers/starter.js';

const SETUP_ROWS: Readonly<Record<string, string>> = {
  node: 'Node.js',
  func: 'Core Tools',
  az: 'Azure CLI',
  azd: 'Azure Developer CLI',
  python: 'Python',
};
const COLUMN: Readonly<Record<string, number>> = { windows: 2, macos: 3, linux: 4 };

function setupTable(): Map<string, string[]> {
  const skill = readFileSync(join(ROOT, 'templates', 'skills', 'azure-functions-setup', 'SKILL.md'), 'utf-8');
  const rows = new Map<string, string[]>();
  for (const line of skill.split(/\r?\n/)) {
    if (!line.startsWith('| ')) continue;
    const cells = line.slice(1, -1).split('|').map(cell => cell.trim());
    rows.set(cells[0], cells);
  }
  return rows;
}

describe('starter tool-install table (ST-004)', () => {
  it('uses only commands that the azure-functions-setup table also gives', () => {
    const rows = setupTable();
    for (const [tool, label] of Object.entries(SETUP_ROWS)) {
      const row = rows.get(label);
      expect(row, label).toBeDefined();
      for (const os of STARTER_OSES) {
        const command = TOOLS.tools[tool].commands[os];
        if (command === null) continue;
        const options = [...(row as string[])[COLUMN[os]].matchAll(/`([^`]+)`/g)].map(match => match[1]);
        expect(options, `${tool} on ${os}`).toContain(command);
      }
    }
  });

  it('has no command where the setup skill gives no single command', () => {
    expect(TOOLS.tools.func.commands.windows).toBeNull();
    for (const tool of Object.values(TOOLS.tools)) expect(tool.commands.linux).toBeNull();
  });

  it('covers every tool that a bundle lists, with Node.js first for the functions bundle', () => {
    const config = loadStarterConfig(join(ROOT, 'starter.config.json'));
    for (const bundle of Object.values(config.bundles)) {
      for (const tool of bundle.tools) expect(TOOLS.tools[tool], tool).toBeDefined();
    }
    expect(config.bundles.functions.tools[0]).toBe('node');
  });

  it('never adds agreement-acceptance or elevation flags', () => {
    for (const tool of Object.values(TOOLS.tools)) {
      for (const command of Object.values(tool.commands)) {
        if (command !== null) expect(command).not.toMatch(/--accept-|--silent|sudo|-Verb RunAs/i);
      }
    }
  });
});
