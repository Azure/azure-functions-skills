# Azure Functions Update Domain-Expert Workflow Specification v0

**Status:** Historical Revision 3; superseded for skill behavior on 2026-09-18.

The current [skill](../../../../templates/skills/azure-functions-update/SKILL.md)
has a language-neutral eleven-step model/config workflow and a
[dotnet-isolated scenario](../../../../templates/skills/azure-functions-update/references/dotnet-isolated.md).
Language/TFM updates are now separate handoffs, not combined conversion checkpoints.
The scenario's stable completion IDs govern current reviews and evaluations.
The older sequence and four-file design below remain research history pending a document rewrite.

**Version:** 0

**Revision:** 3, after the explicit-use and maintenance review on 2026-09-17

**Research cutoff:** 2026-09-17

**Initial implementation focus:** .NET migration, with shared rules for other languages

## 1. Document purpose

This document defines a proposed workflow for an `azure-functions-update` domain expert.
The workflow prepares and controls Azure Functions updates. It does not define the final
skill text or a CLI implementation.

This document separates three types of statements:

- **Confirmed:** A current primary source or repository behavior supports the statement.
- **Proposed:** The workflow should use this rule. Joint review can change it.
- **Open:** The available evidence does not set the product decision.

Statements marked as joint decisions record user choices. Revisions 1 through 3 add the
rules needed to connect those decisions. They do not grant permission for a migration run.

The workflow must record the source URL, source date, access date, applicable version,
and confidence for each material support or compatibility decision. A source link by
itself is not sufficient evidence.

**Joint decision on 2026-09-17:** Evidence freshness uses decision events, not one fixed
time-to-live value. The planner must recheck applicable primary sources:

- when it creates or materially revises the migration plan;
- immediately before the first execution packet that depends on the support decision;
- when work resumes after a stop;
- when the target host, model, TFM, OS, SKU, SDK, worker, or extension version changes;
- when tool output, resolved versions, or source evidence conflicts with the plan.

Cached evidence can support offline assessment when its source date, access date, target
version, and limitations are visible. Stale cached evidence cannot authorize a new
migration execution. If the primary source is unavailable, the plan marks the decision
as unconfirmed and stops the dependent packet unless the user accepts a specific exception.

## 2. Goals

The workflow has these goals:

1. Create a migration plan before code changes start.
2. Use strong domain reasoning during planning, independent of agent count.
3. Make the execution plan self-contained enough for a weaker model without external
   document lookup, whether the planner or an optional subagent executes it.
4. Select a migration path from the current app facts and current support data.
5. Keep each accepted checkpoint in a buildable and testable state.
6. State what each validation method proves and does not prove.
7. Ask for permission before an action changes tools, infrastructure, data, credentials,
   network access, or customer code outside the accepted plan.
8. Preserve evidence so that work can stop and resume without unsupported assumptions.
9. Separate required migration changes from optional improvements.
10. Hand off Azure resource, deployment, SKU, and broad platform work to Azure Skills.

## 3. Non-goals

Version 0 does not:

- implement a skill, CLI command, migration tool, or customer migration;
- define Python and Node.js migrations at the same depth as .NET;
- guarantee that a local test proves Azure service integration;
- install tools or emulators without approval;
- create, change, or deploy Azure resources without approval;
- change a hosting plan as an implied part of a code migration;
- make an unsupported baseline look successful;
- replace customer acceptance for behavior that cannot be reproduced safely;
- define a paid evaluation budget;
- make model-specific prompt instructions permanent without continued measurement.

## 4. Initial scope

### 4.1 .NET-first scope

Version 0 gives detailed rules for these .NET states:

- Azure Functions runtime 4.x with the .NET in-process model;
- migration to the .NET isolated worker model;
- selection of .NET SDK, runtime, target framework moniker (TFM), worker packages,
  build SDK, and binding extension packages;
- .NET Framework dependencies that require an isolated .NET Framework target;
- Linux Consumption restrictions that can require a separate hosting-plan decision.

### 4.2 Shared language scope

All languages use the same workflow for:

- preflight checks;
- workspace and deployed-resource inventory;
- declared and resolved version evidence;
- plan ownership and task packets;
- permission boundaries;
- validation levels;
- emulator and cloud-test capability;
- failure, resume, and evidence rules;
- large data sets;
- acceptance and handoff.

Python and Node.js add language-specific migration routes in later revisions.

### 4.3 Explicit selection

**Joint decision on 2026-09-17:** Start or resume this workflow only when the user
names `azure-functions-update` and asks to use or resume it. A generic migration,
runtime update, diagnosis, deployment, or SKU request does not select this workflow.
A name in a question, quotation, file, or review is not a request to run it.
Normal replies within an active, user-selected run do not need the name again.
A saved plan alone does not authorize a new run.

Help can recommend the skill with an explicit-use example, but must not start it
automatically. Azure Skills keeps platform ownership. An approved handoff returns
evidence to the existing update plan, not a second code-migration workflow.
Instruction-level selection does not establish a client-enforced priority across plugins.
Client-specific manual invocation remains a validation item; do not claim guaranteed
activation from description text alone.

## 5. Responsibilities

**Joint clarification on 2026-09-17:** Planning quality is the requirement; subagent
execution is not. The same agent can perform planning, execution, and acceptance for
any migration size. A weaker subagent is a possible consumer of the plan, not a required
workflow component. "Planner" and "executor" below are roles, not required processes.

| Actor | Required responsibility | Must not do |
| --- | --- | --- |
| Planner / domain expert | After the data-processing gate, read permitted code and configuration, collect evidence, select a supported route, write task packets, evaluate results, investigate surprises, and update the plan | Read unapproved content through a remote model or leave required domain decisions unresolved in an execution plan |
| Executor, possibly the same agent | Perform only the accepted packet, read the named files and required local context, run the listed checks, and record evidence | Expand scope, select a new target version, weaken security, or hide a failure |
| Customer or user | Confirm business behavior, risk limits, environment access, data rules, and actions that need permission | Supply production secrets in a report or committed file |
| Runner or harness | Enforce file, command, network, time, cost, and credential limits; isolate trials; capture exit status and artifacts | Treat skill text as a way to bypass host permissions |
| Azure Functions Skills | Own Functions runtime, worker model, trigger, binding, extension, local host, and Functions-specific migration guidance | Own generic Azure provisioning or deployment execution |
| Azure Skills | Own Azure resource changes, deployment, SKU changes, RBAC, network, quota, and broad platform workflows | Change customer Azure resources without explicit approval |

**Confirmed:** The repository boundary document assigns Functions programming-model,
runtime, worker, and extension migration to Azure Functions Skills. It assigns Azure
resource provisioning, deployment execution, SKU changes, and broad platform work to
Azure Skills.

## 6. Planning and execution roles

### 6.1 Root skill and plan separation

**Revision 3 design:** `SKILL.md` is the complete ordered workflow, not a short router.
A maintainer must see the initial plan, inventory, route agreement, baseline,
stage conversion, local/E2E checks, Azure handoff, and final review in one file.
The same file contains the stop/research/replan loop and permission boundaries.

Keep four references: `plan.md` for forms and result rules, `dotnet.md` for migration
decisions and API contracts, `validation.md` for probes/environments/data, and
`azure-handoff.md` for platform work. Do not hide normal stage order or stop conditions
behind a chain of links. Do not put every service detail in the main workflow.

The planner creates an initial plan from known facts and questions, then updates it
after approved workspace inspection and research. Execution instructions need resolved
decisions before work starts. The plan is not a copy of `SKILL.md`.

This design follows the model guidance for progressive disclosure. It also prevents
large reference text from entering every execution task. The task packet must contain
the facts needed for its task. It must not give only links and require the execution
role to repeat planning research. This rule also applies when one agent performs both
roles. Source links support provenance; normal execution must not depend on opening
external documentation. Include only the relevant conclusions, contracts, and excerpts.

### 6.2 Task packet contract

Each task packet must contain:

1. **Packet ID and plan revision.**
2. **Objective.**
3. **Entry state and required completed checkpoints.**
4. **Known facts**, including current and target host, OS, SKU, language, execution
   model, TFM, SDK, build SDK, worker, extensions, and resolved package versions.
5. **Evidence summary**, with the applicable source extracts or concise rules.
6. **Allowed files and directories.**
7. **Files that must not change.**
8. **Behavior contracts that must not change.**
9. **Exact work scope.**
10. **Allowed command classes and network rules.**
11. **Commands or checks that are expected for this packet.**
12. **Expected results and acceptance conditions.**
13. **Required artifacts**, including diffs, command results, logs, and findings.
14. **Known limitations and blocked validations.**
15. **Stop and escalation conditions.**
16. **Cleanup requirements.**

The packet must tell the executor to read the named source files. "Self-contained"
does not mean "work without reading the code."

