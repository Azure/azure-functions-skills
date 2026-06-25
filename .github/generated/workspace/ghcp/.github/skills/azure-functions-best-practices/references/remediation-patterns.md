# Azure Functions Best Practices Remediation Patterns

Use these patterns only after presenting findings and receiving explicit user approval for the selected fixes.

## Safe remediation workflow

1. Restate the selected finding and proposed change.
2. Confirm impact, rollback, and whether a restart or deployment may occur.
3. Prefer IaC/source patches when the user's project contains the authoritative configuration.
4. Use CLI or Azure MCP changes only when the user confirms the live resource is the source of truth.
5. Redact secrets in commands and output.
6. Re-run inventory or health checks after changes.

## Remediation types

| Type | Examples | Default behavior |
| --- | --- | --- |
| Report-only | Unsupported runtime, weak observability, missing tags | Explain and recommend next step |
| App setting update | `FUNCTIONS_EXTENSION_VERSION`, extension bundle-related settings, telemetry settings | Show exact setting names and ask before applying |
| Identity/RBAC | Managed identity enablement, role assignments for Storage/Event Hubs/Service Bus/Key Vault | Generate commands/IaC; require approval before execution |
| Network/security | HTTPS-only, TLS, FTPS, public network access, private endpoints | Treat as potentially disruptive; require explicit approval |
| Source/IaC patch | `host.json`, Bicep/Terraform, workflow files | Use file edits and run validation checks |
| Deployment/runtime change | plan migration, runtime upgrade, slot swap, restart | Handoff to deploy/upgrade/diagnostics skills as appropriate |

## Validation after fixes

- Static configuration changes: rerun `azure-functions-inventory`.
- Runtime/health changes: rerun `azure-functions-health-status` for the requested time window.
- Trigger/binding changes: validate trigger indexing and invoke or enqueue a test event when safe.
- Source/IaC changes: run project build/tests and deployment validation before publishing.
- Security/RBAC changes: verify access with least privilege and confirm no secret values are printed.

## Escalation rules

- Use `azure-functions-diagnostics` when a best-practice finding is tied to an active failure.
- Use `azure-functions-deploy` when approved changes require deployment.
- Use Azure-wide compliance, cost, RBAC, quota, or upgrade skills/tools for broad cross-service analysis.
