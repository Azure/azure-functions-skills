import spawn from 'cross-spawn';
import { createReadStream } from 'node:fs';
import type { Action } from '../plan.js';
import { normalizeOutput } from '../output.js';
import { actionCwd, ArtifactLimitError, type Outcome, type RunStore } from '../store.js';

export async function executeCommand(
  action: Extract<Action, { kind: 'exec' }>, store: RunStore, prefix: string,
  timeoutMs: number, stdinPath?: string, signal?: AbortSignal,
): Promise<Outcome> {
  const args = action.args;
  if (action.command.includes('\0') || !args.every((arg): arg is string => typeof arg === 'string' && !arg.includes('\0'))) {
    return { status: 'failed', code: 'INPUT_INVALID', message: 'Resolved exec command and arguments must be strings without NUL bytes.', notStarted: true };
  }
  const cwd = actionCwd(store.dir, action.cwd);
  const stdoutPath = `${prefix}/stdout.log`;
  const stderrPath = `${prefix}/stderr.log`;
  const stdout = store.stream(stdoutPath);
  let stderr: ReturnType<RunStore['stream']>;
  try { stderr = store.stream(stderrPath); }
  catch (error) { stdout.close(); throw error; }
  const closeStreams = (): void => { try { stdout.close(); } finally { stderr.close(); } };
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try { child = spawn(action.command, args, { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch {
      closeStreams();
      resolve({ status: 'failed', code: 'EXEC_START_ERROR', message: 'Cannot spawn the command; check executable and arguments.', notStarted: true, primaryArtifact: stdoutPath });
      return;
    }
    let uncertain = false;
    let ioError: Error | undefined;
    let spawnError = false;
    let settled = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const stop = (): void => {
      uncertain = true;
      child.kill('SIGKILL');
      grace ??= setTimeout(() => finish(null), 2000);
    };
    const timer = setTimeout(stop, timeoutMs);
    const input = stdinPath ? createReadStream(stdinPath) : undefined;
    const save = (target: typeof stdout, data: Buffer): void => {
      if (ioError) return;
      try { target.append(data); }
      catch (error) { ioError = error instanceof Error ? error : new Error(String(error)); stop(); }
    };
    const finish = (code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (grace) clearTimeout(grace);
      signal?.removeEventListener('abort', stop);
      input?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.stdin?.destroy();
      try { closeStreams(); } catch (error) { reject(error); return; }
      if (ioError instanceof ArtifactLimitError) {
        resolve({ status: 'unknown', code: 'ARTIFACT_LIMIT', message: 'Output limit reached and command stopped; inspect partial logs and external state before retrying.', primaryArtifact: stdoutPath });
        return;
      }
      if (ioError) { reject(ioError); return; }
      if (uncertain || (code === null && !spawnError)) {
        resolve({ status: 'unknown', code: 'OUTCOME_UNKNOWN', message: 'Execution timed out or was interrupted; inspect external state before retrying.', primaryArtifact: stdoutPath });
      } else if (spawnError) resolve({ status: 'failed', code: 'EXEC_START_ERROR', message: `Cannot start ${action.command}; check the executable and environment.`, notStarted: true, primaryArtifact: stdoutPath });
      else if (code !== 0) resolve({ status: 'failed', code: 'EXEC_EXIT_NONZERO', exitCode: code, message: `Command exited with code ${code}; inspect stderr.`, primaryArtifact: stdoutPath });
      else {
        let text: string;
        try { text = store.read(stdoutPath).toString('utf8'); }
        catch (error) { reject(error); return; }
        try {
          const data = normalizeOutput(action, text);
          resolve({ status: 'succeeded', code: 'OK', exitCode: 0, data, primaryArtifact: stdoutPath });
        } catch {
          resolve({ status: 'failed', code: 'OUTPUT_INVALID', message: 'stdout is not valid JSON; inspect the artifact.', primaryArtifact: stdoutPath });
        }
      }
    };
    child.stdout?.on('data', (data: Buffer) => save(stdout, data));
    child.stderr?.on('data', (data: Buffer) => save(stderr, data));
    child.on('error', () => { spawnError = true; finish(null); });
    child.on('close', finish);
    child.stdin?.on('error', error => {
      if ('code' in error && error.code === 'EPIPE') return;
      ioError = error; stop();
    });
    input?.on('error', error => { ioError = error; stop(); });
    if (input && child.stdin) input.pipe(child.stdin);
    else child.stdin?.end();
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
  });
}
