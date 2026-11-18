# Hosted Skills development

This project was created by the Azure Functions Hosted Skills starter. It is
already scaffolded: do not fetch or reapply a template to begin development.
`.azure-functions-skills/templates/<template>.json` records which sample and
commit the app came from.

Use the skills installed in this directory, in `.agents/skills/` (GitHub
Copilot, Codex) or `.claude/skills/` (Claude Code), not same-named skills from
another plugin:

- `azure-functions-hosted-skills`: authoring, runtime, triggers, deployment, and
  troubleshooting.
- `azure-functions-hosted-skills-migrate`: migration of an existing workflow.
  Use it only when the user asks for it by name; never start it automatically.
- `azure-functions-connector-create`: connection, identity, and consent.
- `azure-functions-connector-mcp`: operation schemas and MCP configuration.
- `azure-functions-connector-validate`: connection and side-effect validation.

No development MCP server is required to edit this project. Do not open a
Canvas unless the user asks for one.

The app is the official daily-blog sample: a chat agent, a daily timer, dynamic
sessions, and optional Outlook infrastructure. Before adapting it, understand
the user's scenario. Remove or replace sample agents that do not belong to it;
do not keep a timer or chat endpoint only for testing. Keep local settings and
infrastructure parameters consistent with each other.

Setup made the project ready to author, not to run or deploy. It did not
install Python, Core Tools, Azurite, or azd, sign in, provision resources, or
validate a model connection. Check those prerequisites when the user asks for
that step. A tool on `PATH` does not mean cloud access is set up.

Ask the user before you install tools, start hosts or containers, send
messages, provision Azure resources, or deploy. Never commit
`src/local.settings.json`, credentials, or local environment state.

Usage telemetry for these skills is on by default. To turn it off, set
`"enabled": false` in `.azure-functions-skills/telemetry.config.json` or set
`AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY=false`. Do not add duplicate hooks or
send test events. App monitoring is separate; keep sensitive content capture
off.
