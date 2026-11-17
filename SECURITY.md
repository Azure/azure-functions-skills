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

1. **An npm package** (`@azure/functions-skills`) that the telemetry hooks run with `npx`, and that provides a small CLI.
2. **Skill templates** loaded by an LLM agent (GitHub Copilot CLI, Claude Code, Codex) which can run with file write and shell execution permissions.

The two highest-impact attack surfaces are:

- **The published npm package** — anything that runs at install or invocation time on a user's machine or CI runner. The package ships no `postinstall`/`preinstall` scripts and CI rejects them.
- **The skill templates loaded by the LLM agent** — skills that instruct the agent to fetch and execute remote content would be a remote-code-execution vector. CI lints skill markdown for these patterns.

This repository does **not** publish to npm. A downstream Microsoft mirror pipeline picks up tagged versions and handles publishing — so this repo holds no `NPM_TOKEN`. Any reference to `NPM_TOKEN` in workflows or scripts is a footgun; `npm run lint:security` audits for this.

### Approved exception: the prompt starter

The prompt starter ([docs/starter.md](docs/starter.md)) asks the agent to download
`install.ps1` or `install.sh` and run it. This is the fetch-and-execute pattern
above. It is accepted as an explicit exception ([FRD-0004](docs/frds/0004-prompt-starter-onboarding.md),
D-023), bound to these controls:

- Authorization comes only from the prompt the user pastes, which names the scope:
  one installer command for the current directory. Tool installation and changes to
  the user's agent settings each need a separate approval.
- HTTPS only. The branch is resolved once to an immutable commit; every payload
  file is checked against its SHA-256 hash; destination paths are checked for
  traversal and links; there is no fallback source.
- `install.*` itself comes from the mutable branch. A reviewed install pins the
  full commit SHA in the URL and with `-Ref` / `--ref`.
- Every merge to `main` reaches new users at once, so `starter/` gets the same
  review as the plugin payload. The aka.ms records are a second control point;
  their owner is recorded in FRD-0004 (D-025).
- `lint:security` scans `templates/starter/` and `starter/`, and allows the
  download-then-run form only when a whole line of a generated `start.md` equals
  the generated installer command for the configured URL.
- The telemetry hook loads code only from the project root, and loads nothing
  when it cannot find one.

## Defense layers built into this repo

| Layer | Mechanism |
| --- | --- |
| Source-of-truth integrity | Required CI checks (`lint`, `typecheck`, `verify:plugin-payload`, tests, build); branch protection on `main` |
| Lifecycle-script ban | `scripts/lint-package-scripts.mjs` rejects `preinstall`/`postinstall`/etc. in package.json |
| Skill content lint | `scripts/lint-skill-content.mjs` rejects `curl \| sh`, `eval $(...)`, base64-decode-execute, download-then-run, script blocks from downloaded content, and raw IPs in skill markdown and starter sources |
| NPM_TOKEN audit | `scripts/audit-npm-token.mjs` rejects publish-credential references in workflows or scripts |
| Dependabot | Security advisories opened automatically |
| Doctor skill as a defender for users | The `azure-functions-doctor` skill checks user-project supply-chain risk (lifecycle scripts, unpinned deps, missing lockfile, tracked `.env`, install-script deps) and semantic patterns (import-time side effects, fetch-then-eval, credential exfiltration, anti-analysis) |

## What users should also do

Pre-deployment checks with the `azure-functions-doctor` skill are one of several layers. Users running Azure Functions deployments should also:

1. **Use [Harden-Runner](https://github.com/step-security/harden-runner)** or equivalent egress filtering on CI runners.
2. **Run coding agents with elevated permissions only on trusted code**, never on unreviewed contributor PRs.
3. **Pin direct production dependencies** in their own projects (the doctor skill flags unpinned ones).
4. **Use OIDC for cloud credentials** instead of long-lived secrets.
5. **Monitor for unexpected npm publishes** of any package they depend on — supply-chain attacks often skip the maintainer's CI pipeline.

## Acknowledgements

The threat model in this document is informed by public analysis of the May 19, 2026 durabletask PyPI compromise (StepSecurity), the TanStack / Mistral AI / LiteLLM / @antv campaigns, and the broader Mini Shai-Hulud worm activity.