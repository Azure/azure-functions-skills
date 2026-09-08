# FRD-NNNN: Feature title

| Metadata | Value |
| --- | --- |
| Status | Draft |
| Revision | 1 |
| Created | YYYY-MM-DD |
| Updated | YYYY-MM-DD |
| Author | Human or agent identity |
| Depends on | FRD links or None |

## 1. Summary

Describe the user-visible outcome in one paragraph. State whether this is a
proposal or an implemented capability.

## 2. Motivation / problem

Describe the concrete problem, an example user workflow, the current behavior,
and alternatives already available in this repository. Link relevant evidence.

## 3. Goals / non-goals

### Requirements and acceptance criteria

| ID | Requirement | Observable acceptance criterion |
| --- | --- | --- |
| XX-001 | Required behavior | Evidence that distinguishes success from a plausible approximation |

### Non-goals

State what will not be built or changed.

## 4. Proposed design

Describe public commands/formats, examples, module ownership, data flow,
compatibility, failure behavior, and trust boundaries. Explain the smallest
solution and why existing helpers cannot meet any new requirement.

For experiments, define controls, inputs, measurement semantics, success
criteria, resource ownership, and separate execution authorization.

### Delivery checkpoints

Describe the understandable implementation slices and where human review is
required. Do not give estimates or create an agent fleet by default.

### Open questions

List unresolved choices and their owners, or explicitly state None. Questions
that affect an implementation contract must be resolved before finalizing it.
Run-specific execution details may remain pending when they are an explicit
later gate rather than an implementation assumption.

## 5. Decisions log

Append decisions; preserve superseded entries and link their replacements.

| ID | Decision / options | Choice and rationale | Decided by | Date |
| --- | --- | --- | --- | --- |
| D-001 | Alternatives considered | Proposed choice; not approval | Human name or Agent name (proposal) | YYYY-MM-DD |

## 6. Test plan

| Requirement | Test / fixture / experiment | Expected evidence |
| --- | --- | --- |
| XX-001 | Planned test, fixture, or experiment | Observable result |

Cover failures, compatibility, and security boundaries as well as the happy path.
Use existing test infrastructure. LLM/live evaluations require reviewed code and
the existing reviewer gate; sample creation alone is not experimental evidence.

## 7. Docs impact

List the exact documents, CLI help, and canonical skill templates that change.
Identify generated outputs, compatibility notes, and user guidance. Do not modify
generated plugin payloads by hand or the user-facing `templates/agents/AGENTS.md`.

## 8. Status & sign-off

| Item | Evidence |
| --- | --- |
| Independent architecture review | Pending |
| Human approval | Pending |
| Approved revision and scope | Pending; record commit SHA or content hash |
| Approval reference and date | Pending |
| Implementation reference | Not started |
| Acceptance evidence | Not collected |

Status remains Draft until ready for review. No feature implementation before
explicit human sign-off and Finalized status. A task-plan approval is not a
substitute. Update this section and the FRD index together.
