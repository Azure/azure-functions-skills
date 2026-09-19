## Code Review - Draft: azure-functions-update

**Revision note, 2026-09-18:** This document records reviews through version 1.2.0.
Those approvals do not cover version 2.0.0. The current skill uses an eleven-step
model/config workflow and `references/dotnet-isolated.md`, with a separate language
handoff and stable completion IDs. Prior file names and combined routes below are historical.

**Current status:** Revised draft, not a measured improvement over skill OFF.
The sections below through "Repository validation and remaining limits" describe
the initial version 1.0.0 review. Its structural approval and token estimates are
historical. "Workflow-value revision" describes version 1.1.0 and specification Revision 2.
See "Explicit use and simpler structure" for the current version 1.2.0 and Revision 3.

### What Looks Good

- A short router loads references by phase. Children receive task-specific packets,
  not the whole reference library.
- Data-processing approval precedes customer source reads. Command permission follows
  actual effects, including build hooks, credentials, and external paths.
- .NET route selection separates SDK, TFM, runtime, model, and hosting support.
  Candidate restore has its own approval before the final migration plan.
- Results identify the current artifact and distinguish host indexing, local behavior,
  real Azure integration, and customer acceptance.

### Summary

| Priority | Open findings |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |

**Overall Assessment:** Approve for a draft. This is a static review, not evidence
that a customer migration or runtime skill selection succeeds.

### Review method and scope

