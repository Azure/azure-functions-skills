# TypeScript Migration Plan

Tracking issue: https://github.com/Azure/azure-functions-skills/issues/32
Branch: `ts-migration-test-automation`

## Working rules

- Update this checklist at every step boundary.
- Use one branch for the full migration.
- Commit each implementation step separately.
- Keep public CLI behavior and package exports compatible.
- After lint/typecheck infrastructure exists, run unit tests and quality gates for every step.
- Once E2E execution is available, verify existing behavior with E2E tests during conversion.
- Use TDD for behavior-changing changes.
- Finish with a TypeScript self-review and refactor duplicated or unnecessarily complex code.

## Step checklist

- [x] Review tracking issue #32.
- [x] Review Step 1 issue #33.
- [x] Create working branch.
- [x] Create this plan file.
- [x] Step 1 / #33: Stabilize Vitest output directories and Windows cleanup.
  - [x] Add shared test filesystem helper.
  - [x] Replace shared test output directories with isolated temp directories where needed.
  - [x] Add robust Windows cleanup retry behavior.
  - [x] Run `npm test -- tests/build.test.js`.
  - [x] Run `npm test`.
  - [x] Commit Step 1.
- [x] Step 2 / #34: Add TypeScript toolchain and CI quality gates.
  - [x] Review Step 2 issue #34.
  - [x] Add TypeScript and Node type dependencies.
  - [x] Add strict Node ESM `tsconfig.json` without conflicting with plugin `dist/` output.
  - [x] Add ESLint flat config for JavaScript and TypeScript.
  - [x] Add `lint`, `typecheck`, and combined validation scripts.
  - [x] Update CI trigger paths and quality gate steps.
  - [x] Run `npm run lint`.
  - [x] Run `npm run typecheck`.
  - [x] Run `npm test`.
  - [x] Run `npm run build`.
  - [x] Commit Step 2.
- [ ] Step 3 / #35: Convert runtime source to TypeScript with shared domain types.
- [ ] Step 4 / #36: Convert Vitest tests to TypeScript and shared helpers.
- [ ] Step 5 / #37: Add automated validation for skill templates.
- [ ] Step 6 / #38: Add new skill scaffolding and contributor workflow docs.
- [ ] Final TypeScript self-review and refactoring pass.

## Step 1 plan

Issue: https://github.com/Azure/azure-functions-skills/issues/33

Implementation notes:

- Keep product source unchanged.
- Introduce a reusable test helper for temporary directory allocation and cleanup.
- Use per-test directories in build tests instead of deleting the same shared `dist-test` directory repeatedly.
- Keep existing assertions intact so this is a test-infrastructure-only change.

## Progress log

- 2026-05-02: Created migration branch and plan file. Starting Step 1 (#33).
- 2026-05-02: Added shared test filesystem helper and moved build/chat tests to isolated temp directories with retry cleanup.
- 2026-05-02: Verified `npm test -- tests/build.test.js` passes (42 tests).
- 2026-05-02: Verified `npm test` passes (62 tests).
- 2026-05-02: Verified `npm run build` passes and prepared Step 1 commit.
- 2026-05-02: Committed Step 1 as `cee0d5f` and started Step 2 (#34).
- 2026-05-02: Added TypeScript, ESLint, strict Node ESM config, CI quality gates, and verified lint/typecheck/test/build/audit.
- 2026-05-02: Verified `npm run ci` passes and prepared Step 2 commit.
