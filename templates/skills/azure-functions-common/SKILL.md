# Azure Functions Common References

Use this suite-internal skill as the shared reference pack for Azure Functions skills.

This skill is intentionally workflow-light. Do not load all references up front. Use [routing.md](references/routing.md) to choose only the runtime/language and trigger/binding reference files needed for the current task.

## Scope

Shared references include:

- Language/runtime references in `references/languages/`.
- Trigger/binding extension references in `references/extensions/`.
- Routing rules in `references/routing.md`.

Task-specific skills keep their own workflows, scripts, evidence checklists, and output formats. For example, diagnostics owns diagnostic workflow and health evidence rules; this skill only owns reusable Azure Functions reference material.

## Loading rules

- Load exactly one language reference when the runtime is known, plus Durable only when Durable is involved.
- Load only extension references matching the app's triggers/bindings or the symptom.
- Load Extension Bundles only for non-.NET apps or extension-version/binding-resolution symptoms.
- Prefer official documentation, official repositories, official samples, and package/container registries before broader web sources.