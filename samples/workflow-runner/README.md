# Workflow runner comparisons

These samples compare **real agents**, not just fixed DAG execution time.
No measured token-savings claim or live Azure result is included with the
implementation. Actual experiments require a reviewed revision and separate
execution approval.

| Scenario | A | B | C |
| --- | --- | --- | --- |
| Create | Existing create skill | Explicit runner opt-in | Same existing template CLI helper, without a DAG |
| Deploy | Existing deploy skill | Explicit runner opt-in | Not included |

The initial workload is TypeScript, HTTP, and Flex Consumption. Create and deploy
are **separate sessions**. Deploy always starts from the official quickstart at
`cba392291ff7b6c994548aabaa8c06eb4055be54`, never a create trial's output.
The generated user request is identical across arms; the trial policy and
availability of the explicit workflow skill are the treatment.

The agent does its own discovery, decision-making, plan authoring, and recovery.
The runner never calls a model. B and C can use the existing
`azure-functions-skills template apply` implementation rather than introducing
a second materializer. Neither may bypass the original MCP discovery or the
Azure prepare/validate/deploy skill chain. Record template/helper mismatches;
do not quietly substitute a different task to obtain favorable numbers.

## Safe local recovery demonstration

Use a new empty workspace. These fixtures run only Node.js, write
`execution-count.txt`, and deliberately fail the `finish` node:

```powershell
node .\bin\azure-functions-skills.js workflow run --plan .\samples\workflow-runner\recovery\plan.json --dir <isolated-workspace>
node .\bin\azure-functions-skills.js workflow run --plan .\samples\workflow-runner\recovery\revised.json --dir <isolated-workspace> --from <returned-run-id> --reuse prepare
```

The first invocation exits 1; the revised invocation succeeds. The counter
contains exactly one `x`, and the imported node records `reusedFrom`. This
demonstrates recovery correctness, **not** token savings.

## Prepare the real-agent specimens without executing them

Build with `npm run compile`. Create a private configuration matching
`src/workflow-evaluation/spec.ts`:

| Field | Required value |
| --- | --- |
| `version` | `1` |
| `model` | One explicitly selected model |
| `repetitions` | `1` or `3` per arm |
| `reviewedSha` | Reviewed default-branch Functions Skills commit, 40 hex characters |
| `azureSkillsRoot`, `azureSkillsSha` | Local skills directory in a reviewed Azure Skills checkout and its immutable commit |
| `mcpVersion` | Exact Azure MCP npm version, not `latest` |
| `subscriptionId`, `location` | Approved target; no credentials in this file |
| `budgetUsd` | Positive approved envelope; not a real-time billing hard cap |
| `minimumTokenReduction` | Predeclared useful reduction between 0 and 1 |
| `cacheAccounting` | `unknown`, `included-in-input`, or `separate-input` |
| `cacheAccountingEvidence` | Required provider/version evidence when accounting is not unknown |

```powershell
node .\lib\workflow-evaluation\cli.js prepare --config <private-config.json> --scenario create --outdir .\results\workflow-runner\create-prepared
node .\lib\workflow-evaluation\cli.js prepare --config <private-config.json> --scenario deploy --outdir .\results\workflow-runner\deploy-prepared
```

Preparation writes isolated `eval.yaml` files, trial policies, B's explicit stdio
MCP configuration, and a manifest. It does not start agents, contact MCP, or
create Azure resources. Outputs are exclusive-created, not overwritten.
The specimens live outside normal `evals` discovery and use the
`workflow-benchmark` tier, so existing scheduled suites are unchanged.

Lint generated specimens with the existing `vally lint --eval-spec <directory>`.
Do not execute them on unreviewed PR/worktree code.

## Approved execution

Use the manual [Workflow Runner Benchmark](../../../.github/workflows/workflow-runner-benchmark.yml)
workflow from a reviewed default-branch commit. It uses the existing
`functions-skills-live-e2e` environment and its required reviewers. Implementation
approval is not authorization to spend Azure or model credits.

Before approval, confirm FC1 availability/quota, least-privilege identity,
subscription/region, code and skill revisions, model/count/budget, cache semantics,
and deletion policy. The cost field is an approval record, **not** an instantaneous
hard spending cap. Count, resource, and elapsed-time limits provide additional
bounds. Missing configuration or failed measurement preflight stops execution.
Later measurement gaps remain explicit trial records rather than aborting the
approved schedule; they prevent an adoption conclusion. Cleanup failures still
stop subsequent trials.

Configure the existing Azure identity variables and these environment variables:

