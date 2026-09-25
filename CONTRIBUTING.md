# Contributing to Azure Functions Skills

Thank you for considering a contribution! Most contributions add or improve a skill. For a skill change, you edit only the files under `templates/skills/`. The build and release process delivers the skill to all supported coding agents.

For repo-internal build/release commands see [docs/development.md](docs/development.md).

## Quick start

```bash
git clone https://github.com/Azure/azure-functions-skills.git
cd azure-functions-skills
npm ci
npm run check
```

`npm run check` runs lint, typecheck, security lint, skill validation, plugin payload verification, tests, and build. Pull requests must pass this gate.

## Repository layout

```text
templates/                Canonical source — edit this
  skills/                 Each skill: SKILL.md + references/ + optional scripts/
  hooks/                  Telemetry hook payloads
  mcp/servers.yaml        MCP server definitions

src/                      TypeScript CLI and build system
  build/                  Template → payload build pipeline
  telemetry/              Telemetry sender used by the hooks
  templates/              Azure Functions template list/apply

tests/                    Vitest coverage

.github/plugins/azure-functions-skills/  Generated plugin payload (do not hand-edit)
.plugin/marketplace.json                  Generated marketplace manifest
.claude-plugin/marketplace.json           Generated marketplace manifest

docs/                     Documentation
```

## How to make changes

### Add or modify a skill

1. Edit the canonical source under `templates/skills/<skill-id>/`:
   - `SKILL.md` — the skill body (front matter + instructions)
   - `references/` — supporting checklists, examples
   - `scripts/` — helper scripts (if any)

   To start a new skill, run `npm run new:skill`.

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

Focus on the quality of the task result and on usability. Make sure that an agent can follow each instruction without guessing. Try the skill manually with a coding agent before you open the pull request.

### Modify the CLI or build system

- `src/build/` — build pipeline (template → agent layouts + plugin payload)
- `src/telemetry/` — telemetry event validation and sending
- `src/templates/` — template list/apply
- `bin/azure-functions-skills.js` — CLI entry point and option parsing

Workflow:

1. Edit `src/` or `bin/`
2. `npm run compile` — TypeScript build
3. `npm test` — Vitest
4. `npm run lint` and `npm run typecheck`

## Security policy for skill and CI changes

Because skills are loaded by an LLM agent that may run with elevated permissions, modifications to certain files require extra care:

- **`templates/skills/**`**: Markdown that the agent reads as instructions. A malicious or careless skill can instruct the agent to fetch and execute arbitrary content. Every PR that touches a `SKILL.md` or `references/*.md` requires explicit reviewer attention to the content of the change.
- **`.github/workflows/**`**: CI workflows have access to repo secrets. Adding a `secrets.NPM_TOKEN` or similar credential is a footgun — this repo does not publish to npm (the mirror pipeline does). Run `node scripts/audit-npm-token.mjs` locally to scan for such references.
- **`package.json` lifecycle scripts**: Only `prepack` is allowed. Adding `postinstall`, `preinstall`, `postpack`, `prepublish`, or `prepublishOnly` is forbidden — these run on every user `npm install` and are a textbook supply chain attack surface. CI rejects them automatically.
- **`.github/plugins/**`**: Auto-generated from `templates/`. Never hand-edit. `npm run verify:plugin-payload` enforces this in CI.

## Submitting a pull request

1. **Fork & branch**: branch from `main` with a descriptive name.
2. **Small, focused changes**: one concern per PR.
3. **Run the gate**: `npm run check` must pass locally.
4. **Tests**: add or update tests for code behavior changes; favor TDD where applicable.
5. **Docs**: update the README and affected docs if applicable.
6. **No hand-edits to generated files**: change `templates/` and regenerate via `npm run build:plugin-payload`.

## Commit style

Conventional commits are preferred but not strictly enforced. Use the imperative mood:

```text
feat: add Durable Functions retry guidance to azure-functions-create
fix: correct extension bundle range in azure-functions-common
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

- **Bug reports**: include the skill name, the coding agent, and the prompt you used; redact secrets first.
- **Feature requests**: describe the user scenario and the result you expect from the agent.
- **Security**: do not file public issues for security vulnerabilities. Email `secure@microsoft.com` instead.

## Code of Conduct

This project follows the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).

## License

By contributing, you agree your contributions will be licensed under the MIT License (see [LICENSE](LICENSE)).