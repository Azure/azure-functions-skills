# Operation Conversion Support

Use this first-release policy before offering a conversion. Technical capability does not
override a policy exclusion. A remote API cannot make an excluded local workflow supported.

## Status rules

| Status | Required evidence or action |
| --- | --- |
| `supported` | The target operation, complete input/output contract, data scope, runtime transport, and authentication meet the requirement. Record target metadata evidence. Live test gates are still required. |
| `change-required` | A candidate changes behavior, search coverage, outputs, or identity. Explain the difference and obtain approval. Then check the revised requirement. |
| `unverified` | Metadata, runtime compatibility, authentication, or other evidence is missing. Report what must be checked. Do not generate this integration or deploy it as supported. |
| `out-of-scope` | This release excludes the operation. Ask about removal or a smaller goal; do not implement a bypass. |

Read the exact operations used by the source. Tool names alone are not requirements.
Do not convert an arbitrary `az`, `workiq`, or MCP command as one generic tool.

## Candidate matrix

All Connector candidates need target-region discovery through `azure-functions-connector-create`.
The service operation references below are discovery sources, not proof of Namespace availability.

| Source requirement | Candidate | First-release decision |
| --- | --- | --- |
| Work IQ: get bounded mail or calendar data | Office 365 Outlook Connector | Candidate; check filters, fields, time zone, pagination, and account. |
| Work IQ: get messages from a specified chat/channel | Teams Connector | Candidate; check chat/channel type, read operation, replies, and access. |
| Work IQ: read a known SharePoint file/list | SharePoint Connector | Candidate; check site/library scope, content format, file size, and access. |
| Work IQ: cross-service semantic search, organizational context, or Copilot reasoning | No equivalent general Connector replacement | `change-required` only if a narrower goal is acceptable; otherwise `out-of-scope`. |
| Work IQ CLI or direct Work IQ MCP | Direct connection | `out-of-scope`; do not implement delegated OAuth for this release. |
| Azure CLI: resource/group list or show | Azure Resource Manager Connector (`arm`) | Candidate; permit only verified read operations with narrow resource scope. |
| Azure CLI: service data reads, logs, or queries | Corresponding service Connector or compatible remote HTTP MCP | `unverified` until the exact operation, output, and authentication are checked. ARM is not a replacement for every data-plane API. |
| Mail send, Teams post, or bounded business-record update | Corresponding Connector | Candidate only after operation and side-effect approval; preserve required confirmation. |
| Existing public remote HTTP MCP | Same endpoint | Candidate; check exact tools, contract, transport, and data exposure. |
| Existing authenticated remote HTTP MCP | Same endpoint | Candidate only if the deployed runtime supports its authentication without a new user OAuth flow. |
| Local stdio MCP wrapper | Corresponding approved Connector or remote HTTP MCP | Check each required operation. The local process itself is `out-of-scope`. |
| Git clone, branch, commit, push, PR creation, or a coding/build pipeline | None in this release | `out-of-scope`, including GitHub/Azure DevOps Connector or MCP alternatives for these operations. |
| `azd`, deployment, resource writes/deletes, RBAC changes, or package publishing | None as a Hosted runtime operation | `out-of-scope`; ARM deployment actions do not override this rule. |
| Arbitrary shell, local executable, desktop automation, local credential cache | None | `out-of-scope`; do not add shell/CLI tools or execution sessions. |
| Local file read/write | Approved trigger input/output or explicit cloud storage operation | `change-required`; a laptop path is not a cloud path. Check transfer, persistence, format, and access. |
| In-memory formatting of approved input data | Instructions or bounded app code | Candidate; code cannot add a service operation excluded by this policy. |
| Required script with supported app-specific processing | Converted Python tool/helper | Candidate; preserve deterministic behavior and test it. Adapt existing Python scripts. Do not run the original language through a wrapper. |
| Required knowledge-only skill | Its own `src/skills/<name>/` directory | Candidate after content, name, reference, and runtime-access checks. |
| Required skill with tools, scripts, or further skill dependencies | Recursive inspection and approved conversion | Apply this policy to every operation. Missing or blocked required dependencies block the parent migration. |

Read [script-conversion.md](./script-conversion.md) for required Python conversion. Split scripts
with service calls or side effects into individual operations. A Python rewrite does not make
Git, PR, deployment, shell, or unsupported service operations supported.
Read [dependent-skills.md](./dependent-skills.md) for recursive inspection, shared dependencies,
name collisions, and cycles.

## Work IQ and identity

Work IQ CLI can retrieve context and reason across mail, meetings, files, people, and business
applications. A workload Connector supplies specific service operations. Fetching a set of emails
and asking the Hosted model to summarize them is not Work IQ's cross-service retrieval.

Work IQ's documented `WorkIQAgent.Ask` permission is delegated, with admin consent and no
application permission. Its Foundry connection guide requires user OAuth and does not support
application-only authentication. Do not treat a Function App managed identity, static bearer token,
or function key as a durable replacement for this user authentication.

For a workload Connector, distinguish:

1. The Function App identity's access to the Namespace connection.
2. The connection account's authorization to the downstream service.

A person completes consent when the connector requires it. The connection service manages its
credentials; tenant policy, revoked consent, or expired authorization can still require action.
Record the connection account's purpose and permitted data scope, without credentials.

For a scheduled single-account workflow, this can replace the local user's data access after
approval. For a multi-user workflow, do not assume a shared connection acts as the caller.
Caller-specific private data is blocked unless a supported isolation design is verified.

## Remote MCP checks

The Hosted Skills runtime supports remote HTTP MCP in `mcp.json`, not local `command`/`args`
processes. Check the current Hosted Skills remote-MCP reference for supported fields.

Verify endpoint, protocol, exact tools, input/output schemas, token audience, authentication,
network reachability, and tool access restrictions. If the server requires interactive user
OAuth or caller-token forwarding that the runtime does not provide, report it as unsupported.
Do not build OAuth token storage, refresh handling, OBO middleware, or custom server hosting here.

## Discovery sources

Use current metadata from the target Namespace/region for operations, authentication parameters,
dynamic schemas, and availability. Use the Connector skills to perform these checks. Record
the source and date so a future run can recheck preview behavior.

- [Connector Namespace overview](https://learn.microsoft.com/en-us/azure/connector-namespace/connector-namespace-overview)
- [Create MCP server connectors](https://learn.microsoft.com/en-us/azure/connector-namespace/create-mcp-server-connectors)
- [Office 365 Outlook operations](https://learn.microsoft.com/en-us/connectors/office365/)
- [Microsoft Teams operations](https://learn.microsoft.com/en-us/connectors/teams/)
- [SharePoint operations](https://learn.microsoft.com/en-us/connectors/sharepointonline/)
- [Azure Resource Manager operations](https://learn.microsoft.com/en-us/connectors/arm/)
- [Work IQ MCP overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/overview)
- [Work IQ permissions](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/permissions)
- [Work IQ Foundry authentication](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/quickstart/foundry)

These sources were checked during design on 2026-10-12. Recheck them during migration.
