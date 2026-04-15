# F17: azure-functions-migrate — Programming Model Migration

**Status:** 📋 Proposed  
**Draft Spec Section:** N/A (discovered from func-emulate F21 migrate)  
**Depends on:** F1 (Skill Graph Metadata), F4 (azure-functions-discovery)

## Problem

Each Azure Functions language is transitioning to a new programming model:

| Language | Legacy Model | Current Model | Change Scope |
|----------|-------------|-----------|---------|
| Node.js | v3 (`function.json` + `index.js`) | v4 (code-first `app.http()`) | Medium |
| Python | v1 (`function.json` + `__init__.py`) | v2 (decorator `@app.route()`) | Medium |
| .NET | In-Process | Isolated Worker | High |

Thousands of existing apps run on legacy models. Migration guides exist on Microsoft Learn, but **the actual conversion work requires manually touching every file**. Developers don't know where to start, and fear of breaking things during migration causes them to postpone.

AI coding agents are ideal for this kind of structured transformation, but they can't produce correct conversions without knowing Functions-specific migration patterns.

## Feature

`azure-functions-migrate` detects legacy Azure Functions programming models and guides migration to the current model. It provides deterministic conversion pattern instructions and decision support for complex cases.

## Supported Migration Paths

### Node.js v3 → v4

| Change | Before (v3) | After (v4) |
|--------|-------------|------------|
| Function definition | `function.json` + `index.js` | Code-first registration with `app.http()` |
| Package | `@azure/functions` 3.x | `@azure/functions` 4.x |
| Directory | `<functionName>/function.json` + `<functionName>/index.js` | `src/functions/<name>.js` (flat) |
| Extension Bundle | v3 | v4 |
| Entry point | `scriptFile` in function.json | `main` in package.json |

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

| Change | Before (v1) | After (v2) |
|--------|-------------|------------|
| Function definition | `function.json` + `__init__.py` | `@app.route()` decorator |
| Entry point | Distributed `__init__.py` files | Single `function_app.py` |
| Directory | `<functionName>/function.json` + `<functionName>/__init__.py` | Flat |
| Config | `AzureWebJobsFeatureFlags` not required | `EnableWorkerIndexing` required |

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

| Change | Before (In-Process) | After (Isolated) |
|--------|---------------------|-------------------|
| Hosting | Runs inside the Functions host | Runs in a separate process |
| NuGet | `Microsoft.NET.Sdk.Functions` | `Microsoft.Azure.Functions.Worker` |
| Startup | `Startup.cs` + `IFunctionsHostBuilder` | `Program.cs` + `HostBuilder` |
| Binding attributes | `Microsoft.Azure.WebJobs` namespace | `Microsoft.Azure.Functions.Worker` namespace |
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
   → Run func start and confirm functions are registered
   → Confirm existing tests pass

5. Post-migration suggestions (from graph)
   → "Migration complete. Run azure-functions-doctor to verify project health."
```

## Skill Metadata

```yaml
id: azure-functions-migrate
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
    - target: azure-functions-doctor
      reason: "Migration completed. Verify project health with diagnostics."
      priority: 100
    - target: azure-functions-deploy
      reason: "Migrated app is ready for deployment."
      priority: 70
  on_failure:
    - target: azure-functions-help
      reason: "Migration encountered issues. Get guided assistance."
      priority: 80
    - target: azure-functions-doctor
      reason: "Run diagnostics to identify post-migration issues."
      priority: 90
entry_conditions:
  - legacy_model_detected
  - user_wants_to_migrate
```

## Incremental Migration

It's not necessary to migrate all functions at once. Node.js v4 supports coexistence with v3 patterns, so you can migrate one function at a time with `--function <name>`:

```
Step 1: Migrate one HTTP function to verify the pattern
Step 2: Migrate the remaining HTTP functions
Step 3: Migrate non-HTTP functions (Timer, Queue, etc.)
Step 4: Delete function.json files and flatten the directory structure
```

## Migration Checklist

Common items to verify for each migration:

- [ ] Update package dependencies
- [ ] Update Extension Bundle version in `host.json`
- [ ] Convert all `function.json` files to code-first
- [ ] Update entry point configuration (`main` in package.json / `function_app.py`)
- [ ] Confirm all functions are registered with `func start`
- [ ] Confirm HTTP endpoints respond correctly
- [ ] Confirm existing tests pass
- [ ] Delete unnecessary `function.json` files and old directories

## Reference Documentation

| Migration Path | Microsoft Learn URL |
|---------------|-------------------|
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
