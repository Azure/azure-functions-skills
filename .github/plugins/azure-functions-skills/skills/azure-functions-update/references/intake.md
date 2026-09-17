# Confirm the target and the user's outcome

The reusable skill does not need a customer repository or fixed target version in
advance. Resolve them during each migration. Use facts already supplied; ask one
material question at a time.

## Select the app

If the request clearly selects the current workspace or a named repository, use that
target without asking again. Otherwise ask which workspace or repository to migrate.
Do not infer that this skill's own repository is the customer app.

Apply [processing and action permissions](permissions.md) before content reads, checkout,
or clone. After permitted inspection, record the path, current commit/ref and uncommitted
changes; for a non-Git workspace, agree a reproducible baseline snapshot.
If the target contains several apps, identify them and ask which are in scope.
The observed baseline is not the proposed destination version.

## Ask about behavior, with evidence

Ask which user-visible outcomes must not change. Use the user's answer and permitted
code/tests to propose concrete contracts, rather than asking the user to enumerate
every technical detail. Examples include response shape, error behavior, duplicate
processing, message settlement, schedules, and existing orchestration progress.

If the user does not know, offer a small set of observed examples and their expected
results for confirmation. Existing code is evidence of behavior, not proof that every
current defect is intentional. Record uncertain or conflicting expectations.
Do not fabricate customer acceptance. Block only changes that depend on an unresolved
important contract.

Create requirement IDs with [the requirement record](requirements.md). Each agreed
business scenario needs a final E2E path: trigger/input, selected environment,
observable business output, and expected result independent of the new implementation.
Ask the customer to resolve business ambiguity, not internal API trivia.

## Confirm the destination after research

Present the observed baseline and a supported proposed target with host, model, TFM,
SDK/worker/extension constraints, OS/SKU assumptions, stage order, and support deadline.
Explain what changes, what stays fixed, and what remains unknown.
Ask whether to proceed with that destination; "latest" alone is not a target tuple.

Obtain candidate-resolution permission before restore. Confirm actual resolved versions
before conversion; if they change the accepted destination or effects, return for approval.
An existing grant can cover a stated version range. Do not ask again for unchanged facts.

Explain a blocker with its effect, options, and the next useful user decision.
Evidence gaps and past expert corrections can be collected during work; their absence
is not a reason to require an upfront failure-history document.
