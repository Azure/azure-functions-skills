/**
 * Doctor module — project diagnostics for Azure Functions.
 */
export { loadProjectContext } from './context.js';
export { ALL_CHECKS } from './checks.js';
export { runDoctor } from './runner.js';
export type { RunResult } from './runner.js';
export { formatReport } from './formatters.js';
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
  ReportSummary,
} from './types.js';
