import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT_DIR = join(import.meta.dirname, '..');

export function setup(): void {
  const command = process.platform === 'win32' ? 'cmd.exe' : 'npm';
  const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run compile'] : ['run', 'compile'];
  execFileSync(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });
}
