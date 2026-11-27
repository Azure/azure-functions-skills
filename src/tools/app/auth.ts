import { execFile } from 'node:child_process';
import { EXIT, ToolError } from './output.js';
import type { TokenProvider } from './azure.js';

export type CommandRunner = (command: string, args: readonly string[]) => Promise<{ ok: boolean; stdout: string }>;

/** Runs `az` or `azd`; Windows needs a shell because both are `.cmd` shims. Arguments are fixed strings from this tool. */
export const runCommand: CommandRunner = (command, args) =>
  new Promise(resolve => {
    execFile(command, [...args], { shell: process.platform === 'win32', windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout) });
    });
  });

/** Gets tokens from the Azure CLI, then the Azure Developer CLI, and caches them per resource for this process. */
export function createTokenProvider(run: CommandRunner = runCommand): TokenProvider {
  const cache = new Map<string, Promise<string>>();
  return resource => {
    let token = cache.get(resource);
    if (!token) {
      token = acquire(run, resource);
      cache.set(resource, token);
      token.catch(() => cache.delete(resource));
    }
    return token;
  };
}

async function acquire(run: CommandRunner, resource: string): Promise<string> {
  const az = await run('az', ['account', 'get-access-token', '--resource', resource, '--output', 'json']);
  const fromAz = az.ok ? readToken(az.stdout, 'accessToken') : undefined;
  if (fromAz) return fromAz;

  const azd = await run('azd', ['auth', 'token', '--scope', `${resource}/.default`, '--output', 'json']);
  const fromAzd = azd.ok ? readToken(azd.stdout, 'token') : undefined;
  if (fromAzd) return fromAzd;

  throw new ToolError(EXIT.precheck, 'Could not get an Azure access token from `az` or `azd`.', {
    findings: [{ severity: 'error', code: 'NotSignedIn', message: 'Neither the Azure CLI nor the Azure Developer CLI returned a token.', fix: 'Run `az login` (or `azd auth login`), then retry.' }],
  });
}

function readToken(stdout: string, field: string): string | undefined {
  try {
    const value = (JSON.parse(stdout) as Record<string, unknown>)[field];
    return typeof value === 'string' && value ? value : undefined;
  } catch {
    return undefined;
  }
}
