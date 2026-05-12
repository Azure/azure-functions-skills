# Azure Functions Skills

[![npm](https://img.shields.io/npm/v/@agent-loom/azure-functions-skills)](https://www.npmjs.com/package/@agent-loom/azure-functions-skills)

AI assistant plugins for Azure Functions — **one command** to set up GitHub Copilot, Claude Code, or Codex with a guided `setup → create → deploy` workflow.

## Quick Start

```bash
# In your Azure Functions project (or any empty directory):
npx @agent-loom/azure-functions-skills setup
```

Or install globally:

```bash
npm install -g @agent-loom/azure-functions-skills
azure-functions-skills setup
```

The CLI auto-detects which coding agents you have (GitHub Copilot, Claude Code, Codex) and installs the right files.

```
🔍 Detecting coding agents...
  Found: ghcp, claude

📁 Installing to: /home/user/my-functions-app

⚡ Azure Functions Skills installed!

  Agents configured: ghcp, claude
  Files written: <count>

  Skills available:
    • azure-functions-common — Azure Functions Common References
    • azure-functions-best-practices — Azure Functions Best Practices Review
    • azure-functions-create — Create Azure Functions App
    • azure-functions-deploy — Deploy Azure Functions
    • azure-functions-diagnostics — Azure Functions Diagnostics
    • azure-functions-health-status — Azure Functions Health Status
    • azure-functions-inventory — Azure Functions Inventory
    • azure-functions-setup — Azure Functions Setup

  Get started: Ask your AI assistant to "set up Azure Functions"
```

### Specify Agents Manually

```bash
npx @agent-loom/azure-functions-skills setup --agent ghcp
npx @agent-loom/azure-functions-skills setup --agent claude --agent codex
npx @agent-loom/azure-functions-skills setup --dir ./my-app
```

### Launch with Welcome Prompt (`chat`)

Start a CLI coding agent with Azure Functions context and a Welcome message:

```bash
npx @agent-loom/azure-functions-skills chat
```

The CLI auto-detects your agent (GHCP CLI / Claude Code / Codex), analyzes your project, and launches the agent with a startup prompt:

```
🔍 Detecting CLI coding agents...
  Using: claude-code

🚀 Launching claude-code with Azure Functions context...

⚡ Azure Functions Skills
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📂 Functions project detected (node)
🧩 Skills: azure-functions-setup, azure-functions-create, azure-functions-deploy

🚀 Suggested next steps:
  → Run azure-functions-deploy to deploy your app to Azure through Azure Skills
  → Ensure the Azure Skills plugin is installed for prepare/validate/deploy workflows
   → Run azure-functions-create to add another function

💬 What would you like to build?
```

Specify an agent or custom prompt:

```bash
npx @agent-loom/azure-functions-skills chat --agent github-copilot
npx @agent-loom/azure-functions-skills chat --agent codex --dir ./my-app
npx @agent-loom/azure-functions-skills chat --prompt "Create an HTTP trigger function"
```

### Use as a Library (VS Code Extension)

```typescript
// Setup API
import { applySetup, detectAgents } from '@agent-loom/azure-functions-skills';

const agents = await detectAgents();  // ['ghcp', 'claude']
const result = await applySetup('/path/to/project', { agents });
console.log(result.welcomeMessage);

// Chat API — launch an agent with Welcome prompt
import { chat, buildStartupPrompt, detectCliAgents } from '@agent-loom/azure-functions-skills/chat';

const cliAgents = await detectCliAgents();
const { childProcess, prompt } = await chat({ agent: 'claude-code', dir: '/path/to/project' });
```

### Install as a plugin from GitHub

Released plugin payloads are committed under `.github/plugins/azure-functions-skills/`, so agents that support Git-backed plugins can install directly from this repository or from the marketplace manifests in `.plugin/marketplace.json` and `.claude-plugin/marketplace.json`.

For GitHub Copilot CLI / Codex-style marketplace flows:

```bash
copilot plugin marketplace add Azure/azure-functions-skills
copilot plugin install azure-functions-skills@azure-functions-skills
```

For VS Code, use **Chat: Install Plugin From Source** and point it at the repository or the plugin payload path:

```text
Azure/azure-functions-skills:.github/plugins/azure-functions-skills
```

### Download release zip (plugin bundle)

Release zips are optional convenience artifacts. For direct install/update, prefer the Git-backed plugin flow above or the filtered workspace install with `setup`.

Download the plugin payload zip from [GitHub Releases](https://github.com/Azure/azure-functions-skills/releases):

- `azure-functions-skills-plugin-{version}.zip` — cross-tool plugin payload

Extract it into a stable plugin directory:

```bash
mkdir -p ~/.azure-functions-skills/plugins
unzip azure-functions-skills-plugin-{version}.zip -d ~/.azure-functions-skills/plugins

# PowerShell
$pluginRoot = Join-Path $env:LOCALAPPDATA "AzureFunctionsSkills\plugins"
New-Item -ItemType Directory -Path $pluginRoot -Force | Out-Null
Expand-Archive azure-functions-skills-plugin-{version}.zip -DestinationPath $pluginRoot
```

Register the extracted plugin directory with your agent's plugin-from-source flow.

## What You Get

| Skill | Description |
| --- | --- |
| **azure-functions-common** | Shared language, runtime, trigger, binding, and extension references for the suite |
| **azure-functions-best-practices** | Review existing Function Apps against Azure Functions best practices and guide approved remediations |
| **azure-functions-create** | Scaffold a new Azure Functions project with language and template selection |
| **azure-functions-deploy** | Azure Functions-facing proxy to Azure Skills deployment (`azure-prepare` → `azure-validate` → `azure-deploy`) |
| **azure-functions-diagnostics** | Diagnose deployment failures, runtime errors, trigger/binding failures, telemetry issues, and related incidents |
| **azure-functions-health-status** | Inspect current app state, Resource Health, metrics, Application Insights/Log Analytics signals, and recent Activity Log |
| **azure-functions-inventory** | Collect app specifications and configuration inventory without runtime-health analysis |
| **azure-functions-setup** | Verify prerequisites and set up the local Azure Functions development environment |

Plus:

- **functions-copilot** agent — routes you to the right skill based on context
- **Welcome hook** — first-run prerequisite check + onboarding
- **MCP integration** — Azure Functions Templates + Azure MCP servers
- **AGENTS.md** — coding standards (linter, TDD, security, self-review)

## What Gets Installed

### GitHub Copilot

**Workspace files** (copied to your project):
```
.github/copilot-instructions.md           # Always-on instructions + welcome
.github/agents/functions-copilot.agent.md  # @functions-copilot custom agent
.github/skills/{skill-id}/SKILL.md         # Agent Skills standard; one directory per skill
.github/skills/{skill-id}/references/      # Optional supporting references
.github/skills/{skill-id}/scripts/         # Optional helper scripts
.github/hooks/welcome-setup.json          # SessionStart: prereq check + welcome
.vscode/mcp.json                          # Azure Functions Templates + Azure MCP
AGENTS.md                                 # Coding standards
```

**Plugin format** (generated into `dist/plugin/azure-functions-skills/` and committed at `.github/plugins/azure-functions-skills/`; not copied by `setup`):
```
.plugin/plugin.json                        # Copilot/OpenPlugin manifest
plugin.json                               # Plugin manifest
skills/{skill-id}/SKILL.md                # Plugin-level skills
agents/functions-copilot.agent.md         # Plugin-level agent
hooks.json                                # Plugin hooks (Copilot format)
.mcp.json                                 # Plugin MCP servers (mcpServers key)
.claude-plugin/plugin.json                # Claude-compatible manifest
.codex-plugin/plugin.json                 # Codex-compatible manifest
```

### Claude Code

```
CLAUDE.md                                        # Full instructions + skills inline
.claude/settings.json                            # MCP server configuration
.claude/skills/{skill-id}/SKILL.md                # One directory per skill
.claude/skills/{skill-id}/references/             # Optional supporting references
.claude/skills/{skill-id}/scripts/                # Optional helper scripts
```

### Codex (OpenAI)

**Workspace files** (copied to your project):
```
AGENTS.md                            # Workspace instructions + coding standards
.agents/skills/{skill-id}/SKILL.md    # Workspace-level skills
.codex/config.toml                   # MCP server config (workspace format)
.codex/hooks.json                    # SessionStart: welcome + prereq check
```

Codex plugin distribution uses the common plugin payload at `.github/plugins/azure-functions-skills/` or `dist/plugin/azure-functions-skills/`.

## Demo: setup → create → deploy

After installing the workspace files or registering the plugin for your preferred agent:

1. **Open your project** in VS Code (Copilot), terminal (Claude/Codex), or your IDE
2. **The welcome hook fires** — checks your environment and suggests next steps
3. **Say** *"I want to create a new Azure Function"*
   - The agent runs **azure-functions-setup** checks
   - Then guides you through **azure-functions-create** (language + trigger selection)
   - Finally suggests **azure-functions-deploy** to push to Azure
4. Each skill surfaces the **next logical action** from its `SKILL.md` guidance

## Development

### Prerequisites

- Node.js ≥ 18

### Setup

Run this once after cloning the repository, and any time `node_modules/` is removed:

```bash
npm ci
```

`npm ci` installs the development tools used by the scripts, including TypeScript's `tsc` command.

### Test (TDD)

```bash
npm run lint             # ESLint for TypeScript and JavaScript
npm run typecheck        # TypeScript strict typecheck for src/ and tests/
npm test                 # run once
npm run test:watch       # watch mode
npm run validate:skills  # validate canonical skill templates
npm run verify:plugin-payload # verify committed plugin payload is in sync
npm run check            # lint + typecheck + validate + test + build
```

`npm run ci` is kept as an alias for CI systems, but `npm run check` is the clearer local command.

### Build

```bash
npm run build                     # all targets
npm run build -- --target ghcp    # single target
npm run build:plugin-payload      # update committed plugin payload + marketplaces
```

Output goes to `dist/`:
```
dist/
├── workspace/
│   ├── ghcp/     # GitHub Copilot workspace layout
│   ├── claude/   # Claude Code workspace layout
│   └── codex/    # Codex workspace layout
└── plugin/
  └── azure-functions-skills/ # self-contained plugin payload
```

The release-ready plugin payload is also generated into `.github/plugins/azure-functions-skills/` by `npm run build:plugin-payload`. Do not edit that generated directory by hand; update `templates/` and regenerate it.

### Add a new skill

Scaffold the required skill file:

```bash
npm run new:skill -- azure-functions-my-skill \
  --title "Azure Functions My Skill" \
  --description "Guidance for my Azure Functions workflow"
```

Before opening a PR, complete this checklist:

- Update `templates/skills/<skill-id>/SKILL.md` frontmatter metadata (`name`, `title`, `description`, `category`).
- Write `templates/skills/<skill-id>/SKILL.md` workflow instructions and any next-step guidance.
- Add optional `references/` or `scripts/` content if the skill needs supporting files.
- Run `npm run validate:skills` to catch missing files and frontmatter ID mismatches.
- Run `npm run check` to verify lint, typecheck, validation, tests, and build.
- Run `npm pack --dry-run` before release-related changes to inspect package contents.

### Architecture

```
src/                     # CLI / builder source code (TypeScript)
└── build/               # Build system
    ├── build.ts         #   Entry point
    ├── loader.ts        #   Canonical source loader
    ├── validate-skills.ts # Skill template validator
    └── build-target.ts  #   Per-target generators
lib/                     # Compiled runtime output used by package exports and CLI

.github/plugins/azure-functions-skills/ # Generated release plugin payload committed on release
.plugin/marketplace.json                 # Generated Copilot marketplace manifest
.claude-plugin/marketplace.json          # Generated Claude marketplace manifest

templates/               # Canonical plugin content (edited by hand)
├── skills/              # Canonical skill definitions
│   ├── azure-functions-common/       #   SKILL.md + references/
│   ├── azure-functions-create/       #   includes references/
│   ├── azure-functions-deploy/
│   ├── azure-functions-diagnostics/  #   includes references/
│   ├── azure-functions-health-status/ #   includes references/ and scripts/
│   ├── azure-functions-inventory/    #   includes references/ and scripts/
│   └── azure-functions-setup/
├── agents/              # Agent definitions
│   ├── AGENTS.md        #   Coding standards
│   └── functions-copilot.agent.md
├── hooks/               # Lifecycle hooks
│   └── welcome-setup.md #   First-run welcome + prereq check
├── mcp/                 # MCP server definitions
│   └── servers.yaml
└── prompts/             # Chat startup prompts
    └── startup.md
```

The build system reads canonical sources and generates workspace-specific artifacts plus a self-contained plugin payload. Each skill has:
- `SKILL.md` — YAML frontmatter metadata plus target-agnostic workflow instructions
- optional `references/` and `scripts/` directories copied into every target artifact

### CI/CD

The GitHub Actions workflows:

- **Build** (`.github/workflows/build-plugins.yml`) — runs on every push/PR to `main`:
  1. Install dependencies
  2. Run lint
  3. Run TypeScript typecheck
  4. Validate skill templates
  5. Run tests
  6. Verify committed plugin payload is in sync
  7. Build workspace and plugin artifacts
  8. Upload artifacts

- **Publish** (`.github/workflows/publish.yml`) — intentionally disabled. The workflow is kept as documentation/reference only because the repository permissions do not allow it to complete reliably.

### Local release

Use the local release helper from a clean `main` checkout. It validates `main`, checks that the disabled publish workflow will not run on tag push, bumps the package version when needed, regenerates the committed plugin payload and marketplace manifests, runs validation, creates the tag, publishes to npm, pushes the tag, and best-effort creates a GitHub Release with a plugin payload zip.

```bash
npm run release:local -- 0.12.0 --yes
```

Useful options:

- `--dry-run` — print mutating commands without running them.
- `--github-account <user>` — switch GitHub CLI account before creating the Release.
- `--skip-github-release` — publish npm and push the tag without creating a Release.
- `--require-github-release` — fail instead of skipping when GitHub Release creation is unavailable.

Prerequisites for a full release:

- `npm whoami` is authenticated with permission to publish `@agent-loom/azure-functions-skills`.
- `gh auth status` is authenticated with permission to create releases in `Azure/azure-functions-skills`.
- On non-Windows platforms, `zip` is available for packaging Release assets.

## Specification

See [docs/prd-docs/](docs/prd-docs/) for detailed feature requirement documents.

## License

MIT
