import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync,
  realpathSync, renameSync, statSync, writeFileSync, writeSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import { jsonSchema, LIMITS } from './plan.js';

const terminal = z.enum(['succeeded', 'failed', 'unknown']);
export const receiptSchema = z.object({
  action: z.enum(['primary', 'fallback']), attempt: z.number().int().positive(),
  startedAt: z.string(), endedAt: z.string(), status: terminal, code: z.string(),
  exitCode: z.number().nullable().optional(), message: z.string().optional(),
}).strict();
const nodeRecordSchema = z.object({
  status: z.enum(['running', 'succeeded', 'failed', 'unknown', 'blocked', 'notStarted']),
  exports: z.record(jsonSchema).default({}), receipts: z.array(receiptSchema).default([]),
  artifacts: z.record(z.string()).default({}), primaryArtifact: z.string().optional(),
  usedFallback: z.boolean().optional(), reusedFrom: z.object({ run: z.string(), node: z.string() }).optional(),
}).strict();
export const runSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), dir: z.string(), configDigest: z.string(),
  pid: z.number().int().positive(), processStartedAt: z.string(), startedAt: z.string(), endedAt: z.string().optional(),
  status: z.enum(['running', 'succeeded', 'failed', 'unknown']), error: z.string().optional(),
  nodes: z.record(nodeRecordSchema), outputs: z.record(jsonSchema), unavailableOutputs: z.array(z.string()),
}).strict();
export type Run = z.infer<typeof runSchema>;
export type NodeRecord = Run['nodes'][string];
export type Receipt = z.infer<typeof receiptSchema>;
export type Outcome = {
  status: Receipt['status']; code: string; message?: string; exitCode?: number | null;
  data?: import('./plan.js').Json; primaryArtifact?: string; notStarted?: boolean;
};
export class ArtifactLimitError extends Error {
  constructor() { super('Workflow artifact storage limit exceeded; partial output may have been saved.'); }
}
export function digest(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
function safePath(root: string, relative: string): string {
  const segments = relative.split(/[\\/]/);
  if (!segments.length || segments.some(part => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..')) {
    throw new Error('Unsafe workflow artifact path.');
  }
  let path = root;
  for (const segment of segments) {
    path = join(path, segment);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Workflow state cannot contain symbolic links.');
  }
  return path;
}
function runRoot(dir: string, id: string): string {
  if (!z.string().uuid().safeParse(id).success) throw new Error('Run ID must be a UUID returned by workflow run.');
  const workspace = realpathSync(dir);
  return safePath(workspace, `.azure-functions-workflows/runs/${id}`);
}
function diskBytes(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).reduce((total, name) => {
    const path = safePath(dir, name);
    return total + (statSync(path).isDirectory() ? diskBytes(path) : statSync(path).size);
  }, 0);
}
export class RunStore {
  readonly root: string;
  private bytes: number;
  constructor(readonly dir: string, readonly id: string = randomUUID(), create = false) {
    this.root = runRoot(dir, id);
    if (create) {
      mkdirSync(dirname(this.root), { recursive: true });
      mkdirSync(this.root);
    }
    this.bytes = diskBytes(this.root);
  }
  path(relative: string): string { return safePath(this.root, relative); }
  read(relative: string): Buffer {
    const path = this.path(relative);
    if (statSync(path).size > LIMITS.artifact) throw new Error('Artifact exceeds the read limit.');
    return readFileSync(path);
  }
  readJson(relative: string): unknown { return JSON.parse(this.read(relative).toString('utf8')) as unknown; }
  write(relative: string, data: Buffer | string): void {
    const content = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (content.length > LIMITS.artifact || this.bytes + content.length > LIMITS.run) throw new Error('Workflow storage limit exceeded.');
    const path = this.path(relative);
    mkdirSync(dirname(path), { recursive: true });
    const old = existsSync(path) ? statSync(path).size : 0;
    const temporary = this.path(`${relative}.tmp`);
    writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
    this.bytes += content.length - old;
  }
  writeJson(relative: string, value: unknown): void { this.write(relative, JSON.stringify(value)); }
  writeArtifact(relative: string, data: string): void {
    const size = Buffer.byteLength(data);
    if (size > LIMITS.artifact || this.bytes + size > LIMITS.run - 2 * LIMITS.artifact) throw new ArtifactLimitError();
    this.write(relative, data);
  }
  stream(relative: string): { append: (data: Buffer) => void; close: () => void } {
    const path = this.path(relative);
    mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(path, 'wx', 0o600);
    let bytes = 0;
    let closed = false;
    return {
      append: data => {
        if (closed) throw new Error('Artifact stream is closed.');
        // Reserve room for receipts and atomic state replacement after an output overrun.
        if (bytes + data.length > LIMITS.artifact || this.bytes + data.length > LIMITS.run - 2 * LIMITS.artifact) throw new ArtifactLimitError();
        let offset = 0;
        while (offset < data.length) offset += writeSync(fd, data, offset);
        bytes += data.length;
        this.bytes += data.length;
      },
      close: () => { if (!closed) { closed = true; closeSync(fd); } },
    };
  }
}

export function readRun(dir: string, id: string): Run {
  const store = new RunStore(dir, id);
  if (!existsSync(store.path('state.json'))) throw new Error(`Unknown run ${id}; check --dir and the run ID.`);
  const run = runSchema.parse(store.readJson('state.json'));
  if (run.id !== id || realpathSync(dir) !== run.dir) throw new Error('Run identity or workspace does not match.');
  if (run.status === 'running') {
    try { process.kill(run.pid, 0); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
        throw new Error('Cannot verify the run owner; inspect its process and external effects before importing.', { cause: error });
      }
      run.status = 'unknown';
      run.error = 'Owner process has exited; unfinished operations have unknown outcomes.';
      for (const node of Object.values(run.nodes)) if (node.status === 'running') {
        node.status = 'unknown';
        node.exports = {};
      }
    }
  }
  return run;
}

export function actionCwd(dir: string, cwd: string): string {
  const root = realpathSync(dir);
  const candidate = realpathSync(resolve(root, cwd));
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) throw new Error('Action cwd must remain within --dir.');
  return candidate;
}
