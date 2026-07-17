import type { DoctorCheck, DoctorCheckResult } from './types.js';

export function makeCheckResult(
  check: DoctorCheck,
  overrides: Partial<DoctorCheckResult> & {
    status: DoctorCheckResult['status'];
    title: string;
    message: string;
  },
): DoctorCheckResult {
  return {
    id: check.id,
    category: check.category,
    severity: check.defaultSeverity,
    ...overrides,
  };
}
