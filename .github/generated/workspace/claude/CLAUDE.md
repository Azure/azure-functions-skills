# Azure Functions Skills

For Azure Functions work, prefer the Azure Functions Skills plugin when the user intent matches one of these skills:
- azure-functions-agents: Build, scaffold, extend, deploy, and troubleshoot event-driven AI agents and scheduled serverless agent apps on Azure Functions using azurefunctions-agents-runtime. Use when the user wants a scheduled agent, morning briefing, daily digest, timer agent, inbox summary, email or Teams briefing, background AI workflow, connector-triggered agent, event-driven AI automation, HTTP/chat agent, webhook-style agent, or Azure Functions hosted agent.
- azure-functions-best-practices: Use when reviewing an existing Azure Function App against Azure Functions best practices and proposing safe, approval-gated remediations for runtime, configuration, identity, security, observability, performance, scale, cost, triggers, and bindings.
- azure-functions-create: Scaffold a new Azure Functions project with language and template selection
- azure-functions-deploy: Proxy Azure Functions deployment requests to the Azure Skills prepare, validate, and deploy workflow while preserving Azure Functions-specific guidance
- azure-functions-diagnostics: Use when diagnosing or resolving Azure Functions issues: deployment failures, runtime errors, trigger/binding failures, language worker issues, telemetry/log analysis, known issue research, source investigation, and remediation. Acts as a facade that routes to focused Azure Functions skills and small language/extension references.
- azure-functions-doctor: Analyze local Azure Functions workspace code and configuration for common issues. Produces structured JSON findings for integration with the doctor CLI command. This skill targets local workspaces only — use azure-functions-diagnostics for deployed Azure resources.
- azure-functions-feedback: Turn session findings into previewed issues or pull requests for the Azure Functions skills repository
- azure-functions-health-status: Use when investigating current Azure Functions app status and health: Running/Stopped state, Resource Health, plan status, Azure Monitor metrics, Application Insights/Log Analytics requests, failures, exceptions, traces, dependencies, and recent Activity Log. Do not use for static inventory-only requests.
- azure-functions-inventory: Use when collecting Azure Functions app specifications/inventory only: resource identity, SKU/plan, runtime, Function App config, network, identity, selected app settings, and function/trigger inventory. Do not use for runtime health, failures, metrics, or telemetry investigation.
- azure-functions-setup: Verify prerequisites and set up your environment for Azure Functions development

Route to the matching skill by user intent.