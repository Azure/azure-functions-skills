---
name: azure-functions-e2e-tests
title: Azure Functions Skills E2E Tests
description: "Use in Agent mode when designing, running, or reporting real end-to-end tests for Azure Functions Skills across GitHub Copilot, Claude Code, and Codex plugin/setup/chat flows."
category: task
---

> **Language**: Reply in the user's language. Default generated shareable E2E reports to English unless the user asks for another language.

# Azure Functions Skills E2E Tests

Use this skill in **Agent mode** to run and summarize real end-to-end validation of Azure Functions Skills across coding agents. When the user asks to test, run the safe local scenarios that are available in the current environment and report blocked, unsupported, and failed scenarios with evidence and root-cause analysis.

## Agent mode requirement

This skill is intended for Agent mode, not passive chat.

- If the current chat cannot run terminal commands or edit/check files, tell the user to switch to Agent mode before continuing.
- In Agent mode, run the workflow directly: inventory the current templates, create isolated temporary workspaces, invoke real coding-agent CLIs, inspect evidence, author a high-quality HTML report, and summarize results.
- Do not merely print commands for the user to run unless tool execution is unavailable or the user explicitly asks for manual commands.

## When to use

- The user asks to run E2E tests for Azure Functions Skills.
- The user asks whether GitHub Copilot, Claude Code, or Codex support plugin/setup/chat flows.
- The user wants a scenario-by-agent support matrix or HTML report.
- A plugin install, workspace setup, chat startup, hook, MCP, prompt, or skill visibility issue needs reproducible evidence.
- The user wants to compare README guidance with actual agent behavior.

## Core rules

1. **Real agents, not fakes** — use real install commands and real coding-agent CLIs when available. Do not replace E2E validation with mocks, hard-coded template expectations, or generated-report scripts.
2. **Dynamic inventory** — derive expected `skills`, `prompts`, `mcp`, `hooks`, `agents`, plugin payload files, and Azure Skills dependency checks from the current repository files and docs at run time. Do not hard-code today's template names.
3. **Scenario references first** — select scenarios from [scenarios.md](references/scenarios.md) and keep a short `E2E-RUN-<timestamp>.md` checklist while running them.
4. **Agent-visible proof required** — setup, chat, and plugin scenarios must prove that the target coding agent can see or use the installed `skills`, `prompts`, `mcp`, `hooks`, and `agents`; file existence alone is not enough.
5. **Documented command contract** — plugin/setup/chat scenarios must use the documented command sequence from README or generated CLI help, then launch the target agent with an inspection prompt.
6. **No false warnings** — if a required command was not run, exited non-zero, timed out, or did not prove required visibility, mark the scenario `fail` or `blocked`, not `warning`. Use `warning` only when every required check passed and only non-blocking concerns remain.
7. **Evidence before judgment** — record command output, file evidence, agent version, package version, prompt transcript, and support status before concluding.
8. **Redact aggressively** — never publish tokens, function keys, publish profiles, connection strings, secrets, or personal local paths.
9. **Separate unsupported from failed** — mark a scenario `unsupported` when the agent or platform cannot support the flow; mark it `blocked` when local prerequisites, credentials, or safe isolation are missing; mark it `fail` when expected behavior is broken.
10. **Beautiful report by the agent** — author the HTML report directly from evidence. Match the quality of the design report style: readable layout, summary cards, matrices, clear colors, failure analysis, and recommended fixes.
11. **Review the review** — after drafting evidence and reports, perform a cross-check pass over commands, outputs, scenario statuses, and conclusions. Fix unsupported/blocked/fail classifications before presenting results.

## Execution policy

When the user asks to run or validate E2E tests:

1. Build a dynamic inventory from the current repository:
   - `templates/skills/*/SKILL.md` for expected Azure Functions skills.
   - `templates/prompts/`, `templates/mcp/`, `templates/hooks/`, and `templates/agents/` for expected prompts, MCP, hooks, and agent definitions.
   - `.github/plugins/azure-functions-skills/` and generated plugin manifests for plugin payload expectations.
   - README and package scripts for documented setup/chat/plugin commands.
2. Create one isolated temporary workspace per agent and install mode. Do not reuse the repository root as a test workspace.
3. For each target agent (`ghcp`, `codex`, `claude`) and each mode (`plugin`, `setup`, `chat`):
   - Start from a clean isolated workspace and, when safe, a clean isolated agent/plugin config location.
   - If clearing real user-level plugin state would mutate the user's profile, ask for approval or mark the cleanup check `blocked`; never silently delete global config.
   - Install or register `azure-functions-skills` using the documented flow for that mode.
   - Verify whether the dependent `azure-skills` surfaces are present or whether clear install guidance is shown.
   - Launch the actual coding-agent CLI with an inspection prompt. The prompt must ask it to report visible/usable `agents`, `skills`, `prompts`, `mcp`, `hooks`, plugin surfaces, and Azure Skills dependency surfaces. Treat missing agent-response evidence as `blocked` or `fail` according to the cause.
   - For `chat`, also verify that startup loads the intended agent and welcome/startup message.
4. For plugin scenarios, the command sequence is part of the test contract:
   - GitHub Copilot CLI must follow README order: `copilot plugin marketplace add Azure/azure-functions-skills`, then `copilot plugin install azure-functions-skills@azure-functions-skills`, then run Copilot with the Functions agent, for example `copilot --agent functions-copilot -p "<inspection prompt>"`.
   - Claude Code must follow the README plugin-from-source flow: clone or use the repo source, run `claude --add-dir <plugin-payload-dir>`, then run Claude with an inspection prompt in the isolated workspace.
   - Codex must follow the README Codex plugin flow: `codex plugin marketplace add Azure/azure-functions-skills`, install/select `azure-functions-skills` from `/plugins` when supported, then run Codex with an inspection prompt in the isolated workspace.
   - If a documented plugin command is unavailable, interactive-only, or contradicts current CLI help, record the command attempt and classify the scenario as `blocked` or `fail` with analysis; do not silently substitute setup-mode file checks.
