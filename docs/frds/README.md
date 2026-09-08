# Feature Requirement Documents

FRDs make substantial changes understandable and reviewable before implementation.
This process adapts the [Azure Functions Agents Runtime design workflow](https://github.com/Azure/azure-functions-agents-runtime/blob/1351d6e79905399d9338ee8c1dd0092ed945a8f0/AGENTS.md#L15-L46)
and [FRD template](https://github.com/Azure/azure-functions-agents-runtime/blob/1351d6e79905399d9338ee8c1dd0092ed945a8f0/docs/frds/_template.md)
to this TypeScript CLI and skill repository. It does not introduce a new execution
framework or a requirement to launch multiple agents.

## Index

| ID | Feature | Status | Depends on |
| --- | --- | --- | --- |
| [FRD-0001](0001-workflow-runner.md) | Local workflow runner | Implemented | None |
| [FRD-0002](0002-workflow-create-deploy-evaluation.md) | Workflow create/deploy evaluation | Finalized | FRD-0001 |

[Historical F1-F21 specifications](../prd-docs/README.md) remain in `docs/prd-docs/`.
Do not move, renumber, or silently reinterpret them. Refer to old features as
`F21`, for example, and new features as `FRD-0001`; these are separate sequences.
The current CLI contract is documented in [CLI Reference](../cli-reference.md).

## Choose the development lane

| Scope | Examples | Process |
| --- | --- | --- |
| Nit | Typo, formatting, comment correction | Change, appropriate checks, PR |
| Bug | Incorrect behavior or regression | Reproduction test, fix, checks, PR |
| Small internal feature | One module, no public contract change | Short design note in PR, tests, implementation, docs |
| Medium or larger feature | Public CLI/library surface, new authoring format, discovery behavior, cross-module feature | FRD, independent review, human sign-off, implementation, evidence |

Update a related FRD rather than creating one for every module or test case.
If a bug fix changes an approved public contract, record and review that contract
change even if the code patch is small. Pure FRD/process documentation can be
written before feature approval.

## Authoring

Use `_template.md` and the next available `NNNN-kebab-case-title.md` name.
Check the index for collisions before choosing a number.

Keep all eight sections: summary, motivation, goals/non-goals, proposed design,
decisions log, test plan, docs impact, and status/sign-off. Use stable requirement
IDs such as `WR-001`, and link each to acceptance evidence. A test name, fixture,
or report link is more useful than a statement that something was "verified."

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

Implementation starts only after `Finalized`. A general task-plan approval does
not finalize a document that the human has not reviewed. The agent may record an
explicit human approval; it may not approve its own FRD.

Identify the approved revision with a commit SHA or a content hash for an
uncommitted draft. Update the index and document together when status changes.
If a contract changes after approval, identify the affected requirements, append
the decision, and return that scope to review before implementing it.

For multi-stage work, distinguish core implementation from sample development
and experiments. The workflow runner and its create/deploy measurements have
separate FRDs so that completing the runner cannot silently close the experiment.

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
