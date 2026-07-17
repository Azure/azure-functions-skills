export type BuildTargetName = 'ghcp' | 'claude' | 'codex';
export type CliAgentName = BuildTargetName;

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

export interface HookDefinitions {
  copilotTelemetry: string;
  claudeTelemetry: string;
  cursorTelemetry: string;
  telemetryConfig: string;
  trackTelemetryPowerShell: string;
  trackTelemetryShell: string;
}

export interface BuildData {
  skills: Skill[];
  mcpServers: McpServer[];
  hooks: HookDefinitions;
  packageVersion?: string;
}
