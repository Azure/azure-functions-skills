---
name: azure-functions-e2e-tests
title: Azure Functions Skills E2E Tests
description: "Use in Agent mode when designing, running, or reporting real end-to-end tests for Azure Functions Skills across GitHub Copilot, Claude Code, and Codex plugin/setup/chat flows."
category: task
---

> **Language**: Reply in the user's language. Default generated shareable E2E reports to English unless the user asks for another language.

# Azure Functions Skills E2E Tests

Use this skill in **Agent mode** to run and summarize real end-to-end validation of Azure Functions Skills across coding agents. When the user asks to test, run the full local scenario matrix by default and report blocked, unsupported, and failed scenarios with evidence and root-cause analysis.

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
3. **Scenario references first** — select scenarios from [scenarios.md](references/scenarios.md) and keep the run checklist inside `reports/e2e/<run-id>/`, not in the repository root.
4. **Agent-visible proof required** — setup, chat, and plugin scenarios must prove that the target coding agent can see or use the installed `skills`, `prompts`, `mcp`, `hooks`, and `agents`; file existence alone is not enough.
   Prefer a machine-readable inspection artifact for this proof. The artifact may be written by the runner from the agent's noninteractive output; do not require the agent itself to write the file when that would trigger local write approval.
5. **Documented command contract** — plugin/setup/chat scenarios must use the documented command sequence from README or generated CLI help, then launch the target agent with an inspection prompt.
6. **No silent scope reduction** — do not omit GitHub Copilot, Claude Code, Codex, setup, chat, plugin, docs consistency, basic help, or Azure Skills dependency scenarios unless the user explicitly narrows scope in the current request. If a scenario cannot run, execute the discovery/version/help command needed to prove why and record it as `blocked`, `unsupported`, or `fail`; never leave it out of the matrix.
7. **Fresh plugin install semantics** — plugin scenarios test installation, not reuse. Before installing, inspect existing plugin state, uninstall/remove the target `azure-functions-skills` plugin with the official CLI when approved and supported, then reinstall through the documented flow. If cleanup is unsafe, denied, unsupported, or interactive-only, record the cleanup check and classify the plugin scenario as `blocked` unless an isolated config location proves a fresh install.
8. **No false warnings** — if a required command was not run, exited non-zero, timed out, or did not prove required visibility, mark the scenario `fail` or `blocked`, not `warning`. Use `warning` only when every required check passed and only non-blocking concerns remain.
9. **Evidence before judgment** — record command output, file evidence, agent version, package version, prompt transcript, plugin pre-state, cleanup/uninstall result, post-install state, and support status before concluding.
10. **Redact aggressively** — never publish tokens, function keys, publish profiles, connection strings, secrets, or personal local paths.
11. **Separate unsupported from failed** — mark a scenario `unsupported` when the agent or platform cannot support the flow; mark it `blocked` when local prerequisites, credentials, approvals, or safe isolation are missing; mark it `fail` when expected behavior is broken.
12. **Beautiful report by the agent** — author the HTML report directly from evidence. Match the quality of the design report style: readable layout, summary cards, matrices, clear colors, failure analysis, and recommended fixes.
13. **Review the review** — after drafting evidence and reports, perform a cross-check pass over commands, outputs, scenario statuses, and conclusions. Fix omitted scenarios and unsupported/blocked/fail classifications before presenting results.
14. **No repository-root setup pollution** — never run `setup`, `chat`, agent inspection prompts, or generated help/discovery commands from the repository root when they can create files. Commands that may write agent files must run only inside `reports/e2e/<run-id>/workspaces/<scenario-id>/` or another explicitly isolated workspace. For this CLI, do not run `setup --help` from the repository root because setup subcommand help is not guaranteed to be side-effect free; use top-level `--help` for read-only discovery or run subcommand help probes only in a disposable scenario workspace. Prefer absolute `--dir <scenario-workspace>` over cwd-dependent `--dir .` in final command evidence.
15. **Final command list required** — every HTML report must include a `Command Evidence` section with the final execution command sequence for every scenario in the matrix, including pass, warning, blocked, unsupported, and failed scenarios. Do not collapse this down to generic patterns only; readers must be able to see exactly which command shape worked or did not work for each scenario.
16. **Capability Surface Matrix required** — every HTML report must include a `Capability Surface Matrix` that shows, for each coding agent, whether `skills`, `prompts/guidance`, `mcp`, `hooks`, `agent definitions/guidance`, `plugin`, and `chat` are pass, warning, fail, blocked, or unsupported. Do not remove this matrix when adding command evidence.
17. **Target-specific agent surfaces** — do not judge every host by GitHub Copilot `.agent.md` semantics. GitHub Copilot uses `.github/agents/*.agent.md` or installed plugin agents; Claude Code uses `CLAUDE.md`, skills, hooks, and MCP and may intentionally omit unsupported `agents` manifest metadata; Codex setup guidance uses `AGENTS.md` and `.agents/skills`, while plugin custom-agent activation must be reported separately if not visible.

