# Azure Functions Skills — Development Standards

> These instructions apply to all coding agents working in this repository.

## Project Overview

- **What**: CLI tool + plugin system that equips coding agents with Azure Functions–specific knowledge
- **Stack**: TypeScript (strict), Node.js 18+, ESM
- **Targets**: GitHub Copilot CLI, Claude Code, Codex CLI
- **Testing**: Vitest for unit tests, Vally for skill evaluation (LLM-backed)

## Commands

| Task | Command |
| --- | --- |
| Build | `npm run build` |
| Compile only | `npm run compile` |
| Unit tests | `npm test` |
| Tests (watch) | `npm run test:watch` |
| Lint | `npm run lint` |
| Type check | `npm run typecheck` |
| Security lint | `npm run lint:security` |
| Skill validation | `npm run validate:skills` |
| Plugin payload verify | `npm run verify:plugin-payload` |
| Full gate | `npm run check` |
| Eval smoke | `npm run eval:smoke` |

## Code Style

- TypeScript strict mode — avoid `any` types; use proper interfaces and generics.
- Named exports; no default exports.
- Prefix intentionally unused parameters with `_`.
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`.
- Remove unused imports, variables, and functions before committing.

## Architecture

- Separate concerns by domain: `src/doctor/`, `src/setup/`, `src/chat/`, `src/build/`.
- Avoid duplicate code — extract shared logic into helpers.
- `templates/` is the canonical source; generated payloads are derived.
- Never hand-edit files under `.github/plugins/`, `.plugin/`, or `.claude-plugin/`. Change `templates/`, then regenerate with `npm run build:plugin-payload`.

## Testing

- **TDD**: Write tests first. Every new function or module must have tests before implementation.
- Unit tests live in `tests/*.test.ts`.
- Use `npm run test:watch` during TDD cycles.
- Run `npm test` before every commit.
- CLI changes require E2E verification: `node bin/azure-functions-skills.js <cmd> --dir <isolated-workspace>`.
- When the task is not code-related (skills, CI config, documentation), TDD is not required.

## Security

- No secrets in code — use environment variables or secret managers.
- No npm lifecycle scripts except `prepack`. Adding `postinstall`, `preinstall`, etc. is forbidden.
- Run `npm run lint:security` for supply-chain checks.
- **Never run Vally evals on PR code.** PR code is unreviewed and may contain prompt injection attacks. Skill content is loaded as LLM instructions and the agent has file-write and shell-execution permissions. Always use a GitHub Environment with a reviewer gate so only reviewed code is evaluated.
- Never run `doctor --deep` on untrusted workspaces.

## Boundaries

- Never edit generated files under `.github/plugins/`, `.plugin/`, `.claude-plugin/`.
- Never commit `local.settings.json` or `.env` files.
- Do not run `setup` or `chat` from the repo root — use `--dir <isolated-workspace>` to avoid pollution.
- Do not touch `templates/agents/AGENTS.md` — that is the user-facing template, not this repo's dev standards.

## Before Committing

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. CLI changes → E2E verify with real agent
5. Template changes → `npm run build:plugin-payload` then `npm run verify:plugin-payload`

## After Implementation

- Use `/rubber-duck` for self-review with a different model family.
  - If the current model is Claude (Ops family), switch to a GPT-family top model.
  - If the current model is GPT, switch to a Claude top model.
  - Use `/model` to switch, then `/rubber-duck` to review.

## Language Policy

- Respond in the user's language.
- PRs, source code, and documentation included in PRs must be in English unless otherwise specified.
- Temporary files created for user explanation (reports, proposals, etc.) should use the user's language.

## Multi-Account (EMU + Public)

- Some contributors use both GitHub EMU (enterprise) and public GitHub accounts.
- If work stalls due to authentication or permission errors, check whether the active account matches the target repository.
- Switch accounts with `/user switch` or `gh auth login` to match the repo's organization.
- EMU orgs require SSO authentication; public repos use personal accounts.
