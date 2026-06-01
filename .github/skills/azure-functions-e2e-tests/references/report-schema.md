# E2E Report Schema

## Evidence JSON structure

Each test case produces one JSON record:

```json
{
  "testCaseId": "TC-S1-GHCP-LOCAL",
  "agent": "ghcp",
  "installMode": "local",
  "scenario": "S1-install-chat",
  "status": "pass | fail | blocked | unsupported",
  "startedAt": "2026-05-31T00:00:00Z",
  "completedAt": "2026-05-31T00:03:00Z",
  "commands": [
    {
      "id": "S1GL-1",
      "command": "mkdir -p ...",
      "cwd": "/path/to/workspace",
      "exitCode": 0,
      "stdoutExcerpt": "...",
      "stderrExcerpt": "",
      "timestamp": "2026-05-31T00:00:01Z"
    }
  ],
  "fileChecks": [
    {
      "path": ".github/agents/functions-copilot.agent.md",
      "expected": "exists",
      "actual": "exists",
      "size": 4521,
      "contentExcerpt": "# functions-copilot...",
      "status": "pass"
    }
  ],
  "issues": [],
  "analysis": "All expected files present, no bloated content."
}
```

## Run summary JSON

```json
{
  "runId": "20260531-001",
  "packageVersion": "0.0.3-preview",
  "platform": "windows",
  "startedAt": "2026-05-31T00:00:00Z",
  "completedAt": "2026-05-31T01:00:00Z",
  "expectedCommandCount": 99,
  "actualCommandCount": 95,
  "missingCommandIds": ["S1GP-9", "S1GP-10", "S1XP-6", "S2GP-8"],
  "testCases": {
    "total": 12,
    "pass": 8,
    "fail": 1,
    "blocked": 3,
    "unsupported": 0
  },
  "results": [
    { "testCaseId": "TC-S1-GHCP-LOCAL", "status": "pass" },
    { "testCaseId": "TC-S1-GHCP-PLUGIN", "status": "blocked" }
  ]
}
```

## HTML report structure

The HTML report MUST include these sections in order:

### 1. Header
- Run ID, timestamp, package version, platform, git commit

### 2. Summary cards
- Total test cases with pass/fail/blocked/unsupported counts
- Expected vs actual command count
- Overall status badge

### 3. Test case matrix table
| Test Case | Agent | Mode | Scenario | Status |
|-----------|-------|------|----------|--------|

### 4. Per-test-case details
Each test case in a collapsible `<details>` element:

```html
<details>
  <summary>TC-S1-GHCP-LOCAL — PASS</summary>
  <h4>Commands executed</h4>
  <table>
    <tr><th>ID</th><th>Command</th><th>Exit</th><th>Time</th></tr>
    <tr><td>S1GL-1</td><td><code>mkdir -p ...</code></td><td>0</td><td>0.1s</td></tr>
  </table>

  <h4>Command output</h4>
  <details>
    <summary>S1GL-2: install --local --agent ghcp</summary>
    <pre>Azure Functions Skills installed locally.
  Updated agents: ghcp
  Workspace files written: 64
  ...</pre>
  </details>

  <h4>File verification</h4>
  <table>
    <tr><th>File</th><th>Expected</th><th>Actual</th><th>Size</th></tr>
    <tr><td>.github/agents/functions-copilot.agent.md</td><td>exists</td><td>exists</td><td>4521</td></tr>
  </table>

  <h4>Analysis</h4>
  <p>All checks passed. No bloated files detected.</p>
</details>
```

### 5. Issues found
Table of actionable issues with severity (CRITICAL/HIGH/MEDIUM/LOW).

### 6. Machine-checkable counters
```
Expected commands: 99
Actual commands: 95
Missing: S1GP-9, S1GP-10, S1XP-6, S2GP-8
Run status: INCOMPLETE (4 commands missing)
```

### 7. Recommendations
Prioritized list of fixes based on failures.

## Status definitions

| Status | Meaning |
|--------|---------|
| `pass` | All required checks passed with evidence |
| `fail` | Required behavior broken or contradicts expectations |
| `blocked` | Cannot run due to missing CLI, auth, or prerequisites |
| `unsupported` | Agent/platform does not support this flow by design |
| `incomplete` | Test case partially executed (some commands missing) |

## HTML styling requirements

- Use a clean, professional CSS (no external dependencies)
- Green for pass, red for fail, yellow for blocked, gray for unsupported
- Collapsible details for command outputs (default collapsed)
- Monospace font for command text and output
- Responsive layout
- Print-friendly
