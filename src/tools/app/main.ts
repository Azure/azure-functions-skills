import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createTokenProvider } from './auth.js';
import { runCli } from './cli.js';
import { EXIT, errorEnvelope } from './output.js';

const referencesDir = process.env.FUNCTIONS_APP_REFERENCES_DIR ?? fileURLToPath(new URL('../references/', import.meta.url));
const assetsDir = process.env.FUNCTIONS_APP_ASSETS_DIR ?? fileURLToPath(new URL('../assets/', import.meta.url));

async function readInput(source: string): Promise<string> {
  if (source !== '-') return readFile(source, 'utf-8');
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf-8');
}

if (typeof fetch !== 'function') {
  const envelope = errorEnvelope('startup', EXIT.unsupported, `Node.js ${process.version} has no fetch; this tool needs Node.js 18 or later.`, {
    next: ['Fall back to REST with `az rest` and the recipes in references/ (quote URLs that contain &).'],
  });
  process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  process.exit(EXIT.unsupported);
}

const result = await runCli(process.argv.slice(2), {
  fetch: (url, init) => fetch(url, init),
  getToken: createTokenProvider(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  referencesDir,
  assetsDir,
  now: () => new Date(),
  readInput,
});

process.stdout.write(`${JSON.stringify(result.output, null, 2)}\n`);
process.exitCode = result.exitCode;
