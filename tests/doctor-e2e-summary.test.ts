import { describe, expect, it } from 'vitest';
import {
  evaluateDoctorExpectation,
  type DoctorE2eExpectation,
} from '../src/doctor/e2e-summary.js';

const EXPECTATION: DoctorE2eExpectation = {
  expectedStatus: 'fail',
  requiredFindings: ['project-exists:fail', 'local-settings:warn'],
};

describe('evaluateDoctorExpectation', () => {
  it('matches when status and all minimum findings match', () => {
    expect(evaluateDoctorExpectation(EXPECTATION, {
      summary: { status: 'fail' },
      tiers: {
        builtin: {
          checks: [
            { id: 'project-exists', status: 'fail' },
            { id: 'local-settings', status: 'warn' },
          ],
        },
      },
    }, false)).toEqual({
      expected: 'fail',
      actual: 'fail',
      expectation: 'match',
      missingFindings: [],
      unexpectedFindings: [],
    });
  });

  it('is partial when status matches but a minimum finding is missing', () => {
    expect(evaluateDoctorExpectation(EXPECTATION, {
      summary: { status: 'fail' },
      tiers: {
        builtin: {
          checks: [{ id: 'project-exists', status: 'fail' }],
        },
      },
    }, false)).toEqual({
      expected: 'fail',
      actual: 'fail',
      expectation: 'partial',
      missingFindings: ['local-settings:warn'],
      unexpectedFindings: [],
    });
  });

  it('is a mismatch when the actual status differs', () => {
    expect(evaluateDoctorExpectation(EXPECTATION, {
      summary: { status: 'pass' },
      tiers: {
        builtin: {
          checks: [{ id: 'local-settings', status: 'warn' }],
        },
      },
    }, false)).toEqual({
      expected: 'fail',
      actual: 'pass',
      expectation: 'mismatch',
      missingFindings: ['project-exists:fail'],
      unexpectedFindings: [],
    });
  });

  it('keeps deep results advisory while exposing deterministic differences', () => {
    expect(evaluateDoctorExpectation(EXPECTATION, {
      summary: { status: 'fail' },
      tiers: {
        builtin: {
          checks: [
            { id: 'project-exists', status: 'fail' },
            { id: 'unexpected-check', status: 'warn' },
          ],
        },
      },
    }, true)).toEqual({
      expected: 'fail',
      actual: 'fail',
      expectation: 'advisory',
      missingFindings: ['local-settings:warn'],
      unexpectedFindings: ['unexpected-check:warn'],
    });
  });

  it('reports an unconfigured fixture separately from deep advisory results', () => {
    expect(evaluateDoctorExpectation(undefined, {
      summary: { status: 'pass' },
      tiers: { builtin: { checks: [] } },
    }, false).expectation).toBe('unconfigured');
  });

  it('can require a deterministic skipped finding', () => {
    const expected: DoctorE2eExpectation = {
      expectedStatus: 'pass',
      requiredFindings: ['dotnet-version:skip'],
    };

    expect(evaluateDoctorExpectation(expected, {
      summary: { status: 'pass' },
      tiers: {
        builtin: {
          checks: [{ id: 'dotnet-version', status: 'skip' }],
        },
      },
    }, false)).toEqual({
      expected: 'pass',
      actual: 'pass',
      expectation: 'match',
      missingFindings: [],
      unexpectedFindings: [],
    });
  });
});
