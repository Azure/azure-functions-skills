# Native local comparisons

These Vally **0.16.0** experiments reuse the
[TypeScript HTTP scenario](../evals/azure-functions-create/typescript-http/README.md).
They compare the same objective task, not whether the agent invoked a skill.
Vally owns execution, grading and measurement; the existing static dashboard
consumes its canonical results. No custom agent runner, LLM judge, Azure
resources, or CI is involved.
Run only reviewed, trusted local code with an approved inference budget.
Never run these from PR-triggered CI or on untrusted contributor content.

| Definition | Conditions | Paid scenario trials |
| --- | --- | --- |
| `typescript-http-pair.experiment.yaml` | Sonnet 5, skill OFF/ON | 2 |
| `typescript-http-matrix.experiment.yaml` | Sonnet 5 and GPT-6 Astra, each OFF/ON | 4 |

These two YAML files preserve the manual definitions used for the observations
below. The convenience workflow's skill/model registration is now solely
[`local-benchmark.json`](local-benchmark.json); it does not read either proof
YAML or the repository's suite configuration.

Each cell has `runs: 1`, one worker, a ten-minute native timeout and
`max_duration`, and the same three native graders. OFF replaces the skill array
with `[]`; ON replaces it with only `azure-functions-create` and its bundled
references. Prompt, empty application fixture, MCP configuration (none), builtin
skill disabling, and grading are unchanged between each model's OFF/ON arms.
Neither model nor reasoning effort is silently substituted; reasoning effort is
left at the runtime/model default in both arms.

The experiment command does **not** accept `--max-retries`. In this pinned
version, `experiment-runner.js` does not supply a retry override and native
`pipeline/trial-runner.js` resolves `ctx.maxRetries ?? 0`: zero trial retries.
Do not add the unsupported eval-only flag. These limits are not token or money
caps; `max_turns` and `max_tokens` are not execution limits in 0.16.0.

## Local convenience commands

Configure the environment once, then run one noninteractive npm command from
this checkout. The output parent must already exist:

```powershell
$env:VALLY_RUN_ROOT = 'Q:\'
$env:VALLY_OUTPUT_ROOT = 'C:\private\benchmarks'
# Explicit acknowledgment of reviewed local code, not spending approval.
$env:VALLY_TRUSTED = '1'

# Free: stage isolated inputs and resolve the native four-cell plan.
npm run eval -- --all --dry-run
```

Before a paid run, supply `COPILOT_GITHUB_TOKEN`, `GH_TOKEN` or `GITHUB_TOKEN`
through your approved environment. With GitHub CLI installed and authenticated
to an account with Copilot access, capture its token directly into the current
PowerShell process's environment without displaying it:

```powershell
$env:COPILOT_GITHUB_TOKEN = gh auth token --hostname github.com
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:COPILOT_GITHUB_TOKEN)) {
    $env:COPILOT_GITHUB_TOKEN = $null
    throw 'Could not obtain a GitHub token. Run gh auth login --hostname github.com for an account with Copilot access, then retry.'
}

# Acquiring a token does not authorize inference spending.
# Paid: ONLY after approving the models, four trials, budget and cleanup policy.
npm run eval -- --all
```

For multiple authenticated accounts, replace the assignment with the following,
substituting the intended account for `<github-user>`, and retain the failure
check before running an evaluation:

```powershell
$env:COPILOT_GITHUB_TOKEN = gh auth token --hostname github.com --user '<github-user>'
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($env:COPILOT_GITHUB_TOKEN)) {
    $env:COPILOT_GITHUB_TOKEN = $null
    throw 'Could not obtain the selected account token. Run gh auth login --hostname github.com for that account, then retry with its --user value.'
}
```

Do **not** run `gh auth token` by itself: it prints the token to the terminal.
Keep the assignment above, do not echo the environment variable, and never put
the token in configuration files, logs or command-line arguments. Token
acquisition is a manual environment-preparation step; the wrapper itself still
does not read credential stores, and dry-runs do not need a token.

