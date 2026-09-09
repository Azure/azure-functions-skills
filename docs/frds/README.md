# Feature Requirement Documents

FRDs make substantial changes understandable and reviewable before implementation.
This process adapts the [Azure Functions Agents Runtime design workflow](https://github.com/Azure/azure-functions-agents-runtime/blob/1351d6e79905399d9338ee8c1dd0092ed945a8f0/AGENTS.md#L15-L46)
and [FRD template](https://github.com/Azure/azure-functions-agents-runtime/blob/1351d6e79905399d9338ee8c1dd0092ed945a8f0/docs/frds/_template.md)
to this TypeScript CLI and skill repository. It does not introduce a new execution
framework or a requirement to launch multiple agents.

## Opt-in only

FRDs are optional and used only when the user explicitly requests FRD work.
Use the repository-local [frd skill](../../.github/skills/frd/SKILL.md) for requests
such as "Create an FRD for this feature" or "Draft a Feature Requirement Document."
Ordinary implementation, new skills, bug fixes, refactoring, and general planning
requests do not opt in, regardless of feature size or public contract impact.
An incidental FRD mention is not an opt-in request.

The authoring, ownership, review, and delivery gates below apply only to the
feature or document selected by the user. They are not repository-wide
prerequisites for development.

## Index

| ID | Feature | Status | Depends on |
| --- | --- | --- | --- |
| [FRD-0003](0003-azure-contribution-telemetry.md) | Azure contribution telemetry: observed successful Azure deployments | Draft | — |

FRD numbers 0001 and 0002 are reserved by pull requests that were open when this
index was written; check the index and open pull requests for collisions before
choosing a number.

[Historical F1-F21 specifications](../prd-docs/README.md) remain in `docs/prd-docs/`.
Do not move, renumber, or silently reinterpret them. Refer to old features as
`F21`, for example, and new features as `FRD-0001`; these are separate sequences.
The current CLI contract is documented in [CLI Reference](../cli-reference.md).

## Choose the development lane after opt-in

| User intent | Examples | Process |
| --- | --- | --- |
| No explicit FRD request | Any feature, skill, bug fix, refactoring, or general design task | Follow normal development standards; no FRD gate |
| Explicit FRD request | Create, draft, or revise an FRD for a selected feature | FRD, independent review, human sign-off; implementation and evidence when requested |

Update a related FRD rather than creating one for every module or test case.
Within the opted-in scope, if a bug fix changes an approved public contract,
record and review that contract change even if the code patch is small. Pure
FRD/process documentation can be written before feature approval.

## Choose FRD ownership

| Area | FRD ownership |
| --- | --- |
| CLI or library | One FRD per coherent public feature or contract; update it as that feature evolves |
| Canonical skill | One lifecycle FRD per skill; update the same document for substantive behavior changes |
| Shared skill infrastructure | A separate FRD for cross-skill routing, metadata, generation, evaluation, or other shared contracts |

A canonical skill is the authored source skill, not each generated payload copy,
target-specific rendering, or alias. Those derived forms are covered by the
canonical skill's FRD and the relevant shared-infrastructure FRD.

When the user opts into an FRD for a new canonical skill, draft it before
implementing that skill. Do not create placeholder FRDs for existing skills in
bulk or automatically start FRDs for substantive contract changes.
Within the opted-in scope, update the skill's FRD when its purpose, triggering,
inputs or outputs, tool chain, transitions, safety boundary, or acceptance criteria
change. Typos, reference refreshes, and editorial clarifications do not require an
FRD revision unless they alter the skill's behavior or contract.

## Authoring

Use `_template.md` and the next available `NNNN-kebab-case-title.md` name.
Check the index for collisions before choosing a number.

Keep all eight sections: summary, motivation, goals/non-goals, proposed design,
decisions log, test plan, docs impact, and status/sign-off. Use stable requirement
IDs such as `XX-001`, and link each to acceptance evidence. A test name, fixture,
or report link is more useful than a statement that something was "verified."

For a skill FRD, identify the canonical skill path and cover its purpose, trigger
contract, inputs and outputs, tool dependencies, recommended transitions, safety
constraints, and evaluation criteria. Extend this document as the skill evolves
instead of creating a new FRD for each enhancement.

Use English for committed documents. User-facing explanations and temporary
review summaries may use the user's language.

The decisions log is append-only: retain previous decisions and link a superseding
decision when a choice changes. Identify whether a choice was made by a human or
proposed by an agent. Do not present an agent proposal as human approval.

## Lifecycle and gates

| Status | Meaning | Required transition evidence |
| --- | --- | --- |
| Draft | Authoring; not permission to implement | All sections written, unresolved questions explicit |
| In review | Ready for an independent architecture review and human reading | Review findings and resolutions |
| Finalized | Identified revision explicitly approved by a human | Approver, date, revision, scope, approval reference |
| Implemented | Approved scope delivered, documented, and evidenced | Accepted tests/results and implementation reference |

For the opted-in scope, implementation starts only after `Finalized` and a user
request to implement. A general task-plan approval does
not finalize a document that the human has not reviewed. The agent may record an
explicit human approval; it may not approve its own FRD.

Identify the approved revision with a commit SHA or a content hash for an
uncommitted draft. Update the index and document together when status changes.
If a contract changes after approval, identify the affected requirements, append
the decision, and return that scope to review before implementing it.

For multi-stage work, distinguish core implementation from sample development
and experiments. Split dependent stages into separate FRDs (using `Depends on`)
so that completing one stage cannot silently close a dependent experiment or
follow-on stage.

## Delivery discipline

Default to a primary implementer working in understandable slices. At the agreed
checkpoints, present the requirements completed, remaining work, and changed
decisions. Use a separate review pass at meaningful boundaries, not a fleet of
concurrent implementers or an FRD per small task.

PR descriptions should link the relevant FRD and requirement IDs, summarize any
decision changes, and identify evidence. This is process guidance, not a new
automated merge gate.

Follow the repository's [development standards](../../AGENTS.md): TypeScript
strict mode, ESM, TDD for code, existing npm/Vitest checks, and canonical template
generation. Do not copy Python-specific tooling from the reference project.

For paid or live experiments, design approval and execution authorization are
different gates. Confirm the approved code revision, target, identity, budget,
repetition count, and cleanup policy. Existing reviewer-gated evaluation and
untrusted-code restrictions still apply. An experiment is complete only when its
required runs, measurements, report, and resource disposition are recorded.