5. Capture every command used for evaluation:
   - Command text, cwd, environment assumptions, start/end time, exit code, and redacted stdout/stderr excerpt.
   - In the HTML report, put command details and output in collapsed `<details><summary>...</summary>...</details>` sections so readers can inspect them without overwhelming the summary.
6. Workspace retention:
   - Before cleanup, ask the user whether to keep failed scenario workspaces, keep all workspaces, or delete all temporary workspaces.
   - If the user keeps workspaces, record retained paths in the evidence/report after redacting user-specific path segments where sharing externally.
   - If no answer is available, keep failed workspaces when practical and delete passing workspaces.
7. Authentication and local prerequisites:
   - Because this starts as a local E2E workflow, it is acceptable to ask the user to authenticate, approve a CLI prompt, reload VS Code, or run a one-time login when a real agent/plugin flow is blocked by auth.
   - Do not mark auth-blocked scenarios as fail unless authentication should already have been available according to the scenario contract; otherwise use `blocked` with clear next steps.
8. If an agent or mode cannot support a surface, report `unsupported` with a reason. If a CLI hangs, lacks authentication, or cannot safely isolate plugin state, report `blocked`. If a surface should work but does not, report `fail` with failure analysis.
9. Run local static checks as follow-up: `npm run check` when practical, or focused tests when the user asks for a narrow scope.
10. Do not run live Azure scenarios unless the user explicitly asks and the protected Azure/OIDC environment is available.
11. Always write structured evidence and a human-readable report, even when some scenarios are blocked or unsupported.

## Report publishing

The coding agent creates the report from collected evidence. When the user asks to publish or attach a report to a PR, copy or stage the reviewed `report.html` to the requested destination, such as `reports/e2e/current/report.html`. Do not rely on a report-generation or report-submission script as the source of truth.

## Workflow

1. **Create the run checklist**
   - Include target agents, install modes, platform, package version, selected scenarios, dynamic inventory source paths, and expected surface counts.
   - Track each scenario as `[ ]`, then update to `[x]`, `[blocked]`, `[unsupported]`, or `[failed]`.

2. **Collect environment information**
   - Agent CLI availability and versions.
   - OS and shell.
   - Current repository commit and package version.
   - Whether plugin, setup, chat, and Azure Skills dependency flows are in scope.
   - Current template inventory and generated plugin payload inventory.

3. **Run scenarios**
   - Run plugin, setup, and chat scenarios for GitHub Copilot, Codex, and Claude.
   - Isolate each run in a temporary workspace unless the user intentionally targets an existing workspace.
   - Capture evidence for every check in the scenario.
   - Capture command details and redacted command output for every command that affects the result.
   - When blocked by authentication or an interactive local approval, ask the user for help before marking the scenario.
   - Continue through remaining scenarios after failures unless the failure indicates a safety risk.

4. **Write structured evidence**
   - Use the JSON shape in [report-schema.md](references/report-schema.md).
   - Keep raw transcripts separate and redact before publishing.

5. **Create the report**
   - Include scenario x agent support status, versions, test datetime, platform, failure evidence, unsupported reasons, and recommended fixes.
   - Include a capability surface matrix for GitHub Copilot, Claude Code, and Codex across `plugin`, `skills`, `prompts`, `mcp`, `hooks`, and `agents`.
   - Include detailed evidence for how each surface was checked: dynamic inventory source, generated file path, launch command, agent response excerpt, and unsupported/block/fail reason.
   - Include collapsed command logs with command, cwd, exit code, and redacted output.
   - Include retained workspace paths or cleanup status for every scenario.
   - Include failure analysis that explains why a failure occurred and what should be fixed next.
   - HTML reports must be hand-authored by the agent from the JSON evidence and should be suitable for sharing.

6. **Create the skill improvement report**
   - Write a short companion report, for example `reports/e2e/<run-id>/skill-improvement.md`.
   - Include places where the agent struggled while running the skill: command option discovery, unclear docs, missing scenario guidance, auth prompts, CLI non-interactive limitations, report-writing ambiguity, or tool limitations.
   - Convert each struggle into a proposed improvement for `SKILL.md`, scenario references, README docs, or future automation.

7. **Cross-check before final answer**
   - Re-read `evidence.json`, `report.md`, `report.html`, retained workspace notes, and the skill improvement report.
   - Check for contradictions such as a scenario marked `pass` while a command failed, unsupported plugin capability reported as supported, missing command logs, or missing failure analysis.
   - If available, ask another model/agent or reviewer pass to critique the conclusion; otherwise perform an explicit self-review section in the report.
   - Record the cross-check result in the HTML report and final chat summary.

8. **README integration only when requested**
   - Do not update README badges or report links unless the user explicitly asks or the run is in CI publishing mode.
   - Badge status must be derived from latest evidence, not manually guessed.

## References

- Scenario catalog: [scenarios.md](references/scenarios.md)
- Report and evidence schema: [report-schema.md](references/report-schema.md)
- CI rollout and security boundaries: [ci-strategy.md](references/ci-strategy.md)
- Support status definitions: [support-matrix.md](references/support-matrix.md)

## Output summary

End each run with:

```text
Run ID:
Package version:
Agents tested:
Scenarios completed:
Support summary:
Failures / unsupported cases:
Report path:
Next recommended scenario:
```