## Manual-first execution guidance

When CLI behavior is uncertain, the user asks for a fresh manual run, or a prior automated runner has hidden failures, execute scenarios one at a time instead of batching the matrix behind a custom runner.

- Create `reports/e2e/<run-id>/checklist.md` and `reports/e2e/<run-id>/evidence.md` first.
- Run exactly one scenario in `reports/e2e/<run-id>/workspaces/<scenario-id>/`.
- Immediately record the command, exit status, agent-visible response, and what made the scenario work before starting the next scenario.
- Do not use a custom runner as the source of truth until the manual command shape is proven for that agent and scenario type.
- If a command hangs, times out, or produces confusing output, stop that scenario, capture the failure, simplify the command, and rerun only that scenario.
- Keep inspection prompts in a PowerShell variable so the prompt is passed as one argument on Windows.
- Resolve run directories from the repository root at the start of every scenario. Do not keep relative `reports/e2e/...` variables across `Set-Location` calls.
- Use the workspace harness and scenario command contracts in [scenarios.md](references/scenarios.md). Keep concrete command sequences there so this skill remains small and does not contradict the references.

Key caveats that affect classification:

- If cwd drift nests one scenario under another, discard that evidence as harness-invalid and rerun; do not report a product failure.
- GitHub Copilot chat and GitHub Copilot installed-plugin inspection use different discovery paths and agent id contracts. `setup --agent ghcp` is a setup target id; `chat --agent github-copilot` is the chat launcher id; `copilot --agent azure-functions-skills:functions-copilot` is the installed-plugin inspection id. Validate `chat-welcome-ghcp` through the normal `chat --agent github-copilot` launcher with headless Copilot passthrough or a workspace artifact; validate `plugin-install-ghcp` after cleanup/install with the qualified installed-plugin agent.
- Subcommand help, Claude plugin validation, Codex plugin activation, and `azd` hook coverage have known CLI caveats. Use the detailed rules in [scenarios.md](references/scenarios.md) and report-schema checks rather than repeating them here.
- F15 install/routing flows intentionally separate global plugin payload from workspace activation. The default plugin payload is skills-only, while the user-facing `install` command performs plugin install plus workspace activation in one step. MCP/hooks are expected from `install` workspace activation by default, not from the global plugin payload alone.

## Execution policy

When the user asks to run or validate E2E tests:

1. Build a dynamic inventory from the current repository:
   - `templates/skills/*/SKILL.md` for expected Azure Functions skills.
   - `templates/prompts/`, `templates/mcp/`, `templates/hooks/`, and `templates/agents/` for expected prompts, MCP, hooks, and agent definitions.
   - `.github/plugins/azure-functions-skills/` and generated plugin manifests for plugin payload expectations.
   - The default plugin payload profile is skills-only. Treat MCP, hooks, and agent definitions in plugin payloads as opt-in/full-profile expectations only.
   - README and package scripts for documented setup/chat/plugin commands.
