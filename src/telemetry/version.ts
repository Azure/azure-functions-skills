import { readFileSync } from 'node:fs';

const packageJsonUrl = new URL('../../package.json', import.meta.url);

export const PACKAGE_VERSION = readPackageVersion();

function readPackageVersion(): string {
  const value: unknown = JSON.parse(readFileSync(packageJsonUrl, 'utf-8'));
  if (!isRecord(value) || typeof value.version !== 'string' || value.version.length === 0) {
    throw new Error('Package version is missing from package.json.');
  }
  return value.version;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
