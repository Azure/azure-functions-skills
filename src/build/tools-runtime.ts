import { buildSync } from 'esbuild';
import { fileURLToPath } from 'node:url';
import type { FunctionsTools } from './loader.js';

/** Bundles `src/tools` into one dependency-free file that runs on Node 18 or later. */
export function buildFunctionsTools(): FunctionsTools {
  const result = buildSync({
    entryPoints: [fileURLToPath(new URL('../tools/cli.js', import.meta.url))],
    absWorkingDir: fileURLToPath(new URL('../../', import.meta.url)),
    bundle: true,
    write: false,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    legalComments: 'none',
  });
  return { code: result.outputFiles[0].text };
}
