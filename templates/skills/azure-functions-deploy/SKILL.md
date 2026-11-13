---
name: azure-functions-deploy
title: Deploy Azure Functions
description: Deploy an Azure Functions app to Azure with the Azure Developer CLI, using a script that plans, applies, and verifies the deployment. Do not use for Azure Functions Hosted Skills, including follow-up deployment requests during Hosted Skills creation; use azure-functions-hosted-skills instead.
category: task
---

> **Language**: Always respond in the same language the user is using.

# azure-functions-deploy — Deploy Azure Functions

Deploy an Azure Functions app to the Flex Consumption plan with the Azure Developer CLI (`azd`).

A script does the fixed work: it reads the project, writes a plan, runs the approved plan, and checks the result. Your job is to get the missing inputs from the user, show the plan, get approval, and handle a failure.

If the app is an Azure Functions Hosted Skills app (the conversation is creating a Hosted Skill, or the app uses `*.agent.md` or `agents.config.yaml`), invoke `azure-functions-hosted-skills` instead and stop.

## What this skill supports

| Project | Path |
| --- | --- |
| Has `azure.yaml` and `infra/main.bicep` (projects from `azure-functions-create` templates have both) | Script workflow below |
| Anything else: no `azure.yaml`, Terraform, Go without infrastructure files, an existing app without azd | [references/manual-deploy.md](references/manual-deploy.md) |

The script deploys only what the project's own `infra/` describes. It does not choose a hosting plan, write infrastructure, or delete resources.

## The tool

Run the tool with Node. `<skill-dir>` is the folder that contains this `SKILL.md`.

```text
node "<skill-dir>/../azure-functions-common/scripts/functions-tools.mjs" deploy <command> --dir "<project-root>"
```

`<project-root>` is the folder that contains `azure.yaml`. Each run prints one JSON object. Read `ok`, `summary`, `data`, `findings`, `gaps`, and `next`.