Each packet also names its checkpoint, input artifact revision, expected temporary
failures, time limit, and output artifact revision. A packet is a work assignment.
A checkpoint is an acceptance boundary for a coherent set of changes. They are not
necessarily the same unit.
For assessment and resolution packets, unknown values remain explicit. Record a
candidate constraint rather than inventing a resolved version.

For an in-process conversion, project references, startup, function signatures, binding
types, and required configuration form one coherent conversion checkpoint. The planner
can assign these changes to separate packets with explicit dependencies. It must not
require a successful intermediate build after only the project references change.
The planner controls shared-file writes and does not start a dependent checkpoint until
the complete conversion passes its gate.

### 6.2.1 Requirement-to-proof record

**Revision 2 proposal:** Keep a compact record of actual obligations in the accepted
plan. Each row has an ID, authority and date, observed applicability, expected result,
affected files and consumers, packet/checkpoint, proof method, current artifact, and
disposition. Classes are user contracts, supported-target requirements, and best-practice
recommendations. Do not create a row for every sentence in a guide.

The planner checks each affected required row before execution: facts, selected change,
and proof must be defined. Missing domain decisions stay in planning. At acceptance,
compare actual changes and outputs with the rows. A source fetch or mention does not
prove implementation. Explain material changes without a row. Required rows cannot
close as "not selected"; inapplicability needs evidence. Recommendations can be deferred
with owner and reason without claiming full best-practice conformity.

This is an explicit review method, not a new automatic validator. Its effect on missed
requirements remains to be measured.

### 6.3 Stop and escalation conditions

The executor must stop the packet and return to planning when:

- a declared or resolved version differs from the plan;
- a new function, trigger, binding, shared project, or deployment target appears;
- a command needs a feed, proxy, certificate, path, or tool that the packet does not allow;
- a build or test failure has a cause outside the packet;
- the proposed fix changes a public contract or business behavior;
- the proposed fix needs a broad refactor;
- a test can reach production or customer data;
- an Azure resource or permission change is required;
- evidence conflicts with the target release or service behavior;
- a cleanup step cannot complete.

With one agent, returning to planning means stopping execution, researching the new
fact, and updating the plan. It does not require another agent or new external role.

## 7. Workflow state model

**Joint decision on 2026-09-17:** Resolve the app during the migration conversation.
Use a clearly selected workspace or customer repository from the request. If the target
is unclear, ask which app to migrate before content inspection. Apply the data-processing
gate, then record the observed revision and working-tree state. A non-Git target needs
an agreed baseline snapshot. Do not require a customer repository during skill design.

Ask which behaviors must remain unchanged. Use code and existing tests to propose
concrete examples for user confirmation; the customer need not know all technical
details in advance. Unknown or conflicting important behavior blocks dependent changes,
not all independent assessment.

After research, present the supported destination tuple, assumptions, stage order,
support window, and expected effects. Confirm the destination with the user before
candidate restore, then confirm actual resolved versions before conversion. Ask again
only for a material target, scope, or permission change.

```text
INTAKE
  -> DATA_PROCESSING_GATE
  -> ASSESSMENT_APPROVAL
  -> PREFLIGHT
  -> INVENTORY
  -> BASELINE_APPROVAL
  -> BASELINE
  -> PROVISIONAL_ROUTE
  -> RESOLUTION_APPROVAL
  -> TARGET_RESOLUTION
  -> PLAN_APPROVAL
  -> CHECKPOINT_EXECUTION
  -> CHECKPOINT_VALIDATION
  -> ACCEPTANCE
  -> DELIVERY_HANDOFF
  -> COMPLETE
```

This is the main path, not a single-pass sequence. These rules define its branches:

| Transition | Required condition |
| --- | --- |
| `INTAKE` to `DATA_PROCESSING_GATE` | Identify the target and the runner processing boundary without reading customer file contents through the model |
| `DATA_PROCESSING_GATE` to `ASSESSMENT_APPROVAL` | Approve a permitted local collector or explicit content processing under section 10.3 |
| `ASSESSMENT_APPROVAL` to `PREFLIGHT` | Approve the initial read scope, metadata limits, version commands, outputs, and side effects |
| `INVENTORY` to `BASELINE_APPROVAL` | Define baseline commands, expected behavior, endpoints, data, and applicable permissions |
| `BASELINE_APPROVAL` to `BASELINE` | Accept the baseline packet before restore, build, tests, or host startup |
| `BASELINE` to `PROVISIONAL_ROUTE` | Record successful evidence or the conditional baseline allowed by Route E |
| `PROVISIONAL_ROUTE` to `TARGET_RESOLUTION` | Confirm the proposed destination with the user; obtain `RESOLUTION_APPROVAL` for candidate versions, restore scope, feeds, paths, and temporary project changes |
| `TARGET_RESOLUTION` to `PLAN_APPROVAL` | Confirm the candidate with actual SDK and dependency resolution; keep the route provisional if restore is blocked |
| `PLAN_APPROVAL` to `CHECKPOINT_EXECUTION` | Approve the supported route, checkpoint gates, packets, and permissions |
| `CHECKPOINT_VALIDATION` to the next checkpoint | Accept the current checkpoint and its applicable evidence |
| `CHECKPOINT_VALIDATION` to `INVESTIGATING` | A required gate fails or an unexpected result needs a planning decision |
| Validation or `ACCEPTANCE` to `AZURE_VALIDATION_HANDOFF` | A required service-backed check needs the separately approved handoff in section 19.1 |
| `AZURE_VALIDATION_HANDOFF` to validation or `ACCEPTANCE` | Receive and evaluate Azure Skills results, including cleanup; missing approval remains blocked |
| `ACCEPTANCE` to `DELIVERY_HANDOFF` | All required conditions for the accepted scope have valid evidence |
| `DELIVERY_HANDOFF` to `COMPLETE` | Deliver the agreed artifacts and close required cleanup and ownership actions |

The target-resolution packet is an approved investigation, not approval to migrate or
deploy the app. It may use an approved isolated copy with candidate project changes.
If resolution changes the candidate, return to `PROVISIONAL_ROUTE`. If it changes the
permission scope, obtain new approval. An unchanged accepted candidate does not need
another restore solely to repeat the same evidence.

Repeat execution and validation for each checkpoint. A final incomplete report can be
delivered from a blocked state without entering `COMPLETE`. Cloud access is not required
for the local branches.
For each new intermediate target, repeat the provisional route and resolution steps
before its execution. Existing approval can cover these steps when the accepted plan
already names the candidate and all effective actions.

For a small update, one compact artifact can hold the plan, requirement rows, grants,
and packet. Single-agent execution is valid for any migration. State transitions do not require
separate files or repeated user prompts. Preserve gates and final E2E rather than
measuring process quality by document or agent count.

Any active state can move to:

- `NEEDS_DECISION`: The user must select a material design or scope option.
- `NEEDS_PERMISSION`: The next action exceeds the current permission envelope.
- `BLOCKED_ENVIRONMENT`: A tool, feed, proxy, certificate, path, or runner limit blocks work.
- `BLOCKED_PRODUCT`: The app cannot meet a required support or compatibility condition.
- `INVESTIGATING`: The planner is checking an unexpected result.
- `RESUMABLE_STOP`: Evidence is complete enough for a later resume.
- `FAILED_CLEANUP`: A created test resource or artifact could not be removed.

The plan stores a monotonically increasing revision. Each packet refers to one revision.
A packet from an older revision cannot continue after a material route change.
Preserve its evidence as history, then determine whether it still applies under section 20.

## 8. Plan update and surprise handling

When a surprise occurs, the planner must:

1. Stop dependent packets.
2. Preserve the failing command, exit code, relevant log, current diff, and environment facts.
3. Classify the surprise as code, dependency, toolchain, service, permission, runner, or unknown.
4. Check the documentation and release or tag that applies to the target version.
5. For interface or behavior questions, inspect the applicable release or tag of
   `azure-functions-host`, WebJobs SDK, the binding extension, or the isolated worker.
6. Read compatibility branches and feature flags to their effective result. Do not use
   one fragment from `main` or `latest` to decide behavior for an older release.
7. Propose a minimal isolated prototype only when it can answer the question and the
   current permission envelope allows it.
8. Ask for permission if the prototype needs downloads, containers, Azure, credentials,
   customer data, or changes outside the accepted scope.
9. Add the result, source, limits, and confidence to the evidence record.
10. Revise the plan and invalidate affected packets.

## 9. Preflight

### 9.1 Tool and environment inventory

Run preflight only within the assessment approval. File contents, version-command
outputs, logs, and paths returned to a remote model are subject to the data-processing
gate. The existence of a tool is not permission to install, update, or use it.

The preflight records availability and version for:

