import { buildSync } from 'esbuild';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FunctionsTools } from './loader.js';

/**
 * Bundles `src/tools` into one dependency-free file that runs on Node 18 or later.
 * It always bundles the TypeScript source, so the compiled build and the tests
 * produce the same bytes.
 */
export function buildFunctionsTools(): FunctionsTools {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const result = buildSync({
    entryPoints: [join(root, 'src', 'tools', 'cli.ts')],
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: 'node',
    target: 'node18',
    format: 'esm',
    legalComments: 'none',
  });
  return { code: result.outputFiles[0].text };
}
