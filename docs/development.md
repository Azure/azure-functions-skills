# Development Workflow

> **Looking to contribute?** Start with [CONTRIBUTING.md](../CONTRIBUTING.md). This page is the deeper reference for internal build/test/release commands.

This repository keeps canonical agent, skill, hook, prompt, and MCP content under `templates/`. Generated plugin payloads and marketplace manifests are committed so users can install the current repository state without rebuilding locally.

## Prerequisites

| Tool | Required for | Install |
| --- | --- | --- |
| Node.js 20 or later | TypeScript build, tests, and CLI scripts | [nodejs.org](https://nodejs.org/) |
| npm | Dependency install, package scripts, and release publishing | Included with Node.js; see [npm docs](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm) |
| Git | Source control and release checks | [git-scm.com/downloads](https://git-scm.com/downloads) |
| GitHub CLI | Optional GitHub Release creation in `release:local` | [cli.github.com](https://cli.github.com/) |
| GitHub Copilot CLI, Claude Code, or Codex CLI | Optional real-agent smoke tests. GitHub Copilot CLI requires Node.js 24+; Claude Code requires Node.js 18+; Codex requires Node.js 16+. | [gh-copilot](https://github.com/github/gh-copilot), [Claude Code](https://claude.ai/download), [Codex package](https://www.npmjs.com/package/@openai/codex) |

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

> **This repository does NOT publish to npm.** The package `@azure/functions-skills` is published by a downstream Microsoft mirror pipeline that picks up tags pushed here. The local release helper only prepares and tags; it never holds NPM tokens or runs `npm publish`.

Use the local release helper from a clean `main` branch that matches `origin/main`:

```bash
npm run release:local -- 0.0.5-preview --dry-run
npm run release:local -- 0.0.5-preview --yes
```

The helper:

1. Verifies `main` is clean and matches `origin/main`.
2. Verifies the version is not already published on npm.
3. Bumps `package.json` and `package-lock.json` when needed, regenerates the plugin payload, commits, and pushes `main`.
4. Runs `npm ci --ignore-scripts` and `npm run check`.
5. Runs `npm pack --dry-run` to verify the tarball contents.
6. Creates an annotated git tag and pushes it.

The tag push triggers two independent downstream processes:

- **`.github/workflows/draft-release.yml`** creates a draft GitHub Release with auto-generated notes for the maintainer to review and publish.
- **The Microsoft mirror pipeline** publishes `@azure/functions-skills@<version>` to npm.

Useful release options:

```bash
npm run release:local -- 0.0.5-preview --dry-run
npm run release:local -- 0.0.5-preview --yes --skip-check
npm run release:local -- 0.0.5-preview --yes --no-push-main
```

Before tagging, confirm that:

- `npm run check` passes.
- `npm pack --dry-run` contains `bin/`, `lib/`, `templates/`, and `README.md` (no `src/`, no `.js.map`).
- The generated plugin payload and marketplace manifests are included in the release commit when templates changed.

This repo does **not** require any npm credentials. If you see references to `NPM_TOKEN` in workflows or scripts, that is a footgun — file an issue.
