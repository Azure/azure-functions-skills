# Azure Functions Skills usage scenarios

Use these scenario scripts to try the Azure Functions Skills plugin without relying on private subscriptions, prepared test apps, or customer-specific data.

The examples focus on GitHub Copilot. Claude Code and Codex can use the same prompts after their host plugin manager installs this repository.

## Prerequisites

The only hard prerequisite for the npm CLI is **Node.js 18+**. The `azure-functions-setup` skill checks the Azure Functions development environment.

For scenarios that touch a real Azure subscription, sign in first:

```bash
az login
az account show
```

## Install locally when needed

```bash
npx @azure/functions-skills install --local --agent ghcp --dir ./my-app
```

Normally, install the repository plugin with the coding agent's own plugin manager. Use `--local` only for workspace-local or VS Code integration scenarios.

## Start the Functions workflow

Open the coding agent normally and ask: `Explain what Azure Functions Skills can do and which workflow I should start with.`

Expected result:

- The agent invokes `azure-functions-help`.
- It can explain setup, create, deploy, diagnostics, best-practices, health, inventory, and feedback workflows.
- It suggests the next workflow based on the current directory.

## Scenario 1: Learn what the skills can do

Prompt:

```text
Explain what Azure Functions Skills can do, when to use setup/create/deploy/diagnostics/best-practices/feedback, and which workflow I should start with.
```

Expected result:

- The assistant summarizes the available Azure Functions skills.
- It explains the difference between setup, create, deploy, diagnostics, best-practices, and feedback.
- It suggests a next step based on whether the current directory is empty or already contains a Functions project.

## Scenario 2: Create and verify a new HTTP trigger project

Start in an empty directory, then prompt:

```text
Create a TypeScript Azure Functions project with an HTTP trigger. Use official Azure Functions templates where available. After creating it, build it and verify it locally with an HTTP request.
```

Expected result:

- The assistant checks local prerequisites or routes to `azure-functions-setup` if tools are missing.
- It uses Azure MCP template discovery when available instead of inventing template IDs.
- It creates project files such as `host.json`, `local.settings.json`, `package.json`, TypeScript config, and function source.
- It builds the project.
- It starts the Functions host and sends a request to the local HTTP endpoint.
- It reports the local URL, status code, and response body.

## Scenario 3: Add skills to an existing Functions project

Start in an existing Azure Functions project, then install:

```bash
npx @azure/functions-skills install --local --agent ghcp
```

Prompt:

```text
Inspect this existing Azure Functions project and tell me which Azure Functions Skills workflows are useful next. Do not change source files yet.
```

Expected result:

- Local install adds skills, MCP configuration, and telemetry hooks without modifying app source code.
- The assistant detects that the directory already contains a Functions project.
- It suggests relevant next actions such as adding a function, deploying, reviewing best practices, or running diagnostics.

## Scenario 4: Deploy a Functions app

Prompt from a Functions project:

```text
Use azure-functions-deploy to prepare, validate, and deploy this Azure Functions app. Explain the plan first and ask before creating or changing Azure resources.
```

Expected result:

- The assistant routes through `azure-functions-deploy`.
- It prepares a deployment plan and validates prerequisites.
- It asks before creating or modifying Azure resources.
- It uses official Azure deployment tooling and Azure Skills deployment flow where available.
- It reports the deployed Function App name, resource group, endpoint, and validation result.

## Scenario 5: Diagnose a deployed Function App

Use placeholders for your own resource details:

```text
Use azure-functions-diagnostics to diagnose this deployed Function App.

Target:
- Subscription: <subscription id or name>
- Resource group: <resource group>
- Function App: <function app name>
- Time range: last 2 hours

Symptoms:
- <describe failing endpoint, trigger, deployment, timeout, exception, or missing invocation>

Expected output:
- Separate observed evidence from hypotheses.
- Check resource state, app settings, recent errors, logs, metrics, and telemetry where available.
- Identify likely root causes and recommended next steps.
- If telemetry or permissions are missing, say exactly what is missing.
```

Expected result:

- The assistant confirms the target resource and time range.
- It collects available Azure resource and telemetry evidence.
- It separates facts from inferences.
- It provides likely root causes, remediation steps, and any evidence gaps.

## Scenario 6: Review best practices

Prompt from a Functions project:

```text
Use azure-functions-best-practices to review this Azure Functions project. Do not edit files yet. Report Pass / Warning / Fail with evidence and suggested fixes.
```

Expected result:

- The assistant reviews project structure, runtime settings, trigger/binding configuration, security, local settings handling, monitoring, deployment readiness, and test coverage.
- It does not edit files without approval.
- It provides prioritized recommendations with evidence.

## Scenario 7: Provide feedback on the skills

Prompt after a workflow exposes confusing guidance or a reusable improvement:

```text
Use azure-functions-feedback to turn what we learned in this session into a previewed GitHub issue or pull request for Azure Functions Skills.
```

Expected result:

- The assistant reviews session evidence related to the Azure Functions Skills repository.
- It redacts secrets and customer-specific data.
- It previews the feedback before creating anything.
- It asks whether to create an issue or pull request.
- It does not create external GitHub artifacts without explicit approval.

## Scenario 8: Pre-deployment validation with doctor

Run from a Functions project to validate configuration and code before deployment:

```bash
# Quick built-in checks (Tier 1)
npx @azure/functions-skills doctor --dir .

# Visual HTML report
npx @azure/functions-skills doctor --dir . --format html --output doctor-report.html

# Deep semantic analysis (Tier 2 — opt-in, agent runs with elevated permissions)
npx @azure/functions-skills doctor --dir . \
  --deep --accept-deep-risk \
  --agent github-copilot \
  --format html --output doctor-deep.html
```

Expected result:

- Tier 1 finishes in under a second with deterministic findings: missing `host.json`, deprecated settings, unsupported runtime versions, etc.
- Tier 2 (with `--deep --accept-deep-risk`) takes ~60–120s and adds semantic findings: missing exception handling, hardcoded secrets, blocking I/O, durable non-determinism, etc.
- Exit code `1` if any finding is at or above the `--severity` threshold (default `high`).
- See [doctor-guide.md](doctor-guide.md) for output formats and GitHub Actions integration.

## Related

- [CLI reference](cli-reference.md)
- [Doctor guide](doctor-guide.md)
- [Skills vs Azure Skills](skills-vs-azure-skills.md)
