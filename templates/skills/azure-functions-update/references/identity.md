# Identity, certificates, and external contracts

Record identity type and actual test environment. Distinguish fake credentials,
emulator keys, developer accounts, service principals, and deployed system/user-assigned
managed identities. Do not let a credential chain fall back to an unapproved identity.

| Contract | Local evidence | Additional acceptance |
| --- | --- | --- |
| Managed identity | App logic with a fake; approved developer access to a real service | Deployed resource token acquisition, RBAC, and network access |
| Key Vault | Fake provider behavior; approved developer access | Actual tenant, token, firewall/private endpoint, and RBAC with selected identity |
| Server TLS | Controlled endpoint trust-chain test | Customer domain and hosting certificate behavior |
| Client certificate/mTLS | Selected client/handler behavior | Platform forwarding, termination, required certificates, and access policy |
| CORS | HTTP status/headers from a CLI client | Browser with actual origin, method, headers, credentials mode, and preflight |
| External platform API | Contract fixture or approved test tenant | Platform identity, rate limits, network, data, and customer acceptance |

Developer credentials that reach Azure do not prove deployed managed identity.
A local system-assigned identity simulation cannot prove token issuance for an Azure
resource. Key Vault and identity checks can be real Azure calls even from a laptop.

Classify TLS failures without disabling validation. Emulator development certificates
do not prove App Service mTLS or customer trust policy. Trust-store changes need a
named scope and cleanup; do not remove pre-existing certificates.

A CLI HTTP request does not enforce browser CORS. For browser acceptance, define the
origin and credential scenario rather than treating `curl` success as sufficient.

For external APIs, agree sandbox/tenant, identity, rate/cost limits, fixture privacy,
retention, and credential revocation. Do not create accounts or send messages as an
implied migration test. Unsupported local contracts need an
[Azure/customer handoff](azure-handoff.md), not a success-shaped mock result.

Primary sources accessed 2026-09-17:

- [Local developer identity](https://learn.microsoft.com/dotnet/azure/sdk/authentication/local-development-dev-accounts).
- [Managed identities](https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/overview).
- [Key Vault authentication](https://learn.microsoft.com/azure/key-vault/general/authentication).
- [Functions security](https://learn.microsoft.com/azure/azure-functions/security-concepts).
- [Functions networking](https://learn.microsoft.com/azure/azure-functions/functions-networking-options).
