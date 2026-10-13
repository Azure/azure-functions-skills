---
name: azure-functions-help
description: "Discover the Azure Functions skill that best matches the user's goal"
---


# Azure Functions Help

Use this skill when the user asks what Azure Functions capabilities are available, where to start, or which Azure Functions skill to use.

1. Identify the user's immediate Azure Functions goal.
2. Inspect the available skills whose names start with `azure-functions-`.
3. Recommend at most three matching skills, with one short reason for each.
4. Invoke or direct the user to the best match.

For conversion of an existing local `SKILL.md` and its dependencies to a Hosted Skill, recommend
`azure-functions-hosted-skills-migrate`. For a new Hosted Skill with no source skill, use
`azure-functions-hosted-skills`. This conversion is not a Functions programming-model update.

Exceptions: `azure-functions-update` and `azure-functions-hosted-skills-migrate` require the
user to name the selected skill and ask to use or resume it. For an unnamed migration request,
recommend the matching skill and give an explicit-use
example; do not invoke it automatically. A question or quoted mention is not a run
request. Normal replies within an already selected migration do not need the name again.
The update workflow handles Functions model/configuration changes. Language-version updates
and hosting-plan changes are separate handoffs, not implied parts of the conversion.

Do not reproduce a static catalog when the runtime skill list is available. Do not route generic Azure work here unless the request involves Azure Functions, Function Apps, triggers, bindings, `host.json`, or Functions deployment/runtime behavior.