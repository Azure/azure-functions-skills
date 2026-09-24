# Azure Functions Skills

[![npm](https://img.shields.io/npm/v/@azure/functions-skills)](https://www.npmjs.com/package/@azure/functions-skills)

**Azure Functions context for your coding agent.** The plugin provides skills, Azure MCP configuration, and telemetry hooks for GitHub Copilot, Claude Code, and Codex.

## What & why

Azure Functions Skills equips your coding agent with Functions-specific knowledge — trigger/binding patterns, language anti-patterns, runtime versions, deployment best practices — so the agent gives accurate guidance instead of generic advice.

It is **focused on Azure Functions**. For deployment of *any* Azure resource (Functions or otherwise), it delegates to [Azure Skills](https://github.com/microsoft/azure-skills) via the `azure-functions-deploy` skill. The two packages complement each other — see [docs/skills-vs-azure-skills.md](docs/skills-vs-azure-skills.md) for the role split.

## Prerequisites

**Node.js 20+** is necessary for the telemetry hooks and the companion CLI. Everything else (Azure CLI, Core Tools, language runtimes) is checked and guided by the
`azure-functions-setup` skill when environment verification is needed.

## Quick Start

### 1. Install the plugin with your coding agent

Choose your coding agent and follow its install steps:

#### GitHub Copilot CLI

Start an interactive Copilot session with `copilot`, then run:

```text
/plugin marketplace add Azure/azure-functions-skills
/plugin install azure-functions-skills@azure-functions-skills
```

#### GitHub Copilot app

1. Open **Settings** (the gear icon), then select **Plugins**.
2. Select **Install** to open the plugin installer, then add `Azure/azure-functions-skills` as a marketplace.
3. Select **azure-functions-skills**, review its contents, and confirm the installation.

#### GitHub Copilot in VS Code (Preview)

1. Enable the `chat.plugins.enabled` setting. Your organization may manage this setting.
2. Add this marketplace to your user `settings.json`:

   ```json
   {
     "chat.plugins.marketplaces": [
       "Azure/azure-functions-skills"
     ]
   }
   ```

3. Open the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X`), search for `@agentPlugins`, and install **azure-functions-skills**.

VS Code also discovers plugins installed by GitHub Copilot CLI. See [Agent plugins in VS Code](https://code.visualstudio.com/docs/agent-customization/agent-plugins) for more options.

#### Claude Code

Start an interactive Claude Code session with `claude`, then run:

```text
/plugin marketplace add Azure/azure-functions-skills
/plugin install azure-functions-skills@azure-functions-skills
```

#### Codex CLI

Add this repository as a plugin marketplace from your terminal:

```bash
codex plugin marketplace add Azure/azure-functions-skills
```

Then start Codex, run `/plugins`, select **azure-functions-skills**, and choose **Install plugin**.

> The [`@azure/functions-skills`](https://www.npmjs.com/package/@azure/functions-skills) npm package provides the companion CLI and the telemetry sender. Installing it does not install or launch a coding-agent plugin.

### 2. Verify your prerequisites

Ask your coding agent to run the `azure-functions-setup` skill. It checks the required Azure Functions tools and language runtimes, then guides you through installing or configuring anything that is missing.

### 3. Ask for Azure Functions help

Ask which Azure Functions workflow to use. `azure-functions-help` discovers the installed `azure-functions-*` skills and routes to the best match.

> **More options?** See [CLI Reference](docs/cli-reference.md) for every command, flag, and headless example.

## Companion CLI

The npm package includes a small CLI. The telemetry hooks use it to send events. You can also use it to list and apply Azure Functions templates:

```bash
npx @azure/functions-skills template list --language typescript
npx @azure/functions-skills template apply --template <id> --dir ./my-app
```

## Telemetry

Azure Functions Skills collects usage telemetry to understand which bundled skills and Azure Functions MCP tools are used. Events include allowlisted skill/tool names, relative allowlisted Azure Functions skill-file paths, client name, session id, and timestamp. Telemetry does **not** include file contents, prompts, raw tool arguments, credentials, or absolute paths. Events are sent by the `@azure/functions-skills` package directly to the Azure Functions team's Application Insights resource; the package does not use Azure MCP as a telemetry destination or transport.

To opt out, set either `AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY=false` or
`AZURE_MCP_COLLECT_TELEMETRY=false` in the environment.

## Skills

For contributor guidance on the product boundary between Azure Skills and Azure Functions Skills, see [Azure Skills and Azure Functions Skills Boundary](docs/azure-skills-boundary.md).

| Skill | Purpose |
| --- | --- |
| [`azure-functions-help`](templates/skills/azure-functions-help/SKILL.md) | Discover and route to the best Azure Functions skill |
| [`azure-functions-setup`](templates/skills/azure-functions-setup/SKILL.md) | Verify local prerequisites (Azure CLI, Core Tools, runtimes, Azure Skills) |
| [`azure-functions-create`](templates/skills/azure-functions-create/SKILL.md) | Create new Functions projects or add functions via Azure MCP templates |
| [`azure-functions-hosted-skills`](templates/skills/azure-functions-hosted-skills/SKILL.md) | Build cloud-hosted, event-driven intelligent capabilities with Markdown, Functions triggers, code, tools, HTTP, and MCP |
| [`azure-functions-deploy`](templates/skills/azure-functions-deploy/SKILL.md) | Prepare, validate, and deploy via Azure Skills with Functions-specific guidance |
| [`azure-functions-best-practices`](templates/skills/azure-functions-best-practices/SKILL.md) | Production-readiness review (config, security, reliability) |
| [`azure-functions-diagnostics`](templates/skills/azure-functions-diagnostics/SKILL.md) | Investigate deployment, runtime, trigger, binding, logging issues |
| [`azure-functions-health-status`](templates/skills/azure-functions-health-status/SKILL.md) | Collect current health, metrics, logs, Resource Health, Activity Log |
| [`azure-functions-inventory`](templates/skills/azure-functions-inventory/SKILL.md) | Collect app specification and configuration inventory |
| [`azure-functions-doctor`](templates/skills/azure-functions-doctor/SKILL.md) | Pre-deployment check of local code, configuration, and supply-chain risks |
| [`azure-functions-common`](templates/skills/azure-functions-common/SKILL.md) | Shared language, trigger, binding, extension, routing references |
| [`azure-functions-feedback`](templates/skills/azure-functions-feedback/SKILL.md) | Turn session findings into previewed issues or pull requests |

The `azure-functions-help` skill provides the discovery and routing entry point.

## Contributing

We welcome contributions. To add or improve a skill, edit the files under [`templates/skills/`](templates/skills/), then run `npm run build:plugin-payload` to regenerate the published plugin payload. The release process delivers the skill to all supported coding agents.

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

## Security

Report vulnerabilities to [secure@microsoft.com](mailto:secure@microsoft.com). See [SECURITY.md](SECURITY.md) for the threat model and our defense layers.

## License

[MIT](LICENSE)
