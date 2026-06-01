# Quickstart Reference App

A full quickstart sample is copied into this skill at:

```text
assets/quickstart-sample/
```

Use it as the canonical scaffold example when creating a new app. The copied sample includes:

- `azure.yaml`
- `infra/` with Foundry, Flex Consumption, dynamic sessions, and optional Connector Namespace MCP
  resources
- `src/function_app.py`
- `src/host.json` with a 30-minute function timeout for background-capable scaffolds
- `src/agents.config.yaml`
- `src/main.agent.md`
- `src/daily_microsoft_blog_summary.agent.md` with a 30-minute timer-agent timeout
- `src/mcp.json`
- `src/local.settings.json`
- `src/requirements.txt` with the official `azurefunctions-agents-runtime` PyPI package

## How to Use It

For a new app, copy the directory contents into the project root, then tailor:

1. Rename `azure.yaml` `name` to match the app.
2. Replace sample agents with the user's agents.
3. Keep `main.agent.md` only when the user asks for a chat bot, debug chat UI, chat API, streaming
  API, or built-in MCP endpoint. Remove it for scheduled-only or background-only apps.
4. Keep dynamic sessions when any agent needs web browsing or code execution.
5. Keep the Office 365 connector path only when an agent needs email tools.
6. Update app-specific env vars in `src/local.settings.json` and `infra/main.parameters.json`.
7. Keep `gpt-4.1` default unless intentionally upgrading to a reasoning-capable model.

## Important Difference From the Upstream Sample

This skill copy uses `src/local.settings.json` directly because generated apps should contain a
ready-to-edit local settings file. It still excludes local settings from deployment through
`.funcignore`.

The upstream quickstart may continue to evolve. When refreshing this asset, do not copy `.git`,
`.azure`, or other local state directories.