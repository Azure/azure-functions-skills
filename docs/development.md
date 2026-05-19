# Development Workflow

This repository keeps canonical agent, skill, hook, prompt, and MCP content under `templates/`. Generated plugin payloads and marketplace manifests are committed so users can install the current repository state without rebuilding locally.

## Prerequisites

| Tool | Required for | Install |
| --- | --- | --- |
| Node.js 18 or later | TypeScript build, tests, and CLI scripts | [nodejs.org](https://nodejs.org/) |
| npm | Dependency install, package scripts, and release publishing | Included with Node.js; see [npm docs](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) |
| Git | Source control and release checks | [git-scm.com/downloads](https://git-scm.com/downloads) |
| GitHub CLI | Optional GitHub Release creation in `release:local` | [cli.github.com](https://cli.github.com/) |
| GitHub Copilot CLI, Claude Code, or Codex CLI | Optional real-agent smoke tests | [gh-copilot](https://github.com/github/gh-copilot), [Claude Code](https://claude.ai/download), [Codex package](https://www.npmjs.com/package/@openai/codex) |

Install dependencies:

```bash
npm ci
```

Validate the full repository before opening a pull request:

```bash
npm run check
```

## Key Directories

```text
templates/   Canonical agents, skills, hooks, prompts, and MCP definitions
src/         TypeScript CLI and build system
tests/       Vitest coverage for build, setup, chat, validation, and release helpers
.github/plugins/azure-functions-skills/  Generated plugin payload
```

## Update Templates And Plugin Payloads

1. Edit the canonical source under `templates/`:
   - `templates/agents/` for agent definitions.
   - `templates/skills/` for skill content, references, and scripts.
   - `templates/hooks/` for hook payloads.
   - `templates/mcp/servers.yaml` for MCP server definitions.
   - `templates/prompts/` for chat startup prompt content.
2. Run validation while iterating:

   ```bash
   npm run validate:skills
   npm test
   ```

3. Regenerate the committed plugin payload and marketplace manifests:

   ```bash
   npm run build:plugin-payload
   ```

   This updates:
   - `.github/plugins/azure-functions-skills/` for the cross-tool plugin payload.
   - `.plugin/marketplace.json` for GitHub Copilot plugin marketplace registration.
   - `.claude-plugin/marketplace.json` for Claude plugin marketplace registration.

4. Verify the generated files match the templates:

   ```bash
   npm run verify:plugin-payload
   npm run check
   ```

Do not edit generated files in `.github/plugins/azure-functions-skills/`, `.plugin/marketplace.json`, or `.claude-plugin/marketplace.json` by hand. Change `templates/`, then regenerate.

## Local Smoke Tests

Build workspace layouts for all targets:

```bash
npm run build
```

Install workspace-local files into a temporary project:

```bash
node bin/azure-functions-skills.js setup --agent ghcp --dir ../tmp-functions-app --skip-prerequisites
node bin/azure-functions-skills.js setup --agent claude --dir ../tmp-functions-app --skip-prerequisites
node bin/azure-functions-skills.js setup --agent codex --dir ../tmp-functions-app --skip-prerequisites
```

Launch a target CLI through the chat command:

```bash
node bin/azure-functions-skills.js chat --agent github-copilot --dir ../tmp-functions-app --skip-prerequisites -- -p "List the Azure Functions skills you can see."
node bin/azure-functions-skills.js chat --agent claude-code --dir ../tmp-functions-app --skip-prerequisites --prompt "List the Azure Functions skills you can see." -- -p --output-format text --no-session-persistence
node bin/azure-functions-skills.js chat --agent codex --dir ../tmp-functions-app --skip-prerequisites --prompt "List the Azure Functions skills you can see." -- exec --sandbox read-only --json --skip-git-repo-check --cd .
```

## Release CLI Package

Use the local release helper from a clean `main` branch that matches `origin/main`:

```bash
npm run release:local -- 0.12.0 --dry-run
npm run release:local -- 0.12.0 --yes
```

The helper verifies the release state, optionally bumps `package.json` and `package-lock.json`, regenerates plugin payloads, runs `npm ci`, `npm run check`, and `npm pack --dry-run`, creates an annotated tag, publishes `@agent-loom/azure-functions-skills` to npm, pushes the tag, and creates a GitHub Release with the plugin bundle when GitHub CLI authentication is available.

Useful release options:

```bash
npm run release:local -- 0.12.0 --dry-run
npm run release:local -- 0.12.0 --yes --skip-github-release
npm run release:local -- 0.12.0 --yes --github-account <user>
```

Before publishing, confirm that:

- `npm run check` passes.
- `npm pack --dry-run` contains `bin/`, `lib/`, `src/`, `templates/`, and `README.md`.
- The generated plugin payload and marketplace manifests are included in the release commit when templates changed.
- You are authenticated to npm with publish rights for `@agent-loom/azure-functions-skills`.
