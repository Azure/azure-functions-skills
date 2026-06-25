# IaC and Azure Resource Doctor Checks

Use this file only when IaC files are present or Azure resource access is available.

## IaC checks

| ID | Check | Fail | Warning |
|----|-------|------|---------|
| `AS-004` | Azure Files content settings | Required Windows Consumption/Premium content settings omitted and no no-Azure-Files pattern | Not inferable from source |
| `ST-008` | Flex Consumption deployment storage | Missing `functionAppConfig.deployment.storage`; unsupported `WEBSITE_RUN_FROM_PACKAGE` or Azure Files content settings | Incomplete identity/network posture |
| `SC-003` | CORS wildcard | Wildcard origin with credentials support | Wildcard origin without credentials |
| `SC-004` | HTTPS enforcement | `httpsOnly=false` for public app | Not declared |
| `SC-006` | FTP/FTPS | Plain FTP allowed | FTP enabled but FTPS-only |
| `SC-008` | TLS version | `minTlsVersion` < `1.2` | Not declared |
| `SC-010` | Admin endpoint isolation | - | Public app without admin isolation in IaC |
| `PF-005` | Scale limit | Invalid scale limit | Very low production scale limit |

## Azure resource checks

| ID | Check | Fail | Warning |
|----|-------|------|---------|
| `ST-002` | Host storage with ADLS/HNS | Functions host storage has hierarchical namespace enabled | HNS property unknown |
| `ST-003` | Shared storage account | Confirmed collision-prone shared host storage for Durable/Event Hubs/high-volume apps | Same literal setting reused |
| `ST-004` | Host ID collision | Confirmed duplicate host ID with same storage account | Name/prefix suggests possible collision |
| `ST-005` | Storage lifecycle policy | Policy targets `azure-webjobs*` / `scm` containers | Policy exists but exclusions unknown |
| `ST-006` | Storage region | Confirmed different region from Function App | Region unknown |
| `ST-007` | Azure Files mount use | Mount on unsupported plan/OS | Writable mount without cleanup/quota/read-only rationale |

## Tooling

- Runtime stack metadata should come from Azure Resource Manager via Azure CLI, not direct internal endpoints.
- Use `az rest` for ARM calls when possible so Azure CLI handles token and cloud endpoint selection.
- Azure resource checks require Azure CLI login or federated credentials.
- IaC-only checks may not require Azure login.
