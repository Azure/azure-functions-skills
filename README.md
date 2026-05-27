# Azure Functions Skills

[![npm](https://img.shields.io/npm/v/@azure/functions-skills)](https://www.npmjs.com/package/@azure/functions-skills)
[![E2E report](https://github.com/Azure/azure-functions-skills/actions/workflows/publish-e2e-report.yml/badge.svg)](https://azure.github.io/azure-functions-skills/)

**Azure Functions context for your coding agent.** One command sets up guided workflows (create, deploy, diagnose, review) for GitHub Copilot CLI, Claude Code, and Codex. The `doctor` command catches configuration and code issues *before* you deploy.

Latest E2E status: [HTML report](https://azure.github.io/azure-functions-skills/)

## What & why

Azure Functions Skills equips your coding agent with Functions-specific knowledge — trigger/binding patterns, language anti-patterns, runtime versions, deployment best practices — so the agent gives accurate guidance instead of generic advice.

It is **focused on Azure Functions**. For deployment of *any* Azure resource (Functions or otherwise), it delegates to [Azure Skills](https://github.com/microsoft/azure-skills) via the `azure-functions-deploy` skill. The two packages complement each other — see [docs/skills-vs-azure-skills.md](docs/skills-vs-azure-skills.md) for the role split.

## Prerequisites

**Node.js 18+** is the only thing you need to install yourself. Everything else (Azure CLI, Core Tools, language runtimes) is checked and guided by the `azure-functions-setup` skill the first time you run `chat`.

## Quick Start

### 1. Install the plugin

<details open>
<summary><strong>GitHub Copilot CLI</strong></summary>

```bash
npx @azure/functions-skills install --agent ghcp --dir ./my-app
```

</details>

<details>
<summary><strong>Claude Code</strong></summary>

```bash
npx @azure/functions-skills install --agent claude --dir ./my-app
```

</details>

<details>
<summary><strong>Codex CLI</strong></summary>

```bash
npx @azure/functions-skills install --agent codex --dir ./my-app
```

</details>

### 2. Open the agent

```bash
npx @azure/functions-skills chat --dir ./my-app
```

The first time, the agent greets you with a welcome message, shows the available skills, and suggests the next workflow based on your project state.

> **More options?** See [CLI Reference](docs/cli-reference.md) for every command, flag, and headless example.

## Skills

| Skill | Purpose |
| --- | --- |
| [`azure-functions-setup`](templates/skills/azure-functions-setup/SKILL.md) | Verify local prerequisites (Azure CLI, Core Tools, runtimes, Azure Skills) |
| [`azure-functions-create`](templates/skills/azure-functions-create/SKILL.md) | Create new Functions projects or add functions via Azure MCP templates |
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

Catch configuration mistakes, deprecated settings, and (with `--deep`) semantic code issues *before* you deploy.

### Local — visual HTML report

```bash
npx @azure/functions-skills doctor --dir . --format html --output doctor-report.html
```

Open `doctor-report.html` in a browser:

![Doctor HTML report](docs/images/doctor-report.png)

### GitHub Actions — pre-deploy gate

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: '22'
- name: Validate Azure Functions project
  run: |
    npx @azure/functions-skills doctor \
      --no-deep \
      --format markdown \
      --output doctor.md \
      --severity high
- name: Publish summary
  if: always()
  run: cat doctor.md >> $GITHUB_STEP_SUMMARY
```

> **Doctor walkthrough?** See [docs/doctor-guide.md](docs/doctor-guide.md) for Tier 1 vs Tier 2 details, output formats, deep mode security, and bad-app fixtures.

## Contributing

We welcome contributions. The canonical source for skills, agents, hooks, and MCP definitions lives under [`templates/`](templates/) — edit there, then `npm run build:plugin-payload` to regenerate the published plugin payload.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## License

[MIT](LICENSE)
