import type { ChildProcess } from 'node:child_process';
import type { CommandRunner, PrerequisiteMode, PrerequisiteResult } from './setup/prerequisites/types.js';

export type BuildTargetName = 'ghcp' | 'claude' | 'codex';
export type CliAgentName = BuildTargetName;
export type LauncherId = 'github-copilot' | 'claude-code' | 'codex';
export type WorkspaceMode = 'minimal' | 'copy' | 'plugin-reference';
export type MergeStrategy = 'managed-block' | 'include-file' | 'fail-if-exists' | 'append';
export type PluginInstallMode = 'plugin' | 'local';

export interface Skill {
  id: string;
  title: string;
  description: string;
  argumentHint: string | null;
  category: string;
  content: string;
  referencesDir: string | null;
  scriptsDir: string | null;
  assetsDir: string | null;
}

export interface McpServer {
  id: string;
  name: string;
  description: string;
  type: string;
  command: string;
  args: string[];
}

export interface AgentDefinitions {
  agentsMd: string;
  copilot: string;
}

export interface HookDefinitions {
  welcome: string;
}

export interface BuildData {
  skills: Skill[];
  mcpServers: McpServer[];
  agents: AgentDefinitions;
  hooks: HookDefinitions;
  packageVersion?: string;
}

export type TemplateSourceMode = 'auto' | 'repository' | 'package';

export interface TemplateSourceOptions {
  mode?: TemplateSourceMode;
  repositoryPath?: string;
  repositoryRef?: string;
  commandRunner?: (command: string, args: string[]) => void;
}

export interface TemplateSourceResult {
  kind: 'repository' | 'package';
  templatesDir?: string;
  workspaceDir?: string;
  warnings: string[];
  cleanupDir?: string;
}

export interface SetupOptions {
  agents?: CliAgentName[];
  prerequisites?: PrerequisiteMode;
  prerequisiteRunner?: CommandRunner;
  templateSource?: TemplateSourceOptions;
}

export interface SetupResult {
  agents: CliAgentName[];
  filesWritten: number;
  welcomeMessage: string;
  prerequisites?: PrerequisiteResult[];
  templateSource: Omit<TemplateSourceResult, 'warnings'>;
  warnings: string[];
}

export type FilePromptResult = 'overwrite' | 'skip';

export type FilePrompter = (relativePath: string, newContent: string, existingContent: string) => Promise<FilePromptResult>;

export interface WorkspaceApplyOptions {
  agents?: CliAgentName[];
  mode?: WorkspaceMode;
  mergeStrategy?: MergeStrategy;
  update?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  force?: boolean;
  prompter?: FilePrompter;
  includeMcp?: boolean;
  includeHooks?: boolean;
  includeAgent?: boolean;
  templateSource?: TemplateSourceOptions;
}

export interface WorkspaceApplyResult {
  agents: CliAgentName[];
  mode: WorkspaceMode;
  filesWritten: number;
  plannedFiles: string[];
  dryRun: boolean;
  overwritten: string[];
  managedBlockUpdated: string[];
  savedAside: Array<{ original: string; aside: string }>;
  templateSource?: Omit<TemplateSourceResult, 'warnings'>;
  warnings?: string[];
}

export interface LauncherContext {
  startupPrompt?: string;
  passthroughArgs?: string[];
}

export interface Launcher {
  command: string;
  buildArgs: (ctx: LauncherContext) => string[];
  description: string;
}

export interface DetectedCliAgent {
  id: LauncherId;
  command: string;
  description: string;
}

export interface ChatOptions {
  agent?: LauncherId;
  prompt?: string;
  dir?: string;
  passthroughArgs?: string[];
  dryRun?: boolean;
  prerequisites?: PrerequisiteMode;
  prerequisiteRunner?: CommandRunner;
  setupSkillPending?: boolean;
  setupCompleteCommand?: string;
}

export interface ChatLaunchResult {
  dryRun: false;
  childProcess: ChildProcess;
  agent: LauncherId;
  prompt: string;
  command: string;
  args: string[];
  cwd: string;
}

export interface ChatDryRunResult {
  dryRun: true;
  childProcess: null;
  agent: LauncherId;
  prompt: string;
  command: string;
  args: string[];
  cwd: string;
}

export type ChatResult = ChatLaunchResult | ChatDryRunResult;
