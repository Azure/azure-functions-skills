export const EXIT = {
  /** The command ran. Findings may still describe problems. */
  ok: 0,
  /** Unexpected failure. Use the manual steps; do not repeat the command. */
  unexpected: 1,
  /** Invalid arguments. Fix them and run once more. */
  usage: 2,
  /** A prerequisite or input is missing. Nothing was executed. */
  blocked: 3,
  /** An executed step failed. Read the finding before resuming. */
  stepFailed: 4,
} as const;

export type ExitCode = typeof EXIT[keyof typeof EXIT];

export interface Finding {
  readonly id: string;
  readonly severity: 'error' | 'warn' | 'info';
  readonly title: string;
  readonly detail?: string;
  readonly fix?: string;
}

export interface Gap {
  readonly check: string;
  readonly reason: string;
}

export interface NextStep {
  readonly action: string;
  readonly reason: string;
  readonly command?: string;
}

export interface ToolBody<T> {
  readonly schemaVersion: 1;
  readonly command: string;
  readonly ok: boolean;
  readonly summary: string;
  readonly data: T;
  readonly findings: readonly Finding[];
  readonly gaps: readonly Gap[];
  readonly next?: NextStep;
}

export interface ToolResult<T = unknown> {
  readonly exitCode: ExitCode;
  readonly body: ToolBody<T>;
}

export interface ResultExtras<T> {
  readonly data?: T;
  readonly findings?: readonly Finding[];
  readonly gaps?: readonly Gap[];
  readonly next?: NextStep;
}

export function succeed<T>(
  command: string,
  summary: string,
  data: T,
  extras: Omit<ResultExtras<T>, 'data'> = {},
): ToolResult<T> {
  return { exitCode: EXIT.ok, body: body(command, true, summary, data, extras) };
}

export function fail<T = Record<string, never>>(
  command: string,
  exitCode: Exclude<ExitCode, 0>,
  summary: string,
  extras: ResultExtras<T> = {},
): ToolResult<T> {
  return { exitCode, body: body(command, false, summary, (extras.data ?? {}) as T, extras) };
}

function body<T>(
  command: string,
  ok: boolean,
  summary: string,
  data: T,
  extras: Omit<ResultExtras<T>, 'data'>,
): ToolBody<T> {
  return {
    schemaVersion: 1,
    command,
    ok,
    summary,
    data,
    findings: extras.findings ?? [],
    gaps: extras.gaps ?? [],
    ...(extras.next ? { next: extras.next } : {}),
  };
}
