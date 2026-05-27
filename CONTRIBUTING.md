# Contributing to Azure Functions Skills

Thank you for considering a contribution! This guide covers how to add or change skills, agents, references, tests, and the CLI.

For repo-internal build/release commands see [docs/development.md](docs/development.md).

## Quick start

```bash
git clone https://github.com/Azure/azure-functions-skills.git
cd azure-functions-skills
npm ci
npm run check
```

`npm run check` runs lint, typecheck, skill validation, plugin payload verification, tests, and build. Pull requests must pass this gate.

## Repository layout

```text
templates/                Canonical source — edit this
  agents/                 Agent definitions (e.g. functions-copilot)
  skills/                 Each skill: SKILL.md + references/ + optional scripts/
  hooks/                  Hook payloads (welcome-setup, etc.)
  prompts/                Chat startup prompt content
  mcp/servers.yaml        MCP server definitions

src/                      TypeScript CLI and build system
  doctor/                 doctor command implementation
  setup/                  install/setup/workspace flows
  chat/                   chat command
  build/                  Template → payload build pipeline

tests/                    Vitest coverage
  fixtures/doctor-bad-apps/  Intentionally broken Azure Functions projects

.github/plugins/azure-functions-skills/  Generated plugin payload (do not hand-edit)
.plugin/marketplace.json                  Generated marketplace manifest
.claude-plugin/marketplace.json           Generated marketplace manifest

docs/                     User-facing documentation
  cli-reference.md
  doctor-guide.md
  skills-vs-azure-skills.md
  bad-app-fixtures.md
  research/               Bug-bash feedback, historical notes
  internal/               Internal design documents
  prd-docs/               Feature specs (Fxx-*.md)
```

## How to make changes

### Add or modify a skill

1. Edit the canonical source under `templates/skills/<skill-id>/`:
   - `SKILL.md` — the skill body (front matter + instructions)
   - `references/` — supporting checklists, examples
   - `scripts/` — helper scripts (if any)

2. Validate:

   ```bash
   npm run validate:skills
   npm test
   ```

3. Regenerate the committed plugin payload:

   ```bash
   npm run build:plugin-payload
   ```

4. Verify the generated files match the templates:

   ```bash
   npm run verify:plugin-payload
   ```

Do not edit `.github/plugins/azure-functions-skills/`, `.plugin/marketplace.json`, or `.claude-plugin/marketplace.json` by hand. Change `templates/`, then regenerate.

### Modify the CLI

CLI source lives under `src/`:

- `src/doctor/` — doctor command (built-in checks, AI tier, formatters)
- `src/setup/` — install/setup/workspace flows
- `src/chat/` — chat command
- `src/build/` — build pipeline (template → workspace + plugin layouts)
- `bin/azure-functions-skills.js` — CLI entry point and option parsing

Workflow:

1. Edit `src/` or `bin/`
2. `npm run compile` — TypeScript build
3. `npm test` — Vitest
4. `npm run lint` and `npm run typecheck`

For testing CLI changes against a real workspace:

```bash
node bin/azure-functions-skills.js <cmd> --dir ../tmp-functions-app ...
```

### Add a doctor check

1. Add a `DoctorCheck` to `src/doctor/checks.ts`. Each check has `id`, `category`, `defaultSeverity`, `appliesTo`, `run`.
2. Add it to `ALL_CHECKS`.
3. Add a unit test in `tests/doctor-checks.test.ts`.
4. Add a bad-app fixture exercising the new check (see [docs/bad-app-fixtures.md](docs/bad-app-fixtures.md)).
5. Update `tests/fixtures/doctor-bad-apps/expected-results.md`.

### Test doctor end-to-end

See [docs/bad-app-fixtures.md](docs/bad-app-fixtures.md) for the manual E2E workflow:

```powershell
.\scripts\doctor-e2e-setup.ps1 -Target Q:\temp\doctor-deep-test -DeepOnly
cd Q:\temp\doctor-deep-test
.\run-all.ps1 -Deep -Agent github-copilot
```

This validates that doctor catches the expected findings on every fixture.

## Submitting a pull request

1. **Fork & branch**: branch from `main` with a descriptive name.
2. **Small, focused changes**: one concern per PR.
3. **Run the gate**: `npm run check` must pass locally.
4. **Tests**: add or update tests for behavior changes; favor TDD where applicable.
5. **Docs**: update affected user-facing docs (`docs/cli-reference.md`, `docs/doctor-guide.md`, etc.) and the README if applicable.
6. **PRD updates**: if a feature spec exists under `docs/prd-docs/`, update its status when the implementation changes.
7. **No hand-edits to generated files**: change `templates/` and regenerate via `npm run build:plugin-payload`.

## Commit style

Conventional commits are preferred but not strictly enforced. Use the imperative mood:

```text
doctor: fail closed on unknown AI severity (#117)
formatters: HTML enum allowlist for status/severity (#115)
docs: rewrite README with focused topics + linked references
```

When fixing a published issue, reference the issue number.

## Release process

Publishing is done from a clean `main` matching `origin/main` via the local release helper:

```bash
npm run release:local -- <version> --dry-run
npm run release:local -- <version> --yes
```

See [docs/development.md](docs/development.md) for the full release command reference.

## Reporting issues

- **Bug reports**: include the doctor JSON output if doctor is involved; redact secrets first.
- **Feature requests**: describe the user scenario and what doctor/install/chat outcome you expect.
- **Security**: do not file public issues for security vulnerabilities. Email `secure@microsoft.com` instead.

## Code of Conduct

This project follows the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).

## License

By contributing, you agree your contributions will be licensed under the MIT License (see [LICENSE](LICENSE)).
