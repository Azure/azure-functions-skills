# Azure Functions Development Standards

> These instructions apply to all coding agents working in this repository.

## Code Quality

- **Linter**: Always run the project linter before committing. Fix all warnings and errors.
- **Type Safety**: Use TypeScript strict mode. Avoid `any` types — use proper interfaces and generics.
- **No Dead Code**: Remove unused imports, variables, and functions before committing.

## Security

- **Dependency Updates**: When updating library versions, always check for known vulnerabilities with `npm audit` or equivalent.
- **No Secrets in Code**: Never hardcode secrets, API keys, or connection strings. Use environment variables or secret managers.
- **Auth Levels**: Default to `authLevel: 'function'` for HTTP triggers. Use `anonymous` only for public endpoints.

## Development Workflow

- **TDD**: Write tests first. Every new function or module must have tests before implementation.
- **Small Commits**: Each commit should represent a single logical change.
- **Conventional Commits**: Use prefixes: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`.

## Pull Requests

- **Self-Review**: Before requesting review, re-read every line of your diff. Check for:
  - Accidental debug code (`console.log`, `debugger`)
  - Missing error handling
  - Unclear variable names
  - Test coverage gaps
- **PR Description**: Include what changed, why, and how to test.
- **Keep PRs Small**: Prefer multiple small PRs over one large PR.

## Azure Functions Specific

- **Programming Model**: Use the latest programming model (Node.js v4, Python v2, .NET isolated).
- **Extension Bundles**: Always specify extension bundle version in `host.json`.
- **local.settings.json**: Never commit this file. It's in `.gitignore` by default.
