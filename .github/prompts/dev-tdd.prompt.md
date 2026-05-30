---
description: "Implement a feature using TDD (Red → Green → Refactor)"
name: "dev-tdd"
---

Follow the TDD cycle to implement the requested feature:

1. **Red** — write a failing test that describes the expected behavior.
2. **Green** — write the minimal code to make the test pass.
3. **Refactor** — improve code quality without changing behavior (DRY, clear naming, proper abstractions).
4. Run `npm test` after each cycle to confirm the test suite stays green.
5. Repeat for each unit of work until the feature is complete.

After all cycles:
- Run `npm run lint` to catch style issues.
- Run `npm run typecheck` to confirm type safety.
- Ensure proper separation of concerns — no god functions, no duplicated logic.
- If CLI behavior changed, verify with an E2E run in an isolated workspace.