- Git and repository state;
- .NET SDKs from `dotnet --list-sdks`;
- .NET runtimes from `dotnet --list-runtimes`;
- effective SDK selection and applicable `global.json`;
- Azure Functions Core Tools or Azure Functions CLI;
- Azure CLI only when an accepted step needs Azure;
- package manager and lock files;
- Docker only as an available option, not as permission to start it;
- local emulators that already exist;
- proxy variables, trusted certificate stores, and approved network paths;
- effective NuGet configuration sources and package feeds.

Record the resolved executable path and version of `func`. Core Tools v4 is GA in the
reviewed guidance. Functions CLI v5 is a separate preview product that also uses the
name `func`; it must not be selected as an implicit Core Tools update.

| Activity | Required capabilities | Not required solely for this activity |
| --- | --- | --- |
| File inventory | Permitted local file reader and format parser | .NET SDK, runtime, Core Tools, Azure CLI, Docker |
| .NET restore and build | Compatible .NET SDK, targeting packs, project SDK, approved sources or cache, and required build targets | Core Tools, Azure login, or a separate installation of every target runtime |
| Existing unit tests | Test runner and runtime required by the test project; build capabilities if the command builds | Core Tools or Azure unless the tests actually depend on them |
| Framework-dependent isolated worker execution | Compatible runtime and required shared frameworks, such as ASP.NET Core when referenced | Azure login for execution that uses only local dependencies |
| .NET Framework build and execution | Applicable reference assemblies or targeting pack, build tools, Windows runtime, and OS support for the selected target | Assumption that a modern .NET SDK alone supplies .NET Framework execution |
| Local Functions host and indexing | Compatible `func`, Functions host, worker runtime, app artifacts, and applicable startup dependencies | Azure CLI when all dependencies and credentials are local |
| Emulator integration | Selected emulator version, client and extension compatibility, dependencies, ports, storage, and launch approval | Azure credentials for a fully local emulator test |
| Azure metadata or service checks | Approved target, credential, network access, and the selected Azure tool | Azure CLI specifically when an approved alternative performs the operation |

Custom MSBuild targets, restore hooks, and tests can add requirements and side effects.
Inspect them before execution. A newer SDK can build an older TFM without providing
the older runtime needed to execute its tests. Do not change roll-forward settings
silently to hide a missing runtime.

Record required reads and writes outside the workspace, such as user NuGet configuration,
global package caches, temporary directories, and trust stores. The workspace-only
approval does not cover them. Prefer scoped workspace paths when supported; otherwise,
request a named path exception before the affected operation. Never copy credentials
into a scoped configuration file merely to avoid that approval.

### 9.2 SDK, runtime, and TFM

**Confirmed:** The .NET CLI can use a newer installed SDK to build an earlier TFM.
The SDK selected for a command, the TFM that defines build-time APIs, and the runtime
that executes an app are separate values.

The workflow must not report "updated to .NET X" when it only changed or observed the
SDK that built an older TFM.

### 9.3 Feeds, TLS, and corporate configuration

NuGet combines computer, user, directory, and solution configuration unless the command
selects one configuration file. The planner must record the effective configuration path
and the approved source set before it changes restore behavior.

The workflow must:

- preserve customer proxy, mirror, feed, and certificate policy;
- never disable TLS validation to make a restore succeed;
- never replace a corporate feed with a public feed without approval;
- prefer a scoped and temporary diagnostic over a permanent global change;
- record whether a failure is DNS, TLS trust, proxy, authentication, source mapping,
  package absence, timeout, or runner denial;
- avoid unrelated package installs, such as a documentation linter, in a migration packet.

## 10. Inventory

After the data-processing and assessment gates, the planner reads only the approved
content from the workspace or repository selected by the user.
The inventory must cover:

- all Functions project roots and `host.json` files;
- solution files, project files, project references, and shared modules;
- language and language version;
- Functions host version and extension version;
- .NET SDK selection, runtime, TFM, execution model, build SDK, worker, and analyzers;
- each trigger and binding;
- .NET binding extension packages;
- extension bundle declarations for non-.NET apps;
- declared versions and resolved versions as separate fields;
- startup, dependency injection, middleware, serialization, logging, and configuration;
- `local.settings.json` shape without recording secret values;
- deployment scripts, IaC, CI workflows, app settings names, OS, architecture, and SKU clues;
- related Azure resources and external service dependencies;
- downstream users of shared libraries and contracts;
- test projects, fixtures, snapshots, and current test commands;
- repository size, data size, generated content, and areas that need sampling.

### 10.1 Deployed app information

The future workflow asks whether a deployed Function App exists.

- If it exists, the workflow asks for the app identity and permission to read its current
  OS, SKU, runtime stack, worker setting, app-setting names, extension version, networking,
  identity, and related resources.
- If it does not exist, the local migration continues from code and configuration.
- If the user does not provide cloud access, the workflow marks cloud facts unknown.
  This condition does not block all local migration work.

Secret values are not part of the normal inventory.

### 10.2 Reuse from current doctor code

**Joint decision on 2026-09-17:** A future implementation should extract a shared,
read-only inventory API. Doctor and update use this API. The API collects and normalizes
facts. It does not select a migration route, change files, run a migration packet, or
access Azure.

Initial reuse candidates are:

- `src/doctor/context.ts` for a small base of project and function discovery;
- the pure parsing parts of `src/doctor/stacks.ts` for supplied stack metadata;
- `src/doctor/types.ts` for the pattern of structured findings;
- doctor severity, status, report, and exit-code patterns;
- doctor checks for `host.json`, language, extension bundles, settings names, and function discovery;
- the doctor trust boundary for deep agent work.

**Required gaps before reuse:**

- current doctor discovery has limited .NET project and function inventory;
- it does not model declared and resolved package versions;
- its stack parser can merge distinct .NET execution-model or OS entries;
- fallback version lists are not enough for a migration decision;
- doctor pass/fail does not represent migration checkpoints or validation capability;
- `doctor --deep` has broad execution permissions and is not a default migration inventory step.

Separate reuse into these components:

| Component | Boundary |
| --- | --- |
| Local collector | Read only approved workspace files; return facts, provenance, redaction, and partial-result status |
| Pure parser | Normalize supplied project, package, or stack data; no process, network, or file-write side effects |
| Approved external collector | Read named Azure resources under a separate permission; pass redacted results to the parser |
| Evidence storage | Write only to approved artifact locations; never hide cache writes inside the read-only API |
| Doctor adapter | Map applicable facts to diagnostic findings without changing update acceptance semantics |

Do not call the current `resolveStacks` or doctor runner as a read-only inventory shortcut.
They can invoke Azure CLI and write cache or report files. Cached data must retain its
origin and retrieval date. A fallback version list is not confirmed current support.

Also reuse the routing and output contracts of these existing skills where applicable:

- `templates/skills/azure-functions-inventory/SKILL.md` for deployed specifications;
- `templates/skills/azure-functions-diagnostics/references/workflow.md` for focused
  investigation and source research;
- `templates/skills/azure-functions-setup/SKILL.md` for applicable prerequisite guidance.

Do not run their scripts or installation paths implicitly. At the reviewed repository
revision, the PowerShell inventory script changes the CLI account and configuration,
installs or updates Resource Graph, and retrieves app-setting values before redaction.
Those actions exceed a metadata-only permission. A future adapter must separate those
actions or use an approved collection path. Apply current support sources rather than
copying version constants from a skill.

Doctor keeps its diagnostic checks, severity, and report semantics. Update owns the
migration plan, state machine, task packets, permissions, validation levels, and evidence
history. The workflow can consume doctor findings through a versioned adapter. It must
not treat doctor as the complete migration planner.

The shared API needs a versioned schema, secret-redaction contract, partial-result status,
source timestamps, and declared-versus-resolved version fields. Until that contract
exists, a prototype can consume current doctor output as advisory evidence. It must not
duplicate doctor logic as a permanent design.
Here, "current doctor output" means an existing report supplied through the approved
data boundary. It does not authorize a new doctor run.

### 10.3 Workspace data boundary

**Joint decision on 2026-09-17:** The default inventory process stays in the customer
environment. A local deterministic tool can read the accepted workspace and produce a
redacted inventory. The workflow must not assume that an agent model runs locally.

The gate applies before the first content read through an agent tool. Reading a local
file with `view`, search, or shell is outbound processing if the result enters a remote
model. Post-read redaction in the model is too late.

The runner must first disclose its processing boundary without customer file contents.
Then use one of these paths:

- an available, approved local collector presents its selected output to the customer
  locally; only the approved output is sent to the model;
- the customer supplies an approved redacted summary;
- the customer explicitly approves source processing for the named model and file scope.

The future shared inventory API is not assumed to exist. If none of these paths is
available, stop at `NEEDS_PERMISSION` or `BLOCKED_ENVIRONMENT`. Do not install a collector,
send source, or invent inventory facts to bypass the gate. Each child agent and each
new output type must remain within the same approval or receive a separate approval.

Before content leaves the customer environment for model or service processing, the
workflow must show and get approval for:

