import type { ChildProcess } from 'node:child_process';
import type { CommandRunner, PrerequisiteMode, PrerequisiteResult } from './setup/prerequisites/types.js';

export type BuildTargetName = 'ghcp' | 'claude' | 'codex';
export type CliAgentName = BuildTargetName;
export type LauncherId = 'github-copilot' | 'claude-code' | 'codex';

export interface Skill {
  id: string;
  title: string;
  description: string;
  category: string;
  content: string;
  referencesDir: string | null;
  scriptsDir: string | null;
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

export interface SetupOptions {
  agents?: CliAgentName[];
  prerequisites?: PrerequisiteMode;
  prerequisiteRunner?: CommandRunner;
}

export interface SetupResult {
  agents: CliAgentName[];
  filesWritten: number;
  welcomeMessage: string;
  prerequisites?: PrerequisiteResult[];
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
  prerequisites?: PrerequisiteMode;
  prerequisiteRunner?: CommandRunner;
}

export interface ChatResult {
  childProcess: ChildProcess;
  agent: LauncherId;
  prompt: string;
}
