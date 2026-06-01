---
applyTo: "**/*.ts"
---

# TypeScript Code Generation Rules

## Strict Mode

- All code must pass `tsc --noEmit` with the project's strict tsconfig.
- Never use `any`. Use proper interfaces, generics, or `unknown` with type guards.
- Prefer `readonly` properties where mutation is not needed.

## Module System

- This project uses ESM (`"type": "module"` in package.json).
- Use `import`/`export` — never `require()`.
- Use named exports; avoid default exports.

## Error Handling

- Throw typed errors with descriptive messages.
- Catch errors at appropriate boundaries; do not swallow errors silently.
- Prefix intentionally unused caught errors with `_` (e.g., `catch (_err)`).

## Style

- Prefix intentionally unused parameters with `_`.
- Remove unused imports, variables, and functions.
- Keep functions small and focused on a single responsibility.
- Extract shared logic into helper functions — do not duplicate code.

## TDD

- Write failing tests first, then implement.
- When the task is purely configuration or documentation, TDD is not required.
