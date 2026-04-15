# F3: af-setup — Environment Verification

**Status:** 📋 Proposed  
**仮スペック Section:** 3.1, 4.1  
**Depends on:** F1 (Skill Graph Metadata)

## Problem

New Azure Functions developers often fail at the first step: their environment is missing Azure CLI, Core Tools, a language runtime, or the right versions. Debugging these prerequisites wastes time and discourages adoption. There's no single skill that verifies everything needed and guides the user through fixes.

## Feature

`af-setup` verifies that the developer's environment has all prerequisites for Azure Functions development and provides actionable fix instructions for anything missing.

## Checks

| Check | How | Pass Criteria |
|-------|-----|---------------|
| Azure CLI | `az --version` | Exits 0, version ≥ 2.60 |
| Core Tools | `func --version` | Exits 0, version ≥ 4.x |
| Node.js | `node --version` | Exits 0, version ≥ 18 (if Node project) |
| Python | `python --version` or `python3 --version` | Exits 0, version ≥ 3.9 (if Python project) |
| .NET SDK | `dotnet --version` | Exits 0, version ≥ 8.0 (if .NET project) |
| Java | `java --version` + `mvn --version` | Both exit 0 (if Java project) |
| Azure subscription | `az account show` | Exits 0, subscription active |
| Docker (optional) | `docker --version` | Exits 0 (only if containerized deployment planned) |

## Output Format

```
Azure Functions Environment Check

  ✅ Azure CLI          2.67.0
  ✅ Core Tools         4.0.6610
  ✅ Node.js            22.12.0
  ⚠️  Azure subscription  Not logged in
  ─── Optional ───
  ✅ Docker             27.4.0

Issues Found:
  ⚠️  Azure subscription: Run 'az login' to authenticate.
     Docs: https://learn.microsoft.com/cli/azure/authenticate-azure-cli

Next Steps:
  → af-create: Your environment is ready. Create a new Functions app.
```

## Skill Metadata

```yaml
id: af-setup
title: Azure Functions Setup
intent:
  - verify_tooling
  - onboard_user
  - check_prerequisites
completion_signals:
  - azure_cli_available
  - core_tools_available
  - language_runtime_detected
suggestions:
  on_success:
    - target: af-create
      reason: "The environment is ready. The next logical step is to create a new Azure Functions app."
      priority: 100
    - target: af-help
      reason: "If the user is unsure what to do next, provide guided options."
      priority: 60
  on_failure:
    - target: af-help
      reason: "Setup could not be completed. Route to troubleshooting guidance."
      priority: 100
entry_conditions:
  - user_is_new
  - tooling_unknown
```

## Behavior

### Language-Aware Checks

If the current directory contains a Functions project, `af-setup` detects the language and only checks relevant runtimes:

- `requirements.txt` or `function_app.py` → check Python
- `package.json` with `@azure/functions` → check Node.js
- `*.csproj` with `Microsoft.Azure.Functions.Worker` → check .NET SDK
- `pom.xml` with `azure-functions-maven-plugin` → check Java + Maven

If no project is detected, only Azure CLI and Core Tools are checked.

### Fix Instructions

Each failed check includes:

1. **What's wrong** — one-line description
2. **How to fix** — exact command to run
3. **Docs link** — Microsoft Learn URL for detailed instructions

### Idempotent

Running `af-setup` multiple times is safe. Already-passing checks are shown as ✅ without re-installation.

## Agent Workspace Configuration

環境チェック完了後、`af-setup` は検出されたコーディングエージェントに応じて AI 開発に必要なファイルを自動配置する（func-emulate F20 `fnx setup` の設計を採用）。

### Agent Detection

3 層の検出戦略:

| 検出レイヤー | 対象 | 方法 |
|------------|------|------|
| CLI バイナリ | Claude Code, Codex, Amp 等 | `which` / `where.exe` |
| IDE 設定ファイル | VSCode+Copilot, Cursor | `.vscode/`, `.cursor/` の存在確認 |
| 明示指定 | 全エージェント | ユーザーが指定 |

### Generated Files

検出されたエージェントに基づいて以下を配置:

| ファイル | 対象エージェント | 内容 |
|---------|----------------|------|
| `.github/copilot-instructions.md` | GitHub Copilot | Functions 固有のコーディングガイダンス |
| `.vscode/mcp.json` | GitHub Copilot | Templates MCP サーバー設定 (F19) |
| `.claude/settings.json` | Claude Code | MCP サーバー + プロジェクト設定 |
| `.cursor/rules/azure-functions.mdc` | Cursor | Functions ルール |
| `AGENTS.md` | Codex / 汎用 | エージェント非依存の指示 |

### Agent Path Mapping (from func-emulate manifest)

```yaml
agentPaths:
  shared:
    projectSkills: ".agents/skills"
    agents: [github-copilot, cursor, codex, cline, gemini-cli, opencode, amp]
  custom:
    claude-code:
      projectSkills: ".claude/skills"
      instructions: ".claude/CLAUDE.md"
      mcp: ".claude/settings.json"
    github-copilot:
      instructions: ".github/copilot-instructions.md"
      agentDefs: ".github/agents/"
      mcp: ".vscode/mcp.json"
    cursor:
      rules: ".cursor/rules/"
      mcp: ".cursor/mcp.json"
```

### Idempotency

- 既存ファイルは `--force` なしでは上書きしない
- MCP 設定はマージ方式（既存サーバー設定を保持し、Functions エントリを追加）
- 2回目以降の実行時は新しいモジュールのみ提案

### Content Tailoring

生成されるスキルファイル・指示ファイルの内容は検出されたプロジェクトに合わせてカスタマイズ:

- **言語固有パターン** — 検出されたランタイムの v2/v4/isolated パターン
- **SKU 制約** — ターゲット SKU でサポートされない機能の注意
- **利用可能な MCP ツール** — テンプレート MCP への参照

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Skill runs checks via shell commands, configures `.github/` + `.vscode/mcp.json` |
| Claude Code | Skill configures `.claude/` directory with skills, instructions, MCP |
| Codex | Agent instruction with prerequisite verification + `AGENTS.md` generation |
| Cursor | Skill configures `.cursor/rules/` and `.cursor/mcp.json` |
| Repo Template | Pre-flight check + agent config setup in `copilot-instructions.md` |
