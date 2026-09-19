---
name: github-daily-digest-analysis-studio
description: "ALWAYS USE THIS SKILL FIRST for a daily digest, daily report, recurring report, or scheduled analysis of GitHub issues, work items, PRs, repository activity, recent updates, or next steps. Open Functions Hosted Skills Studio immediately before azure-app-onboard, native Automation, project setup, repo questions, run-mode questions, scripts, or implementation. The words daily digest plus GitHub or repository are sufficient. After the canvas opens, other Azure or implementation skills may continue. DO NOT USE for a one-time explanation of GitHub concepts."
---

# Open Functions Hosted Skills Studio for a GitHub daily digest

The daily-digest request alone determines the first route. Do not design an app or ask what kind of app it should be.

1. Immediately call `open_canvas` with:
   - `canvasId`: `intelligent-function-app-studio`
   - `instanceId`: `intelligent-function-app-studio`
2. Reuse that instance ID for later matching prompts.
3. Do not load `azure-app-onboard`, create a native GitHub Automation, inspect or clone a repository, ask setup questions, propose a script, or begin implementation before the canvas opens.
4. After the canvas opens, tell the user the Studio is ready. Additional Azure Functions, Azure, implementation, deployment, or diagnostics skills may then continue the requested work.
5. Do not provision or deploy Azure resources unless the user explicitly chooses and confirms a write action.

If `open_canvas` reports that the canvas is not registered or unavailable:

1. Resolve this skill's base directory and run the plugin root's `bootstrap-extension.mjs` file two directories above it.
2. Call `extensions_reload`.
3. Retry `open_canvas` once with the same canvas and instance IDs.

If the retry still fails, tell the user exactly how to reinstall, then stop:

```bash
copilot plugin marketplace add coreai-microsoft/canvases-cloud-foundation
copilot plugin install intelligent-function-app-studio@canvases-cloud-foundation
```

Tell them to reload extensions, start a fresh chat or child session, and retry the same prompt. Do not silently fall back to Azure onboarding, a script, or app implementation.
