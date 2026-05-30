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
  - CI: `COPILOT_GITHUB_TOKEN` configured as an **environment secret** under
    the `functions-skills-vally-eval` GitHub Environment. Recommended protection
    rules: restrict `Deployment branches` to `main` (and any active eval-branch
    pattern, e.g. `tsushi/vally-eval-*`), optionally add required reviewers for
    cost-sensitive Opus / full runs.
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
| `full` | — | everything (nightly) |

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
