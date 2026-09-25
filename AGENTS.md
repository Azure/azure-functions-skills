# Azure Functions Skills — Development Standards

> These instructions apply to all coding agents working in this repository.

## Project Overview

- **What**: Skills + telemetry plugin that equips coding agents with Azure Functions–specific knowledge, plus a small companion CLI (template apply, telemetry sender, build)
- **Stack**: TypeScript (strict), Node.js 18+, ESM
- **Targets**: GitHub Copilot CLI, Claude Code, Codex CLI
- **Testing**: Vitest for unit tests

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

## Code Style

- TypeScript strict mode — avoid `any` types; use proper interfaces and generics.
- Named exports; no default exports.
- Prefix intentionally unused parameters with `_`.
- Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`.
- Remove unused imports, variables, and functions before committing.

## Architecture

- Separate concerns by domain: `src/build/`, `src/telemetry/`, `src/templates/`.
- Avoid duplicate code — extract shared logic into helpers.
- `templates/` is the canonical source; generated payloads are derived.
- Never hand-edit files under `.github/plugins/`, `.plugin/`, or `.claude-plugin/`. Change `templates/`, then regenerate with `npm run build:plugin-payload`.

## Testing

- **TDD**: Write tests first. Every new function or module must have tests before implementation.
- Unit tests live in `tests/*.test.ts`.
- Use `npm run test:watch` during TDD cycles.
- Run `npm test` before every commit.
- CLI changes require a manual run: `node bin/azure-functions-skills.js <cmd> --dir <isolated-workspace>`.
- When the task is not code-related (skills, CI config, documentation), TDD is not required.

## Security

- No secrets in code — use environment variables or secret managers.
- No npm lifecycle scripts except `prepack`. Adding `postinstall`, `preinstall`, etc. is forbidden.
- Run `npm run lint:security` for supply-chain checks.
- **Never run LLM-backed skill evaluations in PR-triggered CI or on unreviewed, untrusted contributor code.** Skill content can contain prompt injection attacks, and the evaluation agent has file-write and shell-execution permissions. Start such runs only by manual `workflow_dispatch` or locally on trusted code in an isolated workspace.
- Confirm the target, budget, repetition count, and owned-resource cleanup policy separately before paid experiments.

## Boundaries

- Never edit generated files under `.github/plugins/`, `.plugin/`, `.claude-plugin/`.
- Never commit `local.settings.json` or `.env` files.
- Do not run `template apply` from the repo root — use `--dir <isolated-workspace>` to avoid pollution.
- Do not touch `templates/agents/AGENTS.md` — that is the user-facing template, not this repo's dev standards.

## Before Committing

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`
4. CLI changes → run the command manually in an isolated workspace
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
