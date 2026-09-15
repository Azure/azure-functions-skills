---
name: azure-functions-update
title: Update Azure Functions
description: Update an existing Azure Functions app, its runtime, or its programming model. Use only when the user explicitly requests this skill.
category: task
---

# Update Azure Functions

## Workflow

1. Inspect the existing code and configuration. Get Azure site data only if the requested change needs it. Do not require Azure access for local work.
2. Select the applicable references below. Read the primary source first. Read another source only if it is needed for the selected change. Use current official support information to select a compatible target, not version numbers from old examples.
3. Present the current state, proposed target, required changes, and source links as one gap report and plan. Ask the user to select the scope if it is not clear. Do not ask again for changes already approved.
4. Make only the approved changes. Keep existing behavior and unrelated settings. Update existing build, infrastructure, and pipeline files when the selected migration requires it. Do not change the hosting plan or deploy without authorization.
5. Run the checks that apply to the change. Confirm that the expected functions are registered and retain their behavior. Report completed changes, failed checks, and anything not verified. Do not claim Azure deployment success from local checks.

For a large migration, use stages that each leave a working app. A request for a report or plan does not authorize code changes.

## Select References

Read only the files for the requested scenario and its required dependencies. Do not read this directory in full.

| Scenario | Reference |
| --- | --- |
| Functions host v3 to v4 | [Host migration](references/host-v4.md) |
| C# in-process to isolated worker | [C# model migration](references/dotnet-isolated.md) |
| .NET version update, including .NET 8 to .NET 10 | [.NET version update](references/dotnet-version.md) |
| Node.js programming model v3 to v4 | [Node.js model migration](references/node-model-v4.md) |
| Python programming model v1 to v2 | [Python model migration](references/python-model-v2.md) |
| Other language versions or host version selection | [Runtime and language versions](references/runtime-versions.md) |
| Binding extension updates | [Binding extensions](references/extensions.md) |
| Durable Functions extension v1 to v2 | [Durable Functions migration](references/durable-v2.md) |
| Extension bundles v1, v2, or v3 to v4 | [Extension bundles](references/bundles-v4.md) |
| Existing Bicep, ARM, or deployment scripts | [Infrastructure configuration](references/infrastructure.md) |
| Existing GitHub Actions or Azure Pipelines | [Pipeline configuration](references/pipelines.md) |

Keep host, language, programming model, and extension versions separate. Their version numbers do not identify the same change.

If a source is unavailable or does not cover the case, use a targeted search in Microsoft Learn or the official repository. Report unresolved gaps instead of repeating the same search or inventing requirements.