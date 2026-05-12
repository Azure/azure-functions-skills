import type { BuildTargetName } from '../../types.js';

export type PrerequisiteMode = 'auto' | 'check-only' | 'skip';

export type PrerequisiteStatus =
  | 'present'
  | 'installed'
  | 'manual-action-required'
  | 'unsupported'
  | 'skipped'
  | 'failed';

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  (command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult>;
}

export interface PrerequisiteContext {
  target: BuildTargetName;
  projectDir: string;
  mode: PrerequisiteMode;
  runner?: CommandRunner;
}

export interface PrerequisiteResult {
  id: string;
  target: BuildTargetName;
  status: PrerequisiteStatus;
  message: string;
  commands?: string[];
  details?: string[];
}

export interface PrerequisiteProvider {
  id: string;
  supports(target: BuildTargetName): boolean;
  check(context: PrerequisiteContext): Promise<PrerequisiteResult>;
  install(context: PrerequisiteContext): Promise<PrerequisiteResult>;
}

export interface EnsurePrerequisitesOptions {
  targets: BuildTargetName[];
  projectDir: string;
  mode: PrerequisiteMode;
  runner?: CommandRunner;
  providers?: PrerequisiteProvider[];
}
