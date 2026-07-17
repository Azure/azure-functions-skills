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

Do not reproduce a static catalog when the runtime skill list is available. Do not route generic Azure work here unless the request involves Azure Functions, Function Apps, triggers, bindings, `host.json`, or Functions deployment/runtime behavior.