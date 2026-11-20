# Language, programming-model, and binding detection

Start at `host.json` and source manifests. Record evidence with 1-based line numbers.
Use scoped file searches; do not run the app to discover functions. A workspace can
contain several languages and independently deployed apps.

For each handler record its function name, source location, one trigger, all input
and output bindings, resource path or setting name, and called helpers relevant to
judgment or failure handling. SDK calls are dependencies or side effects, not bindings.
If a resource name is computed, record the expression and mark resolution unknown.
Consult only matching language/extension references through
`../../azure-functions-common/references/routing.md` when more detail is needed.

## Python

- `requirements.txt` or `pyproject.toml` identifies `azure-functions` and any
  `azurefunctions-agents-runtime` dependency. Do not infer the deployed Python
  version from the locally installed interpreter.
- v2: `function_app.py`, `func.FunctionApp`, `DFApp`, decorators, and registered
  `Blueprint` modules. Follow `register_functions` and imported blueprints.
- v1: per-function `function.json` with `scriptFile`, `entryPoint`, and bindings.
  The Python Hosted Skill decorator requires v2; record v1 migration as an adoption cost.
- Read decorators such as `route`, `queue_trigger`, `service_bus_queue_trigger`,
  `blob_trigger`, `timer_trigger`, `event_hub_message_trigger`, and `cosmos_db_trigger`;
  include `*_input`, `*_output`, and generic binding decorators.
- Signals: `except`, `logging.exception`, swallowed exceptions, `range` with
  `sleep`, `tenacity`, regex extraction, keyword dictionaries, manual-review comments,
  `openai`, `azure.ai`, `anthropic`, `agent_framework`, and `semantic_kernel`.
  Confirm each library's actual use before calling it a direct LLM invocation.
- Existing Hosted Skills markers: app-local `.agent.md`, `agents.config.yaml`,
  `create_function_app`, `HostedSkillFunctionApp`, or `HostedSkillDFApp`.
  Read the existing skill/recovery definition before suggesting a duplicate.

## .NET

- Read `.csproj` target framework and package references, `Program.cs`, and attributes.
  `Microsoft.Azure.Functions.Worker` with `[Function]` indicates isolated worker.
  `Microsoft.NET.Sdk.Functions` with `[FunctionName]` indicates in-process.
  Do not call in-process an isolated app because its language is C#.
- Inventory trigger attributes (`HttpTrigger`, `ServiceBusTrigger`, `QueueTrigger`,
  `BlobTrigger`, `TimerTrigger`, `EventHubTrigger`, `CosmosDBTrigger`) and binding
  attributes on parameters, return values, and output DTO properties.
- Trace DI-registered helpers, `HttpClient`, SDK clients, exception filters,
  `catch`, Polly policies, `RetryOptions`, dead-letter calls, and
  `ServiceBusMessageActions` settlement. A thrown exception may already cause a
  host retry or broker dead-lettering; state whether the downstream consumer is visible.
- Look for semantic routing in `switch`, chained predicates, regexes, and dictionaries;
  investigate `Azure.AI.OpenAI`, `OpenAI`, `Microsoft.Extensions.AI`,
  `Microsoft.Agents.AI`, and Semantic Kernel call sites.
- .NET is a supported Hosted Skills language. Recommend the Hosted Skills
  integration inside the same .NET app. Confirm exact type and attribute names from
  current official documentation or installed package source; if they aren't
  available, keep them as labeled placeholders. Never recommend a separately hosted
  Python skill called over HTTP. In-process apps should plan an isolated-worker
  migration as an adoption cost.

## Node.js / TypeScript

- `package.json` identifies `@azure/functions`; inspect the configured `main` files.
  v4 uses `app.http`, `app.storageQueue`, `app.serviceBusQueue`, `app.timer`, etc.,
  `input.*`, `output.*`, and `extraInputs`/`extraOutputs`. v3 uses `function.json`
  and exported handlers. Follow registration imports rather than assuming every
  JavaScript file is a function.
- Inspect `catch`, rejected promises, retry packages, `setTimeout` loops, regexes,
  `switch`, keyword maps, and actual OpenAI/AI SDK calls.
- Hosted Skills doesn't support Node.js today. Keep the opportunity evidence, but
  label adoption blocked and omit the sketch. Don't suggest sending work to a
  separately deployed Python skill.

## Java

- Check `pom.xml` or Gradle dependencies and `@FunctionName`, `@HttpTrigger`,
  `@ServiceBusQueueTrigger`, `@QueueTrigger`, and other binding annotations.
  Include output parameters and generated binding metadata only as corroboration.
- Trace `catch`, Spring Retry or resilience policies, dead-letter senders,
  `Pattern`/`Matcher`, routing tables, and model-client calls.
- Record Java's annotation-based programming model. Hosted Skills doesn't support
  Java today; label adoption blocked, omit the sketch, and never invent a Java
  annotation or suggest a separate Python skill.

## PowerShell

- Inspect per-function `function.json`, `run.ps1`, `profile.ps1`, and
  `requirements.psd1`. Inventory binding `type`, `direction`, path, and connection
  setting names, plus `Push-OutputBinding` usage.
- Trace `try`/`catch`, `$ErrorActionPreference`, `-ErrorAction`, retry loops,
  `Start-Sleep`, `switch -Regex`, `-match`, and direct model REST calls.
  Nonterminating errors do not always enter `catch`; avoid assuming they do.
- Record the script/function.json model. Hosted Skills doesn't support PowerShell
  today; label adoption blocked, omit the sketch, and don't suggest a separate
  Python skill.

## Coverage limits

Report dynamic registrations, unavailable helpers, missing binding metadata, and
ambiguous languages. Missing recovery source means "not found in inspected scope",
not proof that no external recovery process exists. Generated output can corroborate
an inventory but must not replace reading available canonical source.
