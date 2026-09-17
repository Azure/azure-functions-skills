# Azure Functions update: rationale for a future PR

Status: Draft notes for author input, 2026-09-17. No PR has been created or edited.
The unanswered questions below do not block the current skill draft.

## Confirmed motivation

The user wants an improvement over a strong model without this skill: a smoother,
reliable migration, useful human guidance, final E2E evidence, and an accurate report
of what cannot complete. Token, cache, time, and cost data remain useful secondary
measurements. An earlier knowledge-focused skill did not establish the desired broad
advantage in the observed comparison. That does not prove that all knowledge skills
are ineffective.

The repository and baseline are selected at use time. The agent asks when the target
is unclear, inspects the approved target, and confirms a supported destination after
research. It asks the user about behavior contracts, using code/test examples to help.
Past expert corrections will be collected over time; no initial catalog is required.

**Clarification:** Subagents are optional. The requirement is a plan that even a weaker
model could execute without external-document lookup or repeated migration research.
The same agent can plan and execute the full migration. It still reads target code and
actual results. Unexpected facts return the work to planning, where new research can
revise the plan. This is a plan-quality requirement, not a multi-agent architecture.

## Questions about the author's original stage order

These are questions for later answers, not inferred expert statements.

| ID | Topic | Information to add |
| --- | --- | --- |
| R1 | Initial build with a newer .NET environment | Was the primary goal to separate SDK/toolchain failures, assess target API compatibility, or establish another fact? Distinguish a newer SDK with the old TFM from an actual TFM update. |
| R2 | Build/test before model conversion | Which failures should this boundary isolate, and what evidence makes it safe to continue? |
| R3 | Same-TFM isolation versus a combined conversion | Which code/dependency/test characteristics would make the extra stage useful, and when would it add work without useful evidence? |
| R4 | Self-contained execution plan | Beyond the agreed fields, which concrete domain decisions or instructions would make a plan usable by a weaker model without external lookup? Agent count is already settled as optional. |
| R5 | Final E2E and partial completion | Which business paths should be demonstrated first, and how should a customer receive a useful handoff when a required environment is unavailable? |

Author answers: Pending. Add real examples when available. Do not label synthetic
examples or proposed decision rules as observed customer outcomes.

## Proposed explanation, subject to those answers

The draft now connects observed facts to stage choices and selected probes. A
requirement record connects authority, applicability, changed files, and actual proof.
This addresses a possible failure in which an agent finds a requirement but does not
apply it. For small updates, the same gates fit one compact plan/packet without forced
delegation. Single-agent execution is valid at any size. These are hypotheses for
improving reliability, not measured results.

Safety boundaries remain intact. Skill text cannot supply runner enforcement, disclose
unknown processor retention, or authorize an external action.

## Evaluation intent for the PR

Reuse [the native local comparison framework](../../../../experiments/README.md),
not a new runner or dashboard. Its
[report adapter](../../../../src/evaluation/report.ts) currently reads `totalTokens`,
`turnCount`, `toolCallCount`, `wallTimeMs`, `errorCount`, and `skillActivationCount`.
Keep native artifacts and any available cache/cost fields. Missing measurements stay
unknown. The current registered benchmark is not an update migration benchmark.

Before adding/running the future update scenario, define:

- Identical input app/revision, task goal, model/effort, tools, permission rules, and
  customer-answer policy for ON and OFF. Keep OFF free of target and ambient skills.
- Final E2E for the accepted contracts, with actual outputs and named environment.
- A source- and artifact-grounded LLM judge for migration correctness, applicable
  current best practices, and usability. Hide condition labels where practical.
- Human guidance criteria: necessary questions, clear options, timely confirmation,
  useful recovery, customer corrections, and avoidable repeated requests.
- Separate outcomes for autonomous success, human-assisted success, correct blocking,
  and false completion. Do not grade required skill-specific formatting as app quality.
- Separate reporting of advisory best-practice gaps, approved exceptions, real test
  failures, and environment/runner blocks. A judge must not fabricate a passing test.
- Later repetitions and cases that test whether the result generalizes. One pair
  remains a case observation. Keep prompt-only and helper-tool comparisons distinct.

Actual human sessions provide evidence about customer experience. A simulated customer
can test response policy, but is not proof of real customer usability.
The target, spending limit, repetitions, and owned-resource cleanup need their own
approval before paid trials. No trial is authorized by these notes.