- the exact processor or destination;
- the purpose;
- the selected files, fields, or redacted summary;
- the data classification;
- the retention and logging behavior that the runner can state;
- the duration and revocation point.

The default outbound content is the minimum redacted summary needed for the named
decision. It excludes source text, secrets, connection values, customer data, tokens,
certificates, private endpoints, tenant details, and unnecessary resource names.

If the task needs source text or a larger inventory outside the customer environment,
that content needs a new explicit approval. If the product cannot state the processing
boundary or enforce the approved selection, it must stop before transmission.

## 11. .NET migration route selection

### 11.1 Current confirmed support facts

At the research cutoff:

- Azure Functions runtime 4.x supports .NET 8 in-process.
- Support for the in-process model ends on 2026-11-10.
- Runtime 4.x isolated supports .NET 10, .NET 9, .NET 8, and .NET Framework 4.8.1.
- .NET 8 and .NET 9 support end on 2026-11-10.
- The current Microsoft migration guide recommends .NET 10 for apps and dependencies
  that can run on modern .NET.
- The guide recommends .NET Framework 4.8 for dependencies that require .NET Framework.
- .NET 10 does not run on Linux Consumption. A plan change, such as Flex Consumption,
  is a separate Azure platform decision.
- .NET 9 is the last .NET version added to Linux Consumption.
- In-process and isolated apps use different binding extension namespaces and packages.
- Current isolated guidance uses `Azure.Functions.Sdk` as the build SDK and keeps an
  explicit `Microsoft.Azure.Functions.Worker` reference.

These facts have short support windows and must be refreshed for every migration plan.

### 11.2 Do not use one fixed sequence

The workflow must not always use:

```text
change to newest TFM in-process
-> build and test
-> convert to isolated
-> build and test
```

That sequence is invalid when the newest TFM is not supported in-process.

The workflow first computes supported states from:

```text
Functions host version
x execution model
x TFM
x operating system
x hosting plan
x architecture
x worker and build SDK
x extension package set
```

It then selects checkpoints that keep each accepted state supported or explicitly
temporary and diagnostic.

### 11.3 Supported route patterns

#### Route A: Runtime 4.x, in-process .NET 8, modern dependencies

**Proposed target at this cutoff, subject to OS and SKU support:** Isolated .NET 10.
Select a combined conversion checkpoint or a same-TFM intermediate checkpoint from
the observed risks and the accepted plan. The target does not fix the stage order.
Do not first change the in-process app to .NET 10.

If a smaller risk split is necessary, isolated .NET 8 can be an intermediate checkpoint
only while that state remains supported and only when the plan states its short lifetime.
Then update the isolated app to .NET 10 in a separate checkpoint.

**Joint decision on 2026-09-17:** A TFM that is near its end-of-support date can be a
temporary checkpoint only when:

- it separates the execution-model change from the final TFM change;
- the same accepted plan includes the next supported TFM checkpoint;
- the intermediate state remains in support for the planned work period;
- the workflow does not deploy the intermediate state by default;
- the plan gives an expiry, rollback point, owner, and residual risk;
- the workflow cannot report the intermediate state as migration completion.

Deployment of this intermediate state needs a separate decision with current support,
SKU, duration, and rollback evidence.

#### Route B: App with verified .NET Framework-only dependencies

Assess an isolated .NET Framework target. The migration guide uses `net48`; the
supported-language table lists .NET Framework 4.8.1. Record the build TFM and the
supported execution runtime separately, and confirm Windows and hosting support.
For a runtime 1.x baseline, also apply Route C. For a runtime 4.x in-process baseline,
investigate the claim that a dependency is Framework-only before selecting this route.
Do not force the dependency to modern .NET as an implied migration change.

#### Route C: Runtime 1.x, 2.x, or 3.x

Use the applicable Microsoft host-version migration guide. The planner can combine host
and execution-model changes when the official route requires it. It must keep distinct
evidence for host, execution model, TFM, and package changes.

#### Route D: Linux Consumption target with a newer TFM

Do not change the SKU silently. Present at least:

- a code route that stays within the current plan's supported language ceiling, if one
  exists and has an acceptable support period;
- a separate handoff to Azure Skills for a hosting-plan migration;
- the residual risk and support deadline for a temporary target.

#### Route E: Baseline does not build or test

Do not label the baseline as passed. Classify failures:

- environment-only;
- known pre-existing code or test failure;
- unsupported current state;
- unavailable dependency;
- unknown.

The planner can propose a recorded "conditional baseline" only when it can separate the
pre-existing failure from migration behavior. Before conversion, the user must accept
the missing evidence, substitute behavior contract, allowed work, and residual risk.
This exception permits a migration attempt; it does not waive the target build gate.
Unknown behavior without an accepted substitute contract remains blocked. No packet
can add unrelated fixes without a plan revision.

### 11.4 Checkpoint rule

At the acceptance boundary of each checkpoint:

1. Restore must complete from approved sources.
2. Build must pass for the complete checkpoint change set.
3. Applicable existing tests and static contract checks must pass. An unchanged known
   baseline failure must retain its explicit exception and cannot count as a pass.
4. The planned host and function-registration checks must pass when required for that
   checkpoint. Unavailable checks remain blocked; they are not successful gates.
5. If a required gate fails, return to planning investigation and repair within the
   checkpoint. Do not start a dependent checkpoint.

Temporary compile failures inside an accepted conversion checkpoint are allowed only
when its packets describe them and the remaining changes that remove them. They do not
need escalation merely because an intermediate diagnostic build returns an error. Unexpected
errors or an exhausted repair limit still return to planning.

An exception must name its owner, evidence, risk, expiry or follow-up condition, and
user acceptance. A permission or environment exception can defer an unavailable host
or integration check; it cannot turn a failed target build or a known migration-induced
behavior regression into an accepted checkpoint. The final report retains deferred
required checks as acceptance blockers.

Before continuing after a deferral, revise the plan to separate the current checkpoint
gate from the deferred final acceptance condition. The user must approve the reason
that dependent work can continue without that evidence. Keep the original condition
and its blocked status visible.

### 11.4.1 Facts that select a stage

**Proposed heuristics, not measured expert outcomes:** Record the observation, selected
stage, rejected alternative, and acceptance evidence.

- A newer SDK with unchanged TFM/model is a toolchain check, not a runtime migration.
- Consider same-TFM isolation when model and framework changes affect distinct contracts
  and the intermediate tuple supports the required packages for the work period.
- Consider a combined conversion when no supported intermediate exists. Do not choose
  it only to save steps; confirm probes and recovery for the final tuple.
- Trace shared-library consumers before changing signatures or TFM. Inaccessible affected
  consumers remain a reported acceptance gap.
- Use one bounded checkpoint for a small isolated extension update when host, TFM,
  platform, and relevant contracts do not need separate stages.

Choose contract probes from observed code: JSON settings imply schema comparisons;
settlement/retry code implies controlled broker outcomes; orchestration history implies
resume checks distinct from new-instance success. Each probe needs a baseline or
user-accepted expectation and an environment that can prove the contract.
Record observed trigger/input, app path, dependencies, and business output for final E2E.
Do not infer customer expectations or erase baseline uncertainty.

The author's original rationale is still to be collected in
[the PR rationale notes](azure-functions-update-pr-rationale.md). These heuristics do
not claim to reproduce that rationale.

### 11.5 Package compatibility evidence

**Joint decision on 2026-09-17:** A package compatibility decision normally needs both:

1. current official documentation that applies to the selected host, execution model,
   TFM, OS, SKU, worker, build SDK, and binding extension version; and
2. the actual resolved dependency graph from the accepted restore, with declared and
   resolved versions kept separate.

The evidence record includes the document URL and date, access date, package identity,
declared version or range, resolved version, source name, TFM, transitive path, lock or
assets artifact, and command that produced the graph. It excludes feed credentials.

Before target restore, version selection is provisional. Record candidate versions
from the official guidance and obtain resolution approval under section 7. Do not
require a target resolved graph before authorizing the operation that produces it.
After restore, compare the actual graph with the candidate before plan approval.

For .NET, preserve separate evidence for:

- the .NET SDK selected by `global.json` and the command working directory;
- the MSBuild project SDK, including `Azure.Functions.Sdk`, its declared location,
  resolved version, and resolution source;
- the worker application dependency graph;
- the generated host-extension project dependency graph, when the build SDK uses one.

With `Azure.Functions.Sdk` 1.0.0, the reviewed guide describes an
`obj\azure_functions.g.csproj` helper project. Direct function-project restore invokes
the hook that generates and restores it. Solution or traversal restore does not invoke
that hook automatically; use the documented AZFW0108 remediation when applicable.
Do not edit or directly build the generated project. Its graph is evidence, not an
independent customer project.

Use the metadata and indexing mechanism of the selected build SDK. Do not require one
legacy output filename, such as `functions.metadata`, as universal proof of correctness.

