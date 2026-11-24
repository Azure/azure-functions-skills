import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runBench } from '../../src/run.ts';
import { removeDirectory, temporaryDirectory } from '../helpers.ts';

let runRoot: string;
beforeEach(() => { runRoot = temporaryDirectory('skill-bench-example-'); });
afterEach(() => removeDirectory(runRoot));

const dependencies = {
  spawn: () => { throw new Error('a dry-run must not start Vally'); },
  vallyCli: 'unused', ancestorCheck: () => {}, log: () => {},
};

describe.each(['azure-functions-update', 'azure-functions-create'])('example %s', name => {
  const config = fileURLToPath(new URL(`../../examples/${name}/skill-bench.config.json`, import.meta.url));
  const skill = fileURLToPath(new URL(`../../../../templates/skills/${name}/SKILL.md`, import.meta.url));

  it.skipIf(!existsSync(skill))('stages, verifies and validates every cell with no model call', async () => {
    const result = await runBench({ config, selection: { all: true, tier: 'low' }, dryRun: true, runRoot, trusted: true },
      {}, dependencies);
    expect(result.exitCode).toBe(0);
    expect(result.cells.map(cell => [cell.enabled, cell.skills.length])).toEqual([[false, 0], [true, 1], [false, 0], [true, 1]]);
  }, 60_000);
});
