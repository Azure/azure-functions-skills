# Go custom handlers to the native Go worker

Use with the eleven steps in [SKILL.md](../SKILL.md). This scenario provides a
starting point, not a one-command conversion or deployment. Assessment, plan, and
starting-point requests stop after the inventory and saved plan. A plan does not
authorize code changes, toolchain updates, Azure writes, or deployment.

## Load only the current phase

| Common workflow phase | Load | Stop condition |
| --- | --- | --- |
| Steps 1-3: inventory and planning | [assessment.md](custom-handlers-to-go/assessment.md) | Deliver the assessment and next approved action; stop here for plan-only requests |
| Step 4: approved code/configuration conversion | [conversion.md](custom-handlers-to-go/conversion.md) | Complete only the agreed local model/configuration work |
| Steps 5-7 and 9-11: verification and reporting | [validation.md](custom-handlers-to-go/validation.md) | Report each applicable completion ID with evidence or a blocker |

Do not preload all three files. During assessment, load a later phase only when a
specific mapping or validation question needs it. During conversion, consult the
completion table when planning acceptance checks. Reuse the saved plan on resume.
The common workflow's selection, permission, evidence, and recovery rules still apply.

## Creation and provisioning are separate

Neither assessment nor local conversion assumes an Azure Go Function App exists.
Keep the existing source project; do not reinitialize it to obtain a native scaffold.
If an approved empty comparison/target project is needed, hand local scaffolding
to `azure-functions-create`, which discovers Go MCP templates with manifest and
Core Tools fallbacks. Template infrastructure is not evidence of deployed resources.

Hand target preparation, provisioning, validation, and deployment to
`azure-functions-deploy` through Azure Skills only when separately approved.
Record the actual target and availability checks in the same migration plan.

## Sources and target applicability

Reviewed on 2026-11-06. Record the actual target versions and source dates in the
plan; refresh on a conflict, changed target, or missing detail.

| Source | Consult for |
| --- | --- |
| [Go developer reference](https://learn.microsoft.com/azure/azure-functions/functions-reference-go) | Programming model, prerequisites, hosting, limitations |
| [Custom handlers](https://learn.microsoft.com/azure/azure-functions/functions-custom-handlers) | Invocation envelopes, HTTP forwarding, configuration, support |
| [Go worker documentation](https://azure.github.io/azure-functions-golang-worker/) | Worker concepts and guides; load the relevant page rather than the whole site |
| [Triggers and bindings](https://azure.github.io/azure-functions-golang-worker/concepts/triggers-and-bindings/) | Handler types and supported binding model |
| [Registration APIs](https://github.com/Azure/azure-functions-golang-worker/blob/v1.0.0/sdk/app.go) and [options](https://github.com/Azure/azure-functions-golang-worker/blob/v1.0.0/sdk/options.go) | Dated v1.0.0 API evidence; use the selected release's source when different |
| [Worker releases](https://github.com/Azure/azure-functions-golang-worker/releases) | Published compatible versions, not `main` or invented tags |
| [Core Tools 4.16.0 release](https://github.com/Azure/azure-functions-core-tools/releases/tag/4.16.0) | Verified Go GA on Flex and preview support on Linux Elastic Premium/Dedicated |

The core worker v1.0.0 is generally available on Linux Flex Consumption. Linux
Elastic Premium and Dedicated support is a preview rollout: confirm availability
for the actual plan, SKU, and region. Do not force a move to Flex or promise all
preview targets are available. Windows and Linux Consumption are not native Go targets.

Reviewed minimums: Go 1.24 for the core worker, Core Tools 4.12 for Flex, and Azure
CLI 2.87.0 when approved Azure operations need it. Use Core Tools 4.16.0 or later
for Elastic Premium/Dedicated; 4.16.0 is the verified supporting baseline, not a
claim about the earliest supporting release. Do not treat 4.12 as sufficient.
Extension modules can require Go 1.25
or later; inspect the selected modules' `go.mod` files. An unmet version floor needs
a separately approved toolchain stage, not a silent version change.

Additional input bindings and non-HTTP output bindings need agreed Azure SDK
replacements. HTTP responses remain supported through `http.ResponseWriter`.
Durable orchestrations and activities are a separate preview capability, not a
feature to introduce during migration. Durable entities are not supported.
