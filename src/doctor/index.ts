/**
 * Doctor module — project diagnostics for Azure Functions.
 */
export { loadProjectContext } from './context.js';
export { ALL_CHECKS } from './checks.js';
export { runDoctor } from './runner.js';
export type { RunResult } from './runner.js';
export { formatReport } from './formatters.js';
export { resolveStacks, parseStacksResponse, checkVersionStatus, getLanguageVersions } from './stacks.js';
export { buildDoctorPrompt, buildAgentCommand, readAiReport, mergeReports, runAiAnalysis } from './ai-analysis.js';
export type {
  CheckSeverity,
  CheckStatus,
  DoctorCheck,
  DoctorCheckResult,
  DoctorOptions,
  DoctorReport,
  FunctionInfo,
  OutputFormat,
  ProjectContext,
  ProjectLanguage,
  PythonProgrammingModel,
  PythonProjectInfo,
  ReportSummary,
} from './types.js';
