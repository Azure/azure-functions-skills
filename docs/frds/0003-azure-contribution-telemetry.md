# FRD-0003: Azure contribution telemetry

| Metadata | Value |
| --- | --- |
| Status | Draft |
| Revision | 4 |
| Created | 2026-09-08 |
| Updated | 2026-09-10 |
| Author | GitHub Copilot, based on the user's requirements and scope feedback |
| Depends on | [FRD governance](README.md), merged as `a430a5b` (PR #244) |
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
| [Hosted skills skill](../../templates/skills/azure-functions-hosted-skills/SKILL.md) | Uses azd directly; integrate separately with the same collector. |
| [Workspace preferences](../../src/setup/workspace-assets.ts) | Local installs retain per-host telemetry opt-out settings, in addition to environment-variable opt-out. |
| [Release transport](../internal/telemetry-release.md) | The existing release pipeline injects the destination into the npm runtime. No new destination, credential, or service is needed. |

For example, failed provisioning followed by a successful retry should normally
produce one event, with a resource-type set such as Functions, Storage, and
Application Insights. Counting each resource, nested deployment, or failed
attempt would obscure the management question.

### Related work

| PR | Integration rule |
| --- | --- |
| [#244: FRD governance](https://github.com/Azure/azure-functions-skills/pull/244) | Merged as `a430a5b`. This document follows its index, lifecycle, and sign-off rules; do not restate or fork that process here. |
| [#218: hosted skills rename](https://github.com/Azure/azure-functions-skills/pull/218) | Merged as `b173701`. The canonical name is `azure-functions-hosted-skills`; all paths, allowlists, and `deploymentKind` mappings use it. Never emit both names for one operation. |
| [#235: telemetry reliability](https://github.com/Azure/azure-functions-skills/pull/235) | Still open. Reuse its sender, diagnostics, package resolution, and version metadata if merged. Do not reproduce its delivery retry, doctor, canary, or hook overhaul here. |
| [#240: Application Insights SDK update](https://github.com/Azure/azure-functions-skills/pull/240) | Still open. Do not bundle an SDK migration. Verify the actual outbound envelope against whichever version is merged. |
| [#241](https://github.com/Azure/azure-functions-skills/pull/241), [#245](https://github.com/Azure/azure-functions-skills/pull/245) | Reserve FRD numbers 0001 and 0002. No dependency on their workflow runner, evaluation framework, or telemetry events. |

## 3. Goals / non-goals

### Requirements and acceptance criteria

| ID | Requirement | Observable acceptance criterion |
| --- | --- | --- |
| AC-001 | Add one contribution event while preserving existing usage event names and application properties. | One accepted contribution emits `azure_contribution`; existing custom properties remain compatible. Removing hostname-derived SDK envelope context is an intentional privacy change shared by both event paths. |
| AC-002 | Limit attribution to the two supported canonical skills and azd/Bicep provisioning. | Delegated Functions and direct agents paths can call the collector; plain CLI create, Terraform, and unrelated skill use do not emit. |
| AC-003 | Require successful command completion and current ARM deployment success. | Failed/cancelled commands, nonterminal/failed ARM states, no qualifying recent successful deployment, preview, validation, and code-only deploy produce no event. |
| AC-004 | Count one supported successful command, not its resources or modules. | A single-layer azd invocation with multiple nested modules emits at most one event per collector call; failed attempts emit zero. |
| AC-005 | Collect types from the exact ARM deployment and its nested operations. | Subscription and resource-group roots, pagination, and nested modules yield a sorted, distinct resource-type set, without deployment-wrapper types. |
| AC-006 | Send only the categorical event contract and nonidentifying SDK metadata. | The captured HTTP envelope contains no customer names, identifiers, secrets, logs, source, host identity, or inherited correlation identifiers. |
| AC-007 | Honor opt-out before extra collection or transmission. | Either existing opt-out environment variable or the applicable installed telemetry config disables ARM telemetry queries and sending. |
| AC-008 | Do not change deployment outcomes for telemetry-only failures. | Query denial, timeout, malformed input, missing package, and ingestion failure never trigger a deployment retry or change the deployment result the agent already observed. |
| AC-009 | Preserve truthful client/version attribution. | Client values are normalized, not guessed; Skills version comes from the executing asset's metadata or is `unknown`, never inferred from a newer sender. |
| AC-010 | Keep delivery deliberately best-effort. | Documentation discloses unsupported paths, deployment-selection imprecision, skipped observations, possible duplicate collector calls, and absence of exact-once/funnel guarantees. |
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

If a retry skips provisioning from azd's cache, no new successful deployment
appears in the recency window and no event is emitted. Do not search older
attempts for a success. Types describe qualifying operations in the selected
deployment, not a union of all resources touched by failed attempts or a full
workload inventory.

### 4.2 Post-command collection

Keep azd execution exactly as both skills perform it today. Do not wrap,
re-run, intercept, or re-order the deployment. After a supported command reports
success, the executing agent invokes one small internal collector, provisionally:

```text
azure-functions-skills telemetry contribution
```

The subcommand accepts a bounded JSON object on stdin, limited to 16 KiB, with
`skill`, `operation`, `agent`, `skillsVersion`, and optional `environmentName`.
`operation` is `deploy` for `azd up` and `provision` for standalone
`azd provision`. `environmentName` is the local azd environment name, used only
to choose which deployment to inspect. Reject unknown fields; do not accept
templates, environment dumps, transcripts, tool output, or executable paths.
The original `telemetry` stdin contract stays unchanged.

Phase 1 deliberately drops the earlier capture-recipe design
(`AZD_DEPLOYMENT_ID_FILE`, per-attempt temporary files, exit-code plumbing, and a
process-scoped wrapper). That design gave exact per-attempt attribution but
required owning the azd process, which `azure-functions-deploy` cannot do because
it delegates execution to the external Azure Skills executor. Removing it makes
both skills supportable through the same one-line post-success call, deletes the
delegated-capture gate, and keeps the change small. The cost is deployment
selection precision, addressed in section 4.3.

Because the collector runs only after a reported success, there is no exit code
to plumb and no failed-attempt bookkeeping. Section 4.4's independent ARM check
remains the authoritative success signal, so a mistaken invocation after a
failure still emits nothing.

Call the collector once per successful supported command: once after `azd up`,
or once after a standalone `azd provision`, and never in both the delegating and
the delegated skill. This is flow discipline, not durable deduplication.
Repeated calls, separate successful reprovisioning, or ambiguous delivery can
duplicate observations; that limitation is accepted for Phase 1.

If a retry completes without provisioning because azd reuses cached
infrastructure, ARM shows no new successful deployment in the recency window and
no event is emitted.

This is trusted local workflow evidence, not attested attribution: a caller able
to invoke the internal CLI can supply misleading input. Phase 1 does not attempt
anti-fraud or hostile-local-user protection.

### 4.3 Deployment selection

The collector chooses the deployment to inspect from Azure Resource Manager
itself, reusing the Azure CLI authentication already available to the workflow:

1. List deployments at the current subscription scope through a structured,
   injectable query adapter. Never parse azd or CLI human-readable output.
2. Keep only entries whose `provisioningState` is `Succeeded` and whose
   completion timestamp falls inside a bounded recency window of 30 minutes.
3. If `environmentName` is supplied, prefer entries whose deployment name
   contains it; azd derives its subscription-scope deployment name from the
   environment name.
4. Select the single most recent remaining entry. No candidate means no event.

Accepted imprecision: an unrelated successful deployment running concurrently in
the same subscription can be selected, and a deployment that finished before the
window opened is skipped. Both affect which resource-type breakdown is attached
to an observation rather than whether Skills-driven deployment activity is
broadly visible, which is why section 1 uses an "observed", non-exact reporting
label. Exact per-attempt attribution is a deferred Phase 2 option.

Deployment names, deployment IDs, subscription, and resource-group values are
needed locally to run these queries. They are never analytics properties, are
never forwarded to Application Insights, and are not printed by the collector.

Out of scope for Phase 1: management-group and tenant roots, custom Azure
clouds, deployment stacks, Terraform, and any root scope azd does not create for
these two skills.
### 4.4 ARM verification and type extraction

Use Azure CLI authentication already available to the workflow and structured
ARM JSON responses, with a small injectable query adapter. No new Azure SDK or
credential store is needed. Invoke Azure CLI with an argument array, not a
shell-interpolated command. Query only the supported public Azure ARM endpoint.

The adapter reads the selected root's deployment operations. Do not read
deployment parameters, outputs, request/response bodies, or error details into
the event model. CLI subprocess output is consumed locally and not printed by
the collector. Query failure bodies are discarded, not logged.

Walk subscription/resource-group nested deployment IDs returned by ARM; handle
every page and keep an in-memory visited set. Follow only valid ARM deployment
IDs and same-origin ARM pagination URLs. Do not query arbitrary URLs supplied
through stdin or a response body.

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
| `skill` | Executing canonical skill allowlist: `azure-functions-deploy` or `azure-functions-hosted-skills` |
| `operation` | `deploy` or `provision` |
| `result` | Constant `success`, constructed only after verification |
| `resourceTypes` | JSON-encoded array of normalized resource types; string-valued Application Insights custom property |
| `deploymentKind` | Fixed mapping: `azure-functions-deploy` -> `function-app`; `azure-functions-hosted-skills` -> `hosted-agent` |
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
input or ARM responses into it. No subscription/tenant/resource/deployment
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
asset location, not arbitrary ancestor scanning. The collector checks preference
before any ARM query or send. If its location or contents cannot be safely
resolved, skip collection rather than bypass an opt-out.

The collector returns a local categorical result: `sent`, `disabled`,
`not-configured`, `skipped`, or `failed`, with a fixed reason code when relevant.
Neither result nor diagnostics includes input values or raw exception text.
Do not introduce another diagnostics subsystem; use PR #235's bounded diagnostics
if available, otherwise a short local categorical notice.

The existing sender owns delivery timeout and any bounded transport retry.
There is no contribution-specific retry or persistent queue. A telemetry
failure cannot reclassify the deployment, prompt a cloud login, elevate Azure
permissions, or trigger reprovisioning. If ARM read access is absent, skip.

### 4.7 Module ownership and reporting

| Surface | Planned responsibility |
| --- | --- |
| `src/telemetry/contribution.ts` (new) | Stdin input validation, deployment selection policy, normalized event construction |
| `src/telemetry/arm-deployments.ts` (new) | Injectable bounded structured ARM query/traversal |
| Existing sender and `src/telemetry/index.ts` | Reuse transport and privacy-safe client; keep raw ARM responses out of the package's telemetry-event API |
| `bin/azure-functions-skills.js` | Small internal subcommand dispatcher; no deployment orchestration |
| Two canonical skill instructions | One post-success collection step each, not generic PostToolUse detection |

Report event count over time and by skill/deploymentKind. Expand resourceTypes
only for the breakdown; expanding the array must not inflate the headline count.
A type's count means "observations containing this type," not resource count.
Document disabled/unsupported paths and delivery loss. Existing usage counts
can be displayed alongside contributions, but do not compute an exact funnel
or attempt denominator from success-only events.

### Delivery checkpoints

| Slice | Requirements / planned work | Review boundary |
| --- | --- | --- |
| M0: Design approval | Reconcile governance, number allocation, related PRs, and open questions; resolve independent review findings | Obtain human approval of the identified revision; no implementation before Finalized |
| M1: Event and privacy contract | AC-001, AC-006, AC-007, AC-009; tests first, narrow sender/schema changes | Inspect an entirely local captured envelope and confirm compatibility/privacy scope |
| M2: Collector | AC-003 through AC-005, AC-008, AC-010; fixtures first, selection/ARM adapter/CLI | Review counting, bounds, skip behavior, and lack of durable tracking |
| M3: Skill wiring and documentation | AC-002, AC-007, AC-009 through AC-011; post-success step, delegation ownership, local install/plugin assets | Review both skill paths, limitations, and requirement-linked acceptance evidence |

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
  shared-infrastructure FRD under the merged governance policy. It does not redefine
  either skill's purpose or general deployment contract; if lifecycle FRDs are
  required for the tool-chain addition, link those before implementing M3.
- Maintainer: approve the draft's single-layer azd boundary and skip-on-incomplete
  resource breakdown. These are proposed implementation details, not an already
  approved contract.
- Implementer/reviewer at M0: #218 and #244 have merged and revision 4 reflects
  them; recheck #235 and #240 before publication and re-verify the outbound
  envelope against whichever Application Insights SDK version is then in the tree.

## 5. Decisions log

| ID | Decision / options | Choice and rationale | Decided by | Date |
| --- | --- | --- | --- | --- |
| D-001 | Overview versus exact accounting | User accepted a small Phase 1 focused on contribution trends; defer strict deduplication and broad coverage. This is direction approval, not FRD sign-off. | User, conversation scope agreement | 2026-09-08 |
| D-002 | Existing transport versus new service | Reuse Application Insights sender; no SDK migration, backend, or new credential. | Copilot (proposal) | 2026-09-08 |
| D-003 | Generic hook inference, persistent azd hooks, wrapper engine, or explicit collection | Explicit post-success collector call; preserve deployment ownership and avoid command/log parsing. | Copilot (proposal) | 2026-09-08 |
| D-004 | Global workload identity versus per-command observation | No durable ID; one successful supported invocation is one observation. Failed attempts emit nothing; exact-once remains out of scope. | Copilot (proposal) | 2026-09-08 |
| D-005 | Provision success alone versus full azd up result | Require full up success for up, provision success for standalone provision; always verify current ARM evidence. | Copilot (proposal) | 2026-09-08 |
| D-006 | Top-level-only versus nested resource types | Keep bounded nested traversal because Bicep modules are normal, not an optional precision enhancement. | Copilot (proposal) | 2026-09-08 |
| D-007 | Properties-only filtering versus full envelope privacy | Full outbound-envelope filtering is mandatory even in the small PR. | Copilot (proposal) | 2026-09-08 |
| D-008 | Reuse 0001/0002 versus next unused number | Use FRD-0003 after checking open PR filenames; leave the existing 0001 collision to its owners. | Copilot (allocation proposal) | 2026-09-08 |
| D-009 | Architecture review: compatibility and delegated feasibility | Clarify that hostname removal intentionally affects SDK envelopes, not usage application properties; make delegated capture an M0 gate with human-approved scope reduction if needed. | Copilot (revision 2 proposal, responding to independent review) | 2026-09-08 |
| D-010 | Exact per-attempt capture (`AZD_DEPLOYMENT_ID_FILE` recipe) versus post-success ARM deployment selection | Choose post-success selection. The recipe required owning the azd process, which the delegating deploy skill cannot do, so it would have covered only one skill while adding a wrapper, temporary files, and exit-code plumbing. Selection covers both skills with a one-line call and accepts bounded misattribution of the resource-type breakdown, consistent with the "observed", non-exact reporting label. Exact capture is deferred to Phase 2. | User (scope decision), Copilot (revision 3 proposal) | 2026-09-09 |
| D-011 | Rebase onto merged `main` versus keep the pre-merge naming | Rebase and adopt the merged state. PR #244's governance index replaces the provisional index, and PR #218's rename makes `azure-functions-hosted-skills` the only canonical name. Keeping both names or a forked index would create ambiguity in the allowlist and `deploymentKind` mapping. | Copilot (revision 4 maintenance) | 2026-09-10 |

## 6. Test plan

All entries are planned, not completed acceptance evidence. Use existing Vitest,
CLI fixture, local HTTP capture, and isolated install/update infrastructure.

| Requirement | Test / fixture / experiment | Expected evidence |
| --- | --- | --- |
| AC-001 | Extend `tests/telemetry.test.ts` and `tests/simplified-cli.test.ts` | New event exact shape; unchanged legacy stdin/event behavior |
| AC-002, AC-011 | Skill contract fixtures and isolated CLI invocation with a fake ARM query adapter | Only supported explicit entry points collect; external delegation has one owner; no customer `azure.yaml` modifications |
| AC-003 | New contribution fixtures: no recent successful deployment, ARM Running/Failed, stale timestamp outside the window, preview, validation-only | Zero contribution sends and no fallback to unrelated deployment history |
| AC-004 | Failed attempt then successful attempt; nested modules; deliberate double collector call | 0 then 1 for normal retry; one event for nested modules; duplicate-call limitation documented, not falsely claimed solved |
| AC-005 | New ARM fixtures: subscription root, RG root, nested modules/pages, Create/Read/Delete, malformed type, repeated type, unsupported child, empty type set | Complete normalized type set or explicit skip, never wrapper-type counting or partial silent success |
| AC-005, AC-008 | Deadline/request/depth/type caps, cycle, denied read, invalid pagination origin | Bounded termination, no arbitrary URL request, no raw diagnostic data |
| AC-006 | Local HTTP server captures/decompresses the entire serialized SDK request; seed input with sentinel names/secrets | No forbidden sentinel, hostname, environment-derived tag, source, endpoint, or correlation identity anywhere in the envelope |
| AC-006, AC-009 | Invalid skill/client/version, unknown fields, oversized input/type set | Reject or normalize per contract; no free-text outbound dimensions |
| AC-007 | Both environment opt-outs; each host's local and plugin config; missing/malformed preference context | No additional ARM read or send when disabled/unresolved; original deployment still runs |
| AC-008 | Missing Azure CLI, denied or failing ARM query, send failure, malformed stdin | No cloud retry caused by telemetry; the deployment result the agent already observed is never reclassified |
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

This documentation change adds this FRD and one index row to the merged
governance index. Do not otherwise modify the governance files.

Implementation would update:

- `README.md`, Telemetry: new categorical event, opt-out, local transient ARM
  identifiers, contribution scope, IP/service metadata caveat, and best-effort limits.
- `docs/internal/telemetry-release.md`: actual event/property contract and
  simple reporting examples; preserve the existing release destination model.
- `docs/cli-reference.md`: clarify internal telemetry behavior and privacy
  without advertising the collector as a supported deployment command.
- `templates/skills/azure-functions-deploy/SKILL.md`: a single post-success
  collection owner after the delegated deployment completes.
- `templates/skills/azure-functions-hosted-skills/SKILL.md` and its
  `references/infra-and-deployment.md`: the same post-success collection step and
  explicit exclusions for connector follow-up work.
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
| Governance integration | Follows merged FRD governance (`a430a5b`); index row added in `docs/frds/README.md` |
| Number allocation | FRD-0003 unused among remote main and all open PRs checked on 2026-09-08; rechecked against the merged governance index on 2026-09-10 |
| Implementation reference | Not started; explicitly excluded from this task |
| Acceptance evidence | Not collected; section 6 contains planned evidence only |
| Live execution authorization | Not requested or granted |

### Independent review disposition

The reviewer found the direct capture/collector split appropriately small and
recommended human design review after two clarifications. Revision 2 addresses:

| Finding | Resolution |
| --- | --- |
| AC-001 could be read to prohibit shared hostname suppression | AC-001 and section 4.5 explicitly distinguish preserved application properties from intentionally removed SDK hostname context. |
| Delegated capture was only a general open question | Superseded in revision 3: D-010 replaces per-attempt capture with post-success ARM deployment selection, so the delegated path needs no process ownership and the M0 capture gate is removed. |

Revision 3 records the user's scope decision to prefer breadth and simplicity
over exact per-attempt attribution. It changes sections 4.1 through 4.4, AC-003,
AC-010, D-003, the M0 boundary, the open questions, the test plan, and the docs
impact list. It has not been re-reviewed independently.

Revision 4 rebases the document onto merged `main`: it adopts the merged FRD
governance index instead of a provisional one and replaces every
`azure-functions-agents` reference with `azure-functions-hosted-skills` (D-011).
It has not been re-reviewed independently.

This records independent advice and the author's disposition, not reviewer or
human approval of revision 2. M0 questions and human sign-off remain pending.

Status remains Draft. Resolve open questions and review findings, identify the
reviewed revision, obtain explicit human sign-off, and update this document and
the index to Finalized before implementing. This proposal does not authorize
live resources, production telemetry sends, or paid evaluations.
