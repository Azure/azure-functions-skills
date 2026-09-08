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

- Separate concerns by domain: `src/doctor/`, `src/setup/`, `src/build/`.
- Avoid duplicate code — extract shared logic into helpers.
- `templates/` is the canonical source; generated payloads are derived.
- Never hand-edit files under `.github/plugins/`, `.plugin/`, or `.claude-plugin/`. Change `templates/`, then regenerate with `npm run build:plugin-payload`.

## Feature Design and Approval

Use the [FRD process](docs/frds/README.md) for changes that add or materially
change a public CLI or library surface, an authoring format, discovery or routing
behavior, shared infrastructure, or a canonical skill. Typos, documentation-only
clarifications, bug fixes with a reproduction test, and small internal changes do
not need a new FRD; explain their scope in the PR.

1. Read the relevant FRD and its status before starting. New FRDs belong in
   `docs/frds/`; preserve the historical documents and numbering in `docs/prd-docs/`.
   Maintain one lifecycle FRD per canonical skill rather than creating an FRD for
   each skill enhancement. Generated payload copies and aliases do not get their
   own FRDs. Give cross-skill mechanisms a separate shared-infrastructure FRD.
   Add a new skill's FRD before implementation; introduce an FRD for an existing
   skill when its contract next changes materially.
2. Complete all eight sections of the [template](docs/frds/_template.md), including
   requirements, non-goals, decisions, tests, and documentation impact.
3. Obtain a separate architecture review and explicit human sign-off on the
   identified revision. **Do not implement a feature before its FRD is
   `Finalized`.** Approval of a task plan is not approval of an unwritten FRD.
   Drafting/reviewing FRDs and maintaining this documentation process are allowed
   before feature approval.
4. Record non-trivial decisions with alternatives, rationale, decision-maker,
   and date. If an approved contract or scope changes, update the FRD and obtain
   approval for the changed portion before implementing it.
5. Link tasks, PRs, tests, and completion evidence to the FRD's requirement IDs.
   Report what is complete, what remains, and which decisions changed at each
   agreed checkpoint.
6. Default to one primary implementer progressing through understandable slices,
   not a fleet of concurrent implementation agents. Use a separate review pass
   at meaningful checkpoints; do not expand scope ahead of human understanding.
7. Mark an FRD `Implemented` only after its acceptance criteria and evidence are
   complete. A benchmark or evaluation FRD requires actual approved runs and a
   report, not just sample code. Missing approval, measurements, or cleanup
   remain explicit blockers.

FRD approval does not authorize live Azure experiments or bypass the security
rules below. Confirm the target, budget, repetition count, and owned-resource
cleanup policy separately before paid experiments.

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
