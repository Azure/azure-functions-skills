import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, parse } from 'node:path';

export type Environment = Record<string, string>;

export interface EnvironmentOptions {
  /** A paid run passes the model token; a dry-run never does. */
  paid: boolean;
  /** JSON for COPILOT_HOME_SETTINGS_JSON, such as disabledSkills. */
  settings: string;
  registry?: string;
  /** Fixed, non-secret variables from the configuration. */
  fixed?: Record<string, string>;
}

// Only operating-system basics cross into a cell. User tokens, cloud
// credentials, proxies and NODE_OPTIONS are never copied.
const osVariables = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC',
  'PROGRAMFILES', 'PROGRAMFILES(X86)', 'PROGRAMW6432', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS', 'OS']);
const tokenVariables = ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN'];

export const cellDirectories = ['home', 'temp', 'appdata', 'localappdata', 'config', 'cache', 'data', 'state', 'empty'];

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`skill-bench environment: ${message}`);
}

export function httpsUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`skill-bench environment: ${label} must be a valid URL.`);
  }
  check(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
    `${label} must be an HTTPS URL without credentials, query or fragment.`);
  return url;
}

export function modelToken(source: NodeJS.ProcessEnv): string | undefined {
  for (const name of tokenVariables) {
    const value = source[name];
    if (value) return value;
  }
  return undefined;
}

export function isReservedVariable(name: string): boolean {
  const upper = name.toUpperCase();
  return osVariables.has(upper) || tokenVariables.includes(upper) || /TOKEN|SECRET|PASSWORD|CREDENTIAL|KEY/.test(upper)
    || /^(HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|TEMP|TMP|TMPDIR|APPDATA|LOCALAPPDATA|XDG_.*|COPILOT_.*|GH_.*|GIT_.*|NPM_CONFIG_.*|NODE_.*)$/.test(upper);
}

export function cellEnvironment(root: string, source: NodeJS.ProcessEnv, options: EnvironmentOptions): Environment {
  const registry = httpsUrl(options.registry ?? 'https://registry.npmjs.org/', 'the npm registry');
  const env: Environment = {};
  for (const [name, value] of Object.entries(source)) {
    const upper = name.toUpperCase();
    if (osVariables.has(upper) && value !== undefined && env[upper] === undefined) env[upper] = value;
  }
  for (const [name, value] of Object.entries(options.fixed ?? {})) {
    check(!isReservedVariable(name), `fixed variable ${name} is reserved or looks like a secret.`);
    env[name] = value;
  }
  const home = join(root, 'home');
  const drive = parse(home).root.replace(/[\\/]$/, '');
  Object.assign(env, {
    HOME: home, USERPROFILE: home, HOMEDRIVE: drive, HOMEPATH: home.slice(drive.length),
    TEMP: join(root, 'temp'), TMP: join(root, 'temp'), TMPDIR: join(root, 'temp'),
    APPDATA: join(root, 'appdata'), LOCALAPPDATA: join(root, 'localappdata'),
    XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'),
    XDG_DATA_HOME: join(root, 'data'), XDG_STATE_HOME: join(root, 'state'),
    COPILOT_HOME: join(root, 'config'), GH_CONFIG_DIR: join(root, 'config', 'gh'),
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    npm_config_userconfig: join(home, '.npmrc'), npm_config_globalconfig: join(home, 'global.npmrc'),
    npm_config_cache: join(root, 'cache', 'npm'), npm_config_registry: registry.href,
    VALLY_TELEMETRY_OPTOUT: '1', COPILOT_AUTO_UPDATE: 'false', COPILOT_HOME_SETTINGS_JSON: options.settings,
  });
  if (options.paid) {
    const token = modelToken(source);
    check(token, 'set COPILOT_GITHUB_TOKEN (or GH_TOKEN / GITHUB_TOKEN) for a paid run; normal credential stores are not copied.');
    env.COPILOT_GITHUB_TOKEN = token;
  }
  return env;
}

export function createCellDirectories(root: string, settings: string): void {
  for (const directory of cellDirectories) mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, 'config', 'settings.json'), settings);
}

export interface SnapshotOptions {
  /** String values kept verbatim in redacted JSON; all other strings become [REDACTED]. */
  keepValues: string[];
}

