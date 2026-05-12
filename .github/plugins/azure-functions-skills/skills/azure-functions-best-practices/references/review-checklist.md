# Azure Functions Best Practices Review Checklist

Use this checklist after collecting Function App inventory. Apply only sections relevant to the requested scope and collected evidence.

## Runtime and programming model

- Functions host is v4.
- Language runtime is supported and current enough for the selected stack.
- .NET apps prefer isolated worker for new or modernized apps.
- JavaScript/TypeScript apps use the v4 programming model when practical.
- Python apps use the v2 programming model when practical.
- Python Function Apps run on Linux.
- Durable Functions workloads consider Durable Task Scheduler when appropriate.

## Host and app configuration

- `FUNCTIONS_EXTENSION_VERSION` is configured for Functions v4.
- `FUNCTIONS_WORKER_RUNTIME` matches the deployed app language.
- Non-.NET apps use extension bundle `[4.*, 5.0.0)` unless there is a justified exception.
- Required app settings are present; unresolved `%SETTING_NAME%` placeholders are treated as configuration issues.
- `local.settings.json` is used only for local development and is not committed with secrets.
- `WEBSITE_RUN_FROM_PACKAGE` / package deployment settings are consistent with the deployment method.

## Security and networking

- HTTPS-only is enabled.
- TLS version is current for production use.
- FTPS is disabled or restricted when not needed.
- Anonymous HTTP triggers are intentional and documented.
- Public network access, VNet integration, and private endpoints match the app's sensitivity and architecture.
- App settings, connection strings, SAS tokens, and keys are not exposed in output.

## Identity and RBAC

- Managed identity is enabled when the app accesses Azure resources.
- Identity-based connections are preferred over raw connection strings where supported.
- `AzureWebJobsStorage` identity-based settings include the required service URIs and credential settings.
- Storage, Event Hubs, Service Bus, Key Vault, App Configuration, and Durable Task Scheduler role assignments follow least privilege.
- RBAC changes are proposed separately and require approval before execution.

## Storage and triggers/bindings

- Blob triggers prefer Event Grid source where appropriate.
- Blob triggers on Flex Consumption have required queue endpoint, Event Grid subscription, and always-ready considerations.
- Queue triggers have poison-message handling and visibility-timeout settings appropriate for workload behavior.
- Service Bus triggers account for lock renewal, sessions, settlement, retry, and concurrency.
- Event Hubs triggers account for consumer group, checkpointing, partition ownership, batch size, and throughput.
- Cosmos DB triggers account for lease container, change feed behavior, and throughput.
- Timer triggers have schedule, timezone, and missed-execution behavior documented.

## Observability and operations

- Application Insights is enabled for production apps.
- Request, dependency, exception, and trace telemetry are available or gaps are documented.
- Sampling is intentional and cost-aware.
- Alerts exist for failed executions, exceptions, dependency failures, throttling, and availability where appropriate.
- Recent Activity Log changes are reviewed when configuration drift is suspected.
- Tags and ownership metadata are present where required by the environment.

## Scale, performance, and cost

- Hosting plan matches workload needs; Flex Consumption is preferred for new serverless deployments when suitable.
- Premium or Dedicated plans are justified by networking, cold start, duration, or workload requirements.
- Always-ready instances are justified by latency or trigger bootstrap requirements.
- Max instance, memory, and concurrency settings are intentional.
- One Function App per independently scaling workload is considered for horizontal scaling.
- App Insights ingestion, always-ready units, storage transactions, and overprovisioned plans are called out as cost drivers.

## Severity guide

| Severity | Guidance |
| --- | --- |
| Critical | App cannot start, functions cannot index, secrets are exposed, production telemetry is absent, or public anonymous access is unintended. |
| High | Unsupported runtime, insecure auth/networking, broken identity/storage configuration, or trigger setup likely to lose or block events. |
| Medium | Missing alerts, weak cost/scale posture, suboptimal host settings, incomplete RBAC modernization, or missing operational metadata. |
| Low | Documentation gaps, optional modernization, naming/tagging improvements, or future optimization opportunities. |
