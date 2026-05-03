import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REMOVE_RETRY_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: process.platform === 'win32' ? 5 : 2,
  retryDelay: process.platform === 'win32' ? 100 : 25,
};

export function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(dir: string | null | undefined): void {
  if (!dir || !existsSync(dir)) return;
  rmSync(dir, REMOVE_RETRY_OPTIONS);
}

export function resetDir(dir: string): string {
  removeDir(dir);
  mkdirSync(dir, { recursive: true });
  return dir;
}
