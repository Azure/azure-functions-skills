# F17: af-migrate — Programming Model Migration

**Status:** 📋 Proposed  
**仮スペック Section:** N/A (func-emulate F21 migrate から発見)  
**Depends on:** F1 (Skill Graph Metadata), F4 (af-discovery)

## Problem

Azure Functions の各言語は新しいプログラミングモデルに移行している:

| 言語 | レガシーモデル | 現行モデル | 変更規模 |
|------|-------------|-----------|---------|
| Node.js | v3 (`function.json` + `index.js`) | v4 (code-first `app.http()`) | Medium |
| Python | v1 (`function.json` + `__init__.py`) | v2 (decorator `@app.route()`) | Medium |
| .NET | In-Process | Isolated Worker | High |

数千の既存アプリがレガシーモデルで稼働しており、移行ガイドは Microsoft Learn に存在するが、**実際の変換作業は手作業で全ファイルに触る必要がある**。開発者はどこから始めればいいかわからず、移行中に壊れるリスクを恐れて先延ばしにする。

AI コーディングエージェントはこの種の構造化された変換に最適だが、Functions 固有の移行パターンを知らないと正しい変換ができない。

## Feature

`af-migrate` はレガシー Azure Functions プログラミングモデルを検出し、現行モデルへの移行をガイドする。確定的な変換パターンの指示と、複雑なケースでの判断支援を提供する。

## Supported Migration Paths

### Node.js v3 → v4

| 変更点 | Before (v3) | After (v4) |
|--------|-------------|------------|
| 関数定義 | `function.json` + `index.js` | `app.http()` で code-first 登録 |
| パッケージ | `@azure/functions` 3.x | `@azure/functions` 4.x |
| ディレクトリ | `<functionName>/function.json` + `<functionName>/index.js` | `src/functions/<name>.js` (フラット) |
| Extension Bundle | v3 | v4 |
| エントリポイント | `scriptFile` in function.json | `main` in package.json |

```javascript
// Before: HttpTrigger/index.js + HttpTrigger/function.json
module.exports = async function (context, req) {
    context.res = { body: "Hello" };
};

// After: src/functions/httpTrigger.js
const { app } = require('@azure/functions');
app.http('httpTrigger', {
    methods: ['GET', 'POST'],
    authLevel: 'function',
    handler: async (request, context) => {
        return { body: "Hello" };
    }
});
```

### Python v1 → v2

| 変更点 | Before (v1) | After (v2) |
|--------|-------------|------------|
| 関数定義 | `function.json` + `__init__.py` | `@app.route()` デコレータ |
| エントリ | 分散された `__init__.py` | 単一 `function_app.py` |
| ディレクトリ | `<functionName>/function.json` + `<functionName>/__init__.py` | フラット |
| 設定 | `AzureWebJobsFeatureFlags` 不要 | `EnableWorkerIndexing` 必須 |

```python
# Before: HttpTrigger/__init__.py + HttpTrigger/function.json
import azure.functions as func
def main(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("Hello")

# After: function_app.py
import azure.functions as func
app = func.FunctionApp()

@app.route(route="hello")
def http_trigger(req: func.HttpRequest) -> func.HttpResponse:
    return func.HttpResponse("Hello")
```

### .NET In-Process → Isolated Worker

| 変更点 | Before (In-Process) | After (Isolated) |
|--------|---------------------|-------------------|
| ホスティング | Functions ホスト内で実行 | 別プロセスで実行 |
| NuGet | `Microsoft.NET.Sdk.Functions` | `Microsoft.Azure.Functions.Worker` |
| スタートアップ | `Startup.cs` + `IFunctionsHostBuilder` | `Program.cs` + `HostBuilder` |
| Binding 属性 | `Microsoft.Azure.WebJobs` 名前空間 | `Microsoft.Azure.Functions.Worker` 名前空間 |
| DI | `IFunctionsHostBuilder.Services` | `HostBuilder.ConfigureServices` |

## Migration Workflow

```
1. Detect current model
   ├── function.json files exist? → v1/v3 (legacy)
   ├── @azure/functions version in package.json? → check major
   ├── Microsoft.NET.Sdk.Functions in .csproj? → in-process
   └── decorator pattern in .py? → check v1 vs v2

2. Show migration plan
   → List every file that will change
   → Show before/after for representative function
   → Estimate change count

3. Guide transformation (per function)
   → Convert function.json + handler → code-first
   → Update package dependencies
   → Update host.json extension bundle
   → Update entry point configuration

4. Validate
   → func start を実行して関数が登録されることを確認
   → 既存テストが通ることを確認

5. Post-migration suggestions (from graph)
   → "Migration complete. Run af-doctor to verify project health."
```

## Skill Metadata

```yaml
id: af-migrate
title: Azure Functions Model Migration
intent:
  - migrate_programming_model
  - upgrade_from_v1
  - upgrade_from_v3
  - convert_inprocess_to_isolated
completion_signals:
  - migration_completed
  - all_functions_converted
suggestions:
  on_success:
    - target: af-doctor
      reason: "Migration completed. Verify project health with diagnostics."
      priority: 100
    - target: af-deploy
      reason: "Migrated app is ready for deployment."
      priority: 70
  on_failure:
    - target: af-help
      reason: "Migration encountered issues. Get guided assistance."
      priority: 80
    - target: af-doctor
      reason: "Run diagnostics to identify post-migration issues."
      priority: 90
entry_conditions:
  - legacy_model_detected
  - user_wants_to_migrate
```

## Incremental Migration

全関数を一括移行する必要はない。Node.js v4 は v3 パターンとの共存をサポートするため、`--function <name>` で1関数ずつ移行可能:

```
Step 1: 1つの HTTP 関数を移行してパターンを確認
Step 2: 残りの HTTP 関数を移行
Step 3: Non-HTTP 関数（Timer, Queue 等）を移行
Step 4: function.json ファイルを削除、ディレクトリ構造をフラット化
```

## Migration Checklist

各移行で確認すべき共通項目:

- [ ] パッケージ依存関係を更新
- [ ] `host.json` の Extension Bundle バージョンを更新
- [ ] すべての `function.json` を code-first に変換
- [ ] エントリポイント設定を更新 (`main` in package.json / `function_app.py`)
- [ ] `func start` で全関数が登録されることを確認
- [ ] HTTP エンドポイントが応答することを確認
- [ ] 既存テストが通ることを確認
- [ ] 不要な `function.json` ファイルと古いディレクトリを削除

## Reference Documentation

| 移行パス | Microsoft Learn URL |
|---------|-------------------|
| Node.js v3 → v4 | https://learn.microsoft.com/azure/azure-functions/functions-node-upgrade-v4 |
| Python v1 → v2 | https://learn.microsoft.com/azure/azure-functions/functions-reference-python?pivots=python-mode-decorators#upgrade-to-v2 |
| .NET In-Process → Isolated | https://learn.microsoft.com/azure/azure-functions/migrate-dotnet-to-isolated-model |

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Skill detects legacy patterns, guides file-by-file conversion |
| Claude Code | Skill with file transformation and terminal validation |
| Codex | Agent instruction with migration patterns per language |
| Repo Template | Migration note in `copilot-instructions.md` if legacy model detected |
