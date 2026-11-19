# Prompt starter

The prompt starter installs a bundle of Azure Functions skills into a project
directory from one pasted prompt. Its design is in
[FRD-0004](frds/0004-prompt-starter-onboarding.md).

## How it works

1. The user pastes the bundle's prompt (see the [README](../README.md)). The
   prompt names an aka.ms link and authorizes one installer command for the
   current directory.
2. The link redirects to the bundle's generated `start.md` under
   [`starter/`](../starter/). `start.md` tells the agent to pick the OS and its
   own agent slug, and to run one command.
3. `install.ps1` or `install.sh` resolves the branch to one commit SHA (from the
   GitHub API, or, when the anonymous API is rate limited, from the repository's
   Git ref advertisement on `github.com`), downloads
   that commit's archive from `codeload.github.com`, extracts only `starter/`,
   and runs the bootstrap.
4. The bootstrap verifies every selected file against its SHA-256 hash, checks
   every destination before writing, creates missing files without overwriting
   any existing file, inventories tools, and prints one JSON report.
5. The installer sends one setup event unless telemetry is opted out.

The only prerequisites are Windows PowerShell 5.1 or PowerShell 7 on Windows,
or `sh`, `curl`, `tar`, `awk`, `mktemp`, and `sha256sum` or `shasum` on macOS
and Linux. On Windows, the installer uses `%SystemRoot%\System32\tar.exe`
(Windows 10 1803 and later).

## Bundles

| Bundle | Link | Skills |
| --- | --- | --- |
| `functions` | `https://aka.ms/azure-functions-starter` | The 12 Azure Functions skills |
| `hosted-skills`, templates `timer`, `queue`, `servicebus`, `blob`, `cosmos` | `https://aka.ms/hosted-skills-<template>-starter` | The 5 Hosted Skills and Connector skills, one starter sample app, and `AGENTS.md` / `CLAUDE.md` / `.github/copilot-instructions.md` |

Bundles are defined in [`starter.config.json`](../starter.config.json). A skill
belongs to at most one bundle. A bundle can define app templates, each with its
own link and `start.md`; the installer then needs `-Template` / `--template`.
Template apps are a pinned cache of the upstream sample that the
[Azure Functions templates manifest](https://cdn.functions.azure.com/public/templates-manifest/manifest.json)
names for the template's `manifestId` (see `starter.lock.json` and
[development.md](development.md)). The installer never contacts the manifest or
the sample repository. The installed app records its origin in
`.azure-functions-skills/templates/<template>.json`. A sample without its own
`.gitignore` gets a default one that ignores `local.settings.json`, `.env`, and
local build and emulator state. A template bundle is meant
for a new, empty directory: an existing `README.md` or `AGENTS.md` that differs
stops the run with `conflict`, and nothing is written.

## Installer arguments

| PowerShell | POSIX | Meaning |
| --- | --- | --- |
| `-Bundle <name>` | `--bundle <name>` | Bundle to install. Required. |
| `-Template <name>` | `--template <name>` | App template, for bundles that have templates. |
| `-Agent <slug>` | `--agent <slug>` | `copilot`, `claude`, or `codex`. Required. |
| `-Destination <path>` | `--destination <path>` | Target directory. Default: current directory. |
| `-Ref <sha>` | `--ref <sha>` | Full commit SHA to install instead of the latest `main`. |
| `-Check` | `--check` | Compute the report without writing anything. |
| `-Json` | `--json` | Print the JSON report. |
| `-NoTelemetry` | `--no-telemetry` | Write a disabled preference on a fresh install and send no setup event. |

The PowerShell installer runs as a script block, so execution policy does not
apply, and it never exits the caller's session. Its result is in
`$LASTEXITCODE`. The POSIX installer returns the exit code.

| Exit code | Meaning |
| --- | --- |
| `0` | Ready |
| `1` | `-Check` found files that are not installed |
| `2` | Failure; see `error.code` |

## Installed layout

| Agent | Skills | Hook file |
| --- | --- | --- |
| GitHub Copilot | `.agents/skills/` | `.github/hooks/azure-functions-skills.json` |
| Claude Code | `.claude/skills/` | `.claude/settings.json` (created only when absent) |
| Codex | `.agents/skills/` | `.codex/hooks.json` (created only when absent) |

Shared state lives in `.azure-functions-skills/`:

```text
.azure-functions-skills/
  telemetry.config.json   {"enabled": true|false}
  runtime.json            install record for the runtime and hook files
  <bundle>.json           install record for the bundle's files
  hooks/<agent>.json      the hook snippet, for a manual merge
  runtime/                telemetry runtime (telemetry.mjs and its notices)
```