Reviewed on 2026-09-17 using Microsoft's
[skill-reviewer](https://github.com/microsoft/GitHub-Copilot-for-Azure/blob/a7175147f98b6019ceb83099b97208a859effd12/.github/skills/skill-reviewer/SKILL.md),
version 1.0.3, at commit `a7175147f98b6019ceb83099b97208a859effd12`.
The skill was not registered in this session. Its body and all four references were
retrieved and applied directly. It was not installed into a user profile.

The review covers the canonical `azure-functions-update` skill, its 12 references,
the generated payload, the bundled-skill allowlist entry, and the discovery-boundary
documentation. The specification remains v0 Revision 1.

The upstream checklist assumes a different repository. These adaptations are explicit:

| Upstream rule | Application here |
| --- | --- |
| `plugins/{plugin}/skills` | Review `templates/skills` as canonical; generate plugin files with the existing builder |
| Required frontmatter | Retain local name/title/description/category; add MIT and Microsoft/version metadata to the canonical skill |
| Separate activation section | Keep activation in the description, as the skill-creator guidance requests; do not duplicate it in the body |
| Mandatory named MCP tools | No mandatory MCP operation in this skill; discover available schemas and use public docs when unavailable |
| `tests/skills.json` and TriggerMatcher | This repository uses directory discovery, a bundled-name allowlist, and Vally suites; do not invent the upstream registry or matching algorithm |
| Trigger execution | Deferred to an approved later trial; description comparison is not an invocation-rate measurement |
| Bash/PowerShell pairs | No executable helper scripts or non-trivial shell recipes were added |
| PR title and status icons | No PR exists; use a draft title and ASCII report headings |

### Budgets and links

Estimates use the reviewer's fallback of four characters per token, rounded up.
They are not tokenizer measurements.

| File | Estimated tokens |
| --- | --- |
| SKILL.md | 487 |
| references/permissions.md | 937 |
| references/workflow.md | 997 |
| references/inventory.md | 982 |
| references/dotnet.md | 984 |
| references/dotnet-changes.md | 1,000 |
| references/task-packet.md | 725 |
| references/validation.md | 938 |
| references/emulators.md | 919 |
| references/identity.md | 693 |
| references/testing-data.md | 631 |
| references/evidence.md | 940 |
| references/azure-handoff.md | 483 |

The description has 49 words and 356 characters. It names Functions-specific update
requests and excludes new projects, deployment-only work, cross-cloud migration, and
skills CLI updates. All local links resolve. Each reference is reachable from the
router or a linked reference.

The core .NET path reads about 8,000 tokens across its phases if the parent retains all
core references. The complete set is about 10,700 tokens, but is not a mandatory load.
Entry requires about 1,400 tokens. Planning references add about 3,500 tokens including
the router. Emulator, identity, test-data, and Azure handoff references are conditional.
Task-packet size and actual model context use still need measurement.

### Findings corrected before this result

| Initial finding | Severity | Correction |
| --- | --- | --- |
| New skill missing from the bundled telemetry allowlist | High | Added its name to `src/telemetry/sender.ts`; the existing alignment test now passes |
| Three references exceeded the soft token budget | Medium | Shortened repeated prose without dropping the processing, checkpoint, or source boundaries |
| Older Durable examples could conflict with the new build SDK | Medium | Distinguished Durable API mapping from current general SDK guidance in `dotnet-changes.md` |

No new inventory engine, migration script, CLI command, or provisioning path was added.
The allowlist change only registers the new bundled name; it does not change consent,
event properties, destinations, or transmission behavior.

### Routing review

Compared the new description with existing skill descriptions and the repository
ownership rules. The following are expected routes, not executed routing results:

| Request | Expected route |
| --- | --- |
| Plan an in-process .NET Functions conversion to isolated | azure-functions-update |
| Update worker or binding packages in an existing .NET Functions app | azure-functions-update |
| Assess a Python Functions runtime update | azure-functions-update, assessment only |
| Add a new HTTP trigger | azure-functions-create |
| Deploy an unchanged Function App | azure-functions-deploy, then Azure Skills |
| Diagnose an existing listener failure without a migration request | azure-functions-doctor locally, or azure-functions-diagnostics for deployed resources |
| Move Lambda to Functions | azure-cloud-migrate |
| Update the installed skills CLI | CLI guidance, not app migration |

Diagnostics and best-practice review can assist a selected migration. They do not
replace this skill's plan ownership. Help discovers available skills dynamically;
no second static catalog was added.

### Scenario review

These paths were traced through the text, not executed against an app:

| Scenario | Required result in the draft |
| --- | --- |
| Remote parent has no source-processing approval | Stop before content reads; accept an approved summary or explicit source grant |
| Project changes temporarily break compilation during conversion | Finish the coherent approved checkpoint; do not advance with a failed gate |
| .NET 8 checkpoint passed, .NET 10 candidate fails | Show current failure and preserve .NET 8 evidence only as history |
| Candidate graph is unknown before restore | Approve candidate resolution first; confirm actual graphs before final plan approval |
| Event Grid local replay passes but real delivery is required | Keep service acceptance blocked until approved Azure handoff returns evidence |
| Cosmos vNext is selected for .NET | Select HTTPS, approved trust, gateway-compatible client/extension, and telemetry policy |
| Cloud access is denied | Continue independent local work; do not claim deployed compatibility |

### Repository validation and remaining limits

The existing full gate passed after payload generation: lint, typecheck, security
content checks, skill validation, static eval-spec lint, payload verification,
318 tests, and workspace/plugin builds. No agent evaluation was run.
The existing Vally specs do not measure this new skill's trigger rate or migration
quality. No new paid evaluation was added or started.

The development dependencies were restored with user approval and `--ignore-scripts`.
The install reported eight dependency advisories (six moderate, two high). Dependency
remediation was not part of this skill change; the lock file was not changed.

An old-repository trial remains separate. Before that trial, agree the repository and
revision, processing boundary, isolated writable path, command/network permissions,
required outcomes, and any tool or emulator use. If it is a paid comparative experiment,
also agree budget, repetitions, baseline isolation, and owned-resource cleanup separately.
Do not treat this static review as those permissions or as migration success evidence.

### Workflow-value revision

The later GPT-6 self-review found product gaps despite the initial structural approval:
domain decisions were underspecified, requirements were not reconciled with changes
and proof, semantic checks lacked selection rules, and process overhead could exceed
its benefit. The listener-readiness statement was also too broad.

The revision addresses these findings as follows:

| Concern | Revised behavior | Remaining limit |
| --- | --- | --- |
| Customer target unknown during authoring | Resolve workspace/repository during use; ask only if unclear; confirm the destination after research | No customer target has been tried |
| Business expectations implicit | Ask the user with code/test examples; record original expectations and final E2E scenarios | Customer answers and representative cases are still needed during use |
| Planning mistaken for mandatory delegation | Planner and executor are roles that one agent can perform at any size; the plan must also be usable by a weaker model without external-document lookup | Plan sufficiency has not been measured in execution |
| Required information found but not applied | Link authority/applicability to actual changes, resolved versions, and proof; inspect the resulting artifacts | The record is a review method, not an automatic validator |
| Route table without choice criteria | Use observed dependency, support, contract, and recovery facts to choose stages | Proposed heuristics; original expert rationale remains to be collected |
| Generic semantic checks | Select probes from observed serialization, broker, history, discovery, and consumer risks | Local probes do not prove unsupported service behavior |
| Too much process for small changes | Permit one compact plan/packet, optional YAML, no forced delegation or repeated grants | Fewer documents does not establish lower context use |
| Readiness claim too strong | State that this draft has not established a common signal; investigate the actual extension | Some extension signals remain unknown |
| Build or indexing mistaken for success | Require executed E2E for agreed business scenarios; review applicable best practices and report exceptions | Required unavailable E2E prevents migration completion |

Version 1.1.0 had 16 references. New files were `intake.md`,
`requirements.md`, `route-decisions.md`, and `contract-probes.md`.
The complete set is about 14,500 estimated tokens with LF-normalized text and the same
four-character estimate. The root is about 525 tokens; the largest reference is about
1,100. Three references exceed the initial soft 1,000-token reference budget slightly
to retain necessary gates and domain facts. These are not tokenizer measurements.
The library grew; no context or cost reduction is claimed. Load only relevant phases
and selected probes, and keep only required conclusions in an execution packet.

The text was checked against these decision paths, not run against an app:

- One agent plans and executes a large migration without creating a child.
- An optional weaker executor receives rules and expected proof, not only external links.
- A required cloud E2E is unavailable, but separately accepted local stages continue.
- A requirement appears in research but not in the actual changed project.
- A small isolated extension update uses one compact plan and selected contract checks.
- An E2E is still scheduled during execution: status is in progress, not premature failure.
- E2E is absent at final acceptance: no completed migration claim.

The review does not prove that GPT-6 needs this skill or that ON beats OFF.
The current session has already read the skill and is not a clean OFF trial.
The user prioritizes usability, reliable completion, human guidance, and honest blockers.
Use existing Vally metrics and future evidence-grounded LLM judging; a judge cannot
replace missing runtime evidence or count a useful blocked report as a successful migration.

The author-input questions and evaluation intent are saved in
[PR rationale notes](azure-functions-update-pr-rationale.md). Agent count is not an
open question. No customer migration, live evaluation, Azure action, or PR action was
performed for this revision.

The revised payload was generated from canonical templates. The existing full gate
passed again with 318 tests across 22 files. It included static eval-spec lint, not
agent trials. No new validation tool, runtime helper, or evaluation runner was added.

### Final pre-PR review

A separate Claude Opus 5 review found one missing documentation entry: the Japanese
boundary table did not include the update route. The matching row was added with the
same draft scope as the English table. No other actionable findings were reported.
This review is not an ON/OFF evaluation.

### Explicit use and simpler structure

The user identified two issues: migration could start from a broad request, and the
short router hid the complete workflow across too many files.
The selected policy requires an explicit request to use or resume
`azure-functions-update` by name. Questions, quotations, source instructions, and skill
reviews do not authorize a run. Normal replies in an active run do not need repeated naming.
The description, root start rule, help routing, and English/Japanese boundary tables
now use that policy. Azure Skills retains platform work, without a second migration plan.

The root now contains eight ordered steps, the surprise/research/replan loop, and action
boundaries. The references are `plan.md`, `dotnet.md`, `validation.md`, and
`azure-handoff.md`. Previous reference names above describe historical revisions.
The larger root is intentional: maintainers can read the procedure without reconstructing
it from references. The supporting files retain stage choices, contract probes, source
dates, self-contained packets, result validity, environment limits, and cleanup rules.

#### Client limitation

Reviewed on 2026-09-17:

- [Copilot CLI skill documentation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills)
  documents explicit prompts such as `Use /azure-functions-update ...`.
- [github/copilot-cli#4438](https://github.com/github/copilot-cli/issues/4438)
  reports failed model-tool lookup with `disable-model-invocation: true` on 1.0.79.
- [github/copilot-cli#4637](https://github.com/github/copilot-cli/issues/4637)
  reports successful slash-command injection with a second failed lookup on Windows 1.0.80.

These reports describe different invocation paths and are not tests of the selected
1.0.84-3 client. Do not infer universal failure or success from them.
This repository's skill loader/renderer also does not preserve that extra attribute.
No unverified cross-client attribute or CLI change was added in this revision.
The current policy is an instruction boundary, not a runtime guarantee.

#### Routing cases for the next approved trial

| Request/context | Required result |
| --- | --- |
| Use /azure-functions-update to migrate this app | Enter intake; later effects still need permission |
| Resume azure-functions-update for the selected plan | Recheck plan/evidence/grants, then resume permitted work |
| Migrate these Functions to isolated, with no named skill | Do not start this workflow automatically; help may recommend it |
| Change Consumption to Flex | Azure Skills platform work, not implicit code migration |
| Add an HTTP function, diagnose a listener, or update an npm package | Existing task route; no update workflow |
| Explain/review azure-functions-update, or read a file mentioning it | No migration or customer-content assessment |
| Normal answer to a question inside a user-selected run | Continue that run without demanding its name again |
| Azure handoff returns to an active update plan | Record results in the same plan; do not start another migration |

Run client-specific invocation and negative routing cases separately from migration
quality. The ON migration needs an explicit invocation that OFF does not receive;
keep the business request, common Azure Skills, tools, and answer policy equivalent.
The old frozen A/B input is not silently replaced by this revision.
No live trigger trial or customer migration was run for this change.

The revised payload was generated from templates. The existing full gate passed with
318 tests across 22 files; static eval-spec lint did not run model trials.
A separate Claude Opus 5 review found no significant issues in the consolidation,
activation rules, retained migration gates, links, or ownership boundaries.
Neither result proves client activation reliability or an ON/OFF migration benefit.
