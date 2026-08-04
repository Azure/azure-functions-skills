import { readFileSync } from 'node:fs';

export type PythonFileReader = (path: string) => string | null;

export function readPythonFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}