The planner inspects the applicable release or tag source when:

- the official documentation and resolved graph conflict;
- the behavior or supported combination is unknown;
- build, metadata generation, host startup, indexing, or listener behavior fails;
- a review claim depends on an implementation branch or feature flag;
- the package version is outside the documented example or support range.

Source inspection records the repository, release or tag, commit, file and line range,
effective compatibility branch, and conclusion. The workflow must not use a fragment from
`main` or `latest` to decide target-version behavior.

## 12. Validation capability matrix

| Validation | What it can support | What it does not prove | Typical environment |
| --- | --- | --- | --- |
| Restore | Approved feeds can resolve the dependency graph | Build, runtime, or service behavior | Local or CI |
| Build | Source compiles and the selected SDK build tasks complete | Host start, actual function indexing, or trigger behavior | Local or CI |
| Existing unit tests | Preserved behavior covered by those tests | Functions host, bindings, or Azure integration | Local or CI |
| Host process starts | The local Functions host and worker can start | All listeners are ready | Local |
| Expected function list | The host indexed expected function names | Trigger delivery or handler success | Local |
| Listener-ready evidence | A selected listener connected to its configured dependency | Correct business result or all listeners | Local, emulator, or Azure |
| Direct handler test | Handler logic accepts controlled input | Binding pipeline or service delivery | Unit or component |
| Local webhook replay | Event Grid payload parsing and local trigger dispatch for the sample | Subscription validation, service authentication, retry, dead-lettering, or Azure delivery | Local |
| Emulator integration | App behavior for features that the emulator implements | Cloud-only identity, networking, scale, limits, or unimplemented features | Local container or process |
| Azure sandbox integration | Selected Azure service contract with test resources and test identity | Customer network, data, identity, load, or policy | Approved Azure sandbox |
| Customer-environment acceptance | Selected behavior in the customer environment | Unobserved cases outside the acceptance plan | Customer environment |
| Manual acceptance | Human-observed behavior and business meaning | Automated regression protection | Any approved environment |

Every result uses one of:

- `passed`;
- `failed`;
- `blocked`;
- `not applicable`;
- `not selected`;
- `inconclusive`.

A blocked important behavior cannot become `passed` because lower validation levels passed.

## 13. Event Grid boundary

### 13.1 Confirmed local capability

Microsoft Functions guidance describes local Event Grid evaluation by:

1. capturing a cloud event request;
2. running the function locally;
3. posting the event body to
   `/runtime/webhooks/eventgrid?functionName={FUNCTION_NAME}`;
4. setting the required Event Grid headers.

This method can check the local host path and handler behavior for the sample request.
An approved synthetic fixture can also support local replay without first accessing
Azure. Record its schema and provenance. A cloud-captured payload needs separate Azure
and data permissions. Generic webhook and Event Grid trigger routes must use the
validation protocol and headers that apply to their selected event schema.

### 13.2 Cloud-only or service-backed behavior

Manual replay does not prove:

- Event Grid subscription creation and endpoint validation;
- Azure Function endpoint selection and key retrieval;
- Microsoft Entra-protected generic webhook behavior;
- live event-source routing and filters;
- Event Grid delivery, rate matching, batching, retries, duplicates, dead-lettering,
  and service error classification;
- customer network and policy behavior.

The reviewed official emulator guidance covers Storage, Service Bus, Event Hubs, and
Cosmos DB. The reviewed Event Grid guidance gives capture and replay steps. It does not
identify an official Event Grid emulator. This evidence supports the proposed boundary,
but the evidence record must not claim that no third-party emulator exists.

### 13.3 Proposed Event Grid validation route

1. Test handler logic with a stable fixture.
2. Test local Functions webhook dispatch with manual replay.
3. If the acceptance criteria include Event Grid service behavior, ask for permission
   to use an Azure sandbox or an approved public callback route.
4. Use the minimum resource set and an explicit cleanup owner.
5. Report local replay and service integration as separate results.

Do not report a mock success as an Event Grid service integration success.

## 14. Emulator capability

| Service | Confirmed local option | Confirmed important limits | Workflow treatment |
| --- | --- | --- | --- |
| Azure Storage | Azurite for Blob, Queue, and Table | No Azure Files or Data Lake Storage Gen2; limited scale; behavior differences; Table support is preview | Use only for covered APIs and record Azurite version |
| Azure Service Bus | Microsoft Docker-based emulator from MCR | SQL Server dependency; no AMQP WebSockets, partitioned entities, or Entra ID integration; data does not persist across restart | Select AMQP TCP tests only where the app contract permits; record quotas and version |
| Azure Event Hubs | Microsoft Docker-based emulator from MCR | Azurite dependency; no Capture, schema registry, or Entra ID integration; Kafka producer/consumer APIs only; data does not persist across restart | Record protocol, feature set, quotas, and version |
| Azure Cosmos DB, Windows or legacy Linux emulator | Microsoft local or container emulator | Platform and API limits; no scale-out or geo-replication; key-based TLS access | Identify the exact variant before using its capability table |
| Azure Cosmos DB, Linux vNext emulator | Microsoft container emulator | NoSQL API and gateway mode only; selected features; HTTP by default; .NET and Java SDK use requires HTTPS | Select version, API, mode, HTTPS, trust configuration, and telemetry policy explicitly |
| Azure Event Grid | No emulator identified in reviewed official guidance | Local capture and replay does not reproduce service delivery | Use replay, then approved Azure integration when required |
| Azure Key Vault | No local emulator identified in reviewed official guidance | Authentication and authorization depend on Microsoft Entra and Key Vault | Use a fake only for app logic; use approved Azure for service integration |

The reviewed overview pages also state these material limits:

- Service Bus has no JMS, virtual-network integration, autoscale, geo-disaster recovery,
  or large-message support. Its documented use is sequential testing. Its administration
  client can manage entities, but JSON configuration changes require restart.
- Event Hubs supports AMQP and Kafka streaming. The producer/consumer restriction applies
  to Kafka, not to all protocols. Kafka uses SASL plaintext with the PLAIN mechanism.
  There is no on-the-fly client SDK management, virtual-network integration, autoscale,
  or geo-disaster recovery.
- Cosmos DB Linux vNext lists Change Feed as supported. This alone does not prove
  compatibility with a selected Functions trigger extension. Some endpoints return
  success without performing the operation, including custom index policy changes.
  Such responses cannot count as functional evidence for that feature.
- Cosmos DB Linux vNext enables usage telemetry by default. Before startup, approve
  the destination and selected data, or disable that telemetry through its documented
  configuration. Emulator health probes do not prove that a Functions listener is ready.

These are documentation snapshots accessed on 2026-09-17, not results from a tested
container image. Before a run, record the selected emulator version and image digest,
client SDK, binding extension, protocol, API, configuration, limits, and source date.
Do not apply one variant's limits to another variant. "Microsoft emulator" identifies
its publisher; it does not promise production parity, an SLA, or Microsoft support.

Check transport, identity, restart, and feature requirements before selecting a test.
An emulator that lacks the required feature cannot prove that feature through a passing
test. Changing the app transport solely for the emulator requires a separate scoped
test configuration and leaves the original transport unverified.

If an emulator is absent, the workflow can propose a download or Docker option. It must
ask for permission before download, license acceptance, image pull, container start,
port binding, or persistent data creation.

## 15. Authentication, TLS, CORS, and external systems

### 15.1 Identity levels

The workflow must distinguish:

- a local fake credential;
- an emulator key or connection string;
- a developer identity from Azure CLI, Azure Developer CLI, Azure PowerShell,
  Visual Studio, or Visual Studio Code;
- a local service principal;
- a deployed system-assigned or user-assigned managed identity;
- a customer production identity.

**Confirmed:** A developer account can authenticate local code through Azure Identity.
This does not prove that a deployed managed identity exists, can obtain a token, has the
required RBAC role, or can reach the target resource. A system-assigned identity is tied
to one Azure resource and only that resource can use it to request tokens.

### 15.2 Key Vault

A fake secret provider can test application logic. A developer identity can test a real
Key Vault only with approved Azure access. Full acceptance can also require Key Vault
firewall, private endpoint, tenant, token, and RBAC evidence. A developer-identity pass
is not a managed-identity pass.

### 15.3 TLS, certificates, and mTLS

The workflow must not disable certificate validation. It must classify:

- server TLS and trust-chain validation;
- custom domain certificate behavior;
- client-certificate authentication to an external service;
- inbound mTLS to the Function App;
- emulator development certificates.

Azurite can use HTTPS. Windows and legacy Cosmos DB emulator guidance describes
key-based TLS access. Cosmos DB Linux vNext starts with HTTP by default. Its .NET and
Java SDK path requires HTTPS. Select the documented protocol and certificate trust
configuration for the exact variant without disabling validation. These checks do not
prove customer certificate policy, App Service certificate behavior, or mTLS.

