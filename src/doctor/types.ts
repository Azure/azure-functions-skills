/**
 * Doctor command types — project diagnostics for Azure Functions.
 */

import type { LanguageStackInfo } from './stacks-types.js';

// ── Check result severity and status ──

export type CheckSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

// ── Check result produced by each check ──

export interface DoctorCheckResult {
  id: string;
  category: string;
  severity: CheckSeverity;
  status: CheckStatus;
  title: string;
  message: string;
  file?: string;
  line?: number;
  recommendation?: string;
}

// ── Function metadata discovered in the workspace ──

export interface FunctionInfo {
  name: string;
  triggerType: string;
  bindingTypes: string[];
  entryPoint?: string;
  scriptFile?: string;
}

// ── Project context collected before running checks ──

export type ProjectLanguage = 'node' | 'python' | 'dotnet' | 'java' | 'powershell' | 'unknown';

export interface ProjectContext {
  dir: string;
  language: ProjectLanguage;
  hostJson: Record<string, unknown> | null;
  localSettings: Record<string, unknown> | null;
  packageJson: Record<string, unknown> | null;
  functions: FunctionInfo[];
  stacks: LanguageStackInfo[];
}

// ── Individual check definition ──

export interface DoctorCheck {
  id: string;
  category: string;
  defaultSeverity: CheckSeverity;
  appliesTo: (ctx: ProjectContext) => boolean;
  run: (ctx: ProjectContext) => Promise<DoctorCheckResult[]>;
}

// ── Report structures ──

export interface TierResult {
  ran: boolean;
  checks: DoctorCheckResult[];
}

export interface AiTierResult extends TierResult {
  agent?: string;
  durationMs?: number;
  error?: string;
}

export interface ReportSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  pass: number;
  status: 'pass' | 'fail';
}

export interface DoctorReport {
  version: number;
  timestamp: string;
  workspace: string;
  language: ProjectLanguage;
  tiers: {
    builtin: TierResult;
    ai: AiTierResult;
  };
  summary: ReportSummary;
}

// ── CLI options ──

export type OutputFormat = 'text' | 'json' | 'markdown' | 'html';

export interface DoctorOptions {
  dir: string;
  deep: boolean;
  agent?: string;
  timeout: number;
  format: OutputFormat;
  output: string;
  checks?: string[];
  severity: CheckSeverity;
  /** How to auto-install skills when not yet installed. Default: 'local' (CI-safe). */
  installMode?: 'local' | 'plugin';
  /**
   * Acknowledge that --deep runs the agent with elevated permissions (write/shell)
   * and that the workspace is trusted. Required to enable Tier 2 analysis.
   */
  acceptDeepRisk?: boolean;
}
