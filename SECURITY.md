<!-- BEGIN MICROSOFT SECURITY.MD V1.0.0 BLOCK -->

## Security

Microsoft takes the security of our software products and services seriously, which
includes all source code repositories in our GitHub organizations.

**Please do not report security vulnerabilities through public GitHub issues.**

For security reporting information, locations, contact information, and policies,
please review the latest guidance for Microsoft repositories at
[https://aka.ms/SECURITY.md](https://aka.ms/SECURITY.md).

<!-- END MICROSOFT SECURITY.MD BLOCK -->

## Threat model for `@azure/functions-skills`

This repository ships:

1. **An npm CLI** (`@azure/functions-skills`) that installs into user workspaces and runs at command time.
2. **Skill templates** loaded by an LLM agent (GitHub Copilot CLI, Claude Code, Codex) which, on `doctor --deep`, runs with file write and shell execution permissions.

The two highest-impact attack surfaces are:

- **The published npm package** — anything that runs at install or invocation time on a user's machine or CI runner. The package ships no `postinstall`/`preinstall` scripts and CI rejects them.
- **The skill templates loaded by the LLM agent on `--deep`** — skills that instruct the agent to fetch and execute remote content would be a remote-code-execution vector. CI lints skill markdown for these patterns.

This repository does **not** publish to npm. A downstream Microsoft mirror pipeline picks up tagged versions and handles publishing — so this repo holds no `NPM_TOKEN`. Any reference to `NPM_TOKEN` in workflows or scripts is a footgun; `npm run lint:security` audits for this.

## Defense layers built into this repo

| Layer | Mechanism |
| --- | --- |
| Source-of-truth integrity | Required CI checks (`lint`, `typecheck`, `verify:plugin-payload`, tests, build); branch protection on `main` |
| Lifecycle-script ban | `scripts/lint-package-scripts.mjs` rejects `preinstall`/`postinstall`/etc. in package.json |
| Skill content lint | `scripts/lint-skill-content.mjs` rejects `curl \| sh`, `eval $(...)`, base64-decode-execute, raw IPs in skill markdown |
| NPM_TOKEN audit | `scripts/audit-npm-token.mjs` rejects publish-credential references in workflows or scripts |
| `--deep` PR refusal | Doctor refuses Tier 2 in pull-request contexts (env `GITHUB_EVENT_NAME=pull_request`, Azure DevOps `BUILD_REASON=PullRequest`, GitLab `CI_PIPELINE_SOURCE=merge_request_event`) |
| `--deep` explicit consent | Tier 2 requires `--accept-deep-risk` plus a clear warning printed before agent spawn |
| Dependabot | Security advisories opened automatically |
| Doctor as a defender for users | Tier 1 detects user-project supply-chain risk (lifecycle scripts, unpinned deps, missing lockfile, tracked `.env`, install-script deps); Tier 2 reference catches semantic patterns (import-time side effects, fetch-then-eval, credential exfiltration, anti-analysis) |

## What users running doctor in production should also do

Pre-deployment validation via `doctor` is one of several layers. Users running Azure Functions deployments should also:

1. **Use [Harden-Runner](https://github.com/step-security/harden-runner)** or equivalent egress filtering on CI runners.
2. **Run `doctor --deep` only in trusted environments** (post-merge, gated by GitHub Environment approval), never on contributor PRs.
3. **Pin direct production dependencies** in their own projects (doctor flags unpinned ones).
4. **Use OIDC for cloud credentials** instead of long-lived secrets.
5. **Monitor for unexpected npm publishes** of any package they depend on — supply-chain attacks often skip the maintainer's CI pipeline.

## Acknowledgements

The threat model in this document is informed by public analysis of the May 19, 2026 durabletask PyPI compromise (StepSecurity), the TanStack / Mistral AI / LiteLLM / @antv campaigns, and the broader Mini Shai-Hulud worm activity.