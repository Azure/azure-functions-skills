# E2E Report Schema

## Evidence JSON

Each test case produces one record:

```json
{
  "testCaseId": "TC-S1-GHCP-LOCAL",
  "agent": "ghcp",
  "installMode": "local",
  "scenario": "fresh-install",
  "status": "pass",
  "startedAt": "2026-05-31T00:00:00Z",
  "completedAt": "2026-05-31T00:01:00Z",
  "commands": [
    {
      "id": "S1GL-2",
      "command": "$CLI install --local --agent ghcp --dir $WS",
      "cwd": "/path/to/repository",
      "exitCode": 0,
      "stdoutExcerpt": "Azure Functions Skills locally installed.",
      "stderrExcerpt": "",
      "timestamp": "2026-05-31T00:00:01Z"
    }
  ],
  "fileChecks": [
    {
      "path": ".github/skills/azure-functions-help/SKILL.md",
      "expected": "exists",
      "actual": "exists",
      "status": "pass"
    }
  ],
  "issues": [],
  "analysis": "The local layout contains skills, MCP, and telemetry hooks only."
}
```

## Run summary JSON

```json
{
  "runId": "20260531-001",
  "packageVersion": "0.0.5-preview",
  "platform": "windows",
  "expectedCommandCount": 38,
  "actualCommandCount": 38,
  "missingCommandIds": [],
  "testCases": {
    "total": 6,
    "pass": 6,
    "fail": 0,
    "blocked": 0,
    "unsupported": 0
  }
}
```

## HTML report sections

1. Header: run ID, timestamps, package version, platform, and git commit.
2. Summary cards: pass/fail/blocked counts and expected/actual commands.
3. Test matrix: test case, agent, scenario, and status.
4. Per-case `<details>` sections with command and file evidence.
5. Issues found with severity.
6. Machine-checkable counters.
7. Cross-check results.

## Status definitions

| Status | Meaning |
| --- | --- |
| `pass` | Every required command and check passed with evidence. |
| `fail` | Supported behavior failed or contradicted expectations. |
| `blocked` | Node.js or another required local prerequisite was unavailable. |
| `incomplete` | One or more required commands lack evidence. |

Reports must use dependency-free, responsive, print-friendly HTML with collapsible command output.
