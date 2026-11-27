---
name: azure-functions-app
title: Azure Functions App
description: Not for Azure Functions Hosted Skills or Connector work. Do every Azure Functions app task from the coding agent instead of the Azure portal, using the bundled functions-app tool first and direct Azure REST calls (ARM, SCM/Kudu, Functions host admin, Azure Monitor) as the fallback. Use to find and inspect Function Apps, functions, triggers, plans, app settings, keys, health, metrics, logs, deployments, and recent changes; to create or change apps, settings, CORS, identity, scale, slots, keys, VNet integration, private endpoints, and access restrictions, and deploy code; to diagnose network connectivity; and to start, stop, restart, swap, sync triggers, or run functions. Do not use when the conversation is creating, running, or deploying a Hosted Skill, or the app has agents.config.yaml, depends on azurefunctions-agents-runtime, or imports create_function_app() from that runtime; use azure-functions-hosted-skills. Use azure-functions-connector-* for Connector Namespace work.
category: task
---

# Azure Functions App (v2)

> **Language**: Always respond in the same language the user is using.

## Use the tool first

Run the bundled tool with Node 18+. `<skill-dir>` is the directory that contains this file.

```bash
node <skill-dir>/scripts/functions-app.mjs <command> [flags]
node <skill-dir>/scripts/functions-app.mjs help            # all commands
node <skill-dir>/scripts/functions-app.mjs <command> --help
```

It signs in with the current `az` login (then `azd`), never prints tokens, redacts secrets, and
prints one JSON envelope: `ok`, `status`, `summary`, `data`, `findings`, `next`. Add `--lean`
to print `data` only. Show the user `summary` and `findings`; follow `next`.

| Command | Use for |
| --- | --- |
| `app find [--name <part>] [--subscription <id>] [--resource-group <rg>]` | List Function Apps (with portal links) |
| `app inspect --app <name\|id>` | Plan, runtime, scale, storage, identity, security, network, and findings |
| `functions list --app <name\|id>` | Functions, triggers, routes, auth levels |
| `functions invoke --app <name\|id> --function <name> [--method <m>] [--path <p>] [--query k=v] [--header "N: v"] [--body <json> \| --body-file <file\|->] [--approve]` | Call a function once with a key fetched through ARM (never printed): status, time, body. Non-GET and non-HTTP triggers need approval (R1) |
| `settings list --app <name\|id>` | App settings and connection strings (redacted), sticky flags, Key Vault reference status |
| `settings set --app <name\|id> (--name <n> --value <v> \| --name <n> --value-file <file\|-> \| --set N=V ...) [--connection-string [--type <t>]] [--sticky] [--approve]` | Add or change settings: full-collection merge, Flex pre-check, Key Vault reference check, verified; `--sticky` makes them slot settings (R1; R2 when replacing) |
| `settings delete --app <name\|id> --name <n> [--name <n2>] [--connection-string] [--approve]` | Remove settings; every other value is kept, verified (R2) |
| `keys list --app <name\|id> [--function <name>]` | Host or function key names (never values) |
| `host status --app <name\|id> [--full]` | Functions host state, version, and errors |
| `deployments list --app <name\|id>` | SCM deployment history |
| `logs query --app <name\|id> [--preset <name>] [--since 1h] [--kql <q> \| --kql-file <file\|->]` | Application Insights logs (presets: errors, exceptions, failures, requests, traces, instances) |
| `logs tail --app <name\|id> [--seconds 30] [--invoke <fn>]` | Live log stream for a bounded time, plus current instances; `--invoke` calls a function while watching |
| `changes --app <name\|id> [--since 24h] [--all]` | What changed (Activity Log; `--all` includes policy and list actions) |
| `restart --app <name\|id> [--approve]` | Restart once and verify the host came back (R1) |
| `slots list --app <name\|id>` | Production and slots: state, host name, sticky setting names, shared content share |
| `slots swap --app <name\|id> --slot <source> [--target <slot>] [--check-function <name>] [--approve]` | Swap once (into production by default), then verify swap status, both hosts, builds, Key Vault references (R2) |
| `vnet integrate --app <name\|id> (--subnet <id> \| --vnet <id\|name> --create-subnet \| --create-vnet) [--approve]` | Regional VNet integration: picks a free prefix, delegates the subnet, verifies (R1) |
| `vnet remove --app <name\|id> [--approve]` | Remove VNet integration; the subnet is kept (R2) |
| `rest <METHOD> <arm-path\|url> [--api-version <v>] [--query k=v] [--body-file <file\|->] [--approve]` | Any Azure REST call the commands above do not cover |
| `docs list` | Recipe topics and the bundled Learn index version |
| `docs search <words> [--layer all\|recipe\|learn] [--lang <l>] [--plan <p>]` | Recipes (how, with this tool) and Microsoft Learn sections (product facts, limits) |
| `docs get <id>` | Read one recipe or `learn:<article>#<section>` |
| `api find <words> [--method <verb>]` | Look up an Azure REST operation (path, api-version, long-running) |

`--app` takes a name or a full resource ID. Add `--slot <name>` to target a deployment slot with
any `--app` command. If a name matches more than one app, the tool lists
the matches; ask the user which one. Write commands without `--approve` only print the plan
(exit 5); they never change anything.

## Fallback order

1. A tool command that does the task.
2. `docs search` → `docs get <id>` → run the recipe's calls with `rest`.
3. `api find` → `rest` with the returned path and api-version.
4. Nothing matches: say so and stop. **Never guess a URL, api-version, or body.**

