# F5: azure-functions-create — Project Scaffolding

**Status:** 📋 Proposed  
**Draft Spec Section:** 5.1, 6, 8  
**Depends on:** F1 (Skill Graph Metadata), F3 (azure-functions-setup recommended first)

## Problem

After setting up the environment, the developer's next question is "how do I create a Functions app?" Without `azure-functions-create`, the skill graph has a gap between `azure-functions-setup` (environment ready) and `azure-functions-deploy` (deploy to Azure). The user is left to figure out project scaffolding on their own, using `func init`, `azd init`, or manual file creation — each with different patterns and pitfalls.

## Feature

`azure-functions-create` guides the developer through creating a new Azure Functions project, handling:

1. **Language selection** — Python, Node.js/TypeScript, .NET (isolated), Java, PowerShell
2. **Template selection** — HTTP trigger, Timer, Blob, Queue, Cosmos DB, etc.
3. **Project structure** — `host.json`, language-specific config, `.gitignore`, entry point
4. **Programming model** — v2 (Python/Node) vs. traditional, isolated worker (.NET)
5. **Post-creation next steps** — directed transitions to `azure-functions-deploy`, `azure-functions-observability`, `azure-functions-hosting`

## Workflow

```
1. Detect if directory is empty or has existing project
   ├── Non-empty with host.json → "Project already exists. Use azure-functions-discovery."
   ├── Non-empty without host.json → "Directory not empty. Create a subdirectory?"
   └── Empty → proceed

2. Language selection
   → Python | Node.js/TypeScript | .NET (isolated) | Java | PowerShell

3. Template selection
   → HTTP trigger (default) | Timer | Blob | Queue | Cosmos DB | Event Hub | ...

4. Generate project files
   → host.json, local.settings.json, language files, .gitignore

5. Post-creation suggestions (from graph metadata)
   → "Next: azure-functions-deploy to deploy, or azure-functions-observability to set up monitoring"
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
id: azure-functions-create
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
    - target: azure-functions-deploy
      reason: "A project exists. Offer deployment next."
      priority: 100
    - target: azure-functions-observability
      reason: "Offer monitoring setup before or after deployment."
      priority: 70
    - target: azure-functions-help
      reason: "Provide other common next steps."
      priority: 40
  on_failure:
    - target: azure-functions-setup
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

When available, `azure-functions-create` leverages `func init` and `func new` under the hood:

```bash
func init my-functions-app --python --model V2
cd my-functions-app
func new --name HttpTrigger --template "HTTP trigger"
```

When Core Tools is not available, `azure-functions-create` generates files directly using embedded templates.

### Validation

- Verify directory is empty or user confirms subdirectory creation
- Validate language runtime is installed (delegate to `azure-functions-setup` if not)
- Confirm generated files are syntactically valid

## Adding Functions to Existing Projects

`azure-functions-create` supports not only new projects but also **adding functions to existing projects** (adopted from the func-emulate `fnx-create-function` skill).

### Detection Logic

```
host.json exists?
├── Yes → Existing project → Add function mode
│   ├── MCP tools available? → Retrieve templates via MCP (F19)
│   └── MCP unavailable? → Generate via func new or embedded patterns
└── No → New project mode (Workflow above)
```

### MCP Tool Integration (F19)

When the Templates MCP server is configured, `azure-functions-create` leverages MCP tools:

| MCP Tool | Purpose |
|----------|---------|
| `get_languages_list` | Retrieve list of supported languages |
| `get_templates_list` | List templates for a given language |
| `get_template` | Get full template source code + required app settings |
| `get_project_template` | Get complete project initialization files |

### Fallback (without MCP)

When MCP is not available:

1. If `func new` command is available, run `func new --name <name> --template <template>`
2. If `func` is also unavailable, generate from embedded template patterns within the skill

### Available Templates

Support status for major triggers:

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

After adding a function, next-step suggestions based on graph metadata are provided:

- "Function added. Run `func start` to test locally."
- "Consider adding tests for the new function."
- "Run `azure-functions-doctor` if `func start` fails."

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Skill guides through prompts, uses MCP tools if available, generates files |
| Claude Code | Skill with MCP tool invocation, file creation, and terminal commands |
| Codex | Agent instruction with scaffolding steps and MCP fallback |
| Repo Template | Quick-start section in `copilot-instructions.md` |
