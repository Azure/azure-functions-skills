import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type { AppTool } from './loader.js';

/** Bundles `src/tools/app` into one dependency-free file that runs on Node 18 or later. */
export function buildAppTool(): AppTool {
  const result = buildSync({
    entryPoints: [fileURLToPath(new URL('../tools/app/main.js', import.meta.url))],
    absWorkingDir: fileURLToPath(new URL('../../', import.meta.url)),
    bundle: true,
    write: false,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    legalComments: 'none',
    banner: { js: '#!/usr/bin/env node' },
  });
  return { code: result.outputFiles[0].text };
}
