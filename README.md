# Azure Functions Skills

[![npm](https://img.shields.io/npm/v/@agent-loom/azure-functions-skills)](https://www.npmjs.com/package/@agent-loom/azure-functions-skills)

Azure Functions Skills provides guided setup, create, deploy, diagnostics, and review workflows for coding agents such as GitHub Copilot CLI, Claude Code, and Codex.

## Recommended: install as a plugin

Use the plugin when your agent supports plugin installation. This keeps the Azure Functions agent, skills, hooks, and MCP configuration available without copying files into every workspace.

GitHub Copilot CLI:

```bash
copilot plugin marketplace add Azure/azure-functions-skills
copilot plugin install azure-functions-skills@azure-functions-skills
```

Claude Code plugin-from-source:

```bash
git clone https://github.com/Azure/azure-functions-skills.git
claude --add-dir ./azure-functions-skills/.github/plugins/azure-functions-skills
```

Codex CLI:

```bash
codex plugin marketplace add Azure/azure-functions-skills
# Then install azure-functions-skills from /plugins.
```

For VS Code plugin-from-source flows, point the installer at:

```text
Azure/azure-functions-skills:.github/plugins/azure-functions-skills
```

After installing, ask your agent:

```text
@functions-copilot set up Azure Functions
```

With GitHub Copilot CLI, select the Functions agent explicitly:

```bash
copilot --agent functions-copilot
```

For a one-shot prompt:

```bash
copilot --agent functions-copilot -p "Explain what Azure Functions Skills can do and which workflow I should start with."
```

If you intentionally want the session to run without permission prompts, add `--yolo`:

```bash
copilot --agent functions-copilot --yolo
```

For a guided overview first, ask:

```text
@functions-copilot Explain what Azure Functions Skills can do, when to use setup/create/deploy/diagnostics/best-practices/feedback, and which workflow I should start with.
```

See [docs/usage-scenarios.md](docs/usage-scenarios.md) for customer-friendly scenario walkthroughs and expected results.

## Plugin vs. `chat` vs. `setup`

| Option | Use when | What it does |
| --- | --- | --- |
| Plugin | You want the normal, reusable experience | Registers the Azure Functions plugin payload from this repository with your agent. |
| `chat` | You want to launch a CLI agent with Azure Functions context immediately | Detects the local project, prepares a startup prompt, checks prerequisites, and starts the selected CLI agent. |
| `setup` | You need workspace-local files or your agent does not support plugins | Copies agent instructions, skills, hooks, and MCP config into the target workspace. |

## CLI commands

Run without global install:

```bash
npx @agent-loom/azure-functions-skills chat
npx @agent-loom/azure-functions-skills setup
```

Or install globally:

```bash
npm install -g @agent-loom/azure-functions-skills
azure-functions-skills chat
azure-functions-skills setup
```

Useful options:

```bash
npx @agent-loom/azure-functions-skills chat --agent github-copilot --dir ./my-app
npx @agent-loom/azure-functions-skills chat --prompt "Create an HTTP trigger function"
npx @agent-loom/azure-functions-skills setup --agent ghcp --dir ./my-app
npx @agent-loom/azure-functions-skills setup --check-prerequisites
npx @agent-loom/azure-functions-skills setup --skip-prerequisites
```

## Skills

| Skill | Purpose |
| --- | --- |
| `azure-functions-setup` | Verify local prerequisites such as Azure CLI, Azure Functions Core Tools, runtimes, and Azure Skills deployment dependency. |
| `azure-functions-create` | Create new Functions projects or add functions by using Azure MCP template discovery first. |
| `azure-functions-deploy` | Prepare, validate, and deploy through Azure Skills while adding Azure Functions-specific guidance. |
| `azure-functions-best-practices` | Review an app for Azure Functions configuration, security, reliability, and production-readiness guidance. |
| `azure-functions-diagnostics` | Investigate deployment, runtime, trigger, binding, language worker, logging, and telemetry issues. |
| `azure-functions-health-status` | Collect current health, metrics, logs, Resource Health, and Activity Log evidence. |
| `azure-functions-inventory` | Collect app specification and configuration inventory without diagnosing health. |
| `azure-functions-common` | Shared language, trigger, binding, extension, routing, and local emulator references for the skill suite. |
| `azure-functions-feedback` | Turn session findings into previewed issues or pull requests for this repository. |

The `functions-copilot` agent routes user requests to the right skill and suggests the next step after each workflow.

## What `setup` writes

For GitHub Copilot workspaces, `setup` writes:

```text
.github/copilot-instructions.md
.github/agents/functions-copilot.agent.md
.github/skills/<skill-id>/SKILL.md
.github/hooks/welcome-setup.json
.vscode/mcp.json
AGENTS.md
```

Claude Code and Codex receive equivalent workspace-local instructions, skills, hooks, and MCP configuration in their native locations.

## Development

Install dependencies:

```bash
npm ci
```

Validate changes:

```bash
npm run check
```

Regenerate committed plugin payload and marketplace manifests after editing `templates/`:

```bash
npm run build:plugin-payload
```

Key source directories:

```text
templates/   Canonical agents, skills, hooks, prompts, and MCP definitions
src/         TypeScript CLI and build system
tests/       Vitest coverage for build, setup, chat, validation, and release helpers
.github/plugins/azure-functions-skills/  Generated plugin payload
```

Do not edit generated plugin payload files by hand. Update `templates/`, then regenerate.

## License

MIT
