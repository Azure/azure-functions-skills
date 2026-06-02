import { basename, dirname, extname, join } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * Generate the save-aside path for a file, preserving the original extension.
 * Example: `CLAUDE.md` -> `CLAUDE.azure-functions-skills-new.md`
 */
export function saveAsidePath(filePath: string): string {
  const dir = dirname(filePath);
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  const aside = ext
    ? `${base}.azure-functions-skills-new${ext}`
    : `${base}.azure-functions-skills-new`;
  return dir === '.' ? aside : join(dir, aside);
}

/**
 * Find a unique save-aside path, appending numeric suffixes if needed.
 */
export function resolveUniqueAsidePath(targetDir: string, relativePath: string): string {
  const candidate = saveAsidePath(relativePath);
  if (!existsSync(join(targetDir, candidate))) return candidate;

  const dir = dirname(candidate);
  const originalExt = extname(relativePath);
  const originalBase = basename(relativePath, originalExt);

  for (let i = 1; i < 100; i++) {
    const numbered = originalExt
      ? `${originalBase}.azure-functions-skills-new.${i}${originalExt}`
      : `${originalBase}.azure-functions-skills-new.${i}`;
    const numberedPath = dir === '.' ? numbered : join(dir, numbered);
    if (!existsSync(join(targetDir, numberedPath))) return numberedPath;
  }

  const ts = Date.now();
  const fallback = originalExt
    ? `${originalBase}.azure-functions-skills-new.${ts}${originalExt}`
    : `${originalBase}.azure-functions-skills-new.${ts}`;
  return dir === '.' ? fallback : join(dir, fallback);
}
