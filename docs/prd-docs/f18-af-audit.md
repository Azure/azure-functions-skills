# F18: af-audit — Project Audit & Static Analysis

**Status:** 📋 Proposed  
**仮スペック Section:** N/A (func-emulate F21 audit から発見)  
**Depends on:** F1 (Skill Graph Metadata)

## Problem

Azure Functions アプリは時間とともに問題を蓄積する:

- `authLevel: 'anonymous'` が本番 HTTP エンドポイントに残る
- ハードコードされた秘密値がソースコードに混入
- 非推奨の Extension Bundle バージョンを使い続ける
- ターゲット SKU でサポートされない機能を使う（例: Flex Consumption で Durable Timer）
- ログ設定が欠落し、本番障害時にテレメトリがない

汎用リンターはこれらの **Functions 固有の問題**を検出できない。`af-observability` (F7) は本番モニタリングの設定を扱うが、`af-audit` はデプロイ前の**静的チェック**を扱う — レイヤーが異なる。

## Feature

`af-audit` は Azure Functions プロジェクトに対して Functions ドメイン固有の静的解析を行い、セキュリティ、SKU 互換性、パフォーマンス、ベストプラクティスの問題を検出する。

## Rule Categories

| カテゴリ | プレフィックス | 対象 |
|---------|-------------|------|
| **Security** | `SEC-` | Auth level, 秘密値漏洩, CORS 設定 |
| **SKU Compatibility** | `SKU-` | ターゲット SKU でサポートされない機能 |
| **Performance** | `PERF-` | 同期 I/O, 無制限並行性, 大きなペイロード |
| **Configuration** | `CFG-` | 不足 app settings, 不正なバインディング式 |
| **Deprecation** | `DEP-` | 非推奨バインディング, EOL ランタイム, 古い Extension Bundle |
| **Best Practice** | `BP-` | App Insights 未設定, テストファイル不足 |

## Rule Examples

### Security Rules

| ID | ルール | レベル | 自動修正 |
|----|-------|--------|---------|
| SEC-001 | HTTP 関数の `authLevel` が `anonymous` | Error | ⚠️ 手動確認要 |
| SEC-002 | ソースコードに接続文字列パターン検出 | Error | ❌ |
| SEC-003 | `local.settings.json` が `.gitignore` に含まれていない | Error | ✅ `.gitignore` に追加 |
| SEC-004 | CORS が `*` に設定 | Warning | ❌ |

### SKU Compatibility Rules

| ID | ルール | レベル | 対象 SKU |
|----|-------|--------|---------|
| SKU-001 | Durable Functions Timer は Flex Consumption 非対応 | Error | Flex |
| SKU-002 | 実行タイムアウトが SKU 上限を超過 | Error | Consumption (5/10min) |
| SKU-003 | VNET 統合が必要だが Consumption プラン | Warning | Consumption |
| SKU-004 | カスタムコンテナが必要だが非対応 SKU | Error | Flex, Consumption |

### Performance Rules

| ID | ルール | レベル | 自動修正 |
|----|-------|--------|---------|
| PERF-001 | async 関数内で同期ファイル I/O | Warning | ✅ `fs.promises` に変換 |
| PERF-002 | HTTP レスポンスにストリーミング未使用で大ペイロード | Info | ❌ |
| PERF-003 | Connection pooling 未使用（DB クライアント毎回生成） | Warning | ❌ |

## Output Format

```
Azure Functions Audit — my-functions-app (Flex Consumption, Node.js v4)
═══════════════════════════════════════════════════════════════════════

ERRORS (must fix)
  ✗ SEC-001  src/functions/webhook.js:12
    Auth level is "anonymous" — this function is publicly accessible.
    Fix: Set authLevel to "function" or "admin", or use API Management.

  ✗ SKU-001  src/functions/orchestrator.js:28
    Durable Functions createTimer() is not supported on Flex Consumption.
    Fix: Use a different delay mechanism or switch to Premium SKU.
    Docs: https://learn.microsoft.com/azure/azure-functions/flex-consumption-plan#limitations

WARNINGS (should fix)
  ⚠ CFG-001  host.json
    Extension bundle version [3.*, 4.0.0) is outdated. Latest: [4.*, 5.0.0).
    Fix: Update extensionBundle.version in host.json.

  ⚠ PERF-001  src/functions/processImage.js:34
    Synchronous file read (fs.readFileSync) in async function handler.
    Fix: Use fs.promises.readFile() instead.

INFO
  ℹ BP-001   No Application Insights connection string configured.
  ℹ BP-002   3 functions have no associated test files.

Summary: 2 errors, 2 warnings, 2 info
```

## Skill Metadata

```yaml
id: af-audit
title: Azure Functions Project Audit
intent:
  - audit_project
  - check_security
  - check_sku_compatibility
  - check_best_practices
completion_signals:
  - audit_completed_clean
  - issues_found_and_reported
suggestions:
  on_success:
    - target: af-deploy
      reason: "Audit passed. Project is ready for deployment."
      priority: 90
    - target: af-feedback
      reason: "Share your audit experience."
      priority: 30
  on_failure:
    - target: af-doctor
      reason: "If audit found critical issues, run diagnostics."
      priority: 70
    - target: af-help
      reason: "Get guidance on fixing audit findings."
      priority: 60
entry_conditions:
  - pre_deployment_check
  - security_review_requested
  - sku_compatibility_check
```

## SKU Detection for Rules

ターゲット SKU の検出順序:

1. `app-config.yaml` → `local.targetSku` (fnx 形式)
2. `local.settings.json` → SKU ヒント
3. Azure リソース metadata（`.azure/` ディレクトリ）
4. ユーザーに聞く（検出できない場合）
5. デフォルト: 全 SKU 共通ルールのみ適用

## CI Integration

`af-audit` は CI パイプラインで使用可能:

```yaml
# GitHub Actions example
- name: Azure Functions Audit
  run: |
    # AI agent が af-audit を実行し、SARIF 形式で出力
    # GitHub Code Scanning と統合
```

出力フォーマット: `text` (デフォルト), `json`, `sarif` (GitHub Code Scanning 対応)

## Relationship to Other Skills

```
af-audit (F18)                     af-observability (F7)
──────────────                     ────────────────────
デプロイ前の静的チェック             デプロイ後の本番モニタリング

  ソースコード解析                    Application Insights 設定
  設定ファイル検証                    ログレベル設定
  SKU 互換性チェック                  アラートルール設定
  セキュリティパターン検出             Kusto クエリテンプレート

タイミング: func start 前           タイミング: デプロイ後
```

```
af-audit (F18)                     af-doctor (F16)
──────────────                     ───────────────
品質・互換性の静的解析               プロジェクト健全性の動的診断

  "このコードに問題はないか？"         "なぜ func start が失敗するのか？"
  コード・設定のパターンマッチ         ランタイム状態のチェック
  SKU 制約違反                       ポート競合、Azurite 状態
```

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Skill scans project files, reports findings with severity |
| Claude Code | Skill with source code analysis and config validation |
| Codex | Agent instruction with audit rule set |
| Repo Template | Pre-deploy checklist in `copilot-instructions.md` |
