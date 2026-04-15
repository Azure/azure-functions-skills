# F20: CLI & Library — Setup + Chat Commands

**Status:** ✅ Implemented  
**Draft Spec Section:** N/A (evolved from func-emulate F20 `fnx setup` / `fnx chat`)  
**Depends on:** F14 (Build System)

## Problem

Manually copying skill, agent, MCP, and hook files is tedious and error-prone. Additionally, when launching CLI coding agents (GHCP CLI, Claude Code, Codex), there's no mechanism to automatically pass Azure Functions-specific context or Welcome messages.

In VS Code Chat windows, the `SessionStart` hook's `additionalContext` is only injected into the model and not visible to the user. In CLI agents, a startup prompt can be passed as an argument, displaying the Welcome message in the chat (proven in func-emulate F20).

## Feature

### npm package: `@agent-loom/azure-functions-skills`

Provides two usage modes:

#### 1. CLI Tool

```bash
# Place skills, agents, MCP, and hooks into a project
npx @agent-loom/azure-functions-skills setup

# Launch a CLI agent with Welcome message
npx @agent-loom/azure-functions-skills chat

# Build plugin artifacts
npx @agent-loom/azure-functions-skills build
```

#### 2. Library (for use from VS Code Extensions, etc.)

```javascript
// Setup API
import { applySetup, detectAgents } from '@agent-loom/azure-functions-skills';
const result = await applySetup('/path/to/project', { agents: ['ghcp'] });

// Chat API
import { chat, buildStartupPrompt, detectCliAgents } from '@agent-loom/azure-functions-skills/chat';
const result = await chat({ agent: 'claude-code', dir: '/path/to/project' });
```

## Commands

### `setup` — One-command install

```
azure-functions-skills setup [--agent <name>] [--dir <path>]
```

1. Detect coding agents (GHCP, Claude, Codex)
2. Generate and place target-specific files
3. Display Welcome message

**Generated Files:**

| Target | Files |
|--------|-------|
| GHCP | `copilot-instructions.md`, `skills/`, `hooks/`, `agents/`, `mcp.json`, `plugin.json` |
| Claude | `CLAUDE.md`, `settings.json`, `skills/` |
| Codex | `AGENTS.md`, `plugin.json`, `skills/`, `config.toml`, `hooks.json`, `marketplace.json` |

### `chat` — Agent launch + Welcome prompt

```
azure-functions-skills chat [--agent <name>] [--prompt <text>] [--dir <path>]
```

1. Detect CLI agents (`copilot`, `claude`, `codex`)
2. Analyze project (host.json, language detection)
3. Expand startup-prompt.md template
4. Launch agent via `spawn()` and pass prompt as argument

**Startup Prompt Template:**

```markdown
⚡ Azure Functions Skills
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📂 {{projectContext}}
🧩 Skills: {{skillList}}

{{suggestedActions}}

💬 What would you like to build?
```

**Passing to agents:**

| Agent | Command |
|-------|---------|
| GHCP CLI | `copilot -i "<prompt>"` |
| Claude Code | `claude "<prompt>"` |
| Codex | `codex "<prompt>"` |

### `build` — Plugin artifact generation

```
azure-functions-skills build [--target <name>]
```

## Library API

### Setup module (`@agent-loom/azure-functions-skills`)

```typescript
// Detect installed coding agents
detectAgents(): Promise<string[]>

// Apply skill files to a target directory
applySetup(targetDir: string, options?: { agents?: string[] }): Promise<{
  agents: string[],
  filesWritten: number,
  welcomeMessage: string
}>
```

### Chat module (`@agent-loom/azure-functions-skills/chat`)

```typescript
// Detect installed CLI coding agents
detectCliAgents(): Promise<Array<{ id: string, command: string, description: string }>>

// Build startup prompt from template + project context
buildStartupPrompt(dir: string): Promise<string>

// Launch a CLI agent with startup prompt
chat(options?: {
  agent?: string,
  prompt?: string,
  dir?: string
}): Promise<{ childProcess: ChildProcess, agent: string, prompt: string }>

// Launcher configurations (for custom integrations)
LAUNCHERS: Record<string, { command: string, buildArgs: (ctx) => string[], description: string }>
```

## Welcome Message Display Methods Summary

| Surface | Method | Welcome Display |
|---------|--------|----------------|
| CLI (`chat` command) | Startup prompt argument | ✅ Displayed in chat |
| VS Code Chat | `SessionStart` hook `additionalContext` | ⚠️ Injected into model only (not visible to user) |
| VS Code Chat (alt) | Instruct in `copilot-instructions.md` to "return Welcome on first response" | ⚠️ At the AI's discretion |
| VS Code Chat (alt) | Warning banner via `systemMessage` | ⚠️ Displayed as banner (not a chat message) |

## Cross-Target Implementation

All commands are implemented in Node.js ESM. Zero dependencies (Node.js 18+ standard APIs only).

| Use | Import |
|-----|--------|
| CLI | `npx @agent-loom/azure-functions-skills <command>` |
| Library (setup) | `import { applySetup } from '@agent-loom/azure-functions-skills'` |
| Library (chat) | `import { chat } from '@agent-loom/azure-functions-skills/chat'` |
| VS Code Extension | Call Library API |
