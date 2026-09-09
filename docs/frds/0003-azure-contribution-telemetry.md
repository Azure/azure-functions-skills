# FRD-0003: Azure contribution telemetry

| Metadata | Value |
| --- | --- |
| Status | Draft |
| Revision | 2 |
| Created | 2026-09-08 |
| Updated | 2026-09-08 |
| Author | GitHub Copilot, based on the user's requirements and scope feedback |
| Depends on | [FRD governance, PR #244](https://github.com/Azure/azure-functions-skills/pull/244), revision `aff24690ae7dae787ad521b4bce718121647ffa7` |
| Component | Shared infrastructure: contribution telemetry and narrow skill integration |

## 1. Summary

Propose one new Application Insights event, `azure_contribution`, to show the
approximate volume and resource-type breakdown of successful Azure deployment
work observed through Azure Functions Skills. Phase 1 covers azd with Bicep from
the Functions deployment and hosted-agents skills. Reuse the current telemetry
transport and deployment workflows; do not build a deployment engine, durable
tracking system, or exact attribution service.

The reporting label is **Observed successful Azure deployment operations**.
This is an adoption/contribution trend, not a complete inventory, an exact
conversion rate, proof of net-new Azure resources, or a billing metric.
This document includes the implementation plan and technical design. No feature
implementation or live experiment is authorized by this draft.

## 2. Motivation / problem

Existing telemetry shows skill/tool usage but cannot establish that a deployment
succeeded. A user can invoke a skill, cancel, run validation, or fail provisioning
without creating a successful workload.

Current repository evidence:

| Surface | Existing behavior / consequence |
| --- | --- |
| [Telemetry sender](../../src/telemetry/sender.ts) | Validates an allowlist and sends `AzureFunctionsSkillsPluginExecuted`; usage categories are `Plugin_EventType`, not separate event names. |
| [Hidden CLI](../../bin/azure-functions-skills.js) | `telemetry` reads one sanitized JSON event from stdin; reuse this command family without changing that contract. |
| [Hook scripts](../../templates/hooks/scripts) | PostToolUse records skill reads/invocations and MCP usage, not deployment success. Do not add shell-output inference here. |
| [Deployment skill](../../templates/skills/azure-functions-deploy/SKILL.md) | Delegates to external `azure-prepare`, `azure-validate`, and `azure-deploy`. This repository does not control that deployment engine. |
| [Agents skill](../../templates/skills/azure-functions-agents/SKILL.md) | Uses azd directly; integrate separately with the same collector. |
| [Workspace preferences](../../src/setup/workspace-assets.ts) | Local installs retain per-host telemetry opt-out settings, in addition to environment-variable opt-out. |
| [Release transport](../internal/telemetry-release.md) | The existing release pipeline injects the destination into the npm runtime. No new destination, credential, or service is needed. |

For example, failed provisioning followed by a successful retry should normally
produce one event, with a resource-type set such as Functions, Storage, and
Application Insights. Counting each resource, nested deployment, or failed
attempt would obscure the management question.

### Related unmerged work

| PR | Integration rule |
| --- | --- |
| [#235: telemetry reliability](https://github.com/Azure/azure-functions-skills/pull/235) | Reuse its sender, diagnostics, package resolution, and version metadata if merged. Do not reproduce its delivery retry, doctor, canary, or hook overhaul here. |
| [#240: Application Insights SDK update](https://github.com/Azure/azure-functions-skills/pull/240) | Do not bundle an SDK migration. Verify the actual outbound envelope against whichever version is merged. |
| [#218: hosted skills rename](https://github.com/Azure/azure-functions-skills/pull/218) | Current canonical name is `azure-functions-agents`; if the rename lands, integrate `azure-functions-hosted-skills` instead and update paths/allowlists. Never emit both for one operation. |
| [#241](https://github.com/Azure/azure-functions-skills/pull/241), [#245](https://github.com/Azure/azure-functions-skills/pull/245) | Reserve FRD numbers 0001 and 0002. No dependency on their workflow runner, evaluation framework, or telemetry events. |

## 3. Goals / non-goals

### Requirements and acceptance criteria

| ID | Requirement | Observable acceptance criterion |
| --- | --- | --- |
| AC-001 | Add one contribution event while preserving existing usage event names and application properties. | One accepted contribution emits `azure_contribution`; existing custom properties remain compatible. Removing hostname-derived SDK envelope context is an intentional privacy change shared by both event paths. |
| AC-002 | Limit attribution to the two supported canonical skills and azd/Bicep provisioning. | Delegated Functions and direct agents paths can call the collector; plain CLI create, Terraform, and unrelated skill use do not emit. |
| AC-003 | Require successful command completion and current ARM deployment success. | Failed/cancelled commands, nonterminal/failed ARM states, missing evidence, preview, validation, and code-only deploy produce no event. |
| AC-004 | Count one supported successful command, not its resources or modules. | A single-layer azd invocation with multiple nested modules emits at most one event per collector call; failed attempts emit zero. |
| AC-005 | Collect types from the exact ARM deployment and its nested operations. | Subscription and resource-group roots, pagination, and nested modules yield a sorted, distinct resource-type set, without deployment-wrapper types. |
| AC-006 | Send only the categorical event contract and nonidentifying SDK metadata. | The captured HTTP envelope contains no customer names, identifiers, secrets, logs, source, host identity, or inherited correlation identifiers. |
| AC-007 | Honor opt-out before extra collection or transmission. | Either existing opt-out environment variable or the applicable installed telemetry config disables ARM telemetry queries and sending. |
| AC-008 | Do not change deployment outcomes for telemetry-only failures. | Query denial, timeout, malformed evidence, missing package, and ingestion failure never trigger a deployment retry or change the captured deployment exit status. |
| AC-009 | Preserve truthful client/version attribution. | Client values are normalized, not guessed; Skills version comes from the executing asset's metadata or is `unknown`, never inferred from a newer sender. |
| AC-010 | Keep delivery deliberately best-effort. | Documentation discloses unsupported paths, skipped observations, possible duplicate collector calls, and absence of exact-once/funnel guarantees. |
| AC-011 | Keep integration small and nonpersistent. | No installed customer `azure.yaml` telemetry hooks, durable operation database, ARM tags, new server, or global tool interception is introduced. |

### Non-goals

- Unique subscriptions, users, tenants, workloads, or pseudonymous customer IDs.
- Durable operation/session tracking, exactly-once delivery, persistent retry
  aggregation, offline queues, and server-side deduplication.
- Direct `az deployment` entry points, CLI resource create/update, Terraform,
  deployment stacks, azd multiple provisioning layers, tenant/management-group
  roots, or custom Azure clouds in Phase 1.
- Code-only `azd deploy`, Core Tools publishing, workload health/authorization,
  connector post-provisioning stages, or the create skill's fallback path.
- Parsing Bicep source, human-readable azd logs, arbitrary shell commands, or
  deployment error bodies to infer contribution.
- Exact changed-resource/new-resource counting, revenue estimates, retry/failure
  dashboards, detailed agent taxonomy, or a new dashboard deployment.
- Refactoring existing usage hooks, adding a skill execution framework, or
  writing lifecycle FRDs for every existing skill.

## 4. Proposed design

### 4.1 Measurement boundary

The unit is one supported `azd up` or standalone `azd provision` invocation that
finishes successfully and has one current successful ARM root with qualifying
resource operations. Nested ARM deployments belong to that root and never count
separately. Two independently successful later updates count twice.

For `azd up`, wait for the entire command: successful infrastructure followed by
failed application publishing produces no event. Standalone `azd provision`
does not require an application publish. Runtime smoke-test failures after a
successful command do not retroactively retract an event; runtime availability
is not this metric.

Call the collector once at the supported command's completion, not both after
provisioning and after up, and not once in each delegating skill. Failed attempts
do not send. This is flow discipline, not durable deduplication. Repeated
collector calls, separate successful reprovisioning, or ambiguous delivery can
duplicate observations; that limitation is accepted for Phase 1.

If a retry skips provisioning from azd's cache, there is no new deployment
evidence and no event. Do not search older attempts for a success. Types describe
qualifying operations in the final observed deployment, not a union of all
resources touched by failed attempts or a full workload inventory.

### 4.2 Explicit capture and post-command collection

Keep azd execution with the existing agent/deployment workflow. Add a small
internal collector, provisionally:

```text
azure-functions-skills telemetry contribution --dir <workspace>
```

The new subcommand accepts a bounded JSON object on stdin with:
`skill`, `operation`, `agent`, `skillsVersion`, `deploymentIdFile`, and `exitCode`.
`operation` is `deploy` for azd up and `provision` for standalone azd provision.
This local evidence object is NOT the outbound telemetry event. Reject unknown
fields; do not accept a template, environment dump, arbitrary executable, or
tool transcript. The original `telemetry` stdin contract remains unchanged.

The invocation recipe belongs to the canonical skill instructions and uses the
same package-resolution convention as existing telemetry. It must:

1. Resolve telemetry preference before capture. If disabled or the collector
   is unavailable, run the original deployment without telemetry instrumentation.
2. Create a fresh, private temporary directory outside the project, with a new
   deployment-ID file path for this attempt. Do not reuse a previous attempt's
   file or commit it to the workspace.
3. Set `AZD_DEPLOYMENT_ID_FILE` only for the azd process. Do not persist it in
   `azure.yaml`, azd environment state, or global shell configuration.
4. Run the original approved azd command, preserving arguments, interactive
   behavior, and working directory. Capture its actual exit code immediately.
5. After termination, invoke the collector with that exit code and file path.
   The collector performs independent ARM verification, not stdout parsing.
6. Clean up the temporary directory in the capture recipe's `finally`/trap path
   and preserve the deployment result. The collector must not recursively delete
   arbitrary paths supplied on stdin. Abrupt host termination can leave local
   scratch data; no durable recovery or startup scan is added.

Use native PowerShell/Bash process-scoped capture recipes, with the substantive
validation, ARM traversal, and sender logic in TypeScript. Do not build a generic
azd wrapper or retry engine. Capture failures must fall back to the original
deployment before it starts, or skip collection after it finishes; never rerun
an already-started deployment to repair telemetry.

For `azure-functions-deploy`, pass the recipe as deployment context to the
external Azure Skills executor; that executor owns command completion and the
single collection call. The parent does not call it again. If the host or
external skill cannot preserve this context, skip rather than guess.
For agents, the executing agent uses the same recipe directly.

Delegated capture feasibility is an M0 gate, not assumed support. Before
Finalized status, identify a concrete host/tool handoff that can preserve the
process-scoped variable, actual exit code, and single collector ownership without
modifying the external plugin. If that cannot be established, obtain human
approval to narrow AC-002 to the direct agents path and mark the Functions
deployment path deferred. Do not claim both paths delivered from recipe fixtures
alone; actual host coverage evidence remains an M3 acceptance requirement.

This is trusted local workflow evidence, not cryptographically attested
attribution: a caller able to invoke the internal CLI can supply misleading
evidence. Phase 1 does not attempt anti-fraud or hostile-local-user protection.

### 4.3 Exact azd evidence

azd added `AZD_DEPLOYMENT_ID_FILE` in 1.25.1. During Bicep provisioning it emits
NDJSON records with `deploymentId` and `layer`. Evidence:
[release history](https://github.com/Azure/azure-dev/blob/5455d41a91625569182d168d5eacac2e79d02b68/cli/azd/CHANGELOG.md),
[file implementation](https://github.com/Azure/azure-dev/blob/5455d41a91625569182d168d5eacac2e79d02b68/cli/azd/pkg/infra/provisioning/bicep/deployment_id_file.go).

File creation occurs before completion and is not proof of success. The
collector requires `exitCode = 0`, one record from a fresh attempt file, an empty
layer name, and a supported deployment resource ID. Missing/empty evidence,
multiple records, a named layer, unsupported azd, and malformed input all skip
collection. Unknown additional NDJSON fields are ignored locally, never sent.
Do not infer deployment names from timestamps, environment names, a latest
deployment listing, or human-readable logs.

Use a 64 KiB evidence-file limit and a 16 KiB stdin limit. Do not print the
records. Although IDs are temporarily needed locally to query ARM, they are not
analytics properties and are never forwarded to Application Insights.

### 4.4 ARM verification and type extraction

Use Azure CLI authentication already available to the workflow and structured
ARM JSON responses, with a small injectable query adapter. No new Azure SDK or
credential store is needed. Invoke Azure CLI with an argument array, not a
shell-interpolated command. Query only the supported public Azure ARM endpoint.

The adapter reads the exact root's `provisioningState`, then its deployment
operations. Do not read deployment parameters, outputs, request/response bodies,
or error details into the event model. CLI subprocess output is consumed locally
and not printed by the collector. Query failure bodies are discarded, not logged.

Walk subscription/resource-group nested deployment IDs returned by ARM; handle
every page and keep an in-memory visited set. Follow only valid ARM deployment
IDs and same-origin ARM pagination URLs. Do not query arbitrary URLs supplied
through an evidence file or response.

Include `targetResource.resourceType` for successful `Create` operations.
ARM's provisioning-operation enum does not provide a separate `Update` value;
do not invent one. Exclude Read, EvaluateDeploymentOutput, waiting, delete, and
cleanup operations. For `Microsoft.Resources/deployments`, traverse the child
and omit the wrapper type from the result. Any referenced child not confirmed
successful makes the observation incomplete and suppresses the event.

Validate type syntax and length, reject IDs/names or malformed values, normalize
case consistently, deduplicate, and sort. Only Microsoft resource-provider
types are included in Phase 1; unknown/custom providers are outside scope.
The value is read from `resourceType`, never reconstructed from resource IDs.
No qualifying types means no event.

Bound collection to 15 seconds overall, 50 ARM requests, nesting depth 10, and
100 distinct types. A denied query, unsupported child scope, exhausted bound,
or malformed required field skips the whole observation rather than emitting
a silently truncated breakdown. These are collector safety limits, not limits
on what the user can deploy.

Operations indicate provisioning activity, not proof that every resource
materially changed. Idempotent ARM reapplication can count. Conversely, cached
operations can be omitted. Do not label this set "new resources."

Reference: [ARM deployment operations contract](https://learn.microsoft.com/en-us/rest/api/resources/deployment-operations/list?view=rest-resources-2025-04-01).

### 4.5 Outbound event and privacy boundary

Emit one event named `azure_contribution`, with exactly these application
properties:

| Property | Source / allowed values |
| --- | --- |
| `skill` | Executing canonical skill allowlist: deploy or agents/hosted-skills, depending on the merged rename |
| `operation` | `deploy` or `provision` |
| `result` | Constant `success`, constructed only after verification |
| `resourceTypes` | JSON-encoded array of normalized resource types; string-valued Application Insights custom property |
| `deploymentKind` | Fixed mapping: deploy skill -> `function-app`; agents/hosted-skills -> `hosted-agent` |
| `agent` | Existing normalized client categories, plus explicit `codex`; otherwise `unknown` |
| `skillsVersion` | Version of executing installed Skills assets, or `unknown` |

Example of the actual string-valued properties contract:

```json
{
  "name": "azure_contribution",
  "properties": {
    "skill": "azure-functions-deploy",
    "operation": "deploy",
    "result": "success",
    "resourceTypes": "[\"microsoft.storage/storageaccounts\",\"microsoft.web/sites\"]",
    "deploymentKind": "function-app",
    "agent": "copilot-cli",
    "skillsVersion": "unknown"
  }
}
```

Use existing installed metadata when available; do not overhaul distribution
only to eliminate `unknown`. A newer npx sender version is not the Skills
version. Derive deploymentKind in code rather than accepting a free-text label.

The telemetry boundary constructs a new allowlisted object; never spread local
evidence or ARM responses into it. No subscription/tenant/resource/deployment
IDs, names, user/email/session IDs, absolute paths, environment values, source,
prompts, endpoints, keys, logs, or errors are sent, even hashed.

Envelope-level privacy is mandatory, not deferred. The currently pinned
Application Insights 1.8.10 [Context implementation](https://github.com/microsoft/ApplicationInsights-node.js/blob/1.8.10/Library/Context.ts)
adds the hostname as cloudRoleInstance. Suppress customer/host-derived tags and
automatic collection; permit only transport-required fields, event timestamp,
and fixed/nonidentifying SDK metadata. Do not inherit operation/session/user
correlation from usage telemetry. Cover the full serialized HTTP envelope, not
just trackEvent arguments. Remove hostname context in the shared client without
redesigning existing usage properties. This intentionally removes hostname from
existing usage envelopes too; AC-001 preserves their event names and application
properties, not that privacy-sensitive SDK tag. Recheck this against PR #240 if
it merges.

This contract governs application telemetry content. HTTPS necessarily exposes
the client's network address to the receiving service; do not promise anonymous
transport. Document the existing ingestion service's applicable privacy policy
and IP handling rather than claiming that categorical properties eliminate all
service-side metadata.

### 4.6 Preferences, failures, and transport

Reuse the two existing opt-out environment variables. Resolve the applicable
installed plugin/workspace `telemetry.config.json` using the executing host and
asset location, not arbitrary ancestor scanning. Both capture recipe and
collector check preference. If its location or contents cannot be safely
resolved, skip collection rather than bypass an opt-out.

The collector returns a local categorical result: `sent`, `disabled`,
`not-configured`, `skipped`, or `failed`, with a fixed reason code when relevant.
Neither result nor diagnostics includes evidence values or raw exception text.
Do not introduce another diagnostics subsystem; use PR #235's bounded diagnostics
if available, otherwise a short local categorical notice.

The existing sender owns delivery timeout and any bounded transport retry.
There is no contribution-specific retry or persistent queue. A telemetry
failure cannot reclassify the deployment, prompt a cloud login, elevate Azure
permissions, or trigger reprovisioning. If ARM read access is absent, skip.

### 4.7 Module ownership and reporting

| Surface | Planned responsibility |
| --- | --- |
| `src/telemetry/contribution.ts` (new) | Local evidence validation, success policy, normalized event construction |
| `src/telemetry/arm-deployments.ts` (new) | Injectable bounded structured ARM query/traversal |
| Existing sender and `src/telemetry/index.ts` | Reuse transport and privacy-safe client; keep raw ARM evidence out of the package's telemetry-event API |
| `bin/azure-functions-skills.js` | Small internal subcommand dispatcher; no deployment orchestration |
| Two canonical skill instructions / one shared reference | Capture recipe and delegation ownership, not generic PostToolUse detection |

Report event count over time and by skill/deploymentKind. Expand resourceTypes
only for the breakdown; expanding the array must not inflate the headline count.
A type's count means "observations containing this type," not resource count.
Document disabled/unsupported paths and delivery loss. Existing usage counts
can be displayed alongside contributions, but do not compute an exact funnel
or attempt denominator from success-only events.

### Delivery checkpoints

| Slice | Requirements / planned work | Review boundary |
| --- | --- | --- |
| M0: Design approval | Reconcile #244, number allocation, related PRs, and open questions; resolve independent review and delegated capture feasibility | Approve a concrete delegation contract or explicitly defer that path, then obtain human approval of the identified revision; no implementation before Finalized |
| M1: Event and privacy contract | AC-001, AC-006, AC-007, AC-009; tests first, narrow sender/schema changes | Inspect an entirely local captured envelope and confirm compatibility/privacy scope |
| M2: Collector | AC-003 through AC-005, AC-008, AC-010; fixtures first, evidence/ARM adapter/CLI | Review counting, bounds, skip behavior, and lack of durable tracking |
| M3: Skill wiring and documentation | AC-002, AC-007, AC-009 through AC-011; recipe, delegation, local install/plugin assets | Review both host/script paths, limitations, and requirement-linked acceptance evidence |

Use one primary implementer and separate review at these checkpoints. Prefer one
small implementation PR if these slices remain reviewable. If telemetry
compatibility or delegation requires a larger framework, stop and revise scope
instead of importing that framework into Phase 1.

Live Azure validation is a separate optional authorization gate: reviewed code,
subscription/identity, budget, repetition count, resource ownership, and cleanup
must be approved. No deployment, Vally evaluation, production event, dashboard,
or Azure resource is created by this documentation task.

### Open questions

- Maintainer: confirm that narrow invocation instrumentation is owned by this
  shared-infrastructure FRD under the final #244 policy. It does not redefine
  either skill's purpose or general deployment contract; if lifecycle FRDs are
  required for the tool-chain addition, link those before implementing M3.
- Maintainer: approve the draft's single-layer azd boundary and skip-on-incomplete
  resource breakdown. These are proposed implementation details, not an already
  approved contract.
- Implementer/reviewer at M0: recheck which of #218, #235, and #240 have merged,
  select the concrete canonical paths and metadata/preference resolver, and
  identify how the direct and delegated execution flows preserve capture context.
  The delegated flow is the explicit M0 gate in section 4.2; if it cannot do this,
  revise AC-002 with human approval rather than promising unsupported coverage.

## 5. Decisions log

| ID | Decision / options | Choice and rationale | Decided by | Date |
| --- | --- | --- | --- | --- |
| D-001 | Overview versus exact accounting | User accepted a small Phase 1 focused on contribution trends; defer strict deduplication and broad coverage. This is direction approval, not FRD sign-off. | User, conversation scope agreement | 2026-09-08 |
| D-002 | Existing transport versus new service | Reuse Application Insights sender; no SDK migration, backend, or new credential. | Copilot (proposal) | 2026-09-08 |
| D-003 | Generic hook inference, persistent azd hooks, wrapper engine, or explicit collection | Explicit fresh-file capture plus post-command collector; preserve deployment ownership and avoid command/log parsing. | Copilot (proposal) | 2026-09-08 |
| D-004 | Global workload identity versus per-command observation | No durable ID; one successful supported invocation is one observation. Failed attempts emit nothing; exact-once remains out of scope. | Copilot (proposal) | 2026-09-08 |
| D-005 | Provision success alone versus full azd up result | Require full up success for up, provision success for standalone provision; always verify current ARM evidence. | Copilot (proposal) | 2026-09-08 |
| D-006 | Top-level-only versus nested resource types | Keep bounded nested traversal because Bicep modules are normal, not an optional precision enhancement. | Copilot (proposal) | 2026-09-08 |
| D-007 | Properties-only filtering versus full envelope privacy | Full outbound-envelope filtering is mandatory even in the small PR. | Copilot (proposal) | 2026-09-08 |
| D-008 | Reuse 0001/0002 versus next unused number | Use FRD-0003 after checking open PR filenames; leave the existing 0001 collision to its owners. | Copilot (allocation proposal) | 2026-09-08 |
| D-009 | Architecture review: compatibility and delegated feasibility | Clarify that hostname removal intentionally affects SDK envelopes, not usage application properties; make delegated capture an M0 gate with human-approved scope reduction if needed. | Copilot (revision 2 proposal, responding to independent review) | 2026-09-08 |

## 6. Test plan

All entries are planned, not completed acceptance evidence. Use existing Vitest,
CLI fixture, local HTTP capture, and isolated install/update infrastructure.

| Requirement | Test / fixture / experiment | Expected evidence |
| --- | --- | --- |
| AC-001 | Extend `tests/telemetry.test.ts` and `tests/simplified-cli.test.ts` | New event exact shape; unchanged legacy stdin/event behavior |
| AC-002, AC-011 | Skill contract fixtures and isolated capture recipes with fake azd/az/package commands | Only supported explicit entry points collect; external delegation has one owner; no customer azure.yaml modifications |
| AC-003 | New contribution fixtures: exit failure/cancel, ARM Running/Failed, missing/fresh empty/stale-looking file, preview, publish failure | Zero contribution sends and no fallback to deployment history |
| AC-004 | Failed attempt then successful attempt; nested modules; deliberate double collector call | 0 then 1 for normal retry; one event for nested modules; duplicate-call limitation documented, not falsely claimed solved |
| AC-005 | New ARM fixtures: subscription root, RG root, nested modules/pages, Create/Read/Delete, malformed type, repeated type, unsupported child/layer, empty type set | Complete normalized type set or explicit skip, never wrapper-type counting or partial silent success |
| AC-005, AC-008 | Deadline/request/depth/type caps, cycle, denied read, invalid pagination origin | Bounded termination, no arbitrary URL request, no raw diagnostic data |
| AC-006 | Local HTTP server captures/decompresses the entire serialized SDK request; seed evidence with sentinel names/secrets | No forbidden sentinel, hostname, environment-derived tag, source, endpoint, or correlation identity anywhere in the envelope |
| AC-006, AC-009 | Invalid skill/client/version, unknown fields, oversized input/type set | Reject or normalize per contract; no free-text outbound dimensions |
| AC-007 | Both environment opt-outs; each host's local and plugin config; missing/malformed preference context | No additional ARM read or send when disabled/unresolved; original deployment still runs |
| AC-008 | Fake azd exit codes, missing collector, query/send failures, cleanup failure, interrupted capture | No cloud retry caused by telemetry; preserve original deployment result; delete only caller-owned temporary data when possible |
| AC-009 | Installed version differs from npx sender; missing metadata; rename variant | Correct asset version or unknown; one canonical skill name, no double emission |
| AC-010 | Documented query examples against a small synthetic dataset | Resource expansion does not change headline event count; no success-rate or full-inventory claim |
| AC-011 | Canonical payload generation and isolated workspace CLI integration | No durable ledger, global hook interception, Azure tags, or new service introduced |

At implementation time, run the targeted tests first, then the repository's
required lint/typecheck/tests and canonical build/payload verification before
commit. Use isolated workspaces for CLI flows. Real-agent/live evaluation, if
needed to establish delegation behavior beyond fixtures, must use reviewed code
and the required reviewer gate; mocks alone are not evidence of live coverage.
Record any unevaluated host as unverified, not supported by assertion.

## 7. Docs impact

This documentation change adds only this FRD and its provisional index.
Do not copy or modify #244's governance files in this branch.

Implementation would update:

- `README.md`, Telemetry: new categorical event, opt-out, local transient ARM
  identifiers, contribution scope, IP/service metadata caveat, and best-effort limits.
- `docs/internal/telemetry-release.md`: actual event/property contract and
  simple reporting examples; preserve the existing release destination model.
- `docs/cli-reference.md`: clarify internal telemetry behavior and privacy
  without advertising the collector as a supported deployment command.
- `templates/skills/azure-functions-deploy/SKILL.md`: delegation capture context
  and a single post-command collection owner.
- `templates/skills/azure-functions-agents/SKILL.md` and its
  `references/infra-and-deployment.md`, or the renamed equivalents from #218:
  direct capture flow and explicit exclusions for connector follow-up work.
- `templates/skills/azure-functions-common/references/contribution-telemetry.md`
  (new): shared small PowerShell/Bash recipes and failure/opt-out behavior.
- `docs/frds/README.md` and this FRD: synchronized lifecycle, reviews, decision
  changes, and requirement-linked implementation evidence.

Regenerate derived plugin payloads with `npm run build:plugin-payload` if
canonical skills change; never hand-edit generated copies. Do not modify
`templates/agents/AGENTS.md`. Changing skill content later requires the
applicable skill-authoring instructions; this draft does not execute the skills.

## 8. Status & sign-off

| Item | Evidence |
| --- | --- |
| Independent architecture review | Claude Opus 4.8 read-only review of revision 1 on 2026-09-08; two clarification findings addressed by the author in revision 2 below |
| Human approval | Pending; prior scope agreement is not approval of this written revision |
| Approved revision and scope | Pending; record commit SHA or content hash after explicit approval |
| Approval reference and date | Pending |
| Governance integration | Pending PR #244 and reconciliation of its final process |
| Number allocation | FRD-0003 unused among remote main and all open PRs checked on 2026-09-08; recheck before publication/merge |
| Implementation reference | Not started; explicitly excluded from this task |
| Acceptance evidence | Not collected; section 6 contains planned evidence only |
| Live execution authorization | Not requested or granted |

### Independent review disposition

The reviewer found the direct capture/collector split appropriately small and
recommended human design review after two clarifications. Revision 2 addresses:

| Finding | Resolution |
| --- | --- |
| AC-001 could be read to prohibit shared hostname suppression | AC-001 and section 4.5 explicitly distinguish preserved application properties from intentionally removed SDK hostname context. |
| Delegated capture was only a general open question | Section 4.2 and M0 now require a concrete delegation contract or an explicitly approved narrowing of AC-002 before Finalized status. |

This records independent advice and the author's disposition, not reviewer or
human approval of revision 2. M0 questions and human sign-off remain pending.

Status remains Draft. Resolve open questions and review findings, identify the
reviewed revision, obtain explicit human sign-off, and update this document and
the index to Finalized before implementing. This proposal does not authorize
live resources, production telemetry sends, or paid evaluations.
