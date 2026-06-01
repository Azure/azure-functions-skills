---
description: "Add a new doctor check with TDD and fixtures"
name: "doctor-check"
---

Add a new doctor check following the established pattern:

1. **Test first** — add a test case in `tests/doctor-checks.test.ts` for the new check.
2. **Implement** — add a `DoctorCheck` to `src/doctor/checks.ts` with `id`, `category`, `defaultSeverity`, `appliesTo`, and `run`.
3. **Register** — add the check to `ALL_CHECKS`.
4. **Fixture** — add a bad-app fixture in `tests/fixtures/doctor-bad-apps/` that triggers the check.
5. **Expected results** — update `tests/fixtures/doctor-bad-apps/expected-results.md`.
6. **Verify**:
   ```bash
   npm test
   npm run lint
   ```
7. Optionally run a manual E2E with the doctor-e2e scripts (see `docs/bad-app-fixtures.md`).
