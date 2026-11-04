# Operation Conversion Support

Use this first-release policy before offering a conversion. Technical capability does not
override a policy exclusion. A remote API cannot make an excluded local workflow supported.

## Status rules

| Status | Required evidence or action |
| --- | --- |
| `supported` | The target operation, complete input/output contract, data scope, runtime transport, and authentication meet the requirement. Record target metadata evidence. Live test gates are still required. |
| `change-required` | A candidate changes behavior, search coverage, outputs, or identity. Explain the difference and obtain approval. Then check the revised requirement. |
| `unverified` | Metadata, runtime compatibility, authentication, or other evidence is missing. Report what must be checked. Do not implement, wire, or publish the affected integration, or deploy it as supported. The scaffold-only exception below does not change this status. |
| `out-of-scope` | This release excludes the operation. Ask about removal or a smaller goal; do not implement a bypass. |

Read the exact operations used by the source. Tool names alone are not requirements.
Do not convert an arbitrary `az`, `workiq`, or MCP command as one generic tool.

If only contract checks that require an authorized connection remain, the user may approve
an app skeleton and connection-independent processing before connection setup. Record the
missing checks and why they need that connection. Keep affected tools unwired, their registrations
unpublished, and business automation disabled. Do not guess schemas or invoke affected tools.
After source review and separate live-work approval, authorize the connection and resolve its
dynamic contracts through the Connector-MCP skill before implementation and publication.
Known unsupported requirements or unresolved scope/identity decisions still block generation.

## Candidate matrix

Compare options per required operation, not per original tool name. Check Connector candidates
first and show them first in the comparison and the user's choices. Show allowed customer MCP
and Python options after them. Apply the GitHub limit below before offering any alternative.
Inspect existing MCP, API, SDK, or code only under approved permissions.
An installed local tool is not proof of Hosted compatibility. Ask for missing sanitized details;
do not scan unrelated configuration or call services without permission.

| Option | Advantages | Checks and costs |
| --- | --- | --- |
| Connector | Less API client code; managed connection and consent lifecycle | Exact operations, target-region support, account/data scope, service limits and cost |
| Customer remote HTTP MCP | Reuses existing business contracts and operations | Not a GitHub alternative in this release; otherwise check Hosted reachability, supported auth, exact tool/schema allowlist, owner, reliability and cost |
| Python custom tool | Fits a bounded API/SDK or app-specific contract | Direct GitHub API/SDK access is excluded; otherwise the app owns dependencies, authentication, validation, errors, timeouts, testing and maintenance |

Show support status, evidence, a recommendation with pros/cons, and the user's choice.
Keep an unverified Connector candidate first with its missing checks; do not present it as ready
to use. If no Connector candidate is available, show the evidence for that finding before any
allowed alternatives. A truncated page, missing metadata, or a failed discovery tool is not proof
that a Connector cannot meet the requirement. Read the needed operation and authentication
sections, or leave the candidate `unverified`. Do not recommend Python only because Connector
checks are incomplete.
For services other than GitHub, an approved customer service or Python client can be recommended
with a verified reason, such as a contract gap or an unacceptable identity scope.
Do not force an unsuitable Connector. Mixed implementations are allowed within the service policy.

Separate service access and authentication from code that limits inputs or processes results.
A Python wrapper that calls approved Connector operations remains the Connector option.
It does not require a separate PAT or GitHub App registration for GitHub access.

All selected Connector candidates need target-region discovery through `azure-functions-connector-create`.
The service operation references below are discovery sources, not proof of Namespace availability.

| Source requirement | Candidate | First-release decision |
| --- | --- | --- |
| GitHub: read Issues, PRs, or the connected user; run scoped read queries | GitHub Connector only | Candidate; verify exact fields, filters, pagination, account, permissions, and target-region support. Check supported query operations if basic reads lack required fields. No direct API/SDK or customer GitHub MCP replacement. |
| Work IQ: get bounded mail or calendar data | Office 365 Outlook Connector | Candidate; check filters, fields, time zone, pagination, and account. |
| Work IQ: get messages from a specified chat/channel | Teams Connector | Candidate; check chat/channel type, read operation, replies, and access. |
| Work IQ: read a known SharePoint file/list | SharePoint Connector | Candidate; check site/library scope, content format, file size, and access. |
| Work IQ: cross-service semantic search, organizational context, or Copilot reasoning | No equivalent general Connector replacement | `change-required` only if a narrower goal is acceptable; otherwise `out-of-scope`. |
| Work IQ CLI or direct Work IQ MCP | Direct connection | `out-of-scope`; do not implement delegated OAuth for this release. |
| Azure CLI: resource/group list or show | ARM Connector, customer remote MCP, or scoped Python ARM client | Candidate; permit only verified read operations with narrow resource scope. |
| Azure CLI: service data reads, logs, or queries | Corresponding Connector, customer remote MCP, or Python service client | `unverified` until the exact operation, output, and authentication are checked. ARM is not a replacement for every data-plane API. |
| Mail send, Teams post, or bounded business-record update | Corresponding Connector, customer remote MCP, or Python service client | Candidate only after operation and side-effect approval; preserve required confirmation. |
| Existing public remote HTTP MCP | Same endpoint, where this service policy permits it | Candidate; check exact tools, contract, transport, and data exposure. A customer GitHub MCP is `out-of-scope` in this release. |
| Existing authenticated remote HTTP MCP | Same endpoint, where this service policy permits it | Candidate only if the deployed runtime supports its authentication without a new user OAuth flow. A customer GitHub MCP is `out-of-scope` in this release. |
| Local stdio MCP wrapper | Approved Connector, remote HTTP MCP, or Python implementation of required actions, within the service policy | Check each required operation. GitHub service access must use its Connector. The local process itself is `out-of-scope`. |
| Git clone, checkout, branch, commit, push, PR creation, or a coding/build pipeline | None in this release | `out-of-scope`, including GitHub/Azure DevOps Connector or MCP alternatives for these operations. |
| `azd`, deployment, resource writes/deletes, RBAC changes, or package publishing | None as a Hosted runtime operation | `out-of-scope`; ARM deployment actions do not override this rule. |
| Arbitrary shell, local executable, desktop automation, local credential cache | None | `out-of-scope`; do not add shell/CLI tools or execution sessions. |
| Local file read/write | Approved trigger input/output or explicit cloud storage operation | `change-required`; a laptop path is not a cloud path. Check transfer, persistence, format, and access. |
| In-memory formatting of approved input data | Instructions or bounded app code | Candidate; code cannot add a service operation excluded by this policy. |
| Required script with supported app-specific processing | Converted Python tool/helper | Candidate; preserve deterministic behavior and test it. Adapt existing Python scripts. Do not run the original language through a wrapper. |
| Required knowledge-only skill | Its own `src/skills/<name>/` directory | Candidate after content, name, reference, and runtime-access checks. |
| Required skill with tools, scripts, or further skill dependencies | Recursive inspection and approved conversion | Apply this policy to every operation. Missing or blocked required dependencies block the parent migration. |