### 15.4 CORS

A command-line HTTP client can test HTTP status and headers. It does not enforce browser
CORS. Browser acceptance needs an approved browser test with the actual origin, method,
headers, credentials mode, and preflight behavior.

### 15.5 External platform APIs

For an external platform, the plan must record:

- approved test tenant or sandbox;
- identity and permission type;
- rate and cost limits;
- fixture and privacy rules;
- cleanup or revocation;
- behavior that only the customer environment can prove.

## 16. Testability changes

If hard-coded endpoints, credentials, clocks, or clients block validation, the planner can
propose a minimal testability change. The proposal must:

- name the blocked acceptance condition;
- show the smallest code seam that removes the block;
- preserve the default production behavior;
- avoid broad dependency-injection or architecture refactors;
- require approval before it changes customer code outside the accepted migration scope;
- never add a silent fallback to a production endpoint;
- never commit a secret-bearing `local.settings.json` or `.env` file.

## 17. E2E test placement and ownership

Migration E2E tests must be distinguishable from customer tests and product code.
The plan records:

- proposed directory;
- test owner;
- fixture owner;
- whether the test is temporary or retained;
- command and environment;
- data classification;
- emulator or Azure resource ownership;
- cleanup behavior;
- customer handoff.

Tests must use expected behavior from the original app, an accepted business contract,
or a stable external contract. A test that only copies the new implementation is not
sufficient migration evidence.

**Joint decision on 2026-09-17:** End migration with executed E2E for the agreed
business scenarios. Select the environment from the contract. Local/emulator E2E can
prove covered local behavior; it cannot replace required real-service or deployed
identity evidence. Build, startup, indexing, and unit tests alone are not final E2E.
If the required path cannot be executed, report the achieved level and blocked
acceptance rather than declaring migration success.

**Joint decision on 2026-09-17:** The default is a clearly named migration E2E area in
the customer repository, such as `tests/migration-e2e/`, when the location follows the
repository conventions. The inventory must select the exact location. The task packet
must keep these tests separate from existing customer tests and must name the customer
owner.

Repository placement and retention need customer approval because they create retained
customer artifacts. If the customer does not approve ownership and retention, the
workflow creates the tests in an isolated temporary area outside the repository. It then:

1. records the exact test content or a permitted reproducible description;
2. preserves the result and required evidence;
3. removes only the run-owned temporary tests, fixtures, credentials, and resources;
4. records the cleanup result.

The workflow must not silently merge migration E2E tests into the existing test suite.
Before creating the external temporary area, approve its exact path, commands, retention,
and cleanup. The workspace-only permission does not cover this fallback. Cleanup removes
only artifacts and resources owned by the run; it must not delete a user's credentials
or stop a shared emulator. Azure resource cleanup remains with Azure Skills.

## 18. Large apps and large data

The workflow must not assume that a Function App is small.

For a large repository, table, event stream, or object set, the plan defines:

- inventory boundaries and excluded generated content;
- representative samples and why they are representative;
- synthetic fixtures when customer data is not permitted;
- deterministic seeds and reproducible extraction rules;
- row, event, byte, file, time, and cost limits;
- privacy and retention controls;
- separate functional, full-volume, load, and performance checks;
- the residual risk from sampling.

Size alone does not make an app unsupported. The final report states what the selected
sample reproduces and what only a full or customer-environment test can prove.

**Joint decision on 2026-09-17:** The workflow does not use one fixed sampling threshold
for all customers. It first runs a lightweight inventory that avoids file content and
customer data when metadata is sufficient. The planner then proposes run-specific limits
and a reproducible selection rule for user approval.

The proposal must include:

- file, project, byte, row, event, object, and dependency counts that are available safely;
- maximum files, bytes, rows, events, elapsed time, model use, network use, and cost;
- included and excluded paths, projects, functions, triggers, bindings, and data classes;
- selection strata, deterministic seed, query, time range, or fixture generator;
- reasons that the sample represents the migration risks;
- full-volume, load, performance, and customer-environment checks that remain separate;
- expected privacy effect and retention;
- the residual risk if the user selects sampling.

The user approves the run-specific limits and selection rule. The runner can also enforce
lower safety limits. A runner safety limit cannot silently change the accepted sample.
If a limit stops collection, the result is partial and the planner updates the plan.

## 19. Best-practice review and handoff

After required migration validation, the planner runs or proposes a Functions-specific
best-practice review.

The report separates:

- **Required migration changes:** Needed for support, build, startup, registration,
  binding, or accepted behavior.
- **Optional improvements:** Security, reliability, maintainability, performance, or
  current style improvements that are not needed to complete the migration.

If the current recommended style cannot be used, the report gives the reason and owner.

Use approved existing doctor output or the future adapter in section 10.2 for applicable
local deterministic findings. A new doctor command needs approval for its effective
actions. Do not use a doctor pass as proof of cloud behavior. Hand off these items to
Azure Skills:

- SKU or hosting-plan migration;
- Azure resource creation or change;
- deployment;
- RBAC and broad identity setup;
- virtual networks and private endpoints;
- quota, region, cost, governance, and compliance work.

### 19.1 Azure sandbox contract

**Joint decision on 2026-09-17:** The update workflow does not create Azure sandbox
resources. It prepares a validation handoff for Azure Skills. The handoff must contain:

- the service behavior that local or emulator checks cannot prove;
- the minimum Azure resource types and supported versions;
- the test identity and least-privilege role requirements;
- the required OS, SKU, region, network, and policy properties;
- the fixture, data classification, expected result, and observation method;
- the time and cost limit;
- the proposed owner, expiry, resource tags, and cleanup acceptance condition;
- the rule that existing customer resources must not change unless the user selects them.

Azure Skills must get separate approval for the named subscription, resource group,
resources, identity, writes, cost limit, duration, and cleanup plan. It should create
dedicated and time-limited resources. It must not treat approval for validation as
approval to deploy the migrated customer app.

The handoff result returns resource identifiers, validation evidence, cost status, and
cleanup status to the update workflow. If cleanup fails, the update workflow reports
`FAILED_CLEANUP`, names the owner, and does not report the Azure validation as fully closed.

## 20. Completion levels

The workflow reports the highest completed level for the current artifact and accepted
scope, plus every blocked required condition.

| Level | Name | Required evidence |
| --- | --- | --- |
| 0 | Assessed | Inventory, current support evidence, route, permissions, and risks |
| 1 | Builds | Approved restore and build pass at the accepted checkpoint |
| 2 | Local host indexed | Level 1, host starts, and expected functions are indexed |
| 3 | Local behavior checked | Level 2 and selected unit, component, replay, or emulator checks pass |
| 4 | Azure integration checked | Selected approved Azure service contracts pass in a sandbox |
| 5 | Customer accepted | Required customer-environment and manual acceptance conditions pass |

Level 2 does not mean that all listeners are ready. Level 3 does not mean that a cloud
service delivered an event. Level 4 does not mean that customer networking, identity,
data, scale, or policy passed unless those items were in the test.

The final status is not "complete" when a required important behavior is blocked. It is
"Level N achieved; acceptance conditions X and Y remain." The report also shows any
lower levels without evidence.

**Joint decision on 2026-09-17:** The result has two separate fields:

- `achievedLevel`: The highest level with complete evidence.
- `overallStatus`: `complete`, `in_progress`, `acceptance_blocked`, `failed`, or
  `failed_cleanup`.

For example, a migration with a successful build, local host start, and expected function
indexing can report:

```text
Level 2 achieved / Acceptance blocked
```

The report then lists each blocked required condition, reason, owner, permission or
environment needed, and acceptance method. A blocked condition does not remove valid
lower-level evidence. It also cannot appear only in report detail or become a successful
completion status.

### 20.1 Evidence validity and current results

Each result identifies its checkpoint, function or project scope, artifact revision,
configuration, resolved SDK and dependency versions, environment, fixture, and test
definition. Include uncommitted changes in the artifact identity; a Git commit alone
does not identify a dirty working tree.

Use reproducible fingerprints for the permitted source, configuration, dependency,
fixture, and test inputs. Record the tested build output, OS and architecture, tool and
runtime versions, emulator version or image digest, and relevant service configuration.
Store secret references or approved version identifiers, not secret values or hashes.
Retain logs and fingerprints only within the agreed data and artifact boundaries.

Before reusing evidence, compare those inputs with the current candidate. A changed
input invalidates dependent results unless the planner records why the change cannot
affect that check. TFM, execution-model, worker, or build-SDK changes require new build,
host, and applicable behavior evidence. Preserve invalidated results as history, not
as evidence for the current `achievedLevel`.

For example, Level 3 evidence for isolated .NET 8 does not transfer to a .NET 10
candidate whose build fails. Report the current build failure and the last accepted
.NET 8 checkpoint separately. `achievedLevel` can be absent when the current candidate
has no fully supported level; do not use Level 0 to mean "not assessed."

