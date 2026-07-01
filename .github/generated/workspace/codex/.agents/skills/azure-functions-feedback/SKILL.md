---
name: azure-functions-feedback
description: "Turn session findings into previewed issues or pull requests for the Azure Functions skills repository"
---


> **Language**: Always respond in the same language the user is using.

# azure-functions-feedback — Azure Functions Skills Feedback

Use this skill after an Azure Functions skill workflow when the session reveals an improvement opportunity for the `azure-functions-*` skills, their references, tests, README, or generated plugin payload.

## When to use

Use this skill when:

- The user asks to send feedback, create an issue, or create a pull request for Azure Functions Skills.
- A workflow uncovered confusing guidance, missing verification, outdated commands, wrong MCP tool usage, repeated recovery steps, or missing diagnostics evidence.
- The agent needed user correction about an `azure-functions-*` skill.
- A manual or E2E test produced reusable findings.

Do not use it for ordinary app bugs unless the finding is about the skill suite itself.

## Workflow

### 1. Review the session

Review the available conversation/session history, files changed, test output, and command results. Identify only actionable feedback related to this repository:

- affected skill or file (`azure-functions-create`, `azure-functions-deploy`, README, routing, references, tests, etc.)
- observed behavior
- expected behavior
- evidence from the session
- repro steps or scenario
- proposed fix or documentation change
- risk / impact

Redact secrets, tenant-specific sensitive data, function keys, publish profiles, tokens, connection strings, and customer data. Keep only resource names or URLs that the user explicitly allows to share.

### 2. Ask whether to proceed

If feedback is likely useful, ask the user whether they want to provide it. Keep the prompt concise:

> I found feedback that could improve Azure Functions Skills. Would you like to preview it as an Issue or a Pull Request?

Options:

- Issue
- Pull Request
- Not now

Do not create external GitHub artifacts without explicit user confirmation.

### 3. Prepare a preview

Before creating anything, show a preview with this structure:

```
Title:
Summary:
Affected area:
Evidence:
Repro / scenario:
Expected behavior:
Proposed change:
Validation plan:
Redactions applied:
```

Ask the user to approve or edit the preview.

### 4. Issue path

After approval, search existing issues in `Azure/azure-functions-skills` before creating a new issue. Look for the preview title, affected area, and key symptom terms. Include both open and recently closed issues when the GitHub CLI or web UI supports it.

If an existing issue is the same topic, or is not identical but clearly similar enough to continue the conversation there, do not create a duplicate issue. Add a short comment with the new evidence or scenario instead. Report the existing issue URL to the user and explain that the feedback was added there.

If no similar issue exists, create a new issue in `Azure/azure-functions-skills` using the preview content.

Prefer the GitHub CLI when available. If it is unavailable, provide the prepared issue or comment body and ask the user to create or post it manually.

After creating an issue or adding a comment, report the issue URL and any follow-up action.

### 5. Pull Request path

After approval, implement the smallest safe change in this repository:

1. Create or switch to a focused branch.
2. Update canonical sources under `templates/`, README, tests, or docs as appropriate.
3. Regenerate generated plugin payload and marketplace files when canonical skill or agent files change.
4. Run validation (`npm run check` when practical; otherwise explain the narrower validation used).
5. Commit with a conventional commit message.
6. Push and open a pull request against `Azure/azure-functions-skills`.

Do not include unrelated local docs, PLAN files, secrets, generated temp files, or user-specific logs.

### 6. Output

End with:

- Issue or PR URL, if created or updated.
- Files changed, if PR path was used.
- Validation results.
- Any intentionally skipped feedback.

## Quality bar

- Feedback must be specific, actionable, and grounded in observed evidence.
- Prefer one issue/PR per cohesive topic.
- Do not overgeneralize from a single failure unless the skill guidance caused or failed to recover from it.
- Keep user language and tone.