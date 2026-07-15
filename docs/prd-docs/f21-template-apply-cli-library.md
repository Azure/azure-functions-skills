# F21: Template Apply CLI & Library

**Status:** ✅ Implemented
**Draft Spec Section:** N/A (follow-up to F5, F19, F20)
**Depends on:** F5 (azure-functions-create), F19 (MCP Integration), F20 (CLI & Library)

## Problem

`azure-functions-create` currently treats Azure MCP template tools as the primary source for both template discovery and full template retrieval. Full template retrieval can return large `files` payloads, especially for `*-azd` templates with infrastructure, which increases agent token usage.

## Feature

Add `template list` and `template apply` surfaces to the CLI and library so agents and VS Code extensions can request template work by parameters instead of receiving full template contents in the conversation.

```bash
azure-functions-skills template list --language typescript --resource http --json

azure-functions-skills template apply \
  --dir ./my-functions-app \
  --template http-trigger-typescript-azd \
  --runtime-version 22
```

## Source Strategy

Use the Azure Functions templates manifest as the primary source.

1. Fetch `https://cdn.functions.azure.com/public/templates-manifest/manifest.json`.
2. Resolve templates from `templates[]` using `language`, `template`, `resource`, and `iac`.
3. Download the selected template directly from `repositoryUrl`, `gitRef`, and `folderPath`.
4. Apply runtime placeholders and write files locally.
5. Fall back to MCP only when the manifest cannot satisfy the request or a caller explicitly requests MCP.

This keeps large template contents out of the agent transcript while preserving Azure MCP as an escape hatch for dynamic or non-manifest scenarios.

## Commands

| Command | Purpose |
| --- | --- |
| `template list` | List manifest templates with optional filters (`--language`, `--resource`, `--iac`, `--json`) |
| `template apply` | Apply a selected template into `--dir` using `--mode auto\|new\|add` |

`apply` defaults to `--mode auto`: use `add` when `host.json` exists, otherwise `new`. Template IDs are expected to be unique, so `--template <id>` is enough for the common apply path. `--runtime-version` is an override; when omitted, runtime placeholders use the manifest default for the resolved template language.

In `add` mode, project scaffolding files such as `host.json`, `package.json`, `.github/`, and `infra/` are skipped by default so an existing app is not reinitialized. `--force` is the explicit opt-in to overwrite those files, including `local.settings.json`.

`--manifest-url` is an advanced escape hatch for trusted custom manifests only. A manifest controls template repository URLs and file contents that may be written into the target directory. GitHub API downloads first run unauthenticated; if GitHub reports a rate limit or private repository response, the CLI retries the `api.github.com` contents request with `GH_TOKEN`, `GITHUB_TOKEN`, or the user's existing `gh auth token`. Tokens are never attached to the manifest URL, template repository URL, or file `download_url`.

### Examples

```bash
azure-functions-skills template list --language python --resource http --iac bicep

azure-functions-skills template apply \
  --dir ./my-functions-app \
  --template http-trigger-python-azd

azure-functions-skills template apply \
  --dir ./my-functions-app \
  --template timer-trigger-typescript \
  --mode add \
  --dry-run
```

## Library API

```typescript
listFunctionTemplates(options?: TemplateListOptions): Promise<TemplateListResult>

applyFunctionTemplate(targetDir: string, options: TemplateApplyOptions): Promise<TemplateApplyResult>
```

The library API is intended for VS Code extensions and other host integrations that need deterministic template application without routing large file payloads through an LLM.

## Acceptance Criteria

- `template list` returns the same template IDs available in the public manifest for the selected filters.
- `template apply` can create a new project from a manifest-backed template.
- `template apply --mode add` can add a function to an existing project without reinitializing it.
- The default path does not call MCP or emit full template file contents to stdout.
- MCP fallback is explicit or used only when manifest resolution fails.