Read [script-conversion.md](./script-conversion.md) for required Python conversion. Split scripts
with service calls or side effects into individual operations. A Python rewrite does not make
excluded repository operations, PR creation, deployment, shell, or unsupported service operations
supported. Issue/PR reads are evaluated separately under the GitHub Connector policy.
Read [dependent-skills.md](./dependent-skills.md) for recursive inspection, shared dependencies,
name collisions, and cycles.

## GitHub service access

This release permits GitHub service access only through approved GitHub Connector operations.
This limit also applies to scripts, dependent skills, existing MCP servers, and implementation
handoffs. It takes precedence over the general Python and remote-MCP options.

Map `gh` or other source tools to their required business operations. Reading Issues and PRs is
not the same as cloning or changing a Git repository. The public Connector catalog lists
`GetIssues`, `GetPullRequests`, `GetUser`, and `SearchGithubWithQuery`; these are discovery
candidates, not proof of target Namespace support or complete report coverage.
Check the full operation metadata for required fields, filters, pagination, errors, and limits.
If basic reads are insufficient, inspect supported query operations before rejecting the
Connector. Verify the query language and fields; do not infer them from an operation name.

When a query operation meets the requirement, Python may call it through the Connector with
fixed read-only query templates, approved repository scope, typed inputs, and bounded pagination.
Do not expose raw queries, arbitrary URLs, or generic MCP dispatch to the model.
Python input checks and result processing do not change who owns service authentication.
Do not export Connector credentials or call GitHub directly from this wrapper.

Use the Connector-create skill to check the target region, authentication scheme, connection
account, organization policy, and full consent scope before selecting the connection design.
The connection service manages its credentials; do not promise permanent access or no future
reauthorization. A tool allowlist does not reduce the connection's OAuth permissions.
Publish only the approved operations and verify the deployed identity and exact tool contracts.

Do not offer direct REST/GraphQL clients, PAT renewal, new GitHub App registration, or customer
GitHub MCP as alternatives in this release, even if they could supply missing data.
Missing metadata is `unverified`; a verified Connector gap blocks the required operation.
Ask whether to remove the requirement or approve a smaller goal. Keep the original requirement
blocked until that decision; do not silently omit fields or generate a direct-access fallback.
Connector support does not remove the exclusions for local clone/checkout, repository changes,
PR creation, or coding/build pipelines.

## Python service tools

Use the Hosted Skills custom-tool pattern only for selected, approved business operations.
The direct API/SDK option below applies to services other than GitHub. For GitHub, use only
the bounded Connector wrapper described above.
Require a documented API/SDK contract, typed inputs/results, fixed service destinations and
operation scope, supported runtime dependencies, and a verified Hosted authentication design.
Prefer managed identity when the service supports it; otherwise use approved secret storage.
Developer login does not establish deployed access or caller-specific identity.

Do not expose arbitrary URLs, HTTP methods, shell commands, or generic SDK dispatch to the model.
Validate resource scope and inputs, use bounded pagination and timeouts, surface explicit errors,
and define write confirmation, result verification, and uncertain-outcome handling.
Do not build a new interactive OAuth/token-refresh/OBO system or host a new MCP server here.
Apply existing exclusions even when an API or SDK could perform the operation.
Plan contract, denial, timeout, pagination, and side-effect tests before implementation.

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

These checks apply only to allowed MCP candidates. A GitHub Connector's generated MCP endpoint
is part of the Connector option; a customer GitHub MCP is not a replacement in this release.
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
- [GitHub operations](https://learn.microsoft.com/en-us/connectors/github/)
- [Office 365 Outlook operations](https://learn.microsoft.com/en-us/connectors/office365/)
- [Microsoft Teams operations](https://learn.microsoft.com/en-us/connectors/teams/)
- [SharePoint operations](https://learn.microsoft.com/en-us/connectors/sharepointonline/)
- [Azure Resource Manager operations](https://learn.microsoft.com/en-us/connectors/arm/)
- [Work IQ MCP overview](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/overview)
- [Work IQ permissions](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/permissions)
- [Work IQ Foundry authentication](https://learn.microsoft.com/en-us/microsoft-365/copilot/extensibility/work-iq/mcp/quickstart/foundry)

The GitHub operation reference and MCP connector guide were checked on 2026-11-03 (UTC).
The other sources were checked during design on 2026-10-12. Recheck them during migration.