Choose `--all` **or** `--skill <registered-id>`. Omitting the selection is an
error, not implicit permission to run everything. Repeat `--models` to select
a registered subset; do not supply a comma-separated model list:

```powershell
# Alternative to --all: one skill, both configured models (four trials).
npm run eval -- --skill azure-functions-create --models claude-sonnet-5 --models gpt-6-astra

# Run without HTML: this subset has only two trials, Astra OFF/ON.
npm run eval:run -- --skill azure-functions-create --models gpt-6-astra

# Later render the printed canonical path without inference.
npm run eval:report -- --input C:\private\benchmarks\<printed-bundle>\native --output C:\reports\benchmark-site
```

Unknown/empty selections, repeated model IDs, or combining `--all` and `--skill`
are rejected before native launch. No model flags means all **registered**
models for the explicitly selected skill set. Selection preserves configuration
order; the first selected model's OFF arm is the native baseline. The initial
registration has exactly one skill/scenario and two models: `--all` means four
trials, not the legacy full/live suites.

`--run-root` (or `VALLY_RUN_ROOT`) is an **existing, clean external parent** for a fresh temporary
directory, not a previously staged trial. Choose a writable parent outside the
checkout with no discovery configuration in its ancestors (for example `/tmp`
on Linux, when clean). `VALLY_OUTPUT_ROOT` is an existing private parent for
automatically named, fresh `benchmark-<uuid>` bundles. Alternatively, `--output`
specifies one **new private bundle**, with an existing parent, outside the
checkout. Explicit flags override environment defaults. Paths are resolved
through existing links before checks; an existing bundle is never reused.
Node 24+, PowerShell 7,
npm and Functions Core Tools v4 must already be on PATH. The wrapper is Node/ESM
and cross-platform; the scenario's existing grader requires `pwsh`.

`--trusted` (or exactly `VALLY_TRUSTED=1`) acknowledges review of the checked-out configuration, eval, target
skill and executable tools. It is **not a sandbox or a budget authorization**.
Agents retain local file/shell access: use only trusted content and approve
inference spending separately. PR-triggered execution is refused. The wrapper
does not acquire tokens, copy credential stores, log tokens, provision Azure,
or configure CI. It normalizes the first available token in the order above to
`COPILOT_GITHUB_TOKEN`; a dry-run receives no token at all.

The central JSON registers model IDs, eval paths and the required files for each
skill. Its initial file list is target `SKILL.md` plus two own references
(`go-project.md`, `language-snippets.md`); no fixture is needed for this empty-app
scenario. Selected evals must follow `evals/<skill>/<scenario>/eval.yaml`.
Explicit file entries are restricted to that target's skill/references and the
declared scenarios' fixture directories; path traversal and links leaving the
repository are rejected. Registration is reviewed code, not arbitrary ingestion.

The wrapper stages only the selected evals/files and creates one temporary
native experiment definition, encoded as JSON (valid YAML). Its native model
matrix contains only selected models. The ON path uses Vally's
`${eval.grandparent}` interpolation to resolve each eval's own target skill;
OFF remains `[]`. This supports multiple registered skills without adding a
target axis or executing a custom model/skill loop. No new skill scenarios are
registered automatically when templates or legacy suites change.

The wrapper checks discovery ancestors, creates
separate empty cwd/home/config/appdata/cache/temp directories, and constructs an
OS/executable environment allowlist. It excludes inherited SSH agents, Azure
credentials, Copilot overrides, plugins/MCP settings and npm configuration.
Both arms disable the two builtin skills using the scenario's native settings;
Vally supplies fresh per-trial workspaces/config and the OFF/ON skill arrays.
These controls prevent ambient discovery, not malicious code from escaping.

Dependency installation inside trials defaults to the public HTTPS npm registry
with empty user/global npm config and a fresh cache. If an approved registry is
required, explicitly set `VALLY_NPM_REGISTRY` or add
`--registry https://your-approved-registry/` to either run command;
credential-bearing URLs are rejected. Normal `.npmrc` files and
registry credentials are not inherited.

