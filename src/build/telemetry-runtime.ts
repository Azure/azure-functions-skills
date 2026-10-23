import { buildSync } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PUBLIC_TELEMETRY_INGESTION_ENDPOINT,
  PUBLIC_TELEMETRY_INSTRUMENTATION_KEY,
} from '../telemetry/public-config.js';

export interface TelemetryRuntime {
  readonly code: string;
  readonly notices: string;
  readonly sdkPackage: string;
}

export function buildTelemetryRuntime(skillsDir: string): TelemetryRuntime {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const nodeRequire = createRequire(import.meta.url);
  const sdkPackagePath = nodeRequire.resolve('applicationinsights/package.json');
  const result = buildSync({
    entryPoints: [fileURLToPath(new URL('../telemetry/runtime.js', import.meta.url))],
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    metafile: true,
    minifyWhitespace: true,
    minifySyntax: true,
    supported: { 'template-literal': false },
    legalComments: 'none',
    external: ['applicationinsights-native-metrics'],
    define: {
      __PUBLIC_TELEMETRY_INSTRUMENTATION_KEY__: JSON.stringify(PUBLIC_TELEMETRY_INSTRUMENTATION_KEY),
      __PUBLIC_TELEMETRY_INGESTION_ENDPOINT__: JSON.stringify(PUBLIC_TELEMETRY_INGESTION_ENDPOINT),
      __BUNDLED_SKILL_FILES__: JSON.stringify(listSkillFiles(skillsDir)),
      'process.env.APPLICATION_INSIGHTS_NO_DIAGNOSTIC_CHANNEL': '"true"',
      __dirname: 'sdkContextDirectory',
    },
    banner: {
      js: [
        'import { createRequire, isBuiltin } from "node:module";',
        'import { fileURLToPath as telemetryFileURLToPath } from "node:url";',
        'const sdkContextDirectory = telemetryFileURLToPath(new URL("./vendor/applicationinsights/out/Library/", import.meta.url));',
        'const loadBuiltin = createRequire(import.meta.url);',
        'const require = id => {',
        '  if (!isBuiltin(id)) throw new Error("Non-builtin module loading is disabled: " + id);',
        '  return loadBuiltin(id);',
        '};',
      ].join('\n'),
    },
  });
  const notices = new Map<string, string>();
  for (const input of Object.keys(result.metafile.inputs)) {
    const match = input.replaceAll('\\', '/').match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//);
    if (!match || notices.has(match[1])) continue;
    const packageRoot = join(root, match[1]);
    const license = readdirSync(packageRoot).find(file => /^licen[cs]e(?:\..*)?$/i.test(file));
    if (license) {
      notices.set(match[1], readFileSync(join(packageRoot, license), 'utf-8'));
    } else if (match[1] === 'node_modules/emitter-listener') {
      // This package publishes an SPDX field, but no license file. It shares
      // its author and BSD-2-Clause license with shimmer.
      notices.set(match[1], `${readFileSync(join(packageRoot, 'package.json'), 'utf-8')}\n${
        readFileSync(join(root, 'node_modules', 'shimmer', 'LICENSE'), 'utf-8')}`);
    } else {
      throw new Error(`Missing bundled dependency license: ${match[1]}`);
    }
  }
  return {
    code: result.outputFiles[0].text,
    notices: [...notices].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, license]) => `${name}\n\n${license.replace(/^\uFEFF/, '')
        .replaceAll('\r\n', '\n').split('\n').map(line => line.trimEnd()).join('\n')}`).join('\n\n'),
    sdkPackage: JSON.stringify({
      name: 'applicationinsights',
      version: (JSON.parse(readFileSync(sdkPackagePath, 'utf-8')) as { version: string }).version,
    }),
  };
}

function listSkillFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(relative(root, path).replaceAll('\\', '/'));
    }
  }
  walk(root);
  return files.sort();
}
