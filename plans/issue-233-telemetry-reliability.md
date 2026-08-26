# Make telemetry delivery reliable and safely diagnosable

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document follows `PLANS.md` at the repository root.

## Purpose / Big Picture

Azure Functions Skills telemetry currently reports an Application Insights flush as failed whenever the SDK callback contains any text, even when that text says every item was accepted. After this change, accepted ingestion exits successfully, normal hooks remain silent and fail open, and a user can opt into safe JSON Lines diagnostics with `AZURE_FUNCTIONS_SKILLS_TELEMETRY_DEBUG=true`. A user can also run `azure-functions-skills telemetry doctor` to distinguish opt-out, missing release configuration, and transport or ingestion outcomes without exposing project content or credentials.

## Progress

- [x] (2026-08-25 23:30Z) Read Issue 233, repository instructions, telemetry implementation, generated-hook pipeline, release pipeline, and existing tests.
- [x] (2026-08-25 23:33Z) Added failing tests for successful ingestion parsing, transient retry, safe bounded diagnostics, deterministic hooks, explicit timeout, dimensions, and the diagnostic CLI.
- [x] (2026-08-25 23:35Z) Implemented sender result parsing, correlation/version dimensions, safe diagnostics, retry, and telemetry doctor.
- [x] (2026-08-26 00:10Z) Updated canonical hook templates and build-time version substitution, then regenerated and verified derived plugin payloads.
- [x] (2026-08-26 00:09Z) Added an explicitly gated post-release canary that waits for the expected public version, downloads its tarball, sends a correlated diagnostic, and queries Application Insights.
- [x] (2026-08-26 00:12Z) Ran targeted tests, the 276-test repository gate, three isolated E2E matrices after successive review fixes, and a Claude Opus 5 rubber-duck review; the final matrix passed 38/38 commands and 6/6 cases.
- [x] (2026-08-26 00:20Z) Completed the Claude Sonnet 5 E2E evidence cross-check: VALID, 38/38 commands verified, no missing commands or verdict overrides.
- [x] (2026-08-26 00:21Z) Published the VALID E2E report to `reports/e2e/current/report.html`.
- [x] (2026-08-26 00:22Z) Prepared the completed implementation as one conventional commit with the required co-author trailer; its SHA is reported to the parent session after creation.
- [ ] Commit the complete implementation and report its commit SHA to the parent session.

## Surprises & Discoveries

- Observation: The user-provided working tree contains `PLANS.md`, which defines ExecPlan rules, but no issue-specific ExecPlan.
  Evidence: `git status --short` lists `PLANS.md`, and `plans/**` initially contains no files.
- Observation: workspace-local installation builds telemetry hooks without setting `BuildData.packageVersion`.
  Evidence: `src/setup/index.ts` returns skills, MCP servers, and hooks only, so deterministic hook substitution must also load the installed package version.
- Observation: Windows PowerShell 5.1 corrupts the original Node inline UUID command, and malformed release YAML was not covered by substring-only tests.
  Evidence: Claude Opus 5 reproduced an invalid `{}` correlation value and a YAML parse failure; `[guid]::NewGuid()` plus a real PowerShell 5.1-to-CLI test and a `yaml.parse` release test now cover both.
- Observation: Copilot CLI documents `timeoutSec`, while Claude and Cursor use `timeout`.
  Evidence: the final canonical registrations use the host-specific key and generated distribution tests assert each shape.

## Decision Log

- Decision: Include the P0 and P1 issue scope plus a single immediate retry for explicitly transient failures and two bounded diagnostic log generations.
  Rationale: These are small extensions of the same delivery boundary, directly satisfy the issue's reliability goal, and can be proven deterministically without changing telemetry architecture.
  Date/Author: 2026-08-25 / Copilot
- Decision: Keep diagnostics allowlisted and typed rather than accepting arbitrary objects for logging.
  Rationale: A generic logger would make it too easy for future callers to write raw hook input, prompts, arguments, credentials, or connection strings.
  Date/Author: 2026-08-25 / Copilot
- Decision: Inject the package version into canonical hook scripts through a `__PACKAGE_VERSION__` placeholder during asset generation.
  Rationale: The template remains canonical while every generated hook invokes the exact package/plugin version that produced it.
  Date/Author: 2026-08-25 / Copilot
- Decision: Keep deterministic package invocation without an `@latest` fallback, and make release publication ordering observable through the gated canary.
  Rationale: Issue 233 explicitly requires deterministic generated hooks. The canary waits until the exact `package.json` version appears on the requested npm tag before testing, preventing a green result against an older release.
  Date/Author: 2026-08-26 / Copilot
- Decision: Use a 30-second host timeout, with Copilot's `timeoutSec` key and Claude/Cursor's `timeout` key.
  Rationale: Ten seconds is too short for a pinned npx cold cache and debug-only npm resolution, while 30 seconds remains finite and matches documented host schemas.
  Date/Author: 2026-08-26 / Copilot

## Outcomes & Retrospective

The implementation now correctly recognizes accepted Application Insights responses, emits safe correlation and version dimensions, provides opt-in bounded diagnostics and a telemetry doctor, pins generated hooks, retries one transient failure, and offers a gated expected-version release canary. The full repository gate passes 276 tests. The final isolated E2E run `20260825-171025` passes all 38 commands and all six local-install/update cases, and its Claude Sonnet 5 evidence cross-check is VALID. The validated report is published and no Issue 233 scope is intentionally deferred.

## Context and Orientation

`src/telemetry/sender.ts` validates a narrow telemetry event and sends it through `applicationinsights` version 1.8.10. Its flush callback currently rejects every non-empty response. `bin/azure-functions-skills.js` accepts internal telemetry events on standard input. Canonical hook definitions and scripts live under `templates/hooks/`; build code in `src/build/build-target.ts` copies them into plugin and workspace distributions. Generated repository plugin files under `.github/plugins/`, `.plugin/`, and `.claude-plugin/` must never be edited directly and are regenerated with `npm run build:plugin-payload`.

