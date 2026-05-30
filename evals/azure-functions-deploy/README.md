# azure-functions-deploy — live evaluation

This eval **deploys real Azure resources**. It runs only from the
[Skill Evaluation - Vally Live](../../.github/workflows/skill-evaluation-vally-live.yml)
workflow under the `functions-skills-live-e2e` GitHub Environment, which is gated
by required reviewers (`Azure/azure-functions-bucees-team`,
`prevent_self_review: false`).

## What it tests

| # | Stimulus | What it asserts |
| --- | --- | --- |
| 1 | Live — deploy TypeScript HTTP FC1 to Azure | `azure-functions-deploy` skill is invoked, agent runs the prepare → validate → deploy hand-off (or `azd up` directly), output contains a `*.azurewebsites.net` Function App URL, and no Azure error patterns appear |

## Fixture

Each stimulus seeds its workspace with the official Azure-Samples
[`functions-quickstart-typescript-azd`](https://github.com/Azure-Samples/functions-quickstart-typescript-azd)
template via `environment.commands`. The commit is pinned to
`cba39229…` so the fixture is reproducible even if upstream changes.

This intentionally separates "deploy" testing from "scaffold" testing:
the project is already deploy-ready when the agent starts.

## Resource lifecycle

The live workflow:

1. Pre-creates a resource group named `rg-afsvally-<runId>-<sha>` in
   `eastus2`, tagged with `vally-eval=true`, `createdAt=<ISO>`,
   `run-id=<id>`. These tags are how the safety net workflow finds
   stale RGs.
2. Sets `AZURE_RESOURCE_GROUP`, `AZURE_ENV_NAME`, `AZURE_LOCATION`,
   `AZURE_SUBSCRIPTION_ID` for the eval step so the agent reuses the
   pre-tagged RG.
3. Runs `vally eval`.
4. **Cleanup**:
   - Default (`keep_resources: false`): `azd down --force --purge --no-prompt`,
     falling back to `az group delete --yes --no-wait`. Runs in
     `if: always()` so it executes even if the eval failed.
   - Debug (`keep_resources: true`): cleanup step is skipped. A warning
     annotation and the `az group delete` command for that run are
     written to `$GITHUB_STEP_SUMMARY` so a human can investigate and
     clean up later.
5. The [cleanup-stale-vally-resources](../../.github/workflows/cleanup-stale-vally-resources.yml)
   safety net workflow deletes any RG tagged `vally-eval=true` that is
   older than 24h, so even forgotten `keep_resources` runs cannot linger.

## Per-skill / per-spec invocation

The live workflow accepts an `eval_spec` input:

| input | effect |
| --- | --- |
| empty | run the entire `live` suite (`.vally.yaml` filter `tier: live`) |
| `evals/azure-functions-deploy/eval.yaml` | run only this spec |

Use this to iterate on a single skill without paying for the others.

## Cost guardrails

- Flex Consumption (FC1) plan only — scales to zero, idle cost ≈ 0.
- `runs: 1` per stimulus.
- One Function App + one storage account + one App Insights workspace
  per run.
- All resources deleted at the end of the run (or within 24h by the
  safety net).
- Subscription-level budget alert tracked in a follow-up issue.
