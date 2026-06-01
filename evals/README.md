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
- For the **live (Tier 3) deploy workflow**, additional Azure setup is required —
  see [CI setup — repository / Azure side](#ci-setup--repository--azure-side) below.

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
| `live` | `tier: live` | **Tier 3 — deploys real Azure resources.** Manual / nightly only, via the dedicated [Skill Evaluation - Azure Live Deploy](../.github/workflows/skill-evaluation-azure-live-deploy.yml) workflow |

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

The `Skill Evaluation - Offline` workflow installs the following before running
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

## CI setup — repository / Azure side

The two workflows under `.github/workflows/` (the standard
`skill-evaluation-offline.yml` and the live
`skill-evaluation-azure-live-deploy.yml` + safety net) require **one-time
configuration** on both the GitHub repository and the Azure
subscription. This section is the authoritative checklist for a
maintainer setting things up from scratch — for example after the
subscription rotates, a new SP is provisioned, or someone forks this
repo.

> All values shown here come from the existing
> `functions-skills-live-e2e` GitHub Environment. Read them directly
> from
> [repo Settings → Environments](https://github.com/Azure/azure-functions-skills/settings/environments)
> rather than hard-coding them anywhere else.

### 1. GitHub Environment: `functions-skills-live-e2e`

| Setting | Value | Notes |
| --- | --- | --- |
| **Required reviewers** | `Azure/azure-functions-bucees-team` | `prevent_self_review: false` so the requester can self-approve |
| **Deployment branches** | Protected branches only (= `main`) | Set in environment protection rules |
| **Variables** | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | The federated identity used by `azure/login@v3` (see step 2). Plain variables, not secrets — they are non-sensitive identifiers |
| **Secrets** | `COPILOT_CLI_TOKEN` | GitHub Copilot SDK token used by Vally's `copilot-sdk` executor. The workflow maps it to `COPILOT_GITHUB_TOKEN` at step level |

### 2. Azure federated identity (OIDC) — workload identity federation

The workflows authenticate via OIDC, not via a client secret. A single
Microsoft Entra application (referenced by `AZURE_CLIENT_ID` above)
needs federated credentials trusting this repository.

Minimum subjects to add for both standard and live workflows:

| Federation subject | Used by |
| --- | --- |
| `repo:Azure/azure-functions-skills:environment:functions-skills-live-e2e` | All workflows that pin `environment: functions-skills-live-e2e` (regular Vally, live deploy, safety net) |
| `repo:Azure/azure-functions-skills:ref:refs/heads/main` *(optional)* | Convenient fallback for ad-hoc runs from `main` without an environment scope |

These are added via Azure portal → Entra ID → App registrations →
your app → **Certificates & secrets** → **Federated credentials**, or
via CLI:

```bash
APP_OBJECT_ID=$(az ad app show --id "$AZURE_CLIENT_ID" --query id -o tsv)
az ad app federated-credential create \
  --id "$APP_OBJECT_ID" \
  --parameters '{
    "name": "azure-functions-skills-live-e2e",
    "issuer": "https://token.actions.githubusercontent.com",
    "subject": "repo:Azure/azure-functions-skills:environment:functions-skills-live-e2e",
    "audiences": ["api://AzureADTokenExchange"]
  }'
```

### 3. Azure role assignments for the SP

The federated identity (the **service principal** that backs
`AZURE_CLIENT_ID`) needs different roles depending on which workflow
should work. Find the SP's object ID once and reuse it:

```bash
SP_OBJECT_ID=$(az ad sp show --id "$AZURE_CLIENT_ID" --query id -o tsv)
SUBSCRIPTION_ID="<value of AZURE_SUBSCRIPTION_ID from the environment>"
```

| Workflow | Required roles on `subscriptions/$SUBSCRIPTION_ID` | Why |
| --- | --- | --- |
| `skill-evaluation-offline.yml` (standard, no Azure resources) | *(none required)* — the workflow runs against the agent and does not call Azure ARM | The agent may probe Azure (via the Azure MCP `functions` namespace), but those tools are read-only and call non-ARM endpoints |
| `skill-evaluation-azure-live-deploy.yml` (Tier 3 live deploy) | **`Contributor`** + **`Role Based Access Control Administrator`** | `Contributor` is needed for `az group create/delete`, Bicep deployment, and per-resource ops. `RBAC Administrator` is needed because the Azure-Samples FC1 quickstart template assigns Storage / Monitoring roles to the Function App's Managed Identity. Without it the agent has to fall back to less-secure auth modes (or modify the Bicep), which trips the security-regression grader in the live eval |
| `cleanup-azure-live-eval-resources.yml` (24h safety net) | Subset of `Contributor` — at minimum `Microsoft.Resources/subscriptions/resourceGroups/delete` | The bundled `Contributor` from the live workflow already covers this; no separate assignment needed |

Apply both roles with:

```bash
# Resource CRUD (required for live deploy)
az role assignment create \
  --assignee "$SP_OBJECT_ID" \
  --role Contributor \
  --scope "/subscriptions/$SUBSCRIPTION_ID"

# Allow assigning Storage / Monitoring roles to the Function App MI
az role assignment create \
  --assignee "$SP_OBJECT_ID" \
  --role "Role Based Access Control Administrator" \
  --scope "/subscriptions/$SUBSCRIPTION_ID"
```

Verify:

```bash
az role assignment list \
  --assignee "$SP_OBJECT_ID" \
  --scope "/subscriptions/$SUBSCRIPTION_ID" \
  --query "[].roleDefinitionName" -o tsv
# Expected:
#   Contributor
#   Role Based Access Control Administrator
```

> Why subscription scope and not a single RG: the live workflow creates
> a fresh `rg-afsvally-<runId>-<sha>` per run and the safety net needs
> to enumerate / delete arbitrary RGs tagged `vally-eval=true`. RG-scoped
> assignments cannot do either.
>
> If your subscription is shared with other workloads and you cannot
> grant subscription-scope `Contributor`, the alternative is to pin
> the live workflow to a single pre-created pool RG and rewrite cleanup
> to use `az resource delete`. See the discussion in the
> `azure-functions-deploy` live eval README for the trade-offs.

### 4. Triggering a run

Once the environment, federation, and roles are in place:

1. **Repo → Actions → Skill Evaluation - Azure Live Deploy → Run workflow**.
2. Pick the branch (`main`), `eval_spec` (optional, defaults to the
   full `live` suite), `model` (optional), and `keep_resources` (debug
   only).
3. A bucees team member approves the deployment (or you self-approve;
   `prevent_self_review: false`).
4. Output lands in the `vally-live-results-<run_id>` artifact.

### 5. Verifying cleanup

After a run, regardless of pass/fail, the resource group should be
gone (or pending deletion). To confirm:

```bash
az group list --tag vally-eval=true -o table
# Empty list = clean. Lingering entries are picked up by the next
# scheduled run of cleanup-azure-live-eval-resources.yml (within 24h).
```

## Cost notes

- Every stimulus running through the `copilot-sdk` executor invokes the GitHub
  Copilot agent at least once, which incurs LLM cost.
- `tier: smoke` stimuli are intentionally small (1 prompt × N runs) for PRs.
- Nightly `full` runs should be gated behind workflow_dispatch or schedule.
- `tier: live` stimuli additionally **create real Azure resources**. They run
  only from the separate [Skill Evaluation - Azure Live Deploy](../.github/workflows/skill-evaluation-azure-live-deploy.yml)
  workflow. See [`azure-functions-deploy/README.md`](azure-functions-deploy/README.md)
  for the resource lifecycle, `keep_resources` debug option, and the
  [cleanup-azure-live-eval-resources](../.github/workflows/cleanup-azure-live-eval-resources.yml)
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
