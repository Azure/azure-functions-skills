# F16: af-doctor — Project Diagnostics

**Status:** 📋 Proposed  
**仮スペック Section:** N/A (func-emulate F18 + fnx-diagnostics から発見)  
**Depends on:** F1 (Skill Graph Metadata), F3 (af-setup)

## Problem

`af-setup` (F3) は初回の環境チェック（Azure CLI, Core Tools, ランタイムの存在確認）を担うが、**開発中に `func start` が失敗した時の診断**は全く別の責務である。

`func start` の失敗原因は多岐にわたる:

- `host.json` の構文エラーや不正なバージョン指定
- `local.settings.json` の欠落や不正な JSON
- ポート 7071 が既に使用中
- ランタイムバージョンの不一致（Python 3.8 で v2 model を使おうとする等）
- Extension Bundle のダウンロード失敗
- Azurite/ストレージエミュレータが未起動（Blob/Queue トリガー使用時）
- Worker ランタイムの設定不足（`FUNCTIONS_WORKER_RUNTIME` 未設定）
- `.NET` in-process プロジェクトの誤検知

開発者はこれらを手動で1つずつ調査するしかなく、初心者ほど原因特定に時間がかかる。

## Feature

`af-doctor` は、Azure Functions プロジェクトの健全性を構造化された 8 カテゴリでチェックし、各問題に対してアクション可能な修正提案を返す診断スキル。

`af-setup` との違い:

| 観点 | af-setup (F3) | af-doctor (F16) |
|------|-------------|----------------|
| **タイミング** | 開発開始前（初回セットアップ） | 問題発生時（開発中） |
| **対象** | グローバルツールの存在確認 | プロジェクト固有の設定・状態 |
| **出力** | "環境 Ready / Not Ready" | "8 カテゴリ × Pass/Warn/Fail + 修正手順" |
| **繰り返し** | 1回やれば十分 | 問題のたびに実行 |

## Diagnostic Checks

| # | カテゴリ | Pass | Warn | Fail |
|---|---------|------|------|------|
| 1 | `host.json` | 存在し、`version: "2.0"` | 不正なバージョン | 欠落 or JSON パースエラー |
| 2 | `local.settings.json` | 存在し、有効な JSON | 欠落（一部動作可） | JSON パースエラー |
| 3 | Worker ランタイム | `FUNCTIONS_WORKER_RUNTIME` 設定済み | — | 未設定 or 不正な値 |
| 4 | ランタイムバージョン | インストール済み、Functions サポート範囲内 | EOL 間近のバージョン | 未インストール or サポート外 |
| 5 | Extension Bundle | `host.json` に設定あり、ダウンロード済み | 古いバージョン範囲 | ダウンロード失敗、範囲不正 |
| 6 | ポート可用性 | 7071 が使用可能 | — | ポート使用中 |
| 7 | Azurite / ストレージ | 起動中（Storage トリガー使用時のみ） | インストール済みだが未起動 | Storage トリガーあるのに未インストール |
| 8 | セキュリティ | 秘密値が `local.settings.json` のみ | — | ソースコードや設定ファイルに秘密値検出 |

## Output Format

```
Azure Functions Project Diagnostics

  ✅ host.json           version 2.0, valid
  ✅ local.settings.json valid JSON, 5 settings
  ✅ Worker runtime      python (from local.settings.json)
  ⚠️  Runtime version     Python 3.9 — EOL October 2025, upgrade to 3.11+
  ✅ Extension bundle     [4.*, 5.0.0) — cached
  ✅ Port 7071           available
  ⚠️  Azurite             installed but not running (blob_trigger detected)
  ✅ Security             no secrets in tracked files

Issues Found:
  ⚠️  Runtime version: Python 3.9 reaches EOL October 2025.
     Fix: Install Python 3.11+ and update FUNCTIONS_WORKER_RUNTIME_VERSION.
     Docs: https://learn.microsoft.com/azure/azure-functions/functions-reference-python

  ⚠️  Azurite: blob_trigger detected but Azurite is not running.
     Fix: Run 'azurite --silent' or 'npx azurite --silent' in another terminal.
     Docs: https://learn.microsoft.com/azure/storage/common/storage-use-azurite

Summary: 0 errors, 2 warnings, 6 passed

Next Steps:
  → Fix warnings and run 'func start'
```

## Diagnostic Workflow (for AI agents)

```
Step 1: Run af-doctor checks
  → Collect all 8 category results

Step 2: If func start fails, reproduce with verbose output
  → func start --verbose 2>&1

Step 3: Parse error output for known patterns
  → "WorkerConfig for runtime: X not found" → ランタイム設定問題
  → "0 functions loaded" → Worker indexing 未有効化 (Python v2)
  → "Port X in use" → ポート競合
  → "No job functions found" → function 検出失敗

Step 4: Read project config files for root cause
  → host.json, local.settings.json, package.json/requirements.txt/*.csproj

Step 5: Provide fix with exact command and docs link
```

## Common Error Patterns

| エラーメッセージ | 原因 | 修正 |
|----------------|------|------|
| `No job functions found` | Worker indexing 未有効化 | `FUNCTIONS_WORKER_RUNTIME` を設定、Python v2 は `AzureWebJobsFeatureFlags=EnableWorkerIndexing` |
| `WorkerConfig for runtime: X not found` | ランタイム未検出 or Core Tools 破損 | Core Tools 再インストール |
| `Port 7071 is in use` | 別プロセスがポート使用中 | `func start --port 7080` or 前回のプロセスを kill |
| `Extension bundle download failed` | ネットワーク問題 or CDN 障害 | `func start --offline` (キャッシュ済みなら) or ネットワーク確認 |
| `Value cannot be null: AzureWebJobsStorage` | ストレージ接続文字列未設定 | `local.settings.json` に `"AzureWebJobsStorage": "UseDevelopmentStorage=true"` 追加 |
| `The listener for function 'X' was unable to start` | バインディング接続エラー | 接続文字列を確認、Azurite/エミュレータ起動確認 |

## Skill Metadata

```yaml
id: af-doctor
title: Azure Functions Project Diagnostics
intent:
  - diagnose_issue
  - func_start_failed
  - troubleshoot
  - debug_project
completion_signals:
  - diagnostics_passed
  - issue_identified_and_fixed
suggestions:
  on_success:
    - target: af-deploy
      reason: "Project is healthy. Ready to deploy."
      priority: 80
    - target: af-observability
      reason: "Set up monitoring for production readiness."
      priority: 60
  on_failure:
    - target: af-setup
      reason: "Diagnostic failures may require environment reconfiguration."
      priority: 80
    - target: af-help
      reason: "Get guided assistance for unresolved issues."
      priority: 60
entry_conditions:
  - func_start_failed
  - error_occurred
  - project_not_working
```

## Relationship to af-setup

```
af-setup (F3)                    af-doctor (F16)
─────────────                    ───────────────
"Do I have the tools?"           "Is my project healthy?"

  Azure CLI installed?             host.json valid?
  Core Tools installed?            local.settings.json valid?
  Python/Node/.NET?                Runtime compatible?
                                   Ports available?
                                   Azurite running?
                                   Secrets safe?

Entry condition:                 Entry condition:
  user_is_new                      func_start_failed
  tooling_unknown                  error_occurred
```

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Skill runs checks via terminal commands, reports structured results |
| Claude Code | Skill with file reads and terminal execution for each check |
| Codex | Agent instruction with diagnostic workflow |
| Repo Template | Troubleshooting guide in `copilot-instructions.md` |
