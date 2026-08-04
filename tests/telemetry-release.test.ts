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
    const officialPipeline = readFileSync(
      join(ROOT, 'azure-pipelines', 'official-build.yml'),
      'utf-8',
    );
    const prereleasePipeline = readFileSync(
      join(ROOT, 'azure-pipelines', 'pre-release.yml'),
      'utf-8',
    );
    const publicPipeline = readFileSync(
      join(ROOT, 'azure-pipelines', 'public-build.yml'),
      'utf-8',
    );

    expect(pipeline).toContain('InjectTelemetryConnectionString');
    expect(pipeline).toContain('ApplicationInsightsConnectionString');
    expect(pipeline).toContain('dropInput/lib/telemetry/config.js');
    expect(pipeline).toContain('__APPLICATIONINSIGHTS_CONNECTION_STRING__');
    expect(pipeline).not.toContain('ApplicationInsightsInstrumentationKey');
    expect(pipeline).not.toContain('dropInput/templates/hooks/telemetry.config.json');
    expect(pipeline).not.toContain('dropInput/dist/plugin/azure-functions-skills/hooks/telemetry.config.json');
    expect(officialPipeline).toContain('InjectTelemetryConnectionString: true');
    expect(prereleasePipeline).toContain('InjectTelemetryConnectionString: true');
    expect(publicPipeline).not.toContain('InjectTelemetryConnectionString: true');
  });

  it('uses the public npm registry in GitHub Actions', () => {
    const workflows = [
      'build-and-test.yml',
      'skill-evaluation-offline.yml',
      'skill-evaluation-azure-live-deploy.yml',
    ];

    for (const workflow of workflows) {
      const content = readFileSync(join(ROOT, '.github', 'workflows', workflow), 'utf-8');
      expect(content).toContain('rm -f .npmrc');
      expect(content.indexOf('rm -f .npmrc')).toBeLessThan(content.indexOf('actions/setup-node'));
    }
  });
});