The wrapper executes the **selected native matrix once** as shard `1/1` with a
fresh UUID, one worker and `--require-pass`. Native `experiment merge` then
converts that single complete shard into the canonical experiment output used
by `eval:report`. This is necessary because even an unsharded 0.16.0 run writes
`shard-manifest.json`, not `experiment-manifest.json`. There is no model loop,
custom merge, retry, comparison judge or additional inference in reporting.

```text
<private-bundle>/
  raw/<run-id>/shard-1-of-1/   Native originals, including session logs/patches
  native/                    Native merged canonical results
  site/                      index.html + logo (only with npm run eval)
```

**Only `site/` is a publication candidate**, after review. Never publish the
bundle, `raw/`, `native/` or native `report.md`: these contain private prompts,
paths and logs. `eval:run` prints the canonical path for later `eval:report`.
Completed native grader failures can still produce a dashboard, but the
command preserves the nonzero run/merge exit. Missing manifests, launch errors
or invalid report input fail explicitly and retain the native partial files;
they never produce an empty success dashboard.

The wrapper removes only its freshly owned staging/profile/trial directory in
`finally` after native return, not the private bundle or the parent directory.
Vally and the existing grader own agent/host cleanup; no shared processes are
stopped. A filesystem cleanup failure is reported with the abandoned directory
and private output paths; it makes the workflow nonzero without replacing a
primary native error or discarding valid results. Native run/merge exits remain
separate from the overall workflow exit. A forced process/OS termination can bypass `finally`: inspect owned
process identities before manually removing the abandoned `vally-local-*`
directory. Never delete other sessions' roots or stop hosts by name.

A dry-run generates **no bundle, trial measurement or dashboard**. It validates
native resolution and wrapper wiring, not inference, model access or grading.
The four real observations below predate this wrapper; they were not rerun to
validate these convenience commands.

## Manual native isolation protocol

The commands in this section are advanced manual operations, not replacements
for the wrapper's isolation. Do not execute them from a developer checkout or normal profile.
Follow the scenario's **Isolation protocol**, including its environment
allowlist, empty HOME/USERPROFILE/config/temp directories, ancestry checks,
bundled runtime, and native ON/OFF discovery checks. Both conditions must show
the expected **enabled** inventory before spending inference.

Stage only these trusted inputs under a new external root, preserving this
relative layout:

```text
inputs/
  experiments/<chosen-definition>.experiment.yaml
  evals/azure-functions-create/typescript-http/eval.yaml
  templates/skills/azure-functions-create/
```

Copy only the selected YAML files and the target skill's files. Do not copy the
repository, its `.vally.yaml`, AGENTS.md, other skills, plugins, or user config.
This matters because `experiment run` resolves project configuration from the
experiment file's directory, not merely the shell cwd. The staged inputs must
also have clean discovery ancestors. Keep the input tree separate from trial
workspaces and the empty shell cwd.

Use an absolute path to the installed Vally entrypoint (`$vally`), the staged
definition (`$experiment`), unused workspace root (`$freshWorkspaces`), and a
private output directory (`$results`). Unlike `vally eval`, this command has no
`--work-dir`: the staged definition plus `--workspace` provide the separation.

```powershell
node $vally experiment run $experiment --dry-run
node $vally experiment run $experiment --workspace $freshWorkspaces `
  --output-dir $results --workers 1 --require-pass
