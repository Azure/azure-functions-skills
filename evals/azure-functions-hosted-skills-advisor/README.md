# Hosted skills advisor evaluation

This manual Vally suite checks source-only recommendations and restraint. It does
not deploy apps, execute fixture applications, or call a hosted skill's model.
The evaluation agent itself uses a model and incurs usage charges. CI must not run it.

| Case | Expected behavior |
| --- | --- |
| Expense interpretation | Find varied-format amount extraction and semantic category/policy selection; retain exact limits and approval checks in code. |
| Delivery failures | Find failed Service Bus deliveries without a recovery consumer; suggest deterministic known-format fixes first and bounded, schema-validated recovery for residual failures. Preserve the valid-record fast path. |
| Plain CRUD | Report zero opportunities for HTTP/Blob CRUD and ordinary JSON/field validation. |
| .NET isolated | Identify the isolated worker, cite the triage code, and include a C# sketch. Recommend the in-app Hosted Skills integration, never an HTTP call to a separate Python skill. |
| Node.js | Detect the v4 HTTP registration; label native adoption unsupported instead of fabricating a binding or migrating the app. |

Every case requires skill invocation, a workspace Markdown report, completion, and
byte-for-byte preservation of the provided customer files. SHA-256 baselines also
detect unexpected non-hidden files besides the report. Harness-owned hidden
directories are excluded from that directory check. Each grader must pass
(`threshold: 1.0`). Keyword graders are smoke checks, not a substitute for reading
the reports against the review criteria below.

## Fixture provenance

The Python positive fixtures are purpose-written reconstructions of the behavior
before adding a hosted skill, not copies of historical upstream implementations.
Both repositories already have hosted skills in their first implementation commit.
Their initial commits contain no earlier deterministic application.

- [Expense processor at f1e3b1e](https://github.com/Azure-Samples/hosted-skills-expense-processor/tree/f1e3b1e24b0b42488ee91fc3b0392762cd20fedb):
  studied the README, `src/function_app.py`, `src/expense_processor.agent.md`,
  policy documents, and repository history. The fixture models the regex amount
  parser and keyword categorizer that hosted interpretation can replace. Its
  numeric travel/equipment caps are illustrative fixture rules, not a claim about
  every upstream policy. The free-text flight, monitor, and client-dinner inputs
  preserve the sample's contrasting scenarios.
- [Delivery recovery at 5e15fdb](https://github.com/greenie-msft/hosted-skills-delivery-recovery/tree/5e15fdb4251236a8e4d719be885425da4cf29dae):
  studied the README, ingestion handler, `src/dlq_repair.agent.md`, record schema,
  and message examples. The fixture preserves required record identity/source/value,
  rejection of camel-case IDs and numeric strings, source normalization, and output
  persistence, but omits the hosted recovery consumer. It uses three deliveries
  instead of the demo's one to expose exhausted fixed retries. It simplifies schema
  validation and Blob naming, and omits the web UI, tracking, MCP, and Azure setup.

The CRUD, .NET, and Node.js fixtures are synthetic controls. Fixtures are static
analysis inputs, not deployable copies of the reference samples. Do not describe a
passing reconstructed-fixture run as a run against original upstream repositories.
For an original customer baseline, supply its reviewed pre-hosted revision separately.

`fixtures/AGENTS.md` constrains the agent to read-only assessment plus the report.
`baseline.json` files contain SHA-256 digests of the files mapped into each trial.
When changing a fixture, update its matching digest and review why it changed.

For a buildable C# Blob-triggered app with varied partner catalog inputs, see the
[partner catalog sample](../../samples/partner-catalog/README.md). Its README shows
how to run the updated local advisor in a source-only workspace. This sample is
for an interactive assessment; it is not an additional case in this Vally suite.

## Run

Use the repository's existing Vally version. Run from the repository root with
outputs and isolated trial workspaces outside the checkout:

```bash
npx @microsoft/vally-cli@0.16.0 lint \
  --eval-spec evals/azure-functions-hosted-skills-advisor/eval.yaml
```

Before a model-backed run, confirm the target cases/model, budget, repetition count,
and owned-resource cleanup policy separately. Run only on reviewed, trusted content.
No Azure resources should be created; keep reports for review and stop any processes.
Do not add PR-triggered evaluation CI.

```bash
npx @microsoft/vally-cli@0.16.0 eval \
  --eval-spec evals/azure-functions-hosted-skills-advisor/eval.yaml \
  --output-dir <out-dir> --workspace <workspace-dir>
```

The default is one run per case with `claude-sonnet-5.5` and a ten-minute timeout.
To narrow the cases, add `--tag area=samples`, `--tag area=restraint`, or
`--tag area=languages`. An all-case run is five model-backed trials.

If the Azure Artifacts feed returns E401, follow `AGENTS.md`: use the installed
`artifacts-npm-credprovider`, then retry. If it is unavailable or needs interaction,
ask the user to configure it or complete sign-in. Do not change the registry or
remove `.npmrc`.

## Review the reports

For each positive finding, verify a real source line, current behavior, a specific
judgment task, a "What's limited today" list followed by "How a hosted skill helps",
the app-language sketch, no priority or confidence labels, and preview
API limitations. Check that cost, latency, non-determinism, validation, and fallback
are explained. Reject reports that move all traffic through a model, delegate exact
compliance limits, or promise repairs without durable quarantine and replay bounds.

For delivery recovery, a recommendation to deterministically handle only the two
known mismatches is reasonable. A hosted fallback must be conditional on residual
ambiguity or wider format variation; the fixture alone does not prove that an LLM
is needed for those two mappings. The suite expects the recovery boundary to be
identified, while this review decides whether the proposed adoption is justified.

For CRUD, require zero findings. For unsupported languages, require accurate language and model
detection and explicit native-adoption blockers. Inspect the saved workspace to
confirm only the report was added.
