# F19: MCP Integration — Template & Runtime MCP Server

**Status:** 📋 Proposed  
**仮スペック Section:** N/A (func-emulate F6/F10 から発見)  
**Depends on:** F1 (Skill Graph Metadata), F5 (af-create)

## Problem

AI コーディングエージェントが Azure Functions のテンプレートや関数メタデータにアクセスするには、現在2つの方法がある:

1. **スキルファイルにパターンを埋め込む** — 静的で、テンプレート更新時にスキルも更新が必要
2. **Web ドキュメントを検索する** — 遅く、不正確で、ハルシネーションのリスクがある

func-emulate は **MCP (Model Context Protocol) サーバー**を通じてこの問題を解決した: テンプレートカタログ、プロジェクトスキャフォールド、SKU プロファイルを MCP ツールとして公開し、AI エージェントがプログラマティックにアクセスできるようにした。

既に `azure-functions-templates-mcp-server` (Manvir Kaur 作) が存在し、4 言語 68+ テンプレートを MCP で提供している。`azure-functions-skills` はこのサーバーとの統合を設計し、全スキルから参照できるようにする必要がある。

## Feature

MCP サーバーとの統合設計。スキルが MCP ツールを活用してテンプレート検索・コード生成・SKU 互換性チェックを行えるようにする。

## Two Integration Layers

### Layer 1: Templates MCP (既存外部サーバー)

Azure Functions Templates MCP Server をスキルのエコシステムに組み込む。

**利用可能な MCP ツール:**

| Tool | 説明 | 利用スキル |
|------|------|-----------|
| `get_languages_list` | サポート言語一覧（ランタイムバージョン、テンプレート数） | af-create, af-help |
| `get_project_template` | プロジェクト初期化ファイル（host.json, package.json 等） | af-create |
| `get_templates_list` | 言語別テンプレート一覧（説明、カテゴリ） | af-create, af-help |
| `get_template` | テンプレートの完全なソースコード + 必要な app settings | af-create |
| `get_sku_profile` | SKU プロファイル（ホスト/バンドルバージョン） | af-hosting, af-audit |

**MCP 設定の自動生成:**

`af-setup` (F3) のワークスペース設定時に、検出されたエージェントに応じて MCP 設定を配置:

```json
// .vscode/mcp.json (GitHub Copilot)
{
  "servers": {
    "azure-functions-templates": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "azure-functions-templates-mcp-server"]
    }
  }
}
```

```json
// .claude/settings.json (Claude Code)
{
  "mcpServers": {
    "azure-functions-templates": {
      "command": "npx",
      "args": ["-y", "azure-functions-templates-mcp-server"]
    }
  }
}
```

### Layer 2: Core Tools MCP (将来構想)

`func` コマンド自体が MCP ツールを公開する将来の構想:

| Tool | 説明 | 状態 |
|------|------|------|
| `get_functions_list` | 実行中ホストの関数一覧（トリガー、ルート） | 将来 |
| `get_host_status` | ホスト状態（バージョン、PID、稼働時間） | 将来 |
| `invoke_function` | HTTP/非HTTP 関数の実行 | 将来 |
| `get_invocation_logs` | 最近の実行ログ | 将来 |

この層は `func start` の `/admin/functions` API をラップする形で実装可能。ただし、Core Tools 本体への変更が必要なため、初期リリースでは Layer 1 のみを対象とする。

## Skill × MCP Integration Matrix

各スキルが MCP ツールをどう活用するか:

| スキル | MCP ツール | 用途 |
|--------|-----------|------|
| **af-create** (F5) | `get_languages_list`, `get_templates_list`, `get_template`, `get_project_template` | テンプレート検索、コード生成、プロジェクトスキャフォールド |
| **af-help** (F2) | `get_languages_list`, `get_templates_list` | 利用可能なテンプレート一覧の表示 |
| **af-hosting** (F8) | `get_sku_profile` | SKU 別の制約情報取得 |
| **af-audit** (F18) | `get_sku_profile` | SKU 互換性チェック |
| **af-discovery** (F4) | `get_sku_profile` | 検出された SKU の詳細情報 |

## MCP Availability Detection

スキルは MCP ツールが利用可能かどうかを検出し、利用可能なら MCP 経由、不可能なら埋め込みパターンにフォールバックする:

```
MCP ツール利用可能?
├── Yes → MCP 経由でテンプレート取得（最新、正確）
└── No → スキル内蔵のパターン/例を使用（静的だが信頼性高い）
```

スキルは MCP 前提で設計するが、**MCP がなくても機能する**ようにフォールバックを常に持つ。

## Build Integration (F14)

ビルドシステムは各ターゲットの MCP 設定ファイルを生成:

| ターゲット | 出力ファイル | フォーマット |
|-----------|------------|------------|
| GHCP | `.vscode/mcp.json` | `{ "servers": { ... } }` |
| Claude Code | `.claude/settings.json` | `{ "mcpServers": { ... } }` |
| Cursor | `.cursor/mcp.json` | `{ "mcpServers": { ... } }` |
| Codex | `codex-mcp.json` | Agent-specific format |

## Skill Metadata

```yaml
id: af-mcp
title: MCP Server Integration
intent:
  - configure_mcp
  - connect_templates
  - enable_ai_tools
completion_signals:
  - mcp_configured
  - templates_accessible
suggestions:
  on_success:
    - target: af-create
      reason: "MCP is configured. Create functions using template tools."
      priority: 100
    - target: af-help
      reason: "Explore what the MCP tools can do."
      priority: 60
  on_failure:
    - target: af-setup
      reason: "MCP configuration failed. Check environment setup."
      priority: 80
entry_conditions:
  - mcp_not_configured
  - ai_agent_detected
```

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | MCP 設定を `.vscode/mcp.json` に配置。スキルが MCP ツール呼び出しを指示 |
| Claude Code | MCP 設定を `.claude/settings.json` に配置 |
| Codex | MCP 設定をエージェント定義に含める |
| Repo Template | MCP 設定テンプレートを repo template に含める |