```

The second command spends two or four trials depending on the selected file.
Inspect the dry-run's exact models and number of plans first. Confirm model
availability with the same runtime/account without sending an inference prompt.
**Do not pipe `/model` to Copilot stdin**: CLI 1.0.80 treats redirected stdin as a
noninteractive prompt, not an interactive slash command.

Never add `--compare`: it invokes an additional LLM judge. Native graders,
summaries, and deterministic arithmetic are sufficient here.

## Sequential matrix without repeating the Sonnet pair

The fixed matrix also supports a budget-saving native continuation. Declare
both models before execution, but execute only the Sonnet pair first. With
this exact matrix, native `by-stimulus` sorts the variants into OFF/Sonnet,
OFF/Astra, ON/Sonnet, ON/Astra. Shard 1/2 therefore selects both Sonnet cells;
shard 2/2 selects both Astra cells. This mapping depends on the variant names:
recheck native selection if changing the definition.

Keep one unchanged staged matrix/eval/skill tree and the same run ID throughout.
Use distinct, unused workspace roots for the two shards. A new isolated profile
may be used, but configuration values, tools, and environment policy must match.

```powershell
$runId = [guid]::NewGuid().ToString()
node $vally experiment run $experiment --dry-run
node $vally experiment run $experiment --shard 1/2 --run-id $runId `
  --shard-strategy by-stimulus --workspace $freshSonnetWorkspaces `
  --output-dir $results --workers 1 --require-pass
```

Stop and inspect both Sonnet trial records, their individual grader verdicts,
effective workspace/skill isolation, and owned-process cleanup before continuing.
A shard's console verdict is partial, not a four-cell result. A failed baseline
is a measured outcome, not permission to tune only that arm or retry indefinitely.
Proceed to Astra only after the paired stage is accepted:

```powershell
node $vally experiment run $experiment --shard 2/2 --run-id $runId `
  --shard-strategy by-stimulus --workspace $freshAstraWorkspaces `
  --output-dir $results --workers 1 --require-pass
node $vally experiment merge `
  (Join-Path $results "$runId\shard-1-of-2") `
  (Join-Path $results "$runId\shard-2-of-2") `
  --output-dir $mergedResults --require-pass
```

`$mergedResults` must be outside both input shard directories. Merge performs no
inference: Vally checks run identity, experiment/config/eval hashes, full-plan
digest, identical plan snapshots, and an exhaustive, nonoverlapping partition.
It preserves the native trial records and regenerates summaries/reporting.
Do not manually combine records or reuse an unrelated standalone pair as matrix
samples. There is no configured deterministic model seed.

Preserve native outputs privately before deleting owned trial applications,
profiles, and caches. Inspect surviving processes using owned PID **and creation
time**, not names or PID alone; never stop shared hosts or emulators.

## Native artifact contract

The observed sharded run writes:

```text
<run-id>/shard-1-of-2/
  shard-manifest.json
  plan-snapshot.json
  <variant>/
    results.jsonl
    run-summary.jsonl
    <eval>/<stimulus>/<model>/0/
      events.jsonl
      metadata.json
      workspace.patch
```

The second shard has the same structure. The merged directory contains
`experiment-manifest.json`, `plan-snapshot.json`, `report.md`, and each variant's
`results.jsonl` and `run-summary.jsonl`. Merge does not copy per-session logs;
keep the original shard directories too.

`results.jsonl` contains native `trial-result` records. Use their `variant`,
`model`, `evalName`, `stimulus`, `status`, `gradeResult.passed`,
`gradeResult.score`, `gradeResult.details`, and `trajectory.metrics`.
`experiment` carries run/variant/baseline identity plus eval/config hashes.
`shardKey` is the native unique sample identity. The observed one-run records
omit top-level `trialIndex` and `totalTrials`; do not require those fields or
invent values for missing metrics.

**Unlike standalone `vally eval`, experiment `run-summary.jsonl` is provenance,
not a verdict.** Its record type is `experiment-run-summary`, with
`experiment`, `runId`, `variant`, `evalFile`, `evalHash`, `configHash`,
`resolvedDefaults`, `resolvedEnvironment`, `experimentFile`, `experimentHash`,
`vallyVersion`, and `timestamp`. Environment values are redacted; skill paths can
still be absolute/private. Native graded verdicts are in the trial records;
the authoritative whole-run aggregation is rendered by native merge in
`report.md`.

Shards write empty result files and configuration summaries even for unselected
variants. The console can label these unexecuted cells "grader(s) failed" and
show `0/2` for the other model. Do **not** turn that console text or a provenance
record into failed samples. Inspect `selectedShardKeys`, `completedShardKeys`,
and actual trial records; distinguish unexecuted, execution-error, and graded
failure. Never count both original shard and merged copies of the same sample.