Record each level as achieved, blocked, failed, not selected, or not applicable, using
the check evidence in section 12. Levels 2 and 3 require their listed lower levels.
Levels 4 and 5 describe different environments; they do not imply that omitted local
or sandbox tests passed. Show the full level and required-check summary beside the
highest achieved level. For multiple apps, calculate results per app and retain all
required gaps in the overall report.

### 20.2 Overall status rules

Apply these rules in order to the current candidate:

1. `failed_cleanup`: Required cleanup failed. Retain other results and name the owner.
2. `failed`: A required check has a known unresolved failure, such as a target build
   failure or a migration-induced behavior regression.
3. `acceptance_blocked`: A required condition has no valid evidence because permission,
   environment, source access, or an inconclusive result prevents acceptance.
4. `in_progress`: Approved work or required checks remain and can continue.
5. `complete`: All required conditions for the final target and accepted scope have
   valid evidence, artifacts are handed over, and required cleanup is closed.

An expected temporary diagnostic failure inside an open checkpoint is not a failed
acceptance gate. Report it in packet progress while the approved repair continues.
Once the checkpoint gate fails or the repair limit is reached, use the rules above.

These rules do not require Azure for an accepted local-only scope. They also do not
permit an agent to remove an important required condition merely to reach `complete`.
Scope changes need user approval and must remain visible in the final report.
Local-only migration still needs its agreed E2E witness. The final report also records
an applicable current best-practice review with adoption or justified exceptions.
Finishing an assessment is not the same result as completing a migration.

## 21. Failure, resume, and evidence

### 21.1 Evidence record

The workflow preserves:

- plan and revision history;
- inventory with secret values removed;
- source ledger with URL, document date, access date, applicable version, extract,
  confidence, and open questions;
- task packets and results;
- commands, working directories, tool versions, exit codes, and durations;
- restore source names without credentials;
- build and test summaries;
- host and function-indexing evidence;
- validation capability and result;
- diffs and changed-file list;
- artifact identities and evidence validity decisions, including superseded results;
- prototypes and their cleanup result;
- user decisions and permission grants;
- residual risks and handoff items.

### 21.2 Resume rule

Before resume, the planner checks:

- repository revision and working-tree state;
- plan revision;
- support-source freshness;
- tool, SDK, runtime, Core Tools, emulator, and package changes;
- credential and permission expiry;
- Azure test-resource state;
- previously blocked conditions.

If a material fact changed, the planner returns to inventory or route selection.
Recalculate the current result under section 20 before displaying a previous level.

### 21.3 Failure report

A failure report states:

- the last accepted checkpoint;
- the failed packet and command;
- whether the failure existed at baseline;
- the classification and current hypothesis;
- evidence checked;
- files changed;
- safe rollback or resume point;
- required decision or permission;
- cleanup state.

## 22. Permission model

This section describes permissions for a future migration run. It does not grant those
permissions for specification research.

### 22.1 Permission classes

| Class | Example | Proposed behavior |
| --- | --- | --- |
| Read-only workspace | Read code, config, manifests, lock files, and Git metadata | Requires target, assessment scope, and data-processing approval before model-visible reads |
| Read-only public research | Read official documentation and public release or tag source | Allowed and recorded |
| Planned local command | Run an existing restore, build, test, or local host command | Allowed without a new prompt only when the accepted packet lists it, it stays in the workspace, it is non-destructive, and it uses only accepted network destinations |
| Network restore | Contact approved package feeds | Ask if not covered by the accepted packet |
| File changes | Change customer code, tests, config, or generated output | Require an accepted packet and file scope |
| Tool or emulator install | Download a package, binary, image, or emulator | Ask first |
| Docker action | Pull, start, stop, bind ports, or create volumes | Ask first |
| Credential use | Use developer, service principal, or customer credentials | Ask first for named scope |
| Azure read | Read deployed app and resource facts | Ask for target and scope |
| Azure write | Create, update, deploy, assign RBAC, or delete | Ask separately with cleanup plan |
| Paid evaluation | Run a paid model or service evaluation | Ask for target, budget, repetitions, and cleanup |

Permission is limited by target, action, duration, resource, data, and cost. Permission
for one class does not imply permission for another class.
An existing unexpired grant can be referenced by a later packet when its effective
actions remain in scope. "Ask first" does not require repeated approval for the same
already approved action. A restore grant covers only its named dependency downloads
and build hooks, not installation of an unrelated tool.

**Joint decision on 2026-09-17:** Plan approval also approves an existing local restore,
build, test, or `func` command only when all these conditions are true:

- the accepted task packet names the command or a narrow command class;
- the command targets only the accepted workspace and artifacts;
- the planner has inspected the invoked script far enough to identify its effective side effects;
- the command is non-destructive;
- every network destination is in the accepted packet;
- the command does not install a tool, start a container, access Azure, use a new
  credential, change an external resource, or use production or unapproved customer data.

The command name does not determine permission. A local test script that connects to an
external service or changes a resource needs the permission for that effective action.
If the effective action is unknown, the planner stops and asks before execution.

### 22.2 Current document work

The work that produced version 0 used only:

- read-only access to this worktree;
- read-only public documentation access;
- one new draft document in this worktree.

It did not install packages, start Docker, access Azure, migrate an app, run an
emulator, run a paid evaluation, commit, push, or create a pull request.

## 23. Evaluation strategy

The product evaluation must measure:

- route correctness against version, model, OS, and SKU constraints;
- use of newly supplied evidence in code decisions;
- preservation of behavior;
- false completion claims;
- permission compliance;
- plan sufficiency for a weaker executor without external-document lookup, independent
  of whether execution uses a subagent;
- recovery from unexpected versions and failures;
- source quality and target-tag correctness;
- cost, time, context use, and repeated fetches;
- prompt-only effect separately from helper-tool effect;
- performance with and without the skill under the same runner controls.

Use repeated trials before making a general performance claim. One paired trial is
evidence about that case, not proof of general model behavior.

**Joint decision on 2026-09-17:** The primary value is a smoother and more reliable
migration experience under GPT-6-class models, including correct human guidance and
clear reporting of work that cannot complete. Compare skill ON and OFF. Success and
user experience matter more than token or cache reductions.

Reuse the existing Vally experiment records, logs, patches, metrics, and reporting
path. The current report exposes total tokens, turns, tool calls, wall time, errors,
and skill activations. Preserve cache or cost data when the native record supplies it;
mark unavailable values unknown, not zero. Do not add a new measurement runner merely
for this draft. The existing update scenario and its judge still need to be configured;
registration of the skill alone does not add an isolated benchmark.

Use an LLM judge for evidence-backed migration quality, current applicable best
practices, and usability. Supply actual artifacts, E2E results, applicable versioned
sources, and the approved contracts. A judge cannot promote a failed or absent E2E
result to success based on an agent's final report. Keep best-practice exceptions
visible and distinguish recommendations from required compatibility.

Judge whether questions were necessary, understandable, timely, and followed by useful
progress. Fewer questions is not inherently better. Compare both arms with the same
initial facts, permission policy, and customer-answer policy; record actual human help.
Do not give ON extra repairs or penalize OFF for not producing skill-specific documents.
Keep autonomous success, human-assisted success, correct blocked outcomes, and false
success claims distinct. A useful blocked report is not a successful migration.

Past human corrections can be collected during later trials; they are not an entry
requirement. Prompt-only and helper-tool effects remain separate. This revision starts
no paid trials, and sets no target, budget, repetitions, or cloud permissions.

### 23.1 Prior experiment interpretation

The user-provided 2026-09-16 experiment is background evidence:

- Both one-run variants preserved the main HTTP/Python and Event Hubs behavior.
- The skill-enabled run adopted the new `Azure.Functions.Sdk/1.0.0` build SDK.
- The control kept the older SDK even though tool results included the new requirement.
- Both runs had feed or TLS delays and unrelated Markdown-lint installation work.
- One local host start was blocked by runner path permission.
- Reported use was 495.0092 credits for the control and 591.23075 for the skill-enabled
  run, with a 500-credit soft cap per run. The handoff reports a budget stop before the
  skill-enabled final report. It does not establish the same stop outcome for the control.

The evaluation design must separate domain guidance from runner permissions, feed
conditions, and harness choices. It must not claim that skill text can grant permissions.

Reviewers must check complete compatibility branches. Prior review claims about an
AzureRM Event Hub argument, Linux Elastic Premium package deployment, and generated
function metadata were withdrawn after deeper version-specific review. The evaluation
must not score a migration from a `latest`-only or partial-source assumption.

## 24. Remaining open product decisions

The focused version 0 decisions for local command permission, E2E ownership, evidence
freshness, temporary TFMs, Azure sandbox ownership, outbound workspace data, sampling,
doctor reuse, package evidence, and blocked-result display are recorded in this document.

Later design work must still decide:

1. The exact shared inventory schema and version policy.
2. The evidence artifact location, retention period, and customer deletion process.
3. Trigger-specific listener-ready and acceptance signals.
4. Python and Node.js route details and coexistence rules.
5. Runner-specific data processing and retention disclosures.
6. The user interface for packet, network, credential, and Azure approvals.
7. The exact handoff schema between Azure Functions Skills and Azure Skills.
8. The product behavior when an official source is unavailable for a long period.

The user selected the evaluation priorities and human-in-the-loop behavior above.
Concrete judge rubrics, update-scenario registration, and representative repositories
remain future work, not prerequisites to this draft revision.

## 25. Questions for Fabio

These are consultation topics only. This document does not identify, contact, or send a
message to a person.

- Which local and cloud validation levels should be the minimum product promise?
- Which trigger and binding teams publish version-specific compatibility evidence that
  an agent can consume reliably?
- What is the supported local test position for Event Grid service behavior?
- Which managed identity, Key Vault, certificate, mTLS, and private-network checks need
  a customer environment?
- Which official emulator gaps are material for Functions migration acceptance?
- What evidence should qualify a listener as ready?
- Which doctor inventory and check contracts are stable enough for reuse?
- What SKU-change boundary should always route to Azure Skills?
- What large internal app and data cases must appear in evaluation fixtures?
- Which migration artifacts should remain in the customer repository?

## 26. Source ledger

Accessed on 2026-09-17 unless stated otherwise.

| Source | Document date or update | Used for |
| --- | --- | --- |
| [Migrate C# Apps from In-process to Isolated Worker Model](https://learn.microsoft.com/azure/azure-functions/migrate-dotnet-to-isolated-model) | 2026-09-14; updated 2026-09-16 | Host 4.x assumption, target selection, project and extension changes |
| [Guide for running C# Azure Functions in an isolated worker process](https://learn.microsoft.com/azure/azure-functions/dotnet-isolated-process-guide) | 2026-09-14; updated 2026-09-16 | Supported .NET versions, plan limit, build SDK, worker and package requirements |
| [Supported Languages in Azure Functions](https://learn.microsoft.com/azure/azure-functions/supported-languages) | 2026-08-27; updated 2026-09-17 | Execution-model, version, EOS, OS, and Linux Consumption support |
| [Select which .NET version to use](https://learn.microsoft.com/dotnet/core/versions/selection) | 2026-05-15; updated 2026-07-27 | SDK, TFM, and runtime distinction |
| [Common NuGet configurations](https://learn.microsoft.com/nuget/consume-packages/configuring-nuget-behavior) | 2024-07-15; updated 2026-08-03 | Effective configuration and source scope |
| [Register Azure Functions binding extensions](https://learn.microsoft.com/azure/azure-functions/functions-bindings-register) | 2025-05-30; updated 2026-07-04 | Extension packages and execution-model namespaces |
| [Develop and run Azure Functions locally](https://learn.microsoft.com/azure/azure-functions/functions-develop-local) | 2026-05-30; updated 2026-06-03 | Local host and secret-bearing local settings |
| [Develop Azure Functions locally by using Core Tools](https://learn.microsoft.com/azure/azure-functions/functions-run-local) | 2026-05-29; updated 2026-09-16 | Core Tools and local host workflow |
| [How to work with Event Grid triggers and bindings](https://learn.microsoft.com/azure/azure-functions/event-grid-how-tos) | 2024-08-07; updated 2025-09-15 | Local capture and manual replay |
| [Event Grid event handler with Azure Functions](https://learn.microsoft.com/azure/event-grid/handler-functions) | 2026-08-27 | Trigger validation, endpoint, rate matching, and Entra-protected webhook route |
| [Azure Event Grid delivery and retry](https://learn.microsoft.com/azure/event-grid/delivery-and-retry) | 2026-02-09; updated 2026-02-12 | Delivery, retry, duplicate, batch, and dead-letter service behavior |
| [Use the Azurite emulator](https://learn.microsoft.com/azure/storage/common/storage-use-azurite) | 2025-08-25; updated 2025-10-23 | Storage emulator scope and limits |
| [Test locally with Service Bus emulator](https://learn.microsoft.com/azure/service-bus-messaging/test-locally-with-service-bus-emulator) | 2025-10-27; updated 2026-08-28 | Official Service Bus emulator and prerequisites |
| [Test locally with Event Hubs emulator](https://learn.microsoft.com/azure/event-hubs/test-locally-with-event-hub-emulator) | 2026-08-25; updated 2026-08-26 | Official Event Hubs emulator and prerequisites |
| [Service Bus emulator overview](https://learn.microsoft.com/azure/service-bus-messaging/overview-emulator) | 2026-02-05; updated 2026-08-28 | AMQP TCP, unsupported features, identity, persistence, and quotas |
| [Event Hubs emulator overview](https://learn.microsoft.com/azure/event-hubs/overview-emulator) | 2026-08-25; updated 2026-08-26 | Capture, schema registry, identity, persistence, and protocol limits |
| [Azure Cosmos DB emulator](https://learn.microsoft.com/azure/cosmos-db/emulator) | 2026-09-01 | Emulator scope, scale, key, and TLS limits |
| [Cosmos DB Linux vNext emulator](https://learn.microsoft.com/azure/cosmos-db/emulator-linux) | 2026-06-02 | NoSQL gateway mode, HTTP default, HTTPS for .NET and Java, and variant-specific features |
| [Authenticate .NET apps with developer accounts](https://learn.microsoft.com/dotnet/azure/sdk/authentication/local-development-dev-accounts) | 2025-11-25; updated 2026-03-20 | Local developer identity behavior |
| [Managed identities for Azure resources](https://learn.microsoft.com/entra/identity/managed-identities-azure-resources/overview) | 2025-08-19; updated 2026-06-15 | Resource-bound managed identity behavior |
| [Authenticate to Azure Key Vault](https://learn.microsoft.com/azure/key-vault/general/authentication) | 2026-01-30; updated 2026-06-12 | Entra, RBAC, firewall, and Key Vault identity path |
| [Securing Azure Functions](https://learn.microsoft.com/azure/azure-functions/security-concepts) | 2026-01-20; updated 2026-07-21 | TLS, certificates, mTLS, keys, and endpoint security |
| [Azure Functions networking options](https://learn.microsoft.com/azure/azure-functions/functions-networking-options) | 2026-09-12; updated 2026-09-16 | Hosting-plan network capability and Azure handoff |
| [Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra) | Accessed 2026-09-17 | Short descriptions, progressive disclosure, and reduced over-instruction |
| [Using GPT-6 Astra](https://developers.openai.com/api/docs/guides/latest-model) | Accessed 2026-09-17 | Initiative, completion, instruction sensitivity, subagents, and verification |
| [Azure Skills and Azure Functions Skills Boundary](../../../azure-skills-boundary.md) | 2026-05-21 | Repository product boundary |
| [Doctor Guide](../../../doctor-guide.md) | Current worktree at `6bb6160` | Doctor capability and trust boundary |

Repository reuse evidence was read at commit `6bb6160012e10b6adbf7879c6dbedc49e47359c2`:
`src/doctor/context.ts`, `src/doctor/stacks.ts`, `src/doctor/runner.ts`,
`src/doctor/types.ts`, the inventory and setup skills, the inventory PowerShell script,
and the diagnostics workflow named in section 10.2. No collector was executed.

## 27. Evidence confidence and known gaps

### Confirmed with current primary sources

- Current .NET execution-model and TFM support table.
- In-process support end date.
- Linux Consumption ceiling for newer .NET versions.
- Current isolated build SDK and package direction.
- Event Grid local manual replay method.
- Event Grid delivery features that require service-backed validation.
- Official local emulators for Storage, Service Bus, Event Hubs, and Cosmos DB.
- Difference between local developer identity and a resource managed identity.

### Proposed product rules

- Compatibility-driven route selection instead of one fixed migration sequence.
- Versioned task packets and plan invalidation.
- Checkpoint boundaries and current-artifact evidence validity.
- Bootstrap approval states and the shared inventory adapter contract.
- Default separation of local replay, emulator, Azure sandbox, and customer acceptance.
- One readable root workflow with four supporting references.

### Joint decisions retained after review

The ten user decisions remain recorded in their sections. E2E placement and retention
are decided in section 17. Planned local command permission is decided in section 22.
The separation of achieved level and overall status is decided in section 20. The
remaining schema and runner details do not reopen those choices.

### Not yet confirmed

- A complete official inventory that explicitly states that Event Grid and Key Vault have
  no official emulators.
- A service-by-service mTLS capability table for all emulators.
- The exact listener-readiness signal for every trigger and extension version.
- A stable API contract for reusing doctor inventory.
- Per-run emulator image and binding-extension compatibility.
- The exact runtime and host support for a selected .NET Framework TFM and Windows version.
