---
name: frd
description: "Create or revise a Feature Requirement Document (FRD) for this repository. Use only when the user explicitly asks to create, draft, or revise an FRD or Feature Requirement Document, or explicitly invokes this skill. Do not trigger for ordinary feature implementation, new skills, bug fixes, refactoring, general design or planning requests, or incidental FRD mentions. Feature size and public contract changes do not imply opt-in."
---

# Feature Requirement Documents

This is a repository development skill, not a distributed Azure Functions skill.
Keep its workflow opt-in so ordinary development does not acquire an unsolicited
documentation or approval gate.

## Scope

Confirm that the user's request explicitly opts into FRD work. If it does not,
continue the original task without creating an FRD or imposing FRD approval gates.
Apply this process only to the feature or document the user selected, not to all
work in the repository. A request to draft a document does not authorize feature
implementation.

## Authoring workflow

1. Read the [FRD process and index](../../../docs/frds/README.md), the
   [template](../../../docs/frds/_template.md), and any related FRD and its status.
   Inspect the relevant code and documentation before proposing a design.
2. Update a related FRD where possible. Otherwise, use the next available
   `docs/frds/NNNN-kebab-case-title.md` and add it to the index. Preserve historical
   documents and numbering in `docs/prd-docs/`.
3. Maintain one lifecycle FRD per canonical skill rather than one per enhancement,
   generated payload copy, or alias. Give cross-skill mechanisms a separate
   shared-infrastructure FRD when included in the user's selected scope. Do not
   create placeholder FRDs for unrelated skills.
4. Complete all eight template sections, including stable requirement IDs,
   observable acceptance criteria, non-goals, design, decisions, tests,
   documentation impact, and status/sign-off. For skill designs, cover purpose,
   triggers, inputs/outputs, tools, transitions, safety boundaries, and evaluations.
5. Record non-trivial decisions with alternatives, rationale, decision-maker, and
   date. Preserve earlier decisions and identify agent suggestions as proposals,
   not human approval. Make unresolved questions explicit.
6. Keep committed documents in English and explanations in the user's language.
   Present the draft, open decisions, and review status; stop at the requested
   authoring scope.

## Review and delivery for the opted-in scope

1. Obtain a separate architecture review and explicit human sign-off on the
   identified revision before marking the FRD `Finalized`. Record the approver,
   date, revision (commit SHA or content hash), scope, and approval reference.
   Task-plan approval is not approval of an unwritten or unreviewed FRD.
2. Implement the opted-in feature only after its FRD is `Finalized` and the user
   has requested implementation. Drafting, reviewing, and maintaining the FRD
   itself can proceed before feature approval.
3. If an approved contract or scope changes, update the FRD and obtain approval
   for the changed portion before implementing it. Keep the index and document's
   status in sync.
4. Link tasks, PRs, tests, and completion evidence to requirement IDs. Default to
   one primary implementer working in understandable slices, with a separate
   review pass at meaningful checkpoints. Report completed requirements,
   remaining work, and changed decisions.
5. Mark an FRD `Implemented` only when its acceptance criteria and evidence are
   complete. Benchmark or evaluation FRDs require approved runs and a report,
   not just sample code. Keep missing approval, measurements, or cleanup explicit.

FRD approval does not authorize paid or live Azure experiments or bypass
repository security rules. Confirm the code revision, target, identity, budget,
repetition count, and owned-resource cleanup policy separately. Follow the
repository's [evaluation security rules](../../../AGENTS.md#security): no Vally
evals in PR-triggered CI or on unreviewed, untrusted contributor code; retain the
GitHub Environment reviewer gate for GitHub Actions evaluations. Trusted local
evaluations are allowed in isolated trial workspaces without that gate. Never
run `doctor --deep` on untrusted workspaces.
