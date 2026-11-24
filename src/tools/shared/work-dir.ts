import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const TOOL_DIR = '.azure-functions-skills';

/** The tool's own folder inside a project. */
export function toolDir(dir: string): string {
  return join(resolve(dir), TOOL_DIR);
}

/** Creates `<project>/.azure-functions-skills/<parts...>` and keeps the tool folder out of source control. */
export function ensureToolDir(dir: string, ...parts: string[]): string {
  const root = toolDir(dir);
  const target = join(root, ...parts);
  mkdirSync(target, { recursive: true });
  const ignore = join(root, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
  return target;
}
