# Evaluations

This folder contains optional evaluation scenarios for individual skills.

## Policy

- Evaluations are optional. A skill does not need an evaluation to ship.
- Add an evaluation only when a skill needs one, for example to measure a risky workflow.
- CI does not run evaluations. Do not add a `pull_request` trigger or a required check for them.
- Run an evaluation manually, on reviewed code, after the target, budget, and cleanup are approved.
- Skill quality comes first. Keep the evaluation framework small, so that the team spends
  its time on the skill content, not on the framework.

## Layout

Each scenario is in `evals/<skill-name>/<scenario>/`. The folder contains `eval.yaml`
in the Vally format, the fixtures, and a `README.md` that tells what the scenario checks.

| Skill | Scenario | Runner |
| --- | --- | --- |
| `azure-functions-update` | [dotnet-isolated](azure-functions-update/dotnet-isolated/README.md) | skill-bench (separate PR) |