| Exit code | Meaning | What to do |
| --- | --- | --- |
| 0 | The command ran | Follow the JSON. `ok: false` means it found a problem. |
| 2 | Invalid arguments | Fix the arguments and run once more. |
| 3 | Blocked before running anything | Apply `findings[].fix` or ask for `data.inputsNeeded`, then run again. |
| 4 | A step failed | See [When a step fails](#when-a-step-fails). |
| 1 | Unexpected failure | Use [references/manual-deploy.md](references/manual-deploy.md). Do not run the same command again. |

Trust the output. Do not repeat its checks with your own `az` or `azd` commands.

If `node` is missing or the tool file does not exist, use [references/manual-deploy.md](references/manual-deploy.md). Do not install Node or download the tool.

## Workflow

### 1. Plan

```text
node "<tool>" deploy plan --dir "<project-root>"
```

This step reads files and sign-in state. It changes nothing in Azure and nothing in the azd environment.

- If `data.inputsNeeded` is present, ask the user for each item. Offer `suggested` and `allowed` values when they are listed. Then run `deploy plan` again with the listed options (`--env`, `--subscription`, `--location`, `--set NAME=VALUE`).
- If a finding has a `fix`, show it to the user. Run `azd auth login` only when the user asks you to.
- If `next.action` is `manual-steps`, switch to [references/manual-deploy.md](references/manual-deploy.md).
- To update the code of an app that is already provisioned, add `--code-only`.

Do not choose a subscription, location, or environment name for the user. Use the values from the plan or ask.

### 2. Get approval

Show the user these fields from the plan output, then ask whether to deploy:

- `data.subscription` and `data.location`
- `data.environment`, and whether it is new (`data.environmentExists`)
- `data.values`, including each value whose `source` is `default`
- `data.steps`, with what each one changes (`local-environment`, `azure-resources`, or `application-code`)

Tell the user that the `azure-resources` step creates billable resources.

If the user wants to see the resource changes first, run the preview. It creates the local azd environment but provisions nothing.

```text
node "<tool>" deploy apply --dir "<project-root>" --approve <planId> --preview
```

Pass `--approve` only with the `planId` the user approved. If you run `deploy plan` again, the id changes and you must ask again.

### 3. Apply

```text
node "<tool>" deploy apply --dir "<project-root>" --approve <planId>
```

Provisioning and deployment can take up to 30 minutes each. Run the command with a long timeout or in the background, and wait for it to exit. Do not stop it because it prints nothing; the script captures the `azd` output in `data.logFile`.

The script refuses to run when the plan id does not match, when the plan file was edited, or when `azure.yaml` or `infra/` changed after planning. In each case, plan again and ask again.

When Azure Storage refuses the package right after a new provision, the script checks the cause before it does anything else. It counts as a storage refusal only when the output names a storage error code (`AuthorizationPermissionMismatch`, `AuthorizationFailure`) or pairs a 403 with a `*.blob.core.*` URL; any other 403 is a normal step failure. It reads the function app's deployment storage, the managed identity's Storage Blob Data role on that account, and the account's network rules. Only when an unconditional role is assigned, the network allows the request, and the next attempt still falls less than 15 minutes after provision does it wait (60 seconds, then 90 seconds) and run the deploy step again. `data.retries` records each wait and its evidence. In every other case it stops with `DEPLOY-STORAGE-FORBIDDEN`, and `data.storageAccess.cause` says why: `role-missing`, `network-restricted`, or `unknown` (including a role assignment with a condition). If a retry fails for another reason, that new failure is reported instead.

### 4. Verify

```text
node "<tool>" deploy verify --dir "<project-root>" --env <environment>
```

The script lists the deployed functions and sends one GET request to each anonymous HTTP trigger. It never uses HEAD. When Azure does not report the app state, the script reads it from the resource; if it is still unknown, it records a gap and relies on the function list and HTTP results.

- `ok: true`: report the function app name, `data.portalUrl`, the functions, and the HTTP results.
- `gaps`: tell the user which functions were not requested and why (for example, a function that needs a key).
- Functions with `authLevel: function`: ask the user whether to request them with a key. Only if the user agrees, run the command again with `--use-keys`. The script reads each function's default key with the Azure CLI and sends it in the `x-functions-key` header. It never prints or stores the key. Admin-level functions are never requested.
- `ok: false`: report the findings and suggest `azure-functions-diagnostics`.
- `ok: false`: report the findings and suggest `azure-functions-diagnostics`.

`deploy verify` needs the Azure CLI (`az`) to be installed and signed in. If it is blocked, tell the user the deployment finished but was not verified.

## When a step fails

Exit code 4 means `azd` ran and failed. The script stops at that step and remembers the finished ones.

1. Read `findings[0]` and `data.outputTail`. Read `data.logFile` when the tail is not enough.
2. Explain the cause to the user. Apply `findings[0].fix` when there is one and the user agrees.
3. Run the same `deploy apply` command again. It continues from the failed step.

Do not retry without a change. The script has already retried a storage refusal when the evidence showed role propagation; for `DEPLOY-STORAGE-FORBIDDEN`, follow `findings[0].fix`. Do not run `azd down`, delete a resource group, or change `infra/` to get past a failure unless the user asks.

If the same step fails twice, or the cause is in the Azure Functions runtime rather than in provisioning, stop and use [references/manual-deploy.md](references/manual-deploy.md) or `azure-functions-diagnostics`.

If a step timed out, the operation may still be running in Azure. Check it before resuming:

```bash
az deployment sub list --query "[?contains(name, '<environment>')].{name:name, state:properties.provisioningState}" -o table
```

## Azure Functions facts to keep in mind

- New serverless apps use the Flex Consumption plan. Package deployment is its only code deployment method.
- Python apps run on Linux. The official templates set `remoteBuild: true` in `azure.yaml`, so do not build Python dependencies locally for deployment.
- Flex Consumption has no deployment slots. Use rolling updates for zero-downtime deployments.
- When the app has private endpoints and no public network access, the machine that deploys needs network access to the deployment endpoint.
- Go apps are in public preview. They run only on Flex Consumption and Linux, need `FUNCTIONS_WORKER_RUNTIME=native`, Core Tools 4.12 or later, and Azure CLI 2.87.0 or later. See [references/manual-deploy.md](references/manual-deploy.md#go-apps).

## Report a successful deployment (internal telemetry)

Run the local deployment-observation collector exactly once after `deploy apply`
succeeds and its output contains `data.telemetry`. That field is present only
when the run provisioned and deployed, which matches a complete `azd up`.
This skill owns the step. Do not also run the hosted-skills collector for the
same deployment.

Do not collect after a failed, cancelled, or preview run, after a `--code-only`
run, or after the manual steps unless they ran a complete `azd up` or a
standalone `azd provision`.

Use `data.telemetry.operation` for `<operation>` and
`data.telemetry.environmentName` for `<azd-env-name>`. For the manual steps,
use `deploy` for `azd up` and `provision` for standalone `azd provision`.
Use the current host name for `<agent>` (`copilot-cli`, `claude-code`, `codex`,
or `Visual Studio Code`). If the environment name is not available, skip
collection. Do not guess it. If you recorded a UTC start time before
deployment, include it as `startedAt`. Otherwise, omit `startedAt`. The name
and start time are not telemetry fields.

Find `hooks/runtime/telemetry.mjs` in the installed plugin root. For workspace
assets, use `.github/hooks/runtime/telemetry.mjs`, `.claude/hooks/runtime/telemetry.mjs`,
or `.codex/hooks/runtime/telemetry.mjs` in the workspace root. Use only the payload
that belongs to this installed skill. Set `<runtime-dir>` to its absolute parent directory.
Pass the project workspace root with `--dir`, even if the current directory is
`infra/`. The collector checks opt-out settings before ARM queries or sending.

```bash
printf '%s' '{"skill":"azure-functions-deploy","operation":"<operation>","agent":"<agent>","environmentName":"<azd-env-name>"}' \
  | node "<runtime-dir>/telemetry.mjs" deployment-observed --dir "<workspace-root>" >/dev/null 2>&1 || true
```

On PowerShell, pipe the same JSON to
`& node "<runtime-dir>\telemetry.mjs" deployment-observed --dir "<workspace-root>"`
inside `try { ... | Out-Null } catch { }`, with `2>&1`.
Encode values as JSON. Do not insert unescaped values into shell commands.
If Node or the local payload is absent, skip collection. Do not download,
install, upgrade, or use a package-manager fallback. Suppress output and ignore
failures. Do not retry collection, redeploy, or change the deployment result.
Normal deployment verification and deployed-app monitoring are unchanged.

## Next steps

- On a missing tool (`azd`, `az`, `node`), suggest `azure-functions-setup`.
- On a successful deployment, suggest `azure-functions-best-practices` for a production readiness review.
- For runtime health, metrics, and Application Insights checks, suggest `azure-functions-health-status`.
- On a failure that the steps above do not resolve, suggest `azure-functions-diagnostics`.