2. Create a run directory at `reports/e2e/<run-id>/` and one isolated temporary workspace per agent and install mode under `reports/e2e/<run-id>/workspaces/<scenario-id>/`. Do not reuse the repository root as a test workspace.
   - Resolve `reports/e2e/<run-id>` from `git rev-parse --show-toplevel` or the current workspace root. Avoid drive-letter-specific paths in instructions, scripts, and reports. Use `Join-Path` in PowerShell and quoted path variables in Bash.
3. For each target agent (`ghcp`, `codex`, `claude`) and each mode (`plugin`, `setup`, `chat`):
   - Start from a clean isolated workspace under `reports/e2e/<run-id>/workspaces/<scenario-id>/` and, when safe, a clean isolated agent/plugin config location.
   - Set the command working directory to the scenario workspace before running any command that can write files, including `npx @agent-loom/azure-functions-skills setup`, `node bin/azure-functions-skills.js setup`, `chat`, `copilot -p`, `claude -p`, and `codex exec`.
   - When a command must reference repository sources, pass absolute paths or explicit `--dir <scenario-workspace>` arguments while keeping the process cwd in the scenario workspace whenever practical. Do not use `--dir .` in reusable command text unless the same command block first proves `Get-Location`/`pwd` is the scenario workspace.
   - Before leaving a scenario, run a targeted `git status --short` check for root-level `.agents`, `.claude`, `.codex`, `.github/agents`, `.github/hooks`, `.github/skills/<non-e2e>`, `AGENTS.md`, and `CLAUDE.md`. If any were created outside `reports/e2e/<run-id>/workspaces/`, treat that as a failed scenario cleanup issue and remove only those generated artifacts after confirming they are untracked.
   - Do not skip an agent or mode because it failed in a previous run, is expected to fail, or is inconvenient to automate. Run the scenario until it passes, fails, blocks, or proves unsupported.
   - If the CLI is missing, run and record the version/discovery command that proves it is missing, then mark all scenarios for that agent `blocked` rather than omitting them.
   - If plugin cleanup would mutate real user-level state, ask for approval before uninstalling/removing the target plugin or marketplace. Never silently delete config files. Prefer official CLI uninstall/remove commands over manual filesystem edits. If approval is unavailable, use a documented isolated config/profile location when the CLI supports one; otherwise mark the plugin cleanup check `blocked`.
   - Install or register `azure-functions-skills` using the documented flow for that mode.
   - For CLI-mediated first-run flows, run `azure-functions-skills install --dry-run` before destructive/global install attempts and record both planned host plugin commands and planned workspace activation files.
   - For install/workspace activation flows, cover `install --yes`, `install --local`, passthrough after `--`, `workspace apply --dry-run`, existing `CLAUDE.md`/`AGENTS.md` refusal, `--yes`, `include-file`, and explicit `--include-mcp`/`--include-hooks` behavior.
   - Verify whether the dependent `azure-skills` surfaces are present or whether clear install guidance is shown.
   - Launch the actual coding-agent CLI with an inspection prompt. The prompt must ask it to report visible/usable `agents`, `skills`, `prompts`, `mcp`, `hooks`, plugin surfaces, and Azure Skills dependency surfaces. Treat missing agent-response evidence as `blocked` or `fail` according to the cause.
   - For `chat`, use the `azure-functions-skills chat` command itself as the launcher under test and follow the agent-specific proof method in [scenarios.md](references/scenarios.md). Direct agent commands are diagnostics only unless the scenario reference explicitly allows them.
4. For plugin scenarios, the command sequence is part of the test contract:
   - Every plugin scenario must begin with pre-state discovery, then target cleanup, then install/register, then post-install state, then agent inspection. Existing plugin installation is normal pre-state, not a failure, but reuse without cleanup/isolation cannot pass a fresh-install scenario.
   - Follow the cleanup/install commands in [scenarios.md](references/scenarios.md). If cleanup mutates user-level state, ask for approval first. If cleanup is unavailable, denied, unsupported, or interactive-only, classify cleanup as `blocked` and do not mark the plugin scenario `pass`.
   - Do not uninstall unrelated plugins. Do not uninstall the dependent `azure-skills` plugin unless the selected dependency scenario explicitly requires a missing-dependency state and the user approves it. Otherwise record whether Azure Skills is present or absent.
   - If a documented plugin command is unavailable, interactive-only, or contradicts current CLI help, record the command attempt and classify the scenario as `blocked` or `fail` with analysis; do not silently substitute setup-mode file checks.
