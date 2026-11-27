export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  unsupported: 3,
  azure: 4,
  approval: 5,
  precheck: 6,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export type Status = 'ok' | 'failed' | 'usage_error' | 'unsupported' | 'azure_error' | 'approval_required' | 'precheck_failed';

const STATUS_BY_EXIT: Record<ExitCode, Status> = {
  0: 'ok',
  1: 'failed',
  2: 'usage_error',
  3: 'unsupported',
  4: 'azure_error',
  5: 'approval_required',
  6: 'precheck_failed',
};

export interface Finding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  fix?: string;
}

export interface Envelope {
  schemaVersion: 1;
  command: string;
  ok: boolean;
  status: Status;
  summary: string;
  data?: unknown;
  findings: Finding[];
  next: string[];
}

export interface CommandResult {
  summary: string;
  data?: unknown;
  findings?: Finding[];
  next?: string[];
}

/** An expected failure with an exit code that tells the agent what to do next. */
export class ToolError extends Error {
  constructor(
    readonly exitCode: ExitCode,
    message: string,
    readonly options: { findings?: Finding[]; next?: string[]; data?: unknown } = {},
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export function successEnvelope(command: string, result: CommandResult): Envelope {
  return {
    schemaVersion: 1,
    command,
    ok: true,
    status: 'ok',
    summary: result.summary,
    data: result.data,
    findings: result.findings ?? [],
    next: result.next ?? [],
  };
}

export function errorEnvelope(command: string, exitCode: ExitCode, message: string, options: ToolError['options'] = {}): Envelope {
  return {
    schemaVersion: 1,
    command,
    ok: false,
    status: STATUS_BY_EXIT[exitCode],
    summary: message,
    data: options.data,
    findings: options.findings ?? [],
    next: options.next ?? [],
  };
}
