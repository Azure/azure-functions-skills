# FRD-0003: Azure deployment observation telemetry

| Metadata | Value |
| --- | --- |
| Status | Draft |
| Revision | 8 |
| Created | 2026-09-08 |
| Updated | 2026-09-15 |
| Author | GitHub Copilot, based on the user's requirements and scope feedback |
| Depends on | [FRD governance](README.md), merged as `a430a5b` (PR #244) |
| Component | Shared infrastructure: deployment observation telemetry and narrow skill integration |

## 1. Summary

Add **one** Application Insights event, `azure_deployment_observed`, that shows the
approximate volume and resource-type breakdown of successful Azure deployments
observed through Azure Functions Skills.

Today's telemetry shows that a skill was used. It cannot show that anything was
deployed. This event closes that gap with the smallest possible mechanism: after a
supported deployment command reports success, the agent calls one bounded,
read-only collector that asks Azure Resource Manager (ARM) what was provisioned,
and sends a small set of categorical values.

| Aspect | Position |
| --- | --- |
| Scope | azd with Bicep, from `azure-functions-deploy` and `azure-functions-hosted-skills` |
| Transport | The existing Application Insights sender. **No** new destination, credential, or service |
| Data | Categorical values only. **No** customer, subscription, resource, or user identity |
| Cost to the user | Read-only ARM queries, bounded to 20 s, run only after a deployment already succeeded |

### What this metric is not

The reporting label is **Observed successful Azure deployment operations**, and the
event name matches that label exactly. This feature *observes*; it does not
establish causality. No wording in this document, in code, or in any derived report
may imply otherwise (D-015).

| Prohibited interpretation | Why it is invalid |
| --- | --- |
| Conversion rate, funnel stage, or success rate | Only successes are emitted, so there is no attempt denominator |
| Total Azure deployment volume or a deployment inventory | Only two skills, azd/Bicep, and subscription-scope roots are in scope |
| Proof that a Skills invocation created the workload | Selection correlates by deployment name and a time window, not by command identity |
| Proof of net-new Azure resources | Idempotent ARM reapplication is indistinguishable from first creation |
| A billing, revenue, or capacity metric | No cost, quantity, subscription, or customer identity data is collected |

## 2. Motivation / problem

A user can invoke a skill, then cancel, run validation only, or fail provisioning.
Usage telemetry counts all of those the same way. Management reporting needs the
subset that produced real Azure resources.

For example, failed provisioning followed by a successful retry should produce
**one** event listing Functions, Storage, and Application Insights. Counting each
resource, each nested module, or each attempt would obscure the question.

### Existing surfaces this design reuses

| Surface | What it already does |
| --- | --- |
| [Telemetry sender](../../src/telemetry/sender.ts) | Sends `AzureFunctionsSkillsPluginExecuted` through an allowlist |
| [Hidden CLI](../../bin/azure-functions-skills.js) | `telemetry` reads one sanitized JSON event from stdin |
| [Hook scripts](../../templates/hooks/scripts) | Record skill and tool usage. Deployment success is **not** inferable here |
| [Deploy skill](../../templates/skills/azure-functions-deploy/SKILL.md) | Delegates to the external `azure-deploy` executor, which this repository does not own |
| [Hosted skills](../../templates/skills/azure-functions-hosted-skills/SKILL.md) | Runs azd directly |
| [Workspace preferences](../../src/setup/workspace-assets.ts) | Per-host telemetry opt-out, in addition to environment variables |
| [Release transport](../internal/telemetry-release.md) | Injects the destination at release time |

### Related work

| PR | Integration rule |
| --- | --- |
| [#244 FRD governance](https://github.com/Azure/azure-functions-skills/pull/244) | Merged `a430a5b`. Follow its index and sign-off rules |
| [#218 hosted skills rename](https://github.com/Azure/azure-functions-skills/pull/218) | Merged `b173701`. `azure-functions-hosted-skills` is the only canonical name |
| [#235 telemetry reliability](https://github.com/Azure/azure-functions-skills/pull/235) | Open. Reuse its sender and version metadata if merged; do not duplicate its retry or doctor work |
| [#240 App Insights SDK update](https://github.com/Azure/azure-functions-skills/pull/240) | Open. Do not bundle an SDK migration. Re-verify the outbound envelope against whichever version merges |

## 3. Goals / non-goals

### Requirements and acceptance criteria

| ID | Requirement | Observable acceptance criterion |
| --- | --- | --- |
| AC-001 | Add one observation event without changing existing usage telemetry. | `azure_deployment_observed` is emitted; existing event names and application properties are unchanged. Removing hostname-derived SDK envelope context is an intentional privacy change shared by both paths. |
| AC-002 | Limit collection to two canonical skills and azd/Bicep. | Only `azure-functions-deploy` (delegated) and `azure-functions-hosted-skills` (direct azd) can call the collector. Plain CLI create, Terraform, and other skills emit nothing. |
| AC-003 | Require both command success and current ARM success. | Failed or cancelled commands, non-terminal or failed ARM states, an absent deployment, a deployment completed before the caller's start instant or outside the recency window, and preview/validation/code-only deploys all produce no event. |
| AC-004 | Count one successful command, not its resources or modules. | One collector call emits at most one event. Failed attempts emit zero. A deployment whose operations contain no successful `Create` is skipped, never emitted with an empty breakdown. |
| AC-005 | Collect types from the selected deployment and its nested operations. | A subscription-scope root, pagination, and nested modules yield a sorted, distinct type set with no deployment-wrapper types. Resource-group-scope roots are out of scope and are skipped, not misattributed. |
| AC-006 | Send only the categorical contract and non-identifying SDK metadata. | The captured HTTP envelope contains no customer names, identifiers, secrets, logs, source, host identity, or inherited correlation identifiers. |
| AC-007 | Honor opt-out before any extra work. | Either opt-out environment variable, or the applicable installed telemetry config, disables the ARM queries and the send before either runs. |
| AC-008 | Never change a deployment outcome. | Query denial, timeout, malformed input, missing package, and ingestion failure never trigger a retry or reclassify the result the agent already observed. |
| AC-009 | Keep client and version attribution truthful. | Client values are normalized, not guessed. Skills version comes from the executing asset or is `unknown`, never inferred from a newer sender. |
| AC-010 | Make the scope limits travel with the metric. | Every dashboard, report, or query example that publishes this metric displays the section 4.8 disclaimer verbatim next to the number. |
| AC-011 | Keep the integration small and non-persistent. | No customer `azure.yaml` hooks, operation database, ARM tags, new server, or global tool interception. |
| AC-012 | Record the data governance before sign-off. | The section 4.6 governance table names the owner, retention, access control, privacy-review determination, service-side metadata handling, and rollback procedure, with no unresolved placeholder. |

### Non-goals

- Unique subscriptions, users, tenants, workloads, or pseudonymous customer IDs.
- Durable tracking, exactly-once delivery, offline queues, or server-side deduplication.
- Direct `az deployment`, CLI resource create/update, Terraform, deployment stacks,
  multiple azd provisioning layers, tenant/management-group roots, or custom clouds.
- Code-only `azd deploy`, Core Tools publishing, workload health, connector
  post-provisioning stages, or the create skill's fallback path.
- Parsing Bicep source, azd logs, shell output, or error bodies to infer success.
- Exact resource counting, revenue estimates, retry/failure dashboards, or a new dashboard.

## 4. Proposed design

### 4.1 Quick reference

| Item | Value |
| --- | --- |
| **Event name** | `azure_deployment_observed` |
| **Collector command** | `azure-functions-skills telemetry deployment-observed` (internal; not a supported public command) |
| **Who calls it** | The agent, **once**, after a supported deployment command reports success |
| **Input** | One JSON object on stdin, at most 16 KiB. Unknown fields are rejected |
| **Azure access** | Read-only ARM queries through the Azure CLI credential already present |
| **Bounds** | 20 s wall clock (injectable), 50 ARM HTTP requests, nesting depth 10, 100 distinct types |
| **Output** | One word: `sent`, `disabled`, `not-configured`, `skipped`, or `failed` |
| **Exit code** | Always `0`. A telemetry problem is never a deployment problem |
| **Opt-out** | `AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY=false`, `AZURE_MCP_COLLECT_TELEMETRY=false`, or `telemetry.config.json` with `{"enabled": false}` |

Input fields:

| Field | Required | Value |
| --- | --- | --- |
| `skill` | Yes | `azure-functions-deploy` or `azure-functions-hosted-skills` |
| `operation` | Yes | `deploy` for `azd up`, `provision` for standalone `azd provision` |
| `agent` | Yes | Client category; anything unrecognized becomes `unknown` |
| `environmentName` | Yes | The local azd environment name. Used **only locally** to find the deployment. See section 4.4 |
| `skillsVersion` | No | Version of the executing installed assets, else `unknown` |
| `startedAt` | No | ISO-8601 UTC instant captured immediately before the deployment started. Bounds selection from below (D-016) |

`environmentName` is required for a usable observation, and is enforced **at
collection time rather than at parse time**: input without it parses, then skips
before any Azure query, so the caller receives the precise skip reason instead of a
generic failure.

### 4.2 What is sent

Exactly these seven application properties, all string-valued:

| Property | Source / allowed values |
| --- | --- |
| `skill` | `azure-functions-deploy` or `azure-functions-hosted-skills` |
| `operation` | `deploy` or `provision` |
| `result` | Constant `success`, constructed only after ARM verification |
| `resourceTypes` | JSON-encoded array of normalized, lowercased, sorted, distinct types |
| `deploymentKind` | Derived in code: `azure-functions-deploy` → `function-app`; `azure-functions-hosted-skills` → `hosted-agent` |
| `agent` | Existing normalized client categories plus `codex`, else `unknown` |
| `skillsVersion` | Short version shape, else `unknown` |

```json
{
  "name": "azure_deployment_observed",
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

`deploymentKind` is derived from `skill` rather than accepted as free text, and a
contradicting pair is rejected. `skillsVersion` is validated against an expected
short shape so it cannot become a free-text channel. A newer npx sender version is
not the Skills version.

#### What is never sent

Subscription, tenant, resource, resource-group, and deployment IDs or names; user,
email, and session IDs; absolute paths; environment values; source; prompts;
endpoints; keys; logs; CLI output; error bodies. **Not even hashed.** The telemetry
boundary builds a new allowlisted object and never spreads local input or ARM
responses into it.

### 4.3 When an event is sent

| Condition | Result |
| --- | --- |
| Supported command succeeded **and** ARM reports a matching successful deployment with at least one successful `Create` | **Event sent** |
| Command failed or was cancelled | No event |
| `azd up` provisioned successfully but application publishing failed | No event. `azd up` requires whole-command success |
| Preview, what-if, validation-only, or code-only `azd deploy` | No event |
| ARM deployment not found, not `Succeeded`, or outside the window | No event |
| Deployment satisfied entirely from cache, so ARM reports no successful `Create` | No event (see undercount note below) |
| Opt-out active | No event, and **no ARM query** |
| Any bound exceeded, query denied, or a required field malformed | No event. Never a silently truncated breakdown |

**Counting.** The unit is one successful `azd up` or standalone `azd provision`.
Nested ARM deployments belong to that root and never count separately. A later
redeployment that ARM reports as having performed qualifying operations is a
separate observation and counts again.

**Call it once.** The agent calls the collector once per successful command: once
after `azd up`, or once after a standalone `azd provision`, and never in both the
delegating and the delegated skill. This is flow discipline, not durable
deduplication. Repeated calls, separate successful reprovisioning, or ambiguous
delivery can duplicate observations. That is accepted for Phase 1.

**Accepted undercount.** ARM's provisioning-operation enum has no `Update` value,
and an ARM PUT is a create-or-update, so a redeployment that really provisions is
still reported as `Create`. The real axis is whether ARM reports any qualifying
operation. A no-op reapplication therefore reports nothing and is skipped, which
systematically undercounts maintenance work. Emitting an empty `resourceTypes`
array was rejected because it creates a second event class indistinguishable from a
collection defect and lets no-op reapplications inflate the headline count (D-017).

### 4.4 How the deployment is found

Keep azd execution exactly as both skills perform it today. Do not wrap, re-run,
intercept, or re-order the deployment.

1. **Require `environmentName`.** azd derives its subscription-scope deployment name
   from the environment name, so that name *is* the deployment identifier. Validate
   it against the ARM deployment-name shape. A missing or invalid value skips the
   observation **before any Azure query**.
2. **Look it up directly by name** at the current subscription scope, through an
   injectable structured query adapter. Never list deployment history, and never
   parse human-readable azd or CLI output.
3. **Accept only** `provisioningState == Succeeded`, with a completion timestamp
   inside a 30-minute recency window and, when `startedAt` was supplied, at or after
   it within a small clock-skew tolerance.

The `startedAt` lower bound removes a real false positive: without it, a user who
deployed manually twenty minutes earlier and then ran a skill that provisioned
nothing would still match that earlier deployment by name. It is optional and
degrades gracefully to the 30-minute window, so an agent that cannot capture it
loses precision rather than the observation. It narrows a time window and is
explicitly **not** a command identity (D-016).

| Scope limit | Behavior |
| --- | --- |
| Subscription-scope root (what azd creates) | Supported |
| Resource-group-scope root | Not found → skipped, never misattributed |
| Management-group / tenant roots, custom clouds, deployment stacks, Terraform | Out of scope |

Accepted imprecision: re-running the collector after a later deployment that reuses
the same environment name refers to the newest deployment of that name. This
affects which breakdown is attached to an observation, not whether Skills-driven
deployment activity is broadly visible.

Deployment names, deployment IDs, subscription, and resource-group values are needed
locally to run these queries. They are never analytics properties, never forwarded,
and never printed.

### 4.5 ARM traversal and bounds

Invoke the Azure CLI with an **argument array**, never a shell-interpolated command,
and query only the supported public ARM endpoint.

| Rule | Detail |
| --- | --- |
| Included | `targetResource.resourceType` of successful `Create` operations |
| Excluded | Read, EvaluateDeploymentOutput, waiting, delete, and cleanup operations |
| Nested deployments | Traverse the child; omit the `Microsoft.Resources/deployments` wrapper type |
| Unconfirmed child | Makes the observation incomplete and suppresses the event |
| Normalization | Validate syntax and length, lowercase, deduplicate, sort. Microsoft providers only. Read from `resourceType`, never reconstructed from a resource ID |
| Never read into the model | Deployment parameters, outputs, request/response bodies, error details |
| Pagination | Handle every page; follow only same-origin ARM URLs; keep an in-memory visited set |

| Bound | Value | On exceeding |
| --- | --- | --- |
| Wall clock | 20 s, injectable | Skip |
| ARM HTTP requests | 50, counting **every** request including each pagination page | Skip |
| Nesting depth | 10 | Skip |
| Distinct types | 100 | Skip |

The time bound covers subprocess execution, so a stalled CLI invocation is
terminated rather than awaited. These are collector safety limits, not limits on
what the user can deploy.

Operations indicate provisioning activity, not proof that every resource materially
changed, so the set must never be labeled "new resources."

Reference: [ARM deployment operations](https://learn.microsoft.com/en-us/rest/api/resources/deployment-operations/list?view=rest-resources-2025-04-01).

### 4.6 Privacy and governance

**Envelope privacy is mandatory, not deferred.** Removing individual known tags is
not sufficient. On the pinned Application Insights 1.8.10, the SDK derives
`ai.application.ver` from the host package and injects `ai.operation.*` correlation
tags when the envelope is built, *after* client-level cleanup runs. Apply an
explicit **allowlist to the finished envelope** instead, permitting only
transport-required fields, the event timestamp, and fixed non-identifying SDK
metadata. Verify against the full serialized HTTP envelope, not the `trackEvent`
arguments. This intentionally removes hostname context from existing usage
envelopes too; AC-001 preserves their event names and application properties, not
that privacy-sensitive SDK tag. Re-check against PR #240 if it merges.

HTTPS necessarily exposes the client's network address to the receiving service. Do
not promise anonymous transport.

#### Data governance

This event introduces no new destination, credential, or service (D-002). It is
written to the same Application Insights resource, through the same release-injected
connection string, as the existing usage event, so its governance is the governance
already applying to that resource. Record the concrete values in
[`docs/internal/telemetry-release.md`](../internal/telemetry-release.md).

| Governance item | Phase 1 position |
| --- | --- |
| Data owner | The maintainer team that already owns the resource. **Name the team and contact before sign-off** (AC-012) |
| Categories collected | Categorical strings only (section 4.2) |
| Retention | As configured on the existing resource. **Record the period before sign-off**; this feature does not request a different one |
| Access control | The existing Azure RBAC. **Record the access model before sign-off**; no new reader is added |
| Privacy/security review | **Obtain a determination before sign-off** on whether a categorical event with no new identifier class needs a delta review |
| Regional and network metadata | Follows the existing resource. Client IP is visible to the ingestion service as a property of HTTPS and is never an application property |
| User disablement | Either opt-out environment variable, or the installed telemetry config, before any query or send (AC-007) |
| Operator rollback | Remove the collection step from the two skills and ship a release. Reverting the implementation PRs removes the event entirely |
| No remote kill switch | Deliberate. A switch would add a configuration service, a fetch path, and a failure mode to every collection, out of proportion to one categorical event. Worst case is bounded by release cadence |

### 4.7 Execution model and failure behavior

| Property | Phase 1 contract |
| --- | --- |
| Synchronicity | **Synchronous.** Runs after the deployment already reported success; never concurrent with it |
| Ordering | Strictly after the result exists. Cannot influence, delay, retry, or reclassify it |
| Azure work | At most 20 s and 50 ARM requests. A live run measured 2.4 s for the lookup |
| Package resolution | **Unbounded and outside this design.** `npx` can dominate wall time on a cold cache. Callers needing a bounded step must use an already-installed asset |
| Disabled or unconfigured | Returns before any query or send, so it adds no measurable latency |
| Process exit mid-collection | Nothing is sent. No queue, no resume, no partial event. Accepted best-effort loss |
| Failure | Always exits 0 and prints one word. Never surfaced as a deployment failure (AC-008) |

Backgrounding is deliberately rejected: it would orphan a process whose lifetime,
output, and opt-out behavior outlive the command the user is watching, hide the
result from the invoking agent, and complicate opt-out audit (D-018).

Opt-out resolution uses the executing host and asset location, not arbitrary
ancestor scanning. **If the configuration cannot be safely resolved, skip rather
than bypass an opt-out.** The existing sender owns delivery timeout and any bounded
transport retry; there is no observation-specific retry or persistent queue. A
telemetry failure cannot prompt a cloud login, elevate permissions, or trigger
reprovisioning.

This is trusted local workflow evidence, not attested attribution: a caller able to
invoke the internal CLI can supply misleading input. Phase 1 does not attempt
anti-fraud protection.

### 4.8 Reporting rules

| Surface | Responsibility |
| --- | --- |
| `src/telemetry/deployment-observation.ts` | Input validation, selection policy, normalized event construction |
| `src/telemetry/arm-deployments.ts` | Injectable bounded structured ARM query and traversal |
| Existing sender and `src/telemetry/index.ts` | Transport and privacy-safe client; keep raw ARM responses out of the public API |
| `bin/azure-functions-skills.js` | Small internal subcommand dispatcher; no deployment orchestration |
| Two canonical skill instructions | One post-success collection step each |

Report event count over time and by `skill` / `deploymentKind`. Expanding
`resourceTypes` must not inflate the headline count: a type's count means
"observations containing this type," not a resource count. Usage counts may be shown
alongside observations, but **do not compute a funnel or an attempt denominator**
from success-only events.

#### Required disclaimer

Any dashboard, report, slide, or query example that publishes this metric must show
this text next to the number, verbatim (AC-010):

> **Observed successful Azure deployment operations.** Counts azd/Bicep
> subscription-scope deployments observed after a successful
> `azure-functions-deploy` or `azure-functions-hosted-skills` command, verified
> against Azure Resource Manager. It is a best-effort adoption signal, not a
> deployment inventory, conversion rate, success rate, or proof that Azure
> Functions Skills created the workload. Resource-group-scope deployments,
> Terraform, direct Azure CLI, multiple azd provisioning layers, tenant and
> management-group roots, custom Azure clouds, opted-out users, and cached or
> update-only redeployments are not counted. Duplicate observations are possible.

Using this metric in a ratio requires a written coverage statement explaining what
the other side measures and why the two are comparable. Without it, publish the
count only.

### Delivery checkpoints

| Slice | Requirements | Review boundary |
| --- | --- | --- |
| M0 Design approval | Governance, numbering, open questions | Human approval of the identified revision |
| M1 Event and privacy contract | AC-001, AC-006, AC-007, AC-009 | Inspect a locally captured envelope |
| M2 Collector | AC-003 to AC-005, AC-008, AC-010 | Review counting, bounds, and skip behavior |
| M3 Skill wiring and docs | AC-002, AC-007, AC-009 to AC-011 | Review both skill paths and the limitations text |

Use one primary implementer with separate review at these checkpoints. If telemetry
compatibility or delegation requires a larger framework, stop and revise scope
instead of importing that framework into Phase 1.

Live Azure validation is a **separate** authorization gate: reviewed code,
subscription, budget, repetition count, resource ownership, and cleanup must all be
approved.

### Open questions

- **Maintainer:** confirm that narrow invocation instrumentation belongs to this
  shared-infrastructure FRD rather than to per-skill lifecycle FRDs.
- **Maintainer:** approve the single-layer azd boundary and the skip-on-incomplete
  resource breakdown.
- **Implementer:** re-check #235 and #240 before merge and re-verify the outbound
  envelope against the Application Insights version then in the tree.

## 5. Decisions log

Append-only. Superseded entries are retained and link their replacement.

| ID | Decision | Choice | Decided by | Date |
| --- | --- | --- | --- | --- |
| D-001 | Overview versus exact accounting | Small Phase 1 focused on trends; defer strict deduplication and broad coverage. Direction approval, not sign-off | User | 2026-09-08 |
| D-002 | Existing transport versus new service | Reuse the Application Insights sender; no SDK migration, backend, or credential | Copilot (proposal) | 2026-09-08 |
| D-003 | Hook inference versus explicit collection | Explicit post-success collector call; no command or log parsing | Copilot (proposal) | 2026-09-08 |
| D-004 | Durable workload identity versus per-command observation | No durable ID. One successful command is one observation; exactly-once is out of scope | Copilot (proposal) | 2026-09-08 |
| D-005 | Provision success versus whole `azd up` result | Require whole-command success, then verify current ARM evidence | Copilot (proposal) | 2026-09-08 |
| D-006 | Top-level types only versus nested traversal | Keep bounded nested traversal; Bicep modules are normal, not an enhancement | Copilot (proposal) | 2026-09-08 |
| D-007 | Property filtering versus full envelope privacy | Full outbound-envelope filtering is mandatory even in a small PR | Copilot (proposal) | 2026-09-08 |
| D-008 | FRD number allocation | Use 0003; leave the existing 0001 collision to its owners | Copilot (proposal) | 2026-09-08 |
| D-009 | Architecture review disposition (revision 2) | Clarify that hostname removal affects SDK envelopes, not usage application properties | Copilot (proposal) | 2026-09-08 |
| D-010 | Per-attempt capture versus post-success ARM selection | **Post-success selection.** Per-attempt capture requires owning the azd process, which the delegating deploy skill cannot do, so it would cover one skill while adding a wrapper, temporary files, and exit-code plumbing. The cost is bounded misattribution of the breakdown. Exact capture deferred to Phase 2 | User (scope), Copilot (proposal) | 2026-09-09 |
| D-011 | Rebase onto merged `main` | Adopt the merged governance index and the `azure-functions-hosted-skills` name | Copilot | 2026-09-10 |
| D-012 | Implementation review disposition | Fix all seven findings in the implementation rather than relax the specification. Only the envelope allowlist needed a specification clarification | Copilot, GPT-5.6 review | 2026-09-10 |
| D-013 | Recency scan versus lookup by name | **Lookup by name.** A live run proved the scan incorrect, not merely slow: ARM does not return deployments newest-first, and `$top` is a per-page hint, so a bounded scan silently drops real deployments. Exhaustive pagination measured 58 s for 151 deployments; lookup by name is one request at 2.4 s. Cost: `environmentName` becomes required and resource-group scope is excluded | Copilot, live evidence | 2026-09-10 |
| D-014 | Defects found only by live execution | Fix in the implementation; specification intent unchanged. Live execution exposed three defects that injected-dependency tests structurally cannot catch: the Azure CLI could not be spawned on Windows, a successful ingestion response was classified as a delivery failure in a helper shared with the pre-existing usage path, and D-013. The time bound moves 15 s → 20 s and becomes injectable. Live evidence is now required before sign-off | Copilot, live evidence | 2026-09-10 |
| D-015 | Per-command correlation versus consistent reframing | **Reframe and rename.** Real correlation is declined for the structural reason in D-010. The event, document, module, and subcommand become `azure_deployment_observed` so the name cannot outrun the mechanism, and section 1 adds the prohibited-interpretation table. Renaming now because nothing has shipped; after release it would be a breaking analytics change | User (naming), Copilot (proposal), Laveesh Rohra (review) | 2026-09-11 |
| D-016 | Recency window alone versus caller-supplied start instant | **Add optional `startedAt`** as a lower bound. Removes the false positive where a cache-only run matches the user's earlier manual deployment by name. Optional and falls back to the window. Narrows a time window; explicitly not the correlation declined in D-015 | Copilot (proposal), Laveesh Rohra (review) | 2026-09-11 |
| D-017 | Emit update-only deployments with an empty breakdown versus exclude | **Exclude.** ARM has no `Update` provisioning operation, so the axis is whether any qualifying `Create` is reported. An empty `resourceTypes` array would create a second event class indistinguishable from a collection defect. The resulting undercount is disclosed | Copilot (proposal), Laveesh Rohra (review) | 2026-09-11 |
| D-018 | Synchronous bounded collection versus backgrounding | **Synchronous.** Backgrounding would orphan a process outliving the command the user is watching, hide the result, and complicate opt-out audit. The review also surfaced that `npx` resolution is unbounded; that cost is now stated rather than hidden behind the Azure-side bound | Copilot (proposal), Laveesh Rohra (review) | 2026-09-11 |
| D-019 | Define new governance versus document what already applies | **Document what applies.** The event reuses the destination and credential of the existing usage event (D-002), so governance is a property of that resource. AC-012 makes recording concrete values a sign-off gate. A remote kill switch was rejected as disproportionate | Copilot (proposal), Laveesh Rohra (review) | 2026-09-11 |
| D-020 | Keep the detailed authoring narrative versus a spec-first document | **Spec-first.** Revision 8 restructures the document around the external contract (quick reference, what is sent, when it is sent, opt-out, verification) and compresses per-revision rationale into this log. No acceptance criterion, bound, or privacy rule is changed | User (readability feedback), Copilot | 2026-09-15 |

## 6. Test plan

Use existing Vitest, CLI fixture, local HTTP capture, and isolated install
infrastructure. Run targeted tests first, then the repository's required
lint/typecheck/test and payload verification.

| Requirement | Test / fixture | Expected evidence |
| --- | --- | --- |
| AC-001 | `tests/telemetry.test.ts`, `tests/simplified-cli.test.ts` | Exact new event shape; unchanged legacy stdin and event behavior |
| AC-002, AC-011 | Skill contract fixtures; isolated CLI with a fake ARM adapter | Only supported entry points collect; delegation has one owner; no customer `azure.yaml` change |
| AC-003 | Missing/invalid `environmentName`; deployment absent; ARM Running/Failed; stale timestamp; completion earlier than `startedAt`; absent and malformed `startedAt`; preview; validation-only | Zero sends for every rejecting case; a missing or invalid name skips **before** any Azure query; an absent or malformed `startedAt` falls back to the window |
| AC-004 | Failed then successful attempt; nested modules; deliberate double call; deployment with no successful `Create` | 0 then 1; one event for nested modules; no-`Create` skips with no empty-array emission; duplicate-call limitation documented, not claimed solved |
| AC-005 | Subscription root, resource-group root, nested modules and pages, Create/Read/Delete, malformed type, repeated type, unsupported child, empty type set | Complete normalized set or explicit skip; never wrapper types or partial silent success; resource-group root skipped as out of scope |
| AC-005, AC-008 | Deadline, request, depth, and type caps; cycle; denied read; invalid pagination origin | Bounded termination; no arbitrary URL request; no raw diagnostic data |
| AC-006 | Local HTTP server captures and decompresses the whole serialized request; seed sentinel names and secrets | No sentinel, hostname, environment tag, source, endpoint, or correlation identity anywhere in the envelope |
| AC-006, AC-009 | Invalid skill/client/version; unknown fields; oversized input | Reject or normalize per contract; no free-text outbound dimension |
| AC-007 | Both environment opt-outs; each host's local and plugin config; missing or malformed config | No ARM read and no send when disabled or unresolved; the deployment still runs |
| AC-008 | Missing Azure CLI; denied or failing query; send failure; malformed stdin | No cloud retry caused by telemetry; the observed result is never reclassified |
| AC-009 | Installed version differs from the npx sender; missing metadata; rename variant | Correct asset version or `unknown`; one canonical skill name, no double emission |
| AC-010 | Query examples against a small synthetic dataset; review of every published artifact | Resource expansion does not change the headline count; the section 4.8 disclaimer appears verbatim |
| AC-011 | Canonical payload generation; isolated workspace CLI integration | No ledger, global hook interception, ARM tags, or new service |
| AC-012 | Documentation review against the section 4.6 governance table | Owner, retention, access control, privacy determination, regional handling, and rollback all recorded; no placeholder remains |
| AC-003, AC-005, AC-006, AC-008 | **Live execution** against a real subscription and a real Application Insights resource, through the published command path rather than injected fakes | Successful send and event arrival with the specified properties; skip and opt-out paths return one word and exit 0 without querying Azure; the ingested envelope carries no host, user, correlation, or application-version identity. Required as its own class because injected-dependency tests cannot exercise process spawning, real ARM response ordering, or ingestion responses (D-014) |

### Manual verification

To reproduce the live evidence:

1. Deploy any subscription-scope Bicep template with `azd provision`, or
   `az deployment sub create --name <env>`, and note the environment name.
2. Set a real connection string in the built asset and run:
   `echo '{"skill":"azure-functions-deploy","operation":"deploy","agent":"copilot-cli","environmentName":"<env>"}' | azure-functions-skills telemetry deployment-observed`
3. Expect `sent`. Then confirm arrival:
   `customEvents | where name == "azure_deployment_observed" | project timestamp, customDimensions`
4. Re-run with the environment name removed, with an invalid name, and with
   `AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY=false`. Expect `skipped`, `skipped`,
   and `disabled`, each exiting 0.

## 7. Docs impact

This document plus one index row in the merged governance index. Do not otherwise
modify the governance files.

Implementation updates:

| File | Change |
| --- | --- |
| `README.md` | Telemetry section: the new event, opt-out, local transient identifiers, scope, and best-effort limits |
| `docs/internal/telemetry-release.md` | Event and property contract, the section 4.6 governance values, the section 4.8 disclaimer, and query examples |
| `docs/cli-reference.md` | Internal telemetry behavior and privacy, without advertising the collector as a supported command |
| `templates/skills/azure-functions-deploy/SKILL.md` | One post-success collection owner after the delegated deployment |
| `templates/skills/azure-functions-hosted-skills/SKILL.md` and `references/infra-and-deployment.md` | The same step, plus explicit exclusion of connector follow-up work |
| `docs/frds/README.md` | Lifecycle status |

Regenerate derived payloads with `npm run build:plugin-payload`; never hand-edit
generated copies. Do not modify `templates/agents/AGENTS.md`.

## 8. Status & sign-off

| Item | Evidence |
| --- | --- |
| Independent architecture review | Claude Opus 4.8 reviewed revision 1 on 2026-09-08. Two clarifications, addressed in revision 2 |
| Implementation review | GPT-5.6 reviewed the telemetry core on 2026-09-10. Seven findings, all fixed in the implementation (D-012) |
| Maintainer review | Laveesh Rohra reviewed revision 6 on PR #247. Five findings, dispositioned in revision 7 (D-015 to D-019). No finding was rejected as invalid; one requested mechanism was declined with a recorded structural rationale (D-015) |
| Human approval | **Pending.** Prior scope agreement is not approval of a written revision |
| Approved revision and scope | Pending; record the commit SHA after explicit approval |
| Governance integration | Follows merged FRD governance (`a430a5b`); index row present |
| Number allocation | FRD-0003 verified unused on 2026-09-08 and re-checked on 2026-09-10 |
| Implementation reference | Phase 1 implemented as stacked PRs at the user's direction while this document is Draft: #259 (telemetry core) and #260 (skill and docs wiring), stacked above #247 |
| Acceptance evidence | Automated coverage from section 6 exists and passes in the implementation PRs, plus a live end-to-end run against real ARM and a real Application Insights resource on 2026-09-10. The live run confirmed a `sent` result, arrival of one custom event with the specified properties, and the section 4.6 privacy boundary on the actual ingested envelope. It also exposed three defects invisible to automated tests (D-013, D-014). **Revision 7's rename, `startedAt`, and the AC-012 governance record are not yet covered and require re-verification** |
| Live execution authorization | Granted by the user on 2026-09-10 for a dedicated test subscription. Test resources are retained by the user |

### Revision history

| Revision | Change |
| --- | --- |
| 1-2 | Initial proposal; architecture review clarifications (D-009) |
| 3 | Post-success ARM selection replaces per-attempt capture (D-010) |
| 4 | Rebased onto merged `main` (D-011) |
| 5 | Implementation review disposition; bounds and envelope allowlist clarified (D-012) |
| 6 | Lookup by name; live-execution defect class; time bound 15 s → 20 s (D-013, D-014) |
| 7 | Maintainer review: rename to `azure_deployment_observed`, `startedAt`, update-only exclusion, execution model, data governance, required disclaimer, AC-012 (D-015 to D-019) |
| 8 | Spec-first restructure for readability; no contract change (D-020) |

### Before this stack merges

1. Resolve the open questions and obtain explicit human sign-off on an identified revision.
2. **Apply revision 7's rename to the implementation PRs.** They still emit
   `azure_contribution` and expose `telemetry contribution`. Revision 7 changed the
   analytics contract, and renaming is only free before release.
3. Implement the optional `startedAt` lower bound (D-016).
4. Fill in the AC-012 governance values with concrete data.
5. Re-run the live verification against the renamed contract.
6. Move this document and the index to `Finalized`.

Status remains Draft deliberately: the user keeps it Draft because review may still
change the content. Implementation proceeded in parallel as draft PRs, so the
sign-off gate applies before merge rather than before writing code. This document
does not authorize live resources, production telemetry sends, or paid evaluations.
