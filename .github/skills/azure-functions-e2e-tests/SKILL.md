---
name: azure-functions-e2e-tests
title: Azure Functions Skills E2E Tests
description: "Use in Agent mode when designing, running, or reporting real end-to-end tests for Azure Functions Skills across GitHub Copilot, Claude Code, and Codex plugin/setup/chat flows."
category: task
---

> **Language**: Reply in the user's language. Default generated reports to English unless the user asks for another language.

# Azure Functions Skills E2E Tests

Prescriptive E2E test runner for Azure Functions Skills CLI. This skill executes a fixed set of test cases with explicit commands — no skipping, no shortcuts.

## Execution protocol

**MANDATORY RULES — violations make the run invalid:**

1. **Load the command reference** — read [commands.md](references/commands.md) FIRST. It contains every test case with numbered commands.
2. **Create a checklist file** at `reports/e2e/<run-id>/checklist.md` BEFORE running any test. The checklist must list every command ID from commands.md.
3. **Execute EVERY numbered command exactly as written** in the command reference. Do NOT skip, summarize, simplify, or batch commands. Each numbered command (e.g., S1GL-1, S1GL-2, ...) must be executed individually and its output recorded.
4. **Copy-paste commands verbatim** — commands in code blocks are copy-paste-ready shell commands. Run them exactly as written, substituting only `$REPO`, `$CLI`, `$WS`, and `$RUN` variables. Do NOT drop flags, truncate argument lists, or remove `-- <passthrough args>` from chat commands.
5. **Chat inspection commands are NOT optional** — every chat command includes a `-p` prompt with `--output-format json -s --allow-all --no-ask-user` (or agent-equivalent flags). These verify that the coding agent actually sees skills/MCP/hooks. Running `chat` without the inspection prompt is a test violation.
6. **Update the checklist** after EACH command completes. Mark with exit code and status.
7. **Record command evidence** — for every command, capture: the exact command text executed, cwd, exit code, stdout excerpt (first 200 lines), stderr excerpt.
8. **Never mark PASS without evidence** — a test case passes ONLY when all its pass criteria are satisfied with recorded evidence.
9. **Continue after failures** — if a test case fails, mark it FAIL and proceed to the NEXT test case with a FRESH workspace. Do not stop the run.
10. **Fresh workspace per test case** — each test case gets its own isolated directory under `reports/e2e/<run-id>/workspaces/<test-case-id>/`. Run `git init` in each workspace before chat commands (required for agent discovery).

## Test matrix

| Agent | Install `--agent` | Chat `--agent` | Plugin inspection |
|-------|-------------------|----------------|-------------------|
| GHCP | `ghcp` | `github-copilot` | `azure-functions-skills:functions-copilot` |
| Claude | `claude` | `claude-code` | host-specific |
| Codex | `codex` | `codex` | host-specific |

Scenarios × modes = test cases:

| Scenario | Install modes | Test case count |
|----------|---------------|-----------------|
| S1: Install + Chat | plugin, local | 6 (3 agents × 2 modes) |
| S2: Old version + Update | plugin, local | 6 (3 agents × 2 modes) |
| **Total** | | **12** |

## Scope selection

Default: run the **full matrix** (12 test cases). The user may narrow scope explicitly:
- By agent: "ghcp only" → only GHCP test cases
- By mode: "local only" or "plugin only" → only that install mode
- By scenario: "S1 only" or "S2 only" → only that scenario
- Single test case: "TC-S1-GHCP-LOCAL" → only that one

If the user does NOT narrow scope, run ALL 12 test cases. Do NOT decide on your own to skip any.

## Preflight checks

Before the matrix, run these commands and record the output. If an agent CLI is missing, mark ALL test cases for that agent as `blocked`:

```
node bin/azure-functions-skills.js --version
node bin/azure-functions-skills.js --help
copilot --version
claude --version
codex --version
```

## Report requirements

Generate `reports/e2e/<run-id>/report.html` with:

1. **Summary cards** — total pass/fail/blocked/unsupported counts, agents tested, timestamp
2. **Test case matrix** — table showing each test case ID, agent, mode, scenario, status
3. **Per-test-case details** — each in a collapsible `<details>` section containing:
   - Test case ID and description
   - Status (pass/fail/blocked/unsupported)
   - Each command executed: command text, cwd, exit code
   - stdout/stderr excerpts in `<pre>` blocks
   - File verification results (files checked, sizes, content excerpts)
   - LLM response excerpts (if chat scenarios were run via LLM)
   - Pass/fail analysis
4. **Issues found** — actionable items with severity
5. **Machine-checkable counters**: `expectedCommandCount`, `actualCommandCount`, `missingCommandIds`

After cross-check, copy final report to `reports/e2e/current/report.html`.

## Workspace isolation

- Test workspaces: `reports/e2e/<run-id>/workspaces/<test-case-id>/`
- NEVER run install/setup/chat from the repository root
- Always use `--dir <workspace>` with absolute paths
- Verify `git status --short` in the repo root after the run — no generated files should leak

## References

- **Command reference (THE source of truth)**: [commands.md](references/commands.md)
- Report schema: [report-schema.md](references/report-schema.md)
- CI strategy: [ci-strategy.md](references/ci-strategy.md)

## Output summary

```text
Run ID:
Package version:
Test cases: <completed>/<total>
  Pass:
  Fail:
  Blocked:
Commands executed: <actual>/<expected>
Report: reports/e2e/<run-id>/report.html
```
