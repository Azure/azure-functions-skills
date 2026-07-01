# Azure Functions Skills

[![npm](https://img.shields.io/npm/v/@azure/functions-skills)](https://www.npmjs.com/package/@azure/functions-skills)
[![E2E report](https://github.com/Azure/azure-functions-skills/actions/workflows/publish-e2e-report.yml/badge.svg)](https://azure.github.io/azure-functions-skills/)

**Azure Functions context for your coding agent.** One command sets up guided workflows (create, deploy, diagnose, review) for GitHub Copilot CLI, Claude Code, and Codex. The `doctor` command catches configuration and code issues *before* you deploy.

Latest E2E status: [HTML report](https://azure.github.io/azure-functions-skills/)

## What & why

Azure Functions Skills equips your coding agent with Functions-specific knowledge — trigger/binding patterns, language anti-patterns, runtime versions, deployment best practices — so the agent gives accurate guidance instead of generic advice.

It is **focused on Azure Functions**. For deployment of *any* Azure resource (Functions or otherwise), it delegates to [Azure Skills](https://github.com/microsoft/azure-skills) via the `azure-functions-deploy` skill. The two packages complement each other — see [docs/skills-vs-azure-skills.md](docs/skills-vs-azure-skills.md) for the role split.

## Prerequisites

**Node.js 20+** is the only thing you need to install yourself for the Azure Functions Skills CLI.
Use **Node.js 24+** when installing or testing GitHub Copilot CLI (`--agent ghcp`) because the
Copilot CLI runtime requires Node 24 or later. Claude Code and Codex do not currently require Node
24. Everything else (Azure CLI, Core Tools, language runtimes) is checked and guided by the
`azure-functions-setup` skill the first time you run `chat`.

## Quick Start

### 1. Install the plugin

<details open>
<summary><strong>GitHub Copilot CLI</strong></summary>

```bash
npx @azure/functions-skills install --agent ghcp
```

</details>

<details>
<summary><strong>Claude Code</strong></summary>

```bash
npx @azure/functions-skills install --agent claude
```

</details>

<details>
<summary><strong>Codex CLI</strong></summary>

```bash
npx @azure/functions-skills install --agent codex
```

</details>

> Installs at **user scope** (available to every project on this machine). Prefer to scope the skills to the current project only? Add `--local` to install them under the working directory instead.

### 2. Open the agent

```bash
npx @azure/functions-skills chat
```

The first time, the agent greets you with a welcome message, shows the available skills, and suggests the next workflow based on your project state.

> **More options?** See [CLI Reference](docs/cli-reference.md) for every command, flag, and headless example.

## Local installs and VS Code extension integration

`install --local` copies skill bodies, agent definitions, hooks, and MCP settings from the assets bundled in the installed `@azure/functions-skills` npm package. It does not fetch templates from GitHub or use a source ref. When a newer npm package is available, the CLI prints an update command so users can refresh the bundled assets before reinstalling or updating.

VS Code extensions can call the same local install flow from TypeScript:

```ts
import { installLocalSkills } from '@azure/functions-skills/setup';

const result = await installLocalSkills({
  targetDir: workspaceFolder.uri.fsPath,
  agents: ['ghcp'],
  yes: true,
  prerequisites: 'skip',
});
```

Common options:

| Option | Description |
| --- | --- |
| `targetDir` | Required workspace root where local skills should be installed. |
| `agents` | Optional agents: `ghcp`, `claude`, `codex`. Defaults to GHCP-compatible setup when omitted. |
| `dryRun` | Return planned local files without writing. |
| `yes` | Approve safe noninteractive changes such as local state `.gitignore` updates. |
| `prerequisites` | `auto`, `check-only`, or `skip`, matching the CLI prerequisite behavior. |
| `checkForUpdates` | Set `false` to skip npm package freshness guidance. |
| `runner` | Optional command runner for tests or extension-host controlled npm checks. |
| `initializeGitForGhcp` | Set `false` to skip GHCP git initialization. |

The result includes installed agents, files written, local state, git setup status, `.gitignore` status, and `packageUpdate` guidance that extensions can surface in their own UI.

## Skills

For contributor guidance on the product boundary between Azure Skills and Azure Functions Skills, see [Azure Skills and Azure Functions Skills Boundary](docs/azure-skills-boundary.md).

| Skill | Purpose |
| --- | --- |
| [`azure-functions-setup`](templates/skills/azure-functions-setup/SKILL.md) | Verify local prerequisites (Azure CLI, Core Tools, runtimes, Azure Skills) |
| [`azure-functions-create`](templates/skills/azure-functions-create/SKILL.md) | Create new Functions projects or add functions via Azure MCP templates |
| [`azure-functions-agents`](templates/skills/azure-functions-agents/SKILL.md) | Build Azure Functions hosted AI agent apps, scheduled agents, connector-triggered agents, and chat/API agents |
| [`azure-functions-deploy`](templates/skills/azure-functions-deploy/SKILL.md) | Prepare, validate, and deploy via Azure Skills with Functions-specific guidance |
| [`azure-functions-best-practices`](templates/skills/azure-functions-best-practices/SKILL.md) | Production-readiness review (config, security, reliability) |
| [`azure-functions-diagnostics`](templates/skills/azure-functions-diagnostics/SKILL.md) | Investigate deployment, runtime, trigger, binding, logging issues |
| [`azure-functions-health-status`](templates/skills/azure-functions-health-status/SKILL.md) | Collect current health, metrics, logs, Resource Health, Activity Log |
| [`azure-functions-inventory`](templates/skills/azure-functions-inventory/SKILL.md) | Collect app specification and configuration inventory |
| [`azure-functions-doctor`](templates/skills/azure-functions-doctor/SKILL.md) | Pre-deployment validation (used by the `doctor` CLI command) |
| [`azure-functions-common`](templates/skills/azure-functions-common/SKILL.md) | Shared language, trigger, binding, extension, routing references |
| [`azure-functions-feedback`](templates/skills/azure-functions-feedback/SKILL.md) | Turn session findings into previewed issues or pull requests |

The `functions-copilot` agent routes user requests to the right skill and suggests the next step after each workflow.

## Doctor — pre-deployment validation

Catch configuration mistakes, deprecated settings, **and semantic code issues** (missing error handling, blocking I/O, hardcoded secrets, durable-orchestrator non-determinism) *before* you deploy. The LLM semantic analysis is the value — `doctor` ships it as both a local CLI command and a GitHub Actions step.

### Local — LLM analysis + visual HTML report

```bash
npx @azure/functions-skills doctor --dir . \
  --deep --accept-deep-risk \
  --agent github-copilot \
  --format html --output doctor-report.html
```

`--accept-deep-risk` acknowledges that the agent runs with elevated permissions (file write, shell execution) — only use on trusted workspaces. Skip the LLM with `--no-deep` for fast deterministic checks only.

Open `doctor-report.html` in a browser:

![Doctor HTML report](docs/images/doctor-report.png)

### GitHub Actions — pre-deploy gate with deep analysis

Trigger on `push: main` (post-merge), not on pull requests — `--deep` refuses to run on pull-request workspaces because PR code is untrusted (it can prompt-inject the agent). See [docs/doctor-guide.md#security-model](docs/doctor-guide.md#security-model).

```yaml
on:
  push:
    branches: [main]

jobs:
  deep-doctor:
    runs-on: ubuntu-latest
    environment: trusted-deep-analysis  # GitHub Environment for approval + scoped secret
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install GitHub Copilot CLI
        run: npm install -g @github/copilot
      - name: Run Azure Functions doctor
        env:
          GITHUB_TOKEN: ${{ secrets.COPILOT_TOKEN }}
        run: |
          npx @azure/functions-skills doctor \
            --deep --accept-deep-risk \
            --agent github-copilot \
            --format markdown --output doctor.md \
            --severity high
      - name: Publish summary
        if: always()
        run: cat doctor.md >> $GITHUB_STEP_SUMMARY
```

Exit code is `1` if any finding is at or above `--severity` (default `high`), gating downstream deploy steps. For PR validation, use the same command with `--no-deep` (Tier 1 only) on `pull_request` events.

> **Doctor walkthrough?** See [docs/doctor-guide.md](docs/doctor-guide.md) for Tier 1 vs Tier 2 details, output formats, deep mode security, and bad-app fixtures.

Doctor also includes **supply-chain security checks** (lifecycle scripts, unpinned production dependencies, missing lockfile, tracked `.env` files, install-script deps, plus Tier 2 semantic checks for import-time side effects, fetch-then-execute, and credential exfiltration patterns) — informed by recent npm and PyPI compromises. See [SECURITY.md](SECURITY.md) for the threat model.

## Contributing

We welcome contributions. The canonical source for skills, agents, hooks, and MCP definitions lives under [`templates/`](templates/) — edit there, then `npm run build:plugin-payload` to regenerate the published plugin payload.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## Security

Report vulnerabilities to [secure@microsoft.com](mailto:secure@microsoft.com). See [SECURITY.md](SECURITY.md) for the threat model and our defense layers.

## License

[MIT](LICENSE)
