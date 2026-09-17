---
name: azure-functions-update
title: Update Azure Functions
description: 'Plan and execute staged Azure Functions updates. WHEN: "upgrade Azure Functions runtime", "migrate .NET Functions to isolated", "update Functions worker or binding extensions". This draft covers .NET migration and shared assessment for other languages. DO NOT USE FOR: new projects, deployment-only tasks, cross-cloud migration, or updating the skills CLI.'
category: task
license: MIT
metadata:
  author: Microsoft
  version: "1.1.0"
---

# Update Azure Functions

Draft; not yet tested on a customer repository. Reply in the user's language.
For other languages, stop after assessment.

## Quick reference

| Scope | Capability |
| --- | --- |
| .NET | Plan, staged conversion, evidence |
| Other languages | Assessment only |
| MCP tools | Optional; discover schemas, then use public docs if unavailable |

## Workflow

Make the plan usable even by a weaker model without external-document lookup. The same agent
can plan and execute any migration; subagents are optional. Read the target code.

1. Follow [intake](references/intake.md) and [permissions](references/permissions.md)
   before customer content reads.
2. Use [inventory](references/inventory.md), [workflow gates](references/workflow.md),
   and the [.NET route](references/dotnet.md) to confirm the target and behavior.
3. Execute approved [task packets](references/task-packet.md). Match required changes
   to evidence; return unresolved decisions to planning.
4. Finish with [E2E validation](references/validation.md) and
   [current results](references/evidence.md). Report what cannot be completed.

Load references for the current phase only. Do not copy the full library into each task.

## Error handling

| Error | Message | Action |
| --- | --- | --- |
| Missing approval | Name the denied action | Ask once for its scope |
| Tool or feed failure | Show cause and affected checks | Stop affected work; preserve evidence |
| Unknown compatibility | Target not confirmed | Research the target release in planning; revise plan |
