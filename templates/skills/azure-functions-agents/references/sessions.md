# Dynamic Sessions Reference

Azure Container Apps dynamic sessions provide the runtime's `execute_python` system tool. Use
dynamic sessions whenever an agent needs code execution, data analysis, file transformation,
web browsing, browser automation, or current public web information.

Do not build custom web-fetch tools for these cases. Configure dynamic sessions and tell the
agent to use Python and Playwright through `execute_python`.

## Configure the Runtime

Put the session pool endpoint in `agents.config.yaml`:

```yaml
system_tools:
  dynamic_sessions_code_interpreter:
    endpoint: $ACA_SESSION_POOL_ENDPOINT

model: $FOUNDRY_MODEL
timeout: 900
```

Agents inherit this system tool by default. Disable it for a specific agent only when that agent
must not execute code:

```yaml
system_tools:
  dynamic_sessions_code_interpreter: false
```

## Infrastructure Requirements

The session pool must be a Python code interpreter session pool, such as `PythonLTS`.

Use the scaffolded files in [../assets/infra/app](../assets/infra/app):

- `session-pool.bicep` creates the pool.
- `session-pool-rbac.bicep` assigns the `Azure ContainerApps Session Executor` role to both the
  function app managed identity and the deployer user.

## App Settings

Set the pool management endpoint in Azure app settings and local settings:

```json
{
  "ACA_SESSION_POOL_ENDPOINT": "https://<region>.dynamicsessions.io/subscriptions/.../sessionPools/<pool>"
}
```

When using a user-assigned managed identity, set `AZURE_CLIENT_ID` for the app. To force a
specific identity for dynamic sessions only, use:

```yaml
system_tools:
  dynamic_sessions_code_interpreter:
    endpoint: $ACA_SESSION_POOL_ENDPOINT
    client_id: $SESSION_POOL_CLIENT_ID
```

## Endpoint Validation

The runtime validates the session pool endpoint before creating the `execute_python` tool. The
endpoint must be an HTTPS URL whose host is a subdomain of `dynamicsessions.io`
(`*.dynamicsessions.io`). Endpoints that use a non-HTTPS scheme, embed userinfo (`user@host`), or
target any other host are rejected and the `execute_python` tool will not be available to agents.
A warning is logged in that state.

Correct endpoint format:

```
https://<region>.dynamicsessions.io/subscriptions/.../sessionPools/<pool>
```

If `execute_python` is missing at runtime after setting the endpoint, check that
`ACA_SESSION_POOL_ENDPOINT` resolves to a valid `https://<region>.dynamicsessions.io/...` URL and
look for a "failed validation" warning in startup logs.

## Local Development

Local execution still calls the real Azure session pool. The developer's `az login` identity
must have `Azure ContainerApps Session Executor` on the pool. The scaffolded Bicep assigns that
role to `deployer().objectId` during provisioning.

Run `azd provision` before `func start`, then copy `ACA_SESSION_POOL_ENDPOINT` from
`azd env get-values` into `src/local.settings.json` if it is not already populated.

## Agent Instructions

Tell agents when to use the tool. Good wording:

```markdown
Use Python code execution, including Playwright for browser automation, when you need current
public information, need to inspect a page, transform data, parse files, or calculate results.
```

Avoid vague wording such as "you may browse if useful" for agents that must reliably fetch
current information.