---
applyTo: "tests/**"
---

# Testing Rules

## Framework

- This project uses **Vitest** for all unit tests.
- Test files: `tests/*.test.ts`
- Fixtures: `tests/fixtures/`
- Run: `npm test` (single run) or `npm run test:watch` (TDD mode)

## TDD Workflow

1. **Red**: Write a failing test that describes the expected behavior.
2. **Green**: Write the minimal implementation to make the test pass.
3. **Refactor**: Improve code quality without changing behavior.
4. Repeat for each unit of work.

## Test Quality

- Test behavior, not implementation details.
- Cover edge cases and boundary values.
- Include both happy path and error path tests.
- Use descriptive test names: `describe('functionName', () => { it('should do X when Y', ...) })`.
- Keep tests independent — no shared mutable state between tests.

## Fixtures

- Bad-app fixtures for doctor checks live in `tests/fixtures/doctor-bad-apps/`.
- Expected results are documented in `tests/fixtures/doctor-bad-apps/expected-results.md`.
- When adding a new doctor check, add a corresponding fixture and update expected results.