## Report

```json
{
  "schemaVersion": 1,
  "mode": "apply",
  "ready": true,
  "bundle": "functions",
  "template": null,
  "agent": "claude",
  "destination": "/path/to/app",
  "sourceCommit": "<sha>",
  "installed": { "bundleCommit": "<sha>", "runtimeCommit": "<sha>" },
  "skills": ["azure-functions-help"],
  "files": { "created": 70, "current": 0, "outdated": 0, "modified": 0 },
  "missingTools": [{ "tool": "func", "reason": "...", "command": null, "docs": "https://..." }],
  "telemetry": { "preferenceEnabled": true, "hooks": "installed", "hookSnippet": null },
  "coexistence": "none",
  "error": null
}
```

On failure the report is
`{"schemaVersion":1,"ready":false,"error":{"code":"...","message":"..."}}`;
a `conflict` error also lists `files`.

| `error.code` | Cause |
| --- | --- |
| `resolve-failed` | The commit lookup failed or returned an invalid value. |
| `rate-limited` | The commit lookup returned HTTP 403 or 429, and the Git ref advertisement fallback also failed. Retry later, or pin a SHA with `-Ref`. |
| `download-failed` | The archive download or extraction failed. |
| `engine-mismatch` | The archive needs a newer installer than the cached `install.*`. Retry in a few minutes. |
| `integrity-failed` | A payload file did not match its hash, or the manifest is invalid. |
| `conflict` | An existing file differs and has no install record, or an apply path is a link. Nothing was written. |
| `invalid-argument` | Unknown bundle, template, agent, or another invalid argument. |

## File states and reruns

Each install record keeps the hash of every file the installer created. On
every run each payload file gets one state:

| State | Condition | Action |
| --- | --- | --- |
| `missing` | The destination does not exist | Created |
| `current` | The file equals the incoming version | None |
| `outdated` | The file equals the recorded version; the incoming version differs | None; reported |
| `modified` | The file has a record and differs from both versions | None; reported |
| `conflict` | The file has no record and differs from the incoming version | Whole run stops |

So a rerun after `main` moved, or a second bundle from a later commit, is safe.
The installer never overwrites a file. An update mode that replaces `outdated`
files is planned after version 1.

## Telemetry hook

The hook command is `node -e` with a POSIX and a PowerShell form. It walks from
the current directory up to the project root: the host's project directory, or
the nearest directory that contains `.git` or the agent's hook file. It loads
`.azure-functions-skills/runtime/telemetry.mjs` only from that root. When it
finds no root before the home directory or the file-system root, it loads
nothing. Without Node.js, or without the runtime, it does nothing.

| `telemetry.hooks` | Meaning |
| --- | --- |
| `installed` | The hook file was created by the starter or equals the snippet. |
| `needs-merge` | A user-owned settings file existed. The installer did not change it; `start.md` has the agent offer to merge `hookSnippet` after approval. |
| `merged` | The user-owned settings file contains the starter hook. |
| `absent` | Telemetry is off, so no hook was written. |

Usage events from the starter carry `distribution: starter` and the name of the
bundle that installed the skill.

## Opt-out

Checked before any request, by both the installer and the hook runtime:

1. `-NoTelemetry` / `--no-telemetry`.
2. `AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY=false` or
   `AZURE_MCP_COLLECT_TELEMETRY=false`, in any letter case.
3. `.azure-functions-skills/telemetry.config.json` and the
   `.github/hooks/`, `.claude/hooks/`, and `.codex/hooks/` `telemetry.config.json`
   files in the destination and every ancestor. `"enabled": false`, invalid, or
   unreadable means disabled.

An existing preference file is never rewritten. Telemetry never changes the
setup result.

## Pinning a version

`install.*` itself is fetched from the `main` branch and is not hash-checked. For
a reviewed, pinned install, replace `main` in the raw URL with the full commit
SHA and pass the same SHA with `-Ref` / `--ref`. The installer then makes no
commit lookup and downloads exactly that commit.

## Security

The one-liner fetches and runs remote code. This is an approved exception to
the threat model in [SECURITY.md](../SECURITY.md) (FRD-0004, D-023), bound to
these controls: authorization comes only from the pasted prompt; HTTPS; one
immutable commit per run; SHA-256 checks for every payload file; safe-path and
no-link checks; no fallback source; `lint:security` allows the download-then-run
form only as the exact generated command line in a generated `start.md`; and
the hook loads code only from the project root.
