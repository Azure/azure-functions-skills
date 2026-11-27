# SCM (Kudu) Core

Rules for calls to the app's deployment (SCM) endpoint.

## Find the SCM host

Read `{site}` and take the entry in `properties.hostNameSslStates` whose `hostType` is
`Repository`. Use `https://<that name>`. Do not construct the SCM host from the app name:
regional and private-endpoint apps use different host names.

## Authentication

- Use a Microsoft Entra bearer token for the App Service resource:
  `az account get-access-token --resource https://appservice.azure.com`.
- Send `Authorization: Bearer <token>`. Do not use publishing (basic auth) credentials; many apps
  disable basic auth, and publishing profiles contain secrets.
- On 401/403, report it. The caller needs a role that grants `Microsoft.Web/sites/publish/action`
  (for example Website Contributor).
- If the SCM site has access restrictions or only a private endpoint, the call must come from a
  network that can reach it. Report this; do not change network rules to work around it.

## Endpoints used by this skill

| Purpose | Request | Plans |
| --- | --- | --- |
| Flex Consumption package deploy | `POST /api/publish?RemoteBuild=<true\|false>&Deployer=azure_functions_skills` body = zip, `Content-Type: application/zip` | Flex Consumption |
| Zip deploy | `POST /api/zipdeploy?isAsync=true&Deployer=azure_functions_skills` body = zip, `Content-Type: application/octet-stream` | Premium, Dedicated, Windows Consumption |
| Latest deployment status | `GET /api/deployments/latest` | All with SCM |
| Deployment history | `GET /api/deployments` | All with SCM |
| Deployment log | `GET /api/deployments/{id}/log` | All with SCM |

Rules:

- Linux Consumption (legacy) is not supported for push deploy by this skill; see
  [../authoring.md](../authoring.md) "Deploy code".
- Python apps need `RemoteBuild=true` on Flex Consumption unless the package already contains
  installed dependencies.
- A `202` response means accepted, not deployed. Track the deployment as below.
- A deploy is not idempotent. On timeout or `5xx`, track the deployment first; never re-upload
  without new approval.

## Track the deployment

Do not accept whatever `/api/deployments/latest` returns: it can be a previous or concurrent
deployment.

1. **Before** uploading, `GET /api/deployments/latest` and record its `id` and `received_time`
   (a `404` means no previous deployment).
2. After the upload, if the response has a `Location` header that points to a deployment status
   URL on the SCM host, poll that URL. Flex `/api/publish` returns `202` with
   `Location: https://<scm-host>/api/deployments/<id>` and the quoted `<id>` as the body.
3. Otherwise poll `GET /api/deployments/latest` every 10 seconds and accept only a deployment
   whose `id` differs from the recorded one and whose `received_time` is later than the upload
   start. If another deployment with `Deployer` other than `azure_functions_skills` appears,
   stop and report a concurrent deployment.
4. When `complete` is `true`, check `status` (`4` = success, `3` = failed) and report
   `status_text`. Stop after 15 minutes and report the last state.
- Kudu log streaming is not available for Flex Consumption. Use Application Insights queries in
  [../inspection.md](../inspection.md) for logs on every plan.
