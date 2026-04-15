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
  Files written: 9

  Skills available:
    • azure-functions-setup  — Verify prerequisites
    • azure-functions-create — Scaffold a new project
    • azure-functions-deploy — Deploy to Azure

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
   → Run azure-functions-deploy to deploy your app to Azure
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

```javascript
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

## What You Get

| Skill | Description |
|-------|-------------|
| **azure-functions-setup** | Verify prerequisites (Azure CLI, Core Tools, runtime) |
| **azure-functions-create** | Scaffold a new Azure Functions project |
| **azure-functions-deploy** | Deploy to Azure using official tools |

Plus:
- **functions-guide** agent — routes you to the right skill based on context
- **Welcome hook** — first-run prerequisite check + onboarding
- **MCP integration** — Azure Functions Templates + Azure MCP servers
- **AGENTS.md** — coding standards (linter, TDD, security, self-review)

## What Gets Installed

### GitHub Copilot

**Workspace files** (copied to your project):
```
.github/copilot-instructions.md           # Always-on instructions + welcome
.github/agents/functions-guide.agent.md    # @functions-guide custom agent
.github/skills/azure-functions-setup/SKILL.md          # Setup skill (Agent Skills standard)
.github/skills/azure-functions-create/SKILL.md         # Create skill
.github/skills/azure-functions-deploy/SKILL.md         # Deploy skill
.github/hooks/welcome-setup.json          # SessionStart: prereq check + welcome
.vscode/mcp.json                          # Azure Functions Templates + Azure MCP
AGENTS.md                                 # Coding standards
```

**Plugin format** (installable via `Chat: Install Plugin From Source`):
```
plugin.json                               # Plugin manifest
skills/af-*/SKILL.md                      # Plugin-level skills
agents/functions-guide.agent.md           # Plugin-level agent
hooks.json                                # Plugin hooks (Copilot format)
.mcp.json                                 # Plugin MCP servers (mcpServers key)
```

### Claude Code

```
CLAUDE.md                            # Full instructions + skills inline
.claude/settings.json                # MCP server configuration
.claude/skills/azure-functions-setup.md           # Setup skill
.claude/skills/azure-functions-create.md          # Create skill
.claude/skills/azure-functions-deploy.md          # Deploy skill
```

### Codex (OpenAI)

```
AGENTS.md                            # Workspace instructions + coding standards
.codex-plugin/plugin.json            # Plugin manifest
.mcp.json                            # MCP server config (plugin format)
.agents/plugins/marketplace.json     # Local marketplace
.agents/skills/af-*/SKILL.md         # Workspace-level skills
skills/af-*/SKILL.md                 # Plugin-level skills
.codex/config.toml                   # MCP server config (workspace format)
.codex/hooks.json                    # SessionStart: welcome + prereq check
```

## Demo: setup → create → deploy

After installing the plugin for your preferred agent:

1. **Open your project** in VS Code (Copilot), terminal (Claude/Codex), or your IDE
2. **The welcome hook fires** — checks your environment and suggests next steps
3. **Say** *"I want to create a new Azure Function"*
   - The agent runs **azure-functions-setup** checks
   - Then guides you through **azure-functions-create** (language + trigger selection)
   - Finally suggests **azure-functions-deploy** to push to Azure
4. Each step surfaces the **next logical action** from the skill graph

## Development

### Prerequisites

- Node.js ≥ 18

### Setup

```bash
npm ci
```

### Test (TDD)

```bash
npm test          # run once
npm run test:watch  # watch mode
```

### Build

```bash
npm run build                     # all targets
npm run build -- --target ghcp    # single target
```

Output goes to `dist/`:
```
dist/
├── ghcp/     # GitHub Copilot plugin
├── claude/   # Claude Code plugin
└── codex/    # Codex plugin
```

### Architecture

```
src/
├── skills/              # Canonical skill definitions
│   ├── azure-functions-setup/        #   skill.yaml + graph.yaml + content.md
│   ├── azure-functions-create/
│   └── azure-functions-deploy/
├── agents/              # Agent definitions
│   ├── AGENTS.md        #   Coding standards
│   └── functions-guide.agent.md
├── hooks/               # Lifecycle hooks
│   └── welcome-setup.md #   First-run welcome + prereq check
├── mcp/                 # MCP server definitions
│   └── servers.yaml
└── build/               # Build system
    ├── build.js         #   Entry point
    ├── loader.js        #   Canonical source loader
    └── build-target.js  #   Per-target generators
```

The build system reads canonical sources and generates target-specific artifacts. Each skill has:
- `skill.yaml` — metadata (id, title, description, category, targets)
- `graph.yaml` — directed graph edges (next-step suggestions on success/failure)
- `content.md` — skill body (target-agnostic instructions)

### CI/CD

The GitHub Actions workflows:

- **Build** (`.github/workflows/build-plugins.yml`) — runs on every push/PR to `main`:
  1. Install dependencies
  2. Run tests
  3. Build all three plugin targets
  4. Upload artifacts

- **Publish** (`.github/workflows/publish.yml`) — runs on version tags (`v*`):
  1. Run tests + build
  2. Publish to npm as `@agent-loom/azure-functions-skills`

To release:
```bash
npm version patch   # or minor / major
git push --follow-tags
```

## Specification

See [docs/prd-docs/](docs/prd-docs/) for detailed feature requirement documents.

## License

MIT
