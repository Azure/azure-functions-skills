export interface DoctorE2eExpectation {
  readonly expectedStatus: 'pass' | 'fail';
  readonly requiredFindings: readonly string[];
}

interface DoctorE2eCheck {
  readonly id: string;
  readonly status: string;
}

export interface DoctorE2eReport {
  readonly summary?: {
    readonly status?: string;
  };
  readonly tiers?: {
    readonly builtin?: {
      readonly checks?: readonly DoctorE2eCheck[];
    };
  };
}

export interface DoctorE2eEvaluation {
  readonly expected: string;
  readonly actual: string;
  readonly expectation: 'match' | 'partial' | 'mismatch' | 'advisory' | 'unconfigured';
  readonly missingFindings: readonly string[];
  readonly unexpectedFindings: readonly string[];
}

export function evaluateDoctorExpectation(
  expected: DoctorE2eExpectation | undefined,
  report: DoctorE2eReport | undefined,
  deep: boolean,
): DoctorE2eEvaluation {
  const actualStatus = report?.summary?.status ?? 'unknown';
  const checks = report?.tiers?.builtin?.checks ?? [];
  const actualFindings = checks
    .filter(check => check.status !== 'pass')
    .map(check => `${check.id}:${check.status}`);
  const unexpectedFindings = checks
    .filter(check => check.status === 'fail' || check.status === 'warn')
    .map(check => `${check.id}:${check.status}`)
    .filter(finding => !(expected?.requiredFindings ?? []).includes(finding));
  const requiredFindings = expected?.requiredFindings ?? [];
  const missingFindings = requiredFindings.filter(finding => !actualFindings.includes(finding));

  let expectation: DoctorE2eEvaluation['expectation'];
  if (deep) {
    expectation = 'advisory';
  } else if (!expected) {
    expectation = 'unconfigured';
  } else if (actualStatus !== expected.expectedStatus) {
    expectation = 'mismatch';
  } else if (missingFindings.length > 0) {
    expectation = 'partial';
  } else {
    expectation = 'match';
  }

  return {
    expected: expected?.expectedStatus ?? '-',
    actual: actualStatus,
    expectation,
    missingFindings,
    unexpectedFindings,
  };
}
