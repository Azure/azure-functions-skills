# Validate and hand off a Go migration

Use for common steps 5-7 and 9-11. During assessment these checks are planned,
not executed or passed. Apply the common evidence and permission rules.

## Verify the local artifact

Run the approved build and existing applicable tests, then `func start`. It builds
for the local OS. Confirm every expected function is indexed and each required
listener starts; startup alone is not business verification.

Compare synthetic HTTP success/error/status/header/auth cases against the baseline.
For messaging, verify actual payload consumption, business side effects, batch
cardinality, intentional failure/retry, and dead-letter handling where used.
Trigger dispatch alone does not prove business results or recovery behavior.
Use only approved emulators/sandbox services; unavailable required E2E stays blocked.
Verify required logs, correlation, and any agreed OpenTelemetry configuration.

When packaging is approved, run `func pack`. Inspect the ZIP for root-level
`host.json`, Linux x64 executable `app`, required assets, and absence of secrets.
Core Tools preserves executable permissions; do not substitute a hand-built Windows
ZIP. Remote builds must be disabled for the compiled package.
See the [deployment guide](https://azure.github.io/azure-functions-golang-worker/guides/deployment/).

## Separate handoffs and rollback

Do not assume an Azure target exists. Record its verified identity and support, or
the separate provisioning requirement. Hand off Azure preparation, provisioning,
validation, and deployment to `azure-functions-deploy` through Azure Skills only
when requested. A local scaffold or generated Bicep does not prove cloud readiness.
For a confirmed Linux Premium/Dedicated preview target, include
`WEBSITE_RUN_FROM_PACKAGE=1` and Always On for Dedicated. Do not add that setting to
Flex Consumption. Wait for configuration changes to apply before deploying.
Do not run Azure writes or publish as part of plan-only or local conversion.

Plan any new Linux target, identity/RBAC, connection settings, networking, state,
and cutover as separately approved platform work. Avoid competing consumers,
double side effects, and shared production checkpoints during side-by-side testing.
Rollback includes code, settings, and event-source ownership, not just the old ZIP.

For necessary Go version changes, use common step 8 with an available, explicitly
approved language/toolchain route. Do not invoke the .NET upgrade agent for Go or
invent an unavailable Go upgrade skill. If the route is unavailable, record the
blocker. After it returns, recheck modules, native registrations, settings, build,
host, and E2E evidence under common step 9.

## Definition of done

Report each applicable ID separately after implementation. Missing execution is
blocked, not pass or not-applicable. For assessment-only requests these remain
future conversion requirements; report the plan as delivered, not the app as migrated.

| ID | Required evidence |
| --- | --- |
| CG-01 | Approved inventory, baseline/accepted substitute, scope, compatible versions, and restore point are recorded. |
| CG-02 | Every original function/trigger/binding has a native mapping; unresolved blockers prevent migration completion. |
| CG-03 | Native startup/registrations replace the custom-handler listener; retired metadata/executables are excluded only after their behavior is accounted for. |
| CG-04 | HTTP routes, methods, auth, responses, and middleware match baseline fixtures, or HTTP is absent with a stated reason. |
| CG-05 | Used message/timer triggers preserve payloads, batch shape, retries, settlement/checkpoints, and service settings; actual failure behavior is verified. |
| CG-06 | Each unsupported input/output binding has an approved, verified replacement preserving identity/side effects, or no such bindings exist. |
| CG-07 | The exact local native/Go settings in conversion.md are present, required host/connection/logging settings are retained, and secrets are excluded. The native Azure runtime proposal, with verified plan-specific schema/values, is recorded in the plan/report; Azure changes remain proposals unless approved and verified. |
| CG-08 | The migrated app builds, applicable existing tests pass, and local indexing/listeners are verified for every expected function. |
| CG-09 | Agreed trigger E2E cases prove business results and required telemetry; missing services or permissions remain blocked. |
| CG-10 | The package is inspected; deployment/cutover/rollback status, platform/toolchain handoffs, unverified cloud behavior, and run-owned cleanup are recorded accurately. |
