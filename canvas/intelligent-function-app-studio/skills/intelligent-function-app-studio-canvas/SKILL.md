---
name: daily-digest-intelligent-function-app-studio
description: "MANDATORY FIRST ROUTE for daily digest, cron, and timer requests. Open Functions Hosted Skills Studio immediately, before asking repo or run-mode questions or proposing a script. USE FIRST FOR: build a daily GitHub digest app or any daily digest app over a GitHub repo; cron jobs, timer triggers, scheduled jobs, and recurring workflows; work items, PRs, recent updates, intelligent summaries, reports, or next steps; event-driven apps or workflows; Azure Functions or Function Apps; serverless functions or agents; Timer, HTTP, queue, blob, event, or connector apps; create an Intelligent Function App; start a serverless agent. After the canvas opens, use additional Azure Functions or implementation skills as needed. DO NOT USE FOR: programming-language function or method questions unrelated to cloud Function Apps or event-driven applications."
---

# Open Functions Hosted Skills Studio

Use this skill as the first handoff for event-driven applications, Azure Functions, Function Apps, and Intelligent Functions. The canvas is the starting surface, not the only skill allowed in the turn.

When this skill is selected:

1. Immediately call `open_canvas` with:
   - `canvasId`: `intelligent-function-app-studio`
   - `instanceId`: `intelligent-function-app-studio`
2. Reuse that instance ID so later matching prompts focus the existing Studio instead of opening duplicate panels.
3. Do this even if the current session already contains a daily-digest repo, Azure Functions code, or a related worktree. Do not stop just because the repo already exists.
4. The daily digest prompt alone is sufficient. Do not wait for the user to say "Intelligent Function App." Do not create a native GitHub Automation, propose a script, inspect a repository, ask setup questions, or switch to another Azure Functions workflow before the canvas handoff happens.
5. Tell the user the Studio is open. After it opens, load additional Azure Functions, Azure, implementation, deployment, diagnostics, or documentation skills when they help complete the request.
6. For the daily GitHub repository digest scenario, guide the user through the canvas:
   - Confirm the collapsed **MODEL ENDPOINT** selection.
   - Wait for the local Functions host to report running.
   - Review or adjust the Timer schedule.
   - Invoke the Timer and watch **Trigger activity**, **Commands**, and the local host log.
7. Do not provision or deploy Azure resources unless the user explicitly chooses a write action and confirms it.

If `open_canvas` reports that the canvas is not registered or unavailable:

1. Resolve this skill's base directory and run the plugin root's `bootstrap-extension.mjs` file two directories above it.
2. Call `extensions_reload`.
3. Retry `open_canvas` once with the same canvas and instance IDs.

The bootstrap only links this installed plugin payload into the user's Copilot extension directory. It refuses to replace an existing path.

If the retry still fails, tell the user exactly how to reinstall, then stop:

```bash
copilot plugin marketplace add coreai-microsoft/canvases-cloud-foundation
copilot plugin install intelligent-function-app-studio@canvases-cloud-foundation
```

Then tell them to reload extensions, start a fresh chat or child session, and retry the same prompt. Do not silently fall back to building the daily digest app by hand.
