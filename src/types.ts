import type { ChildProcess } from 'node:child_process';

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
}

export interface SetupOptions {
  agents?: CliAgentName[];
}

export interface SetupResult {
  agents: CliAgentName[];
  filesWritten: number;
  welcomeMessage: string;
}

export interface LauncherContext {
  startupPrompt?: string;
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
}

export interface ChatResult {
  childProcess: ChildProcess;
  agent: LauncherId;
  prompt: string;
}