Recipes may show `az rest --method <M> --url <U> --body @f.json`; run it as
`rest <M> <U> --body-file f.json`. Use `az rest` or `curl` only if `rest` itself fails with exit 1.

Exit codes decide the next step. Do not retry the same command blindly.

| Exit | Meaning | Do this |
| --- | --- | --- |
| 0 | OK | Report the result. |
| 2 | Usage error | Fix the flags from `summary` and retry once. |
| 3 | Not supported by the tool | Fall back to step 2 immediately. |
| 4 | Azure call failed | Read: run the same read via its recipe. Write: re-read state before anything else. |
| 5 | Approval needed | Show the plan in `data`; rerun with `--approve` only after the user approves. |
| 6 | Pre-check failed (sign-in, missing resource or role, unsupported plan) | Show the missing item and how to fix it. |
| 1 | Unexpected failure | Report `summary`, then fall back to step 2. |

## Stop rules

- **Docs before the web.** Answer product questions with `docs search`. Do not open reference
  files in full or search the web unless `docs search` returned nothing relevant; if it falls
  back to online Learn results, open at most one URL.
- **Trust the verification.** Write commands verify their own result. Do not re-read the same
  state again unless `findings` says it was not verified.
- **Never resend an uncertain write.** If a write reports `OutcomeUnknown` or times out, read the
  current state first; resend only if the read proves the change did not happen.
- **One shell per call.** Run tool commands one at a time; do not chain writes with `&`, `;`, or `&&`.
- **Multi-line input goes through files or stdin** (`--body-file`, `--kql-file`), not inline quoting.

## Modes and risk

Classify by **intent**, not by endpoint. A POST to `.../list` that only reads is a read.

| Mode | Use for | Reference |
| --- | --- | --- |
| Inspection | show, list, why, is it healthy, what changed | [references/inspection.md](references/inspection.md) |
| Authoring | set, add, change, create, deploy, rotate, enable, disable | [references/authoring.md](references/authoring.md) |
| Operations | start, stop, restart, swap, sync, run now | [references/operations.md](references/operations.md) |

Networking uses the same modes; also read [references/networking.md](references/networking.md).
[references/portal-parity.md](references/portal-parity.md) maps portal blades to operations.
Shared REST rules are in `references/core/`. Mixed requests: inspect first, then plan the write.
If the intent is ambiguous, ask one short question.

| Tier | Meaning | Required before the call |
| --- | --- | --- |
| R0 | Read only | Nothing. |
| R1 | Reversible write (setting, CORS, scale, enable/disable, restart, sync, deploy to a slot) | Target resource ID, before/after diff, explicit user approval. |
| R2 | Destructive or outage (stop, swap to production, delete, key rotation, deploy to production, PUT that replaces a collection) | R1 plus impact and rollback path, approval for this exact call. |

Approval covers one target and one change set.

## Non-negotiables

1. **Resolve the target first.** Never act on a guessed app.
2. **Redact secrets.** Show keys and secret values only as presence, unless the user asks for one
   specific value.
3. **Collection PUTs replace everything.** Read, merge, and write back the full collection.
4. **No az resource subcommands, MCP tools, or SDKs** for Azure operations in the fallback path;
   use the tool's `rest` command.
5. **Report what happened**: the resource touched, the result, and the verification read.

## Report a successful azd deployment (internal telemetry)

This applies only when Authoring mode deployed with `azd up` or a standalone `azd provision` in a
project that already uses azd. Do not collect after direct REST, SCM, ARM template, Terraform, or
Core Tools deployments, or after a failed, cancelled, preview, or validation-only command.
Never collect for a Hosted Skills app; `azure-functions-hosted-skills` owns that collection.

After the azd command succeeds, run the local deployment-observation collector exactly once.
Use `deploy` for `azd up` and `provision` for `azd provision`. Use the current host name for
`<agent>` (`copilot-cli`, `claude-code`, `codex`, or `Visual Studio Code`). Set `environmentName`
to the actual azd environment name; if it is unavailable, skip collection. Do not guess it.
If you recorded a UTC start time before deployment, include it as `startedAt`; otherwise omit it.

Find `hooks/runtime/telemetry.mjs` in the installed plugin root. For workspace assets, use
`.github/hooks/runtime/telemetry.mjs`, `.claude/hooks/runtime/telemetry.mjs`, or
`.codex/hooks/runtime/telemetry.mjs` in the workspace root. Use only the payload that belongs to
this installed skill. Set `<runtime-dir>` to its absolute parent directory. Pass the project
workspace root with `--dir`. The collector checks opt-out settings before ARM queries or sending.

```bash
printf '%s' '{"skill":"azure-functions-app","operation":"<operation>","agent":"<agent>","environmentName":"<azd-env-name>"}' \
  | node "<runtime-dir>/telemetry.mjs" deployment-observed --dir "<workspace-root>" >/dev/null 2>&1 || true
```

On PowerShell, pipe the same JSON to
`& node "<runtime-dir>\telemetry.mjs" deployment-observed --dir "<workspace-root>"`
inside `try { ... | Out-Null } catch { }`, with `2>&1`.
Encode values as JSON. Do not insert unescaped values into shell commands. If Node or the local
payload is absent, skip collection. Do not download, install, upgrade, or use a package-manager
fallback. Suppress output and ignore failures. Do not retry collection or change the result.