5. Capture every command used for evaluation:
   - Command text, cwd, environment assumptions, start/end time, exit code, and redacted stdout/stderr excerpt.
   - The recorded `cwd` for setup/chat/agent-inspection commands must be the scenario workspace under `reports/e2e/<run-id>/workspaces/<scenario-id>/`. If a command is intentionally run from another directory, record why it was safe and why it could not write repository-root agent files.
   - In the HTML report, put command details and output in collapsed `<details><summary>...</summary>...</details>` sections so readers can inspect them without overwhelming the summary.
   - Also include a scenario-by-scenario final command list in the HTML report's `Command Evidence` section. This list must cover every selected scenario, even when the result is `blocked`, `unsupported`, or `fail`, and must show the final command sequence used after any manual iteration or recovery.
6. Workspace retention:
   - Before cleanup, ask the user whether to keep failed scenario workspaces, keep all workspaces, or delete all temporary workspaces.
   - If the user keeps workspaces, record retained paths in the evidence/report after redacting user-specific path segments where sharing externally.
   - If no answer is available, keep failed workspaces when practical and delete passing workspaces.
7. Authentication and local prerequisites:
   - Because this starts as a local E2E workflow, it is acceptable to ask the user to authenticate, approve a CLI prompt, reload VS Code, or run a one-time login when a real agent/plugin flow is blocked by auth.
   - Do not mark auth-blocked scenarios as fail unless authentication should already have been available according to the scenario contract; otherwise use `blocked` with clear next steps.
8. Prefer automation-friendly CLI options before asking the user for manual interaction. The exact command shapes live in [scenarios.md](references/scenarios.md); use them as the source of truth for GitHub Copilot, Claude Code, and Codex setup/chat/plugin inspection.
9. If an agent or mode cannot support a surface, report `unsupported` with a reason. If a CLI hangs, lacks authentication, or cannot safely isolate plugin state, report `blocked`. If a surface should work but does not, report `fail` with failure analysis.
10. Run local static checks as follow-up: `npm run check` when practical, or focused tests when the user asks for a narrow scope.
11. Do not run live Azure scenarios unless the user explicitly asks and the protected Azure/OIDC environment is available.
12. Always write structured evidence and a human-readable report, even when some scenarios are blocked or unsupported.

## Report publishing

The coding agent creates the report from collected evidence in `reports/e2e/<run-id>/`. Date-stamped run directories are analysis-only and should remain ignored by git. The only report artifact intended for commit is `reports/e2e/current/report.html`.

At the end of every run, after cross-checking the report, overwrite `reports/e2e/current/report.html` with the reviewed `reports/e2e/<run-id>/report.html`. Do not copy `evidence.json`, transcripts, retained workspaces, session notes, or skill-improvement reports into `current/` unless the user explicitly asks. Do not rely on a report-generation or report-submission script as the source of truth.

## Workflow

1. **Create the run checklist**
   - Create it at `reports/e2e/<run-id>/checklist.md` or inside the run evidence file. Do not create `E2E-RUN-<timestamp>.md` in the repository root.
   - Include target agents, install modes, platform, package version, selected scenarios, dynamic inventory source paths, and expected surface counts.
   - Unless the user explicitly requested a narrower scope in the current request, include all P0/P1 local scenarios for GitHub Copilot, Claude Code, and Codex: setup, chat, plugin, docs consistency, basic help, and Azure Skills dependency.
   - If a target agent or mode is not runnable, keep the scenario in the checklist and mark it `[blocked]`, `[unsupported]`, or `[failed]` with evidence. Do not delete it from the run.
   - Track each scenario as `[ ]`, then update to `[x]`, `[blocked]`, `[unsupported]`, or `[failed]`.

