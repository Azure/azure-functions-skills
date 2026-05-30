# Skill evaluation (Vally)

This directory holds [Vally](https://aka.ms/vally) (`@microsoft/vally-cli`) evaluation
suites for the skills shipped from `templates/skills/`. Each subdirectory targets a
single skill and contains an `eval.yaml` defining stimuli, graders, and configuration.

> Source / docs: <https://aka.ms/vally> · npm: [`@microsoft/vally-cli`](https://www.npmjs.com/package/@microsoft/vally-cli)

## Prerequisites

- **Node.js 22+** (required by Vally; the rest of the repo targets Node 18+ but Vally
  itself does not get bundled into the published package — it is dev-only).
- **GitHub Copilot CLI authentication**:
  - Local: `gh auth login` (Vally reuses your `gh` session).
  - CI: the workflow uses the existing `functions-skills-live-e2e`
    GitHub Environment and consumes the existing `COPILOT_CLI_TOKEN`
    secret, mapping it onto `COPILOT_GITHUB_TOKEN` (the variable name
    that `@github/copilot-sdk` reads). The token is set at **step level**
    on the eval step only, so checkout / install / pre-warm / artifact
    upload do not see it. Protected-branches policy + `azure-functions-bucees-team`
    reviewers on the environment gate every run.
- Run from the repository root so the relative paths in `.vally.yaml` resolve.

## Running

```bash
# PR gate / smoke — routing checks only (cheapest)
npx vally eval --suite smoke

# Single skill, single spec
npx vally eval --eval-spec evals/azure-functions-create/eval.yaml

# Full nightly run (all stimuli including LLM-backed graders)
npx vally eval --suite full

# Realistic user-experience check with Opus 4.7
# (eval.yaml default is claude-sonnet-4.6 for cost/speed; override per-run with --model)
npx vally eval --suite full --model claude-opus-4.7

# Static-only checks (no LLM calls, no agent execution)
npx vally lint
```

Output lands in `./results/` by default:

- `results.jsonl` — one record per stimulus/run with grader outcomes.
- `eval-results.md` — human-readable summary.

## Suite layout

Defined in [`.vally.yaml`](../.vally.yaml) at the repo root:

| suite | filter | use |
| --- | --- | --- |
| `smoke` | `tier: smoke` | quick routing checks |
| `pr` | `tier: smoke` | PR gate (alias of smoke) |
| `triggers` | `area: routing` | all skill-invocation/routing checks |
| `integration` | `type: integration` | LLM-backed behavior tests |
| `full` | `tier: [smoke, full]` | everything **except** live — nightly |
| `live` | `tier: live` | **Tier 3 — deploys real Azure resources.** Manual / nightly only, via the dedicated [Skill Evaluation - Vally Live](../.github/workflows/skill-evaluation-vally-live.yml) workflow |

## Authoring conventions

- One `eval.yaml` per skill under `evals/<skill-name>/`.
- Tag every stimulus with at least:
  - `type: integration`
  - `skill: <skill-name>`
  - `tier: smoke | full`
  - `area: routing | response-quality | handoff`
  - `cost: free | llm`
- **Duplicate the global graders into every stimulus.** Vally (`evaluate#125`)
  does not yet support eval-level graders. See [`_base/common-graders.yaml`](_base/common-graders.yaml)
  for the canonical copies (it is a reference file — **not** consumed by Vally).
- For routing stimuli using the `skill-invocation` grader, prefer `runs: 5` and
  `scoring.threshold: 0.8` so the metric measures invocation rate.
- Response-quality stimuli typically use `runs: 1`.

## CI runner prerequisites

The `Skill Evaluation - Vally` workflow installs the following before running
evals, so any stimulus that triggers a prerequisite check (e.g. the
`azure-functions-setup` eval) reflects the agent / skill behavior rather than a
missing runner tool:

| Tool | Provided by |
| --- | --- |
| Node.js 22 | `actions/setup-node@v4` |
| `npm` | Node.js |
| `az` (Azure CLI) | runner image (pre-installed) |
| `python3` | runner image (pre-installed) |
| `dotnet` | runner image (pre-installed) |
| `func` (Azure Functions Core Tools 4.x) | `npm install -g azure-functions-core-tools@4` step |
| `azd` (Azure Developer CLI) | `https://aka.ms/install-azd.sh` step |

The workflow runs `Verify prerequisites` immediately after these installs, so a
broken provisioning step fails the job before the LLM is invoked. The
`azure-functions-setup` eval then sanity-checks that the agent observes the
same tools from inside the session.

## Common graders (copy into each stimulus)

See [`_base/common-graders.yaml`](_base/common-graders.yaml). Highlights:

- `completed` — non-empty output guard.
- `output-not-matches` for `(?i)fatal error|unhandled exception|stack trace` —
  catches runtime crashes in the agent.
- `output-not-matches` for connection-string / shared-key / master-key patterns —
  secret-leak guard.

## Cost notes

- Every stimulus running through the `copilot-sdk` executor invokes the GitHub
  Copilot agent at least once, which incurs LLM cost.
- `tier: smoke` stimuli are intentionally small (1 prompt × N runs) for PRs.
- Nightly `full` runs should be gated behind workflow_dispatch or schedule.
- `tier: live` stimuli additionally **create real Azure resources**. They run
  only from the separate [Skill Evaluation - Vally Live](../.github/workflows/skill-evaluation-vally-live.yml)
  workflow. See [`azure-functions-deploy/README.md`](azure-functions-deploy/README.md)
  for the resource lifecycle, `keep_resources` debug option, and the
  [cleanup-stale-vally-resources](../.github/workflows/cleanup-stale-vally-resources.yml)
  safety net.

## Live (Tier 3) workflow inputs

The live workflow exposes the following `workflow_dispatch` inputs so a
reviewer can iterate on one skill at a time:

| input | type | default | effect |
| --- | --- | --- | --- |
| `eval_spec` | string | empty | path to a single eval spec (e.g. `evals/azure-functions-deploy/eval.yaml`); empty = run the full `live` suite |
| `model` | string | empty | override the `claude-sonnet-4.6` default (e.g. `claude-opus-4.7`) |
| `keep_resources` | boolean | `false` | **DEBUG ONLY.** Skip the per-run Azure cleanup step. The 24-hour safety net will still delete the resource group via the `vally-eval=true` tag |

## Model selection

Eval specs default to `claude-sonnet-4.6` (matches the convention used by
[`microsoft/GitHub-Copilot-for-Azure`](https://github.com/microsoft/GitHub-Copilot-for-Azure)
and keeps PR / nightly cost and runtime stable). Override per run:

| Layer | Model | When |
| --- | --- | --- |
| PR gate (`smoke`) | `claude-sonnet-4.6` | every push |
| Nightly (`full`) | `claude-sonnet-4.6` | scheduled |
| Reality check | `claude-opus-4.7` | manual via `--model claude-opus-4.7`, e.g. before a release, to mirror what GitHub Copilot CLI users typically run |

Multi-model comparison runs are supported via comma-separated values:

```bash
npx vally eval --suite full --model claude-sonnet-4.6,claude-opus-4.7
```

The GitHub Actions workflow exposes a `model` input on `workflow_dispatch` for
the same purpose.