The matrix's native global `baseline` is Sonnet/OFF. A same-model skill comparison
must pair each model's OFF with that model's ON, not compare Astra against the
global Sonnet baseline.

Use only native metrics. `totalTokens = inputTokens + outputTokens`; do not add
cache reads/writes again. Native `cost` uses provider `github-copilot` and unit
`nano-aiu`, not currency. `durationMs` includes the whole trial;
`trajectory.metrics.wallTimeMs` is trajectory wall time. See the scenario's
metric reference for units and discovery caveats.

In particular, `trajectory.metadata.skillsLoaded` includes disabled builtin
names and is not an effective skill inventory. Native CLI discovery through
`COPILOT_SKILLS_DIRS` also splits comma-containing matrix workspace paths. A
temporary comma-free junction to the **same actual target directory**, with
the same per-trial settings, permits a read-only native listing on Windows.
Remove that diagnostic junction afterward. Vally's executor passes the actual
paths as a `skillDirectories` **array**, not through this environment variable;
do not pass the diagnostic override into paid trials.

## Local observation (2026-09-10)

The native two-shard execution and native merge completed all four scenario
trials with Copilot 1.0.80, Node 24.18.1, and Functions Core Tools 4.10.0.
Each cell passed all three graders with score **1**, including the independent
build and both real HTTP requests. No trial was retried.

| Model | Skill | Total tokens | Turns | Tool calls | Wall time (ms) | Activations |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| claude-sonnet-5 | OFF | 409257 | 21 | 20 | 123694 | 0 |
| claude-sonnet-5 | ON | 835663 | 32 | 31 | 245884 | 1 |
| gpt-6-astra | OFF | 116376 | 9 | 8 | 85939 | 0 |
| gpt-6-astra | ON | 281764 | 13 | 17 | 137202 | 1 |

All four native `errorCount` values were 0. Both ON activations were the target
skill. ON used more tokens and wall time for both models in this observation.
With one trial per cell, these results do not establish statistical superiority
or reliability. The separate first-layer standalone proof is not an additional
sample in this comparison.

One accidental model-discovery invocation preceded these experiments: piping
`/model` and `/exit` into the CLI caused a noninteractive inference, reported as
5.53 AI credits. It is recorded separately in the private execution record, not
hidden in the budget or included in the four benchmark samples. Model availability
was then checked with a temporary, read-only call to the already-installed SDK's
`listModels` (no session creation or prompt). No SDK runner was added.

Native originals, including the merged report, remain private because they
contain prompts, local paths, and command output. Only the native metric values
above are reproduced here.

## Evaluation asset classification

Inspection found no obsolete custom evaluation framework to delete.

| Classification | Assets | Reason |
| --- | --- | --- |
| REUSE | `local-benchmark.json`, TypeScript HTTP eval/grader | Central registration plus native objective local grading; no independent runner. |
| REUSE | Matrix/pair YAML | Historical manual proof definitions, not configuration read by the convenience workflow. |
| REUSE | `src/evaluation/report.ts`, `dashboard/`, report tests | Small deterministic native-result adapter and static UI; no backend or database. |
| REUSE | Other `evals/` YAML, fixtures and `_base/common-graders.yaml` | Existing routing/behavior/live coverage and reference graders, distinct from this target-only benchmark. |
| REUSE | `.vally.yaml`, `eval:suites`, `eval:smoke`, `eval:full`, existing evaluation/cleanup workflows | Preserve existing suite scope and reviewer-gated live behavior; not an isolated OFF baseline. |
| REUSE | `src/telemetry/` and generated hook assets | Product telemetry, not a custom evaluation measurement system. |
| DELETE | None | No custom SDK runner, model loop, trajectory parser, result DB or dashboard service was found. |
| UNKNOWN | None in the inspected evaluation assets | No speculative removal or compatibility layer is needed. |

The old `npm run eval` root-suite alias is now named `npm run eval:suites`.
Existing smoke/full commands and workflow invocations are unchanged.
