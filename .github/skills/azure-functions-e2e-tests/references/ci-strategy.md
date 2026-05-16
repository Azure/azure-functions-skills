# E2E CI Strategy

Use progressive CI levels. Do not expose real-agent tokens or Azure credentials to untrusted pull requests.

## Level 1: static E2E contract CI

Trigger:

- `pull_request`
- `push`

Allowed:

- Scenario catalog validation.
- Evidence schema validation.
- Redaction rule tests.
- README/docs consistency checks.
- Report HTML contract checks using fixture JSON.

Not allowed:

- Real coding-agent tokens.
- Azure login.
- Live plugin installation against user accounts.
- Network operations that require secrets.

## Level 2: protected real-agent E2E

Trigger:

- `workflow_dispatch`
- Maintainer-approved label or comment workflow in a later phase.

Requirements:

- Protected GitHub Environment.
- Required reviewer.
- Exact branch or SHA input.
- Redacted artifacts.

Allowed:

- Real GitHub Copilot CLI, Claude Code, and Codex execution when configured.
- Plugin/setup/chat validation.
- HTML artifact publishing.

Not allowed:

- Running on untrusted fork PRs with secrets.
- Live Azure resource creation.
- Publishing unredacted transcripts.

## Level 3: live Azure E2E

Trigger:

- `workflow_dispatch`
- `schedule`
- Post-merge only after the flow is stable.

Requirements:

- Reuse `functions-skills-live-e2e` protected Environment.
- Use Azure OIDC, not client secrets.
- Scope Azure RBAC to the test resource group.
- Add TTL tags and cleanup with `if: always()`.

Allowed:

- Deploy/invoke/cleanup scenarios.
- Diagnostics against known test apps.

Not allowed:

- Production resources.
- Fork PR execution.
- Secret or Function key leakage.

## Recommended rollout

1. Add static scenario and schema tests.
2. Add local real-agent setup/chat scenarios.
3. Add plugin scenarios.
4. Add protected workflow and publish HTML as artifact.
5. Add README report link and badges after the report format stabilizes.
6. Add live Azure deploy/diagnostics scenarios last.