2. **Collect environment information**
   - Agent CLI availability and versions.
   - OS and shell.
   - Current repository commit and package version.
   - Whether plugin, setup, chat, and Azure Skills dependency flows are in scope.
   - Current template inventory and generated plugin payload inventory.

3. **Run scenarios**
   - Run plugin, setup, and chat scenarios for GitHub Copilot, Codex, and Claude, plus shared docs, basic-help, and Azure Skills dependency checks unless the user explicitly narrowed the run.
   - Do not skip GitHub Copilot because Claude/Codex were the focus of a previous failure, and do not skip plugin scenarios because they are likely to fail. Expected failures are still E2E results.
   - Isolate each run in `reports/e2e/<run-id>/workspaces/<scenario-id>/` unless the user intentionally targets an existing workspace.
   - Run setup/chat commands from the scenario workspace and pass `--dir <scenario-workspace>` explicitly when invoking this repository's CLI. Never allow `setup` or `chat` to default to the repository root, and do not publish final command evidence that relies on `--dir .` without showing the cwd guard.
   - For plugin scenarios, capture pre-state, approved cleanup/uninstall or isolation, install/register, post-state, and agent-visible inspection. Existing installed target plugins must be removed or isolated before a scenario can pass.
   - Capture evidence for every check in the scenario.
   - Capture command details and redacted command output for every command that affects the result.
   - When blocked by authentication or an interactive local approval, ask the user for help before marking the scenario.
   - Continue through remaining scenarios after failures unless the failure indicates a safety risk.

4. **Write structured evidence**
   - Use the JSON shape in [report-schema.md](references/report-schema.md).
   - Keep raw transcripts separate and redact before publishing.

5. **Create the report**
   - Include scenario x agent support status, versions, test datetime, platform, failure evidence, unsupported reasons, and recommended fixes.
   - Include a capability surface matrix for GitHub Copilot, Claude Code, and Codex across `plugin`, `skills`, `prompts/guidance`, `mcp`, `hooks`, `agent definitions/guidance`, and `chat`.
   - In the capability surface matrix, distinguish file/layout support from runtime active-context proof. For example, Claude `agents` metadata can be `unsupported` while Claude `agent guidance` is `pass`; Codex `AGENTS.md` guidance can be `pass` while Codex plugin custom-agent activation is `warning` or `unsupported` if not visible.
   - Include detailed evidence for how each surface was checked: dynamic inventory source, generated file path, launch command, agent response excerpt, and unsupported/block/fail reason.
   - Include the final execution commands for every scenario in `Command Evidence`. The section must show the actual scenario command sequence, not only reusable command patterns or examples.
   - Include collapsed command logs with command, cwd, exit code, and redacted output.
   - Include retained workspace paths or cleanup status for every scenario.
   - Include failure analysis that explains why a failure occurred and what should be fixed next.
   - HTML reports must be hand-authored by the agent from the JSON evidence and should be suitable for sharing.
   - After review, copy the final HTML to `reports/e2e/current/report.html`; this is the only E2E report file intended for commit.

6. **Create the skill improvement report**
   - Write a short companion report, for example `reports/e2e/<run-id>/skill-improvement.md`.
   - Include places where the agent struggled while running the skill: command option discovery, unclear docs, missing scenario guidance, auth prompts, CLI non-interactive limitations, report-writing ambiguity, or tool limitations.
   - Convert each struggle into a proposed improvement for `SKILL.md`, scenario references, README docs, or future automation.

7. **Cross-check before final answer**
   - Re-read `evidence.json`, `report.md`, `report.html`, retained workspace notes, and the skill improvement report.
   - Check for contradictions such as a scenario marked `pass` while a command failed, unsupported plugin capability reported as supported, missing command logs, omitted default-scope scenarios, missing plugin pre-state/cleanup/post-state evidence, or missing failure analysis.
   - Check `git status --short` and verify no generated root-level agent setup files exist outside the ignored date-stamped run directory and the allowed `reports/e2e/current/report.html` publish target.
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
