---
name: azure-functions-e2e-tests
title: Azure Functions Skills E2E Tests
description: "Use in Agent mode when designing, running, or reporting end-to-end tests for Azure Functions Skills workspace-local install and update flows across GitHub Copilot, Claude Code, and Codex layouts."
category: task
---

> **Language**: Reply in the user's language. Default generated reports to English unless the user asks for another language.

# Azure Functions Skills E2E Tests

Prescriptive E2E runner for the package CLI's supported workspace-local distribution surface.

## Execution protocol

1. Read [commands.md](references/commands.md) first.
2. Create `reports/e2e/<run-id>/checklist.md` containing every command ID before execution.
3. Execute every numbered command individually and in order. Substitute only `$REPO`, `$CLI`, `$RUN`, and `$WS`; translate shell syntax only when required by the operating system.
4. After each command, record the exact command, cwd, exit code, the first 200 lines of stdout, and stderr.
5. Update the checklist after each command.
6. Never mark a case as passing without evidence for all of its commands and criteria.
7. Continue after failures, using a fresh workspace for each case.
8. Do not add workaround commands. Record failures as failures.

## Scope

The full matrix contains six local-mode cases:

| Scenario | GHCP | Claude | Codex |
| --- | --- | --- | --- |
| Fresh `install --local` | TC-S1-GHCP-LOCAL | TC-S1-CLAUDE-LOCAL | TC-S1-CODEX-LOCAL |
| Replacement `update --local` | TC-S2-GHCP-LOCAL | TC-S2-CLAUDE-LOCAL | TC-S2-CODEX-LOCAL |

The user may narrow by agent, scenario, or test-case ID. Otherwise run all six.

Plugin installation and coding-agent chat are intentionally out of scope: host tools install plugins, and this package no longer exposes `chat`.

## Prerequisite gate

Only Node.js is required. Run `node --version` and stop if it fails. Coding-agent CLIs and credentials are not required because these tests validate generated workspace assets rather than host-managed plugin installation.

## Preflight

Run and record the two PF commands from `commands.md`.

## Report

Generate `reports/e2e/<run-id>/report.html` with:

1. Summary cards and timestamps.
2. A six-case matrix.
3. Per-case collapsible evidence for every command.
4. File verification and pass/fail analysis.
5. Actionable issues.
6. `expectedCommandCount`, `actualCommandCount`, and `missingCommandIds`.

After a valid cross-check, copy the report to `reports/e2e/current/report.html`.

## Isolation

- Use `reports/e2e/<run-id>/workspaces/<test-case-id>/`.
- Never install or update in the repository root.
- Always pass an absolute `--dir`.
- Check repository `git status --short` after the run for leaked files.

## Mandatory cross-check

After generating the report, use a premium-model rubber-duck agent to compare `commands.md`, `checklist.md`, and `report.html`. It must verify:

- Every command ID has evidence.
- No commands were skipped, batched, simplified, or supplemented with workarounds.
- Verdicts match command exit codes and pass criteria.

Append a `Cross-Check Results` section with reviewer model, verified count, missing commands, workarounds, verdict overrides, and an overall VALID or INVALID result. Re-run an INVALID run.

## References

- [Command reference](references/commands.md)
- [Report schema](references/report-schema.md)
- [CI strategy](references/ci-strategy.md)

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
Published: reports/e2e/current/report.html
```