const snapshotExcludedDirectories = new Set([
  '.git', '.azure', '.claude', '.copilot', '.github', 'bin', 'dist',
  'grading-evidence', 'node_modules', 'obj', 'packages',
]);
const snapshotFileLimit = 1_000_000;
const snapshotTotalLimit = 50_000_000;
const snapshotSensitiveNames = [
  /^\.env(?:\.|$)/i, /^\.npmrc$/i, /^appsettings(?:\.[^.]+)?\.json$/i,
  /\.publishsettings$/i, /\.(?:key|pem|pfx)$/i,
];
const credentialContent = /AccountKey=|SharedAccessSignature=|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i;

function redactJson(path: string, content: string, keep: Set<string>): string {
  let value: unknown;
  try {
    value = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return JSON.stringify({ redaction: `Invalid JSON in ${path}; original content omitted.` }, null, 2) + '\n';
  }
  const redact = (input: unknown): unknown => {
    if (input === null || typeof input === 'boolean' || typeof input === 'number') return input;
    if (typeof input === 'string') return keep.has(input) ? input : '[REDACTED]';
    if (Array.isArray(input)) return input.map(redact);
    return Object.fromEntries(Object.entries(input as Record<string, unknown>).map(([name, item]) => [name, redact(item)]));
  };
  return JSON.stringify(redact(value), null, 2) + '\n';
}

function redactEnvironmentFile(content: string): string {
  return content.split(/\r?\n/).map(line => {
    const match = /^(\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=)/.exec(line);
    return match ? `${match[1]}[REDACTED]` : line.startsWith('#') || !line.trim() ? line : '[REDACTED]';
  }).join('\n');
}

/**
 * Copy a finished trial workspace for private review. Links, logs, build
 * output, hidden directories and secret-like files are not copied; local
 * settings and .env files are copied only in redacted form.
 */
export function saveWorkspaceSnapshot(source: string, destination: string, options: SnapshotOptions): void {
  check(existsSync(source) && lstatSync(source).isDirectory(), 'workspace snapshot source is missing.');
  check(!existsSync(destination), 'workspace snapshot destination already exists.');
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const keep = new Set(options.keepValues);
  const manifest = {
    version: 1, source: basename(source),
    copied: [] as string[], redacted: [] as string[], excluded: [] as string[], totalBytes: 0,
  };
  const write = (target: string, content: string, path: string) => {
    writeFileSync(target, content, { mode: 0o600 });
    manifest.totalBytes += Buffer.byteLength(content);
    manifest.redacted.push(path);
  };
  const visit = (directory: string, output: string, prefix = ''): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      const input = join(directory, entry.name);
      const lower = entry.name.toLowerCase();
      if (entry.isSymbolicLink()) {
        manifest.excluded.push(`${path}:symlink`);
      } else if (entry.isDirectory()) {
        if (snapshotExcludedDirectories.has(lower) || entry.name.startsWith('.')) {
          manifest.excluded.push(`${path}/`);
        } else {
          mkdirSync(join(output, entry.name), { mode: 0o700 });
          visit(input, join(output, entry.name), path);
        }
      } else if (!entry.isFile()) {
        manifest.excluded.push(`${path}:unsupported`);
      } else if (lower.endsWith('.log')) {
        manifest.excluded.push(path);
      } else {
        const size = lstatSync(input).size;
        if (size > snapshotFileLimit || manifest.totalBytes + size > snapshotTotalLimit) {
          manifest.excluded.push(`${path}:size-limit`);
        } else if (lower === 'local.settings.json') {
          write(join(output, 'local.settings.redacted.json'), redactJson(path, readFileSync(input, 'utf8'), keep), path);
        } else if (lower !== '.gitignore' && (entry.name.startsWith('.') || snapshotSensitiveNames.some(pattern => pattern.test(entry.name)))) {
          if (lower === '.env' || lower.startsWith('.env.')) {
            write(join(output, `${entry.name}.redacted`), redactEnvironmentFile(readFileSync(input, 'utf8')), path);
          } else {
            manifest.excluded.push(`${path}:sensitive-name`);
          }
        } else {
          const content = readFileSync(input);
          if (credentialContent.test(content.toString('utf8'))) {
            manifest.excluded.push(`${path}:credential-like-content`);
          } else {
            copyFileSync(input, join(output, entry.name));
            manifest.totalBytes += size;
            manifest.copied.push(path);
          }
        }
      }
    }
  };
  visit(source, destination);
  writeFileSync(join(destination, 'snapshot-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
}
