# Validate and hand off a Go migration

Use for common steps 5-7 and 9-11. During assessment these checks are planned,
not executed or passed. Apply the common evidence and permission rules.

## Validate the isolated migration candidate

Verify that the runnable baseline and restore evidence still exist, then test only
the isolated migration candidate. Its active package must exclude the legacy
`customHandler` block and `function.json` files while the rollback baseline retains
them. Run the approved build and existing applicable tests, then `func start`. It
builds for the local OS. Confirm every expected function is indexed and each required
listener starts; startup alone is not business verification.

Compare synthetic HTTP success/error/status/header/auth cases against the baseline.
For messaging, verify actual payload consumption, business side effects, batch
cardinality, intentional failure/retry, and dead-letter handling where used.
Trigger dispatch alone does not prove business results or recovery behavior.
Use only approved emulators/sandbox services; unavailable required E2E stays blocked.
Verify required logs, correlation, and any agreed OpenTelemetry configuration.
For host-level retry, confirm the candidate registration emits the intended policy,
then exercise an intentional failure through the host and verify attempts, delay
strategy, terminal result, and side effects. Keep broker redelivery/settlement checks
separate from host retry. If local or emulator evidence cannot prove required cloud
behavior, use only a separately approved isolated Azure target or keep the check blocked.

When packaging is approved, run `func pack`. Inspect the ZIP for root-level
`host.json`, Linux x64 executable `app`, required assets, and absence of secrets.
Core Tools preserves executable permissions; do not substitute a hand-built Windows
ZIP. Remote builds must be disabled for the compiled package.
See the [deployment guide](https://azure.github.io/azure-functions-golang-worker/guides/deployment/).

## Separate handoffs and rollback

Cutover is a separate approval after all required candidate checks pass. It must name
the package, plan-specific runtime settings, event-source ownership, deployment order,
post-cutover checks, and rollback trigger. A source change or successful local host
start does not authorize deployment, slot swap, traffic change, or production setting
updates.

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
blocker. After it returns, recheck modules, Go worker registrations, settings, build,
host, and E2E evidence under common step 9.

## Definition of done

Report each applicable ID separately after implementation. Missing execution is
blocked, not pass or not-applicable. For assessment-only requests these remain
future conversion requirements; report the plan as delivered, not the app as migrated.

| ID | Required evidence |
| --- | --- |
| CG-01 | Approved inventory, baseline/accepted substitute, scope, compatible versions, and restore point are recorded. |
| CG-02 | Every original function/trigger/binding has a Go worker mapping; unresolved blockers prevent migration completion. |
| CG-03 | The runnable baseline remains restorable through cutover and post-cutover checks until the approved rollback window closes; the isolated candidate uses only Go worker indexing and excludes legacy metadata after every function has an implemented mapping or replacement. |
| CG-04 | HTTP routes, methods, auth, responses, and middleware match baseline fixtures, or HTTP is absent with a stated reason. |
| CG-05 | Used message/timer triggers preserve payloads, batch shape, host retries, broker settlement/redelivery, checkpoints, and service settings; intentional failure behavior is verified without duplicate production consumption. |
| CG-06 | Each unsupported input/output binding has an approved, verified replacement preserving identity/side effects, or no such bindings exist. |
| CG-07 | The exact local Go worker settings in conversion.md are present, required host/connection/logging settings are retained, and secrets are excluded. The Azure Go runtime proposal, with verified plan-specific schema/values, is recorded in the plan/report; Azure changes remain proposals unless approved and verified. |
| CG-08 | The migrated app builds, applicable existing tests pass, and local indexing/listeners are verified for every expected function. |
| CG-09 | Agreed trigger E2E cases prove business results and required telemetry; missing services or permissions remain blocked. |
| CG-10 | The package is inspected; cutover remains separately approved; deployment/rollback status, package and settings order, event-source ownership, platform/toolchain handoffs, unverified cloud behavior, and run-owned cleanup are recorded accurately. |
