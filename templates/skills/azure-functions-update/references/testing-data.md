# Tests, large data, and ownership

Select tests from original behavior, existing tests, or an accepted business/external
contract. Do not change expected results merely because the new code produces them.

## E2E placement

Propose a distinct migration E2E area that follows customer conventions, for example
`tests/migration-e2e/`. Get approval for exact location, owner, and retention.
Keep it separate from existing customer tests and product code.

If repository ownership/retention is declined, propose an isolated temporary directory
outside the repository. That path, commands, data, retention, and cleanup need approval;
workspace permission does not cover the fallback. If neither location is approved,
mark new E2E creation blocked; existing approved checks can still run.

Record fixture owner, test command, environment, data classification, service ownership,
and handoff. Preserve exact test content or a permitted reproducible description before
removing temporary artifacts. Clean only run-owned tests, fixtures, and credentials.
Azure resource cleanup belongs to the Azure Skills handoff owner.

## Size is not a support boundary

Start with safe, bounded metadata under assessment approval. Do not read a huge table
or repository in full to decide whether sampling is needed. Ask for available size
estimates when even metadata collection exceeds the allowed scope.

Propose run-specific limits and a reproducible selection rule:

- Files, projects, functions, dependencies, rows, events, objects, and bytes.
- Maximum elapsed time, model use, network, service cost, and retained data.
- Included/excluded paths, generated content, functions, and data classes.
- Selection strata, seed, query/time range, or synthetic fixture generator.
- Coverage reason, privacy effects, retention, and remaining risks.

Get user approval before collection. No universal size threshold silently excludes an
app. Prefer synthetic or redacted fixtures where production records are not permitted.
A runner's lower limit produces partial results, not an undocumented smaller sample.

Keep functional checks separate from full-volume, load, and performance checks.
For huge tables or applications, state which behavior the sample reproduces and which
requires customer acceptance. Emulator throughput does not establish production capacity.
Avoid collecting business data into agent context when an approved local assertion and
redacted result can supply the necessary evidence.
