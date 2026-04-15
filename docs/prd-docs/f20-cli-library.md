# F20: CLI & Library — Setup + Chat Commands

**Status:** ✅ Implemented  
**仮スペック Section:** N/A (func-emulate F20 `fnx setup` / `fnx chat` から発展)  
**Depends on:** F14 (Build System)

## Problem

スキル・エージェント・MCP・フックのファイルを手動でコピーするのは面倒で間違いやすい。また、CLI コーディングエージェント (GHCP CLI, Claude Code, Codex) を起動する際に、Azure Functions 固有のコンテキストやWelcome メッセージを自動的に渡す仕組みがない。

VS Code Chat ウインドウでは `SessionStart` hook の `additionalContext` はモデルに注入されるだけでユーザーには見えない。CLI エージェントでは起動時にプロンプトを引数として渡すことで、Welcome メッセージをチャットに表示できる（func-emulate F20 で実証済み）。

## Feature

### npm パッケージ: `@agent-loom/azure-functions-skills`

2つの使い方を提供:

#### 1. CLI ツール

```bash
# スキル・エージェント・MCP・フックをプロジェクトに配置
npx @agent-loom/azure-functions-skills setup

# CLI エージェントを Welcome 付きで起動
npx @agent-loom/azure-functions-skills chat

# プラグインアーティファクトをビルド
npx @agent-loom/azure-functions-skills build
```

#### 2. ライブラリ (VS Code Extension 等から利用)

```javascript
// Setup API
import { applySetup, detectAgents } from '@agent-loom/azure-functions-skills';
const result = await applySetup('/path/to/project', { agents: ['ghcp'] });

// Chat API
import { chat, buildStartupPrompt, detectCliAgents } from '@agent-loom/azure-functions-skills/chat';
const result = await chat({ agent: 'claude-code', dir: '/path/to/project' });
```

## Commands

### `setup` — ワンコマンドインストール

```
azure-functions-skills setup [--agent <name>] [--dir <path>]
```

1. コーディングエージェントを検知（GHCP, Claude, Codex）
2. ターゲットごとのファイルを生成・配置
3. Welcome メッセージを表示

**生成ファイル:**

| Target | Files |
|--------|-------|
| GHCP | `copilot-instructions.md`, `skills/`, `hooks/`, `agents/`, `mcp.json`, `plugin.json` |
| Claude | `CLAUDE.md`, `settings.json`, `skills/` |
| Codex | `AGENTS.md`, `plugin.json`, `skills/`, `config.toml`, `hooks.json`, `marketplace.json` |

### `chat` — エージェント起動 + Welcome プロンプト

```
azure-functions-skills chat [--agent <name>] [--prompt <text>] [--dir <path>]
```

1. CLI エージェントを検知（`copilot`, `claude`, `codex`）
2. プロジェクトを分析（host.json, 言語検知）
3. startup-prompt.md をテンプレート展開
4. エージェントを `spawn()` で起動し、プロンプトを引数として渡す

**Startup Prompt テンプレート:**

```markdown
⚡ Azure Functions Skills
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📂 {{projectContext}}
🧩 Skills: {{skillList}}

{{suggestedActions}}

💬 What would you like to build?
```

**エージェントへの渡し方:**

| Agent | コマンド |
|-------|---------|
| GHCP CLI | `copilot -i "<prompt>"` |
| Claude Code | `claude "<prompt>"` |
| Codex | `codex "<prompt>"` |

### `build` — プラグインアーティファクト生成

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

## Welcome メッセージの表示方法まとめ

| Surface | 方法 | Welcome 表示 |
|---------|------|-------------|
| CLI (`chat` コマンド) | 起動時プロンプト引数 | ✅ チャットに表示される |
| VS Code Chat | `SessionStart` hook `additionalContext` | ⚠️ モデルに注入のみ（ユーザーには見えない）|
| VS Code Chat (代替) | `copilot-instructions.md` に「最初の応答で Welcome を返せ」と指示 | ⚠️ AI の判断次第 |
| VS Code Chat (代替) | `systemMessage` で警告バナー | ⚠️ バナーとして表示（チャットメッセージではない）|

## Cross-Target Implementation

すべてのコマンドは Node.js ESM で実装。依存関係ゼロ（Node.js 18+ 標準 API のみ）。

| 用途 | import |
|------|--------|
| CLI | `npx @agent-loom/azure-functions-skills <command>` |
| Library (setup) | `import { applySetup } from '@agent-loom/azure-functions-skills'` |
| Library (chat) | `import { chat } from '@agent-loom/azure-functions-skills/chat'` |
| VS Code Extension | Library API を呼び出し |
