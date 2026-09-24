---
applyTo: "tests/**"
---

# Testing Rules

## Framework

- This project uses **Vitest** for all unit tests.
- Test files: `tests/*.test.ts`
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

