import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

describe('telemetry release contract', () => {
  it('keeps the connection string placeholder in package-owned runtime code', () => {
    const config = readFileSync(join(ROOT, 'src', 'telemetry', 'config.ts'), 'utf-8');
    const hookConfig = readFileSync(
      join(ROOT, 'templates', 'hooks', 'telemetry.config.json'),
      'utf-8',
    );

    expect(config).toContain('__APPLICATIONINSIGHTS_CONNECTION_STRING__');
    expect(hookConfig).not.toContain('APPLICATIONINSIGHTS');
  });

  it('injects the connection string only into the compiled telemetry package module', () => {
    const pipeline = readFileSync(
      join(ROOT, 'azure-pipelines', 'templates', 'build.yml'),
      'utf-8',
    );

    expect(pipeline).toContain('ApplicationInsightsConnectionString');
    expect(pipeline).toContain('dropInput/lib/telemetry/config.js');
    expect(pipeline).toContain('__APPLICATIONINSIGHTS_CONNECTION_STRING__');
    expect(pipeline).not.toContain('ApplicationInsightsInstrumentationKey');
    expect(pipeline).not.toContain('dropInput/templates/hooks/telemetry.config.json');
    expect(pipeline).not.toContain('dropInput/dist/plugin/azure-functions-skills/hooks/telemetry.config.json');
  });
});
