# F5: azure-functions-create — Project Scaffolding

**Status:** ✅ Implemented (MCP-primary with `func` fallback)
**Draft Spec Section:** 5.1, 6, 8
**Depends on:** F1 (Skill Graph Metadata), F3 (azure-functions-setup recommended first), F19 (MCP Integration)

## Problem

After setting up the environment, the developer's next question is "how do I create a Functions app?" Without `azure-functions-create`, the skill graph has a gap between `azure-functions-setup` (environment ready) and `azure-functions-deploy` (deploy to Azure). The user is left to figure out project scaffolding on their own, using `func init`, `azd init`, or manual file creation — each with different patterns and pitfalls.

## Feature

`azure-functions-create` guides the developer through creating a new Azure Functions project, handling:

1. **Language selection** — Python, Node.js/TypeScript, .NET (isolated), Java, PowerShell
2. **Template selection** — HTTP trigger, Timer, Blob, Queue, Cosmos DB, etc.
3. **Project structure** — `host.json`, language-specific config, `.gitignore`, entry point
4. **Programming model** — v2 (Python/Node) vs. traditional, isolated worker (.NET)
5. **Post-creation next steps** — directed transitions to `azure-functions-deploy`, `azure-functions-observability`, `azure-functions-hosting`

## Execution Paths (MCP-Primary)

The skill is designed with a clear primary / fallback split so it works across the full matrix of agent capabilities:

### Path A — MCP Primary (preferred)

When the [Azure MCP Server](https://learn.microsoft.com/azure/developer/azure-mcp-server/tools/azure-functions) (`@azure/mcp`) is wired into the agent, use it as the authoritative source of truth. This server ships 68+ officially maintained templates across C#, Java, JavaScript, Python, TypeScript, and PowerShell, and exposes three composable tools:

| Step | Azure MCP Tool | Purpose |
|------|----------|---------|
| Discover languages | `functions language list` | Supported languages + runtime versions + prerequisites |
| Browse templates | `functions list or get template` (omit template name) | Language-specific template catalog with descriptions |
| Initialize project | `functions project get` | Returns `host.json`, `local.settings.json`, `package.json` / `requirements.txt` / `pom.xml` / `.csproj`, etc. |
| Add function | `functions list or get template` (with template name) | Full function source code + required app settings + additional packages |

The skill instructs the agent to **never write function code from scratch** when these tools are available.

### Path B — `func` CLI Fallback (explicit)

When the Azure MCP tools are not detected, the skill falls back to `func init` + `func new` and shows an explicit bilingual notice to the user that guides them toward enabling the Azure MCP Server. Minimal per-language code examples live in `references/language-snippets.md` (loaded via the `references/` mechanism added in #8), keeping the main `SKILL.md` lean.

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
   → Path A: functions project get + functions list or get template (Azure MCP)
   → Path B: func init + func new (CLI)

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