The diagnostic log is JSON Lines, meaning one JSON object per line. It is enabled only when `AZURE_FUNCTIONS_SKILLS_TELEMETRY_DEBUG` equals `true`, case-insensitively. `AZURE_FUNCTIONS_SKILLS_TELEMETRY_LOG_DIR` selects its directory. Each record contains only a timestamp and typed safe fields: lifecycle status, skip reason, an already validated telemetry event, package/plugin versions, a credential-free registry origin/path, an integer command exit code, a correlation identifier, and numeric Application Insights acceptance counts or sanitized status categories.

## Plan of Work

First extend unit tests in `tests/telemetry.test.ts` so a JSON callback with equal received and accepted counts succeeds, partial acceptance fails, and only recognized transient responses retry once within one total deadline. Add diagnostics tests that enable logging into a temporary directory, assert safe fields, assert forbidden source values are absent, and force rotation past the byte limit. Extend distribution and hook tests to require `@azure/functions-skills@<build version>`, correlation and version fields, explicit hook timeouts, safe registry logging, exit-code logging, and unchanged fail-open output. Extend CLI tests for `telemetry doctor --json`.

Then refactor `src/telemetry/sender.ts` around a sanitized ingestion-result parser and one total delivery deadline. Add a typed diagnostics module under `src/telemetry/` and a diagnostic-report function exposed by `src/telemetry/index.ts`. Package and plugin versions and correlation IDs become custom dimensions, while older sanitized hook payloads remain accepted and receive safe defaults.

Update `templates/hooks/scripts/track-telemetry.sh` and `.ps1` to construct only the current sanitized event, invoke the deterministic package version, and write hook diagnostics only when opted in. Update canonical hook JSON and workspace-generated hook objects with an explicit timeout. Change `src/build/build-target.ts` to replace the package-version placeholder and `src/setup/index.ts` to load the installed package version.

For release canary support, add a gated script and release-pipeline job only if the current ESRP publish boundary can safely access both the published package and Application Insights verification credentials after publication. If the external release template does not expose a post-publication continuation point, record that boundary and provide a reusable canary script for a separately gated pipeline rather than claiming automatic verification.

## Concrete Steps

Work from the repository root. Run targeted red/green tests with:

    npm test -- tests/telemetry.test.ts tests/telemetry-diagnostics.test.ts tests/telemetry-hook.test.ts tests/simplified-distribution.test.ts tests/simplified-cli.test.ts tests/telemetry-release.test.ts

After canonical template changes, regenerate and verify:

    npm run build:plugin-payload
    npm run verify:plugin-payload

Run the complete non-LLM gate:

    npm run check

Exercise the CLI in an isolated temporary workspace, never the repository root:

    node bin/azure-functions-skills.js install --local --agent ghcp --dir <temporary-directory>
    node bin/azure-functions-skills.js telemetry doctor --json

Do not run Vally evaluations and do not run `doctor --deep`.

## Validation and Acceptance

The targeted telemetry suite must show that `{"itemsReceived":1,"itemsAccepted":1,"errors":[]}` succeeds and that partial acceptance does not. Existing silent hook tests must still return only `{"continue":true}` with exit code zero even when the package invocation exits nonzero. Debug hook tests must explain tracked, skipped/disabled, npm resolution, transport, and accepted outcomes using only safe fields, and test source strings representing a connection string, credential, prompt, file content, raw hook input, and raw tool argument must not occur in the log.

Generated shell and PowerShell hooks must contain the package version supplied in `BuildData`, contain no `@latest`, and generated hook registrations must set a finite timeout. Emitted Application Insights properties must include package version, plugin version, and correlation ID. `telemetry doctor --json` must report package resolution, opt-out, configuration, transport, and ingestion acceptance without printing a connection string.

`npm run check` must pass. The isolated install must write a version-pinned hook, and the diagnostic command must produce a structured report. A Claude-family `rubber-duck` agent must review the final diff and any correctness findings must be resolved before commit.

## Idempotence and Recovery

Tests and builds are repeatable. Diagnostic log rotation renames only the known current telemetry log to one known backup and overwrites the previous backup; it never recursively deletes a directory. If template payload verification fails, rerun `npm run build:plugin-payload` rather than editing generated files. Temporary end-to-end directories are created outside the repository and removed after inspection.

## Artifacts and Notes

The observed successful SDK callback that motivated the fix is:

    {"itemsReceived":1,"itemsAccepted":1,"appId":null,"errors":[]}

The intended normal hook output remains:

    {"continue":true}

## Interfaces and Dependencies

`src/telemetry/sender.ts` continues to export `parseTelemetryEvent`, `sendTelemetryEvent`, and `sendTelemetryEventWithDependencies`. `TelemetryEvent` gains optional safe `correlationId` and `pluginVersion` properties and supports an internal `telemetry_diagnostic` event type. `TelemetryDependencies` supplies package version and diagnostics dependencies for deterministic tests.

`src/telemetry/diagnostics.ts` exports typed diagnostic record functions and constants for bounded size. It uses only Node built-ins. No new package dependency is required. `applicationinsights` remains the transport; this work explicitly does not migrate telemetry to Azure MCP.

Revision note (2026-08-25): Created the issue-specific ExecPlan because only the repository-wide `PLANS.md` rules were present. Scope and decisions were derived from Issue 233 and the parent task.

Revision note (2026-08-26): Updated all living sections after implementation and Claude-family review, recorded PowerShell/YAML/schema discoveries, and captured final validation evidence.
