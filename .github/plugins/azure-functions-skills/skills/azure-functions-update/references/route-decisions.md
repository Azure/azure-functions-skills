# Choose stages from observed risks

These are proposed decision rules, not claims from measured migration trials.
Use the support facts in [the .NET reference](dotnet.md). Record the facts, rejected
alternative, expected benefit, and proof required for each selected stage.

| Observation | Decision and reason | Evidence before acceptance |
| --- | --- | --- |
| Only the selected SDK changes; TFM and model stay fixed | Treat this as a toolchain check, not runtime migration. Avoid adding a code stage unless it isolates a real failure | Effective SDK, unchanged TFM, original build/tests and their executing runtime |
| Model conversion and TFM update affect different contracts; a same-TFM isolated state supports all required packages | Prefer considering a same-TFM model checkpoint to separate causes of regression | Supported intermediate tuple, bounded support window, model/serialization/binding checks, then TFM checks |
| No supported intermediate exists, or target-required packages cannot resolve there | Consider one coherent conversion checkpoint; do not manufacture an unsupported intermediate | Supported final tuple, resolved graphs, original contract probes, and rollback point |
| Baseline has unknown behavior or failing tests | Investigate or propose a conditional baseline, not a sequence chosen to hide failures | Classified cause, substitute contract, explicit risk acceptance |
| Shared libraries have other consumers | Determine whether project/model/TFM changes affect those consumers; isolate Functions-specific changes where feasible | Reference paths, consumer compatibility and selected checks; unknown external consumers remain an acceptance gap |
| Already isolated, bounded extension update, no host/TFM/platform change | Prefer one compact checkpoint and only affected contract checks | Version-specific change evidence, relevant existing tests, and the final agreed E2E |
| New TFM needs a different SKU | Separate code compatibility from platform migration | User-approved platform handoff; no silent SKU change |

Do not select the same-TFM route merely because it is familiar. Confirm that it can
build with the selected worker/extensions and remain supported during the work.
Do not select a combined route merely to save steps. Confirm that failures can be
diagnosed with available probes and that recovery is practical.
If facts support neither route, ask a focused question or investigate; do not guess.

Use a concrete explanation, such as:

```text
Observed: worker conversion changes HTTP serialization; the baseline has accepted
HTTP fixtures. The current TFM supports the required isolated packages.
Proposed: first isolate at the same TFM, compare those fixtures through the host,
then change TFM. This separates model regressions from framework regressions.
Condition: the intermediate support window and final target remain acceptable.
```

This example is a decision pattern, not a claim about the current customer's app.
The expert's original reasons for the initial sequence remain to be collected.

For a small update, keep the plan, requirement rows, permission references, and packet
in one artifact. The same agent can plan and execute, regardless of migration size.
More documents or agents are not evidence of quality. Preserve gates and final E2E.
