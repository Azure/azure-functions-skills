import { afterEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  TELEMETRY_DIAGNOSTIC_LOG_NAME,
  TELEMETRY_DIAGNOSTIC_MAX_BYTES,
  writeTelemetryDiagnostic,
} from '../src/telemetry/diagnostics.js';
import { createTempDir, removeDir } from './helpers/fs.js';

const TEMP_DIRS: string[] = [];

afterEach(() => {
  for (const directory of TEMP_DIRS.splice(0)) removeDir(directory);
});

describe('writeTelemetryDiagnostic', () => {
  it('is silent unless explicitly enabled', () => {
    const directory = createTempDir('af-skills-telemetry-debug-off-');
    TEMP_DIRS.push(directory);

    expect(writeTelemetryDiagnostic({
      AZURE_FUNCTIONS_SKILLS_TELEMETRY_LOG_DIR: directory,
    }, {
      component: 'sender',
      action: 'decision',
      status: 'skipped',
      reason: 'disabled',
    })).toBe(false);
    expect(existsSync(join(directory, TELEMETRY_DIAGNOSTIC_LOG_NAME))).toBe(false);
  });

  it('writes only the typed safe diagnostic contract', () => {
    const directory = createTempDir('af-skills-telemetry-debug-on-');
    TEMP_DIRS.push(directory);
    const secretValues = [
      'InstrumentationKey=connection-secret',
      'npm-password',
      'customer prompt',
      'customer file contents',
      '{"rawHookInput":true}',
      '{"rawToolArguments":true}',
    ];

    expect(writeTelemetryDiagnostic({
      AZURE_FUNCTIONS_SKILLS_TELEMETRY_DEBUG: 'true',
      AZURE_FUNCTIONS_SKILLS_TELEMETRY_LOG_DIR: directory,
      SECRET_TEST_VALUES: secretValues.join('|'),
    } as NodeJS.ProcessEnv, {
      component: 'sender',
      action: 'delivery',
      status: 'accepted',
      correlationId: '11111111-1111-4111-8111-111111111111',
      packageVersion: '1.2.3',
      pluginVersion: '1.2.3',
      attempt: 1,
      ingestion: {
        category: 'accepted',
        itemsReceived: 1,
        itemsAccepted: 1,
      },
    })).toBe(true);

    const content = readFileSync(join(directory, TELEMETRY_DIAGNOSTIC_LOG_NAME), 'utf-8');
    expect(JSON.parse(content)).toMatchObject({
      component: 'sender',
      action: 'delivery',
      status: 'accepted',
      ingestion: {
        category: 'accepted',
        itemsReceived: 1,
        itemsAccepted: 1,
      },
    });
    for (const secret of secretValues) expect(content).not.toContain(secret);
  });

  it('rotates to one bounded backup', () => {
    const directory = createTempDir('af-skills-telemetry-debug-rotate-');
    TEMP_DIRS.push(directory);
    const path = join(directory, TELEMETRY_DIAGNOSTIC_LOG_NAME);
    writeFileSync(path, 'x'.repeat(TELEMETRY_DIAGNOSTIC_MAX_BYTES));

    writeTelemetryDiagnostic({
      AZURE_FUNCTIONS_SKILLS_TELEMETRY_DEBUG: 'true',
      AZURE_FUNCTIONS_SKILLS_TELEMETRY_LOG_DIR: directory,
    }, {
      component: 'sender',
      action: 'complete',
      status: 'accepted',
    });

    expect(statSync(path).size).toBeLessThan(TELEMETRY_DIAGNOSTIC_MAX_BYTES);
    expect(statSync(`${path}.1`).size).toBe(TELEMETRY_DIAGNOSTIC_MAX_BYTES);
    expect(existsSync(`${path}.2`)).toBe(false);
  });
});
