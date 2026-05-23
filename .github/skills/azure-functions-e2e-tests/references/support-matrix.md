# Support Matrix Definitions

Use these definitions to keep support status consistent across agents and scenarios.

## Support states

| Support | Meaning |
| --- | --- |
| `supported` | The scenario works end-to-end with required evidence. |
| `partial` | Core behavior works, but one or more non-blocking capabilities are missing or require manual steps. |
| `unsupported` | The agent or platform does not support the scenario by design or current capability. |
| `unknown` | The scenario has not been tested or was inconclusive. |

## Scenario statuses

| Status | Support mapping | Meaning |
| --- | --- | --- |
| `pass` | `supported` | All required checks passed. |
| `warning` | `partial` | All required behavior passed, but non-blocking concerns need follow-up. Do not use this for skipped, failed, timed-out, or unproven required checks. |
| `fail` | `partial` or `unsupported` | Required behavior failed, contradicted documentation, or was not proven after the required command sequence ran. Use evidence to determine support. |
| `blocked` | `unknown` | Could not run due to missing prerequisites or approvals. |
| `unsupported` | `unsupported` | Capability is not supported or not applicable. |

## Initial matrix rows

| Scenario | GitHub Copilot | Claude Code | Codex |
| --- | --- | --- | --- |
| `setup-workspace-*` | Expected supported | Expected supported | Expected supported |
| `chat-welcome-*` | Expected supported | Expected supported | Expected supported |
| `plugin-install-*` | Expected supported for default skills-only plugin after cleanup-first README/CLI command sequence and qualified installed-plugin inspection such as `azure-functions-skills:functions-copilot` pass | Expected supported/partial only after README `claude --add-dir` or `--plugin-dir` flow and inspection pass; default payload is skills-only | Expected supported/partial only after README Codex marketplace flow and inspection pass; default payload is skills-only |
| `workspace-activation-*` | Expected supported for thin routing, `--yes`, include-file, and opt-in MCP/hooks | Expected supported for thin routing, `--yes`, include-file, and opt-in MCP; hooks unsupported unless Claude adds a supported surface | Expected supported for thin routing, `--yes`, include-file, opt-in MCP, and cross-platform Node hooks |
| `docs-command-consistency` | Shared static scenario | Shared static scenario | Shared static scenario |
| `basic-help-prompt` | Expected supported | Expected supported | Expected supported |
| `azure-skills-dependency` | Expected supported | Not applicable unless Claude dependency flow exists | Expected supported where plugin flow supports it |

## Badge derivation guidance

Agent badges should be derived from latest evidence:

- `passing`: all P0 scenarios pass and no critical P1 failures.
- `partial`: all P0 scenarios pass but one or more P1 scenarios warn, fail, or are unsupported.
- `failing`: any P0 scenario fails.
- `unknown`: required scenarios were not run.

Do not manually edit badge status without updating the evidence JSON.