| Variable | Purpose |
| --- | --- |
| `BENCHMARK_APPROVED_SHA` | Reviewer-maintained approved Functions Skills SHA; must match the dispatched commit, never assigned from the run itself |
| `BENCHMARK_AZURE_LOCATION` | Approved FC1 region |
| `BENCHMARK_AZURE_SKILLS_REPOSITORY` | Reviewed Azure Skills source repository |
| `BENCHMARK_AZURE_SKILLS_SUBPATH` | Directory containing the three Azure skills in that checkout |
| `BENCHMARK_NODE_VERSION` | Exact compatible Copilot host Node version; follow the repository's Node 24+ requirement |
| `BENCHMARK_WORKER_NODE_VERSION` | Exact Node 22 Functions worker version, separate from the agent host |
| `BENCHMARK_AZ_CLI_VERSION`, `BENCHMARK_AZD_VERSION`, `BENCHMARK_FUNC_VERSION` | Exact prerequisite versions |
| `BENCHMARK_AZURITE_IMAGE` | Reviewed, digest-pinned Azurite image for isolated CI |

Do not reuse or install local machine emulators for this CI experiment. On a
developer workstation, use only the already-approved local emulator. The
independent local probe owns a temporary Functions host on a free port and stops
it after a bounded request; a long-lived host is not a DAG node.

Trials execute serially, rotating A/B/C order (or A/B for deploy). Each deployment
gets a fresh RG, azd environment, ownership UUID and tags. The manifest precedes
provisioning. Cleanup checks ownership, waits for deletion, and verifies absence
before another trial starts. The existing scheduled cleanup is only a
reviewer-gated safety net, not a guarantee of automatic removal.

## Measurements and reports

Before Azure authentication/provisioning, a small approved model call verifies
usage capture with the same executor as all arms. Its sanitized `preflight.json`
is reported separately, not charged to an arm's token count. Comparative execution
requires evidence-backed cache semantics; `unknown` is valid only for offline preparation.

The `workflow-measured-copilot` executor plugin wraps an instance of Vally's built-in
`copilot-sdk` implementation; the unused default executor is not started. Its bounded, private sidecar
observes raw events because ephemeral usage can be absent from native session logs.
The collector correlates the sidecar with the trial's session and requested model.
It also reads matching persisted SDK session logs for shutdown totals, which may
arrive after live callbacks disconnect. Otherwise it sums raw `assistant.usage`
events, never normalized synthetic zeros. Pairing requires the same accounting source
and observed model; calibration records provider-resolved model names separately
from the requested alias. Missing input/output or cache components stay null,
with partial-call counts and observed costs retained. Optional reasoning counts
are a separate breakdown, never automatically added to output tokens. A failed
capture may retain observed input/output costs but cannot establish a complete total.
Use `--executor-plugin <compiled-executor.js>` and a unique `WORKFLOW_USAGE_DIR`
for each invocation. Pass `--max-retries 0`: automatic whole-trial replays could
duplicate Azure effects and hide paid failed attempts. A retry needs a separately
approved trial, not selection of the cheapest surviving capture.
Do not use Vally's `--output jsonl`: that writes stdout,
whereas the collector reads the default timestamped `results.jsonl` file.

Agent latency uses executor start/completion timestamps, including discovery,
planning, intermediate operations, and recovery, not just DAG execution time.
Vally's whole-trial `durationMs` is recorded separately; neither includes the
external cleanup phase. Model calls, completed agent turns, and tool calls are
different quantities. Static graders and independent probes use no grader model.

`hostToolResultBytes` measures serialized raw SDK tool-result data, not tokenizer
input or a guarantee about what the provider finally receives. Runner evidence
separately counts runs, newly executed attempts, retries, fallbacks, imported nodes,
runs with reuse, unknown nodes, and tracked output-artifact bytes. Imported receipts
are not counted as new attempts. Multiple runs do not automatically imply a replan;
inspect private receipts for that interpretation. Keep runner state under the trial
workspace root until collection finishes. Unused B treatment or runner use in A/C
invalidates a savings comparison without hiding the independently measured goal outcome.

Quality requires the normal skill chain and independent files/build/HTTP checks.
The local build/host uses the pinned worker executable, not the agent's Node version.
Deployment additionally checks the actual Node 22 runtime, FC1 plan, HTTPS-only configuration,
managed identity, function authorization, and authenticated HTTP response.
Function keys remain inside the probe and are not returned to the agent/report.
Receipts are execution evidence, not proof that an external resource exists.

The workflow collects `trial.json` records and Markdown/HTML/JSON comparisons.
It retains failed trials in totals and computes reduction only for matching,
successful pairs. Different provenance, missing trials, uncertain accounting, or
unconfirmed cleanup cannot become a favorable complete report. Review the
per-trial data and failures before making an adoption decision.

Raw session logs, commands, responses, and private config stay out of git and
uploaded artifacts. Upload only allowlisted records and generated comparisons.
After approved trials, place the reviewed English conclusion in
`docs/reports/workflow-runner-evaluation.md` and link the approved run.

See [FRD-0001](../../../docs/frds/0001-workflow-runner.md) for the runner contract
and [FRD-0002](../../../docs/frds/0002-workflow-create-deploy-evaluation.md) for the
experiment and its remaining authorization gates.
