# F5: af-create — Project Scaffolding

**Status:** 📋 Proposed  
**仮スペック Section:** 5.1, 6, 8  
**Depends on:** F1 (Skill Graph Metadata), F3 (af-setup recommended first)

## Problem

After setting up the environment, the developer's next question is "how do I create a Functions app?" Without `af-create`, the skill graph has a gap between `af-setup` (environment ready) and `af-deploy` (deploy to Azure). The user is left to figure out project scaffolding on their own, using `func init`, `azd init`, or manual file creation — each with different patterns and pitfalls.

## Feature

`af-create` guides the developer through creating a new Azure Functions project, handling:

1. **Language selection** — Python, Node.js/TypeScript, .NET (isolated), Java, PowerShell
2. **Template selection** — HTTP trigger, Timer, Blob, Queue, Cosmos DB, etc.
3. **Project structure** — `host.json`, language-specific config, `.gitignore`, entry point
4. **Programming model** — v2 (Python/Node) vs. traditional, isolated worker (.NET)
5. **Post-creation next steps** — directed transitions to `af-deploy`, `af-observability`, `af-hosting`

## Workflow

```
1. Detect if directory is empty or has existing project
   ├── Non-empty with host.json → "Project already exists. Use af-discovery."
   ├── Non-empty without host.json → "Directory not empty. Create a subdirectory?"
   └── Empty → proceed

2. Language selection
   → Python | Node.js/TypeScript | .NET (isolated) | Java | PowerShell

3. Template selection
   → HTTP trigger (default) | Timer | Blob | Queue | Cosmos DB | Event Hub | ...

4. Generate project files
   → host.json, local.settings.json, language files, .gitignore

5. Post-creation suggestions (from graph metadata)
   → "Next: af-deploy to deploy, or af-observability to set up monitoring"
```

## Generated Files by Language

### Python (v2 model)

```
my-functions-app/
├── function_app.py        # Main entry with @app decorators
├── host.json              # Extension bundle config
├── local.settings.json    # Local app settings
├── requirements.txt       # azure-functions dependency
└── .gitignore
```

### Node.js/TypeScript (v4 model)

```
my-functions-app/
├── src/
│   └── functions/
│       └── httpTrigger.ts  # Function with app.http() registration
├── host.json
├── local.settings.json
├── package.json            # @azure/functions v4 dependency
├── tsconfig.json
└── .gitignore
```

### .NET (isolated worker)

```
my-functions-app/
├── Program.cs              # HostBuilder setup
├── HttpTrigger.cs          # Function class
├── MyFunctionsApp.csproj   # Functions Worker SDK references
├── host.json
├── local.settings.json
└── .gitignore
```

## Skill Metadata

```yaml
id: af-create
title: Create Azure Functions App
intent:
  - scaffold_project
  - choose_language
  - choose_template
  - new_function_app
completion_signals:
  - function_project_created
  - host_json_exists
suggestions:
  on_success:
    - target: af-deploy
      reason: "A project exists. Offer deployment next."
      priority: 100
    - target: af-observability
      reason: "Offer monitoring setup before or after deployment."
      priority: 70
    - target: af-help
      reason: "Provide other common next steps."
      priority: 40
  on_failure:
    - target: af-setup
      reason: "Creation failure may be caused by missing prerequisites."
      priority: 70
entry_conditions:
  - no_project_exists
  - user_wants_new_project
```

## Behavior

### Smart Defaults

- Default language: detected from environment (e.g., if `python3` is available and no Node/dotnet, default to Python)
- Default template: HTTP trigger (most common starting point)
- Default programming model: latest (v2 for Python, v4 for Node, isolated for .NET)

### Core Tools Integration

When available, `af-create` leverages `func init` and `func new` under the hood:

```bash
func init my-functions-app --python --model V2
cd my-functions-app
func new --name HttpTrigger --template "HTTP trigger"
```

When Core Tools is not available, `af-create` generates files directly using embedded templates.

### Validation

- Verify directory is empty or user confirms subdirectory creation
- Validate language runtime is installed (delegate to `af-setup` if not)
- Confirm generated files are syntactically valid

## Adding Functions to Existing Projects

`af-create` は新規プロジェクトだけでなく、**既存プロジェクトへの関数追加**もサポートする（func-emulate `fnx-create-function` スキルから採用）。

### Detection Logic

```
host.json exists?
├── Yes → 既存プロジェクト → 関数追加モード
│   ├── MCP ツール利用可能? → MCP 経由でテンプレート取得 (F19)
│   └── MCP 不可? → func new or 埋め込みパターンで生成
└── No → 新規プロジェクトモード (上記 Workflow)
```

### MCP Tool Integration (F19)

Templates MCP サーバーが設定されている場合、`af-create` は MCP ツールを活用する:

| MCP Tool | 用途 |
|----------|------|
| `get_languages_list` | サポート言語一覧の取得 |
| `get_templates_list` | 指定言語のテンプレート一覧 |
| `get_template` | テンプレートの完全なソースコード + 必要な app settings |
| `get_project_template` | プロジェクト初期化ファイル一式 |

### Fallback (MCP なし)

MCP が利用できない場合:

1. `func new` コマンドが利用可能なら `func new --name <name> --template <template>` を実行
2. `func` も利用不可なら、スキル内蔵のテンプレートパターンから生成

### Available Templates

主要トリガーのサポート状況:

| Trigger | Node.js | Python | .NET Isolated | Java |
|---------|---------|--------|---------------|------|
| HTTP | ✅ | ✅ | ✅ | ✅ |
| Timer | ✅ | ✅ | ✅ | ✅ |
| Queue | ✅ | ✅ | ✅ | ✅ |
| Blob | ✅ | ✅ | ✅ | ✅ |
| Cosmos DB | ✅ | ✅ | ✅ | ✅ |
| Service Bus | ✅ | ✅ | ✅ | ✅ |
| Event Hub | ✅ | ✅ | ✅ | ✅ |
| Durable | ✅ | ✅ | ✅ | ✅ |

### Post-Add Behavior

関数追加後も graph metadata に基づく次ステップ提案を行う:

- "Function added. Run `func start` to test locally."
- "Consider adding tests for the new function."
- "Run `af-doctor` if `func start` fails."

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Skill guides through prompts, uses MCP tools if available, generates files |
| Claude Code | Skill with MCP tool invocation, file creation, and terminal commands |
| Codex | Agent instruction with scaffolding steps and MCP fallback |
| Repo Template | Quick-start section in `copilot-instructions.md` |
