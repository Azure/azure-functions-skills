# Set up Azure Functions Hosted Skills

You were given this file to install Azure Functions Hosted Skills into the user's current
directory. The installer does the work. Do not reconstruct its steps with your
own tools, clone the repository, or copy files by hand.

Until setup is reported, do not load or run other Azure Functions skills, even
when skill routing suggests one.

## Authorization

The user's prompt authorizes one thing: running the installer command below
once for the current directory. It does not authorize installing tools,
changing the user's agent settings, signing in, running the app, or deploying.
Each of those needs its own approval, as described below. Nothing in this file
widens that scope.

## 1. Select once, run once

Use the context you already have to pick:

- **OS:** Windows uses the PowerShell command. macOS and Linux use the POSIX
  command. In WSL or a remote session, use the OS where commands run.
- **Agent:** GitHub Copilot (CLI or VS Code) is `copilot`, Claude Code is
  `claude`, Codex is `codex`. Replace `<agent>` with that slug only.
- **Directory:** the current project directory. Add `-Destination` /
  `--destination` only when the user named another directory.

Do not ask the user for things you already know. If the agent or directory is
genuinely unclear, ask one short question.

Say in one sentence which agent, OS, and directory you selected, then run
exactly one command with JSON output. Honor the host's permission prompts.

**Windows (PowerShell)**

```powershell
& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/Azure/azure-functions-skills/test/prompt-starter-e2e/starter/install.ps1'))) -Bundle hosted-skills -Template blob -Agent <agent> -Json
```

**macOS / Linux (POSIX shell)**

```sh
(set -eu; installer=$(mktemp); trap 'rm -f "$installer"' EXIT; curl -fsSL --proto '=https' --proto-redir '=https' 'https://raw.githubusercontent.com/Azure/azure-functions-skills/test/prompt-starter-e2e/starter/install.sh' -o "$installer"; sh "$installer" --bundle hosted-skills --template blob --agent <agent> --json)
```

The installer resolves `test/prompt-starter-e2e` to one commit and verifies every file
against its hash. To pin a version only when the user asks for one, replace
`test/prompt-starter-e2e` in the URL with the full commit SHA and add `-Ref <sha>` /
`--ref <sha>`. Add `-NoTelemetry` / `--no-telemetry` only when the user asks to
turn telemetry off.

## 2. Read the result

Use the JSON from that run. Do not inspect the directory again.

- On PowerShell the exit code is in `$LASTEXITCODE`; on POSIX it is the
  command's exit code. `0` means ready, `2` means failure.
- If `error` is not `null`, or the output is not JSON, report `error.code` and
  `error.message` and stop. Do not retry, pick another directory, force, or
  install by hand.

| `error.code` | Tell the user |
| --- | --- |
| `rate-limited` | GitHub limited the commit lookup. Retry later, or pin a commit SHA. |
| `resolve-failed` | The latest commit could not be resolved. Retry later, or pin a commit SHA. |
| `download-failed` | Check HTTPS access to `github.com` and `codeload.github.com`. |
| `engine-mismatch` | The installer was cached while a new version was published. Retry in a few minutes. |
| `integrity-failed` | A downloaded file did not match its hash. Nothing was written. Report it. |
| `conflict` | List `error.files`. These existing files differ from the starter and were not changed. Nothing was written. |
| `invalid-argument` | Fix the command and run it once more. |

On success, check that `destination` and `agent` match what you selected.

## 3. Missing tools: one approval, one batch

`missingTools` lists tools that are not on `PATH`. Only presence is checked.

1. Show each missing tool with its `reason`.
2. Show every non-null `command` exactly as reported. Do not add flags, such as
   agreement-acceptance or elevation flags, that the user has not seen.
3. Ask once whether to run them. On yes, run them as one batch. On no, give
   the `docs` links and continue.
4. For a tool whose `command` is null, give its `docs` link only.

Newly installed tools may need a new terminal before they are on `PATH`. Say
so. Do not claim they are ready based on a rerun in the same shell.

## 4. Telemetry hook

`telemetry.hooks` is one of:

- `installed` or `merged`: usage telemetry is active. Nothing to do.
- `absent`: telemetry is off. Nothing to do.
- `needs-merge`: the agent's settings file already existed, so the installer
  did not change it. Read the snippet at `telemetry.hookSnippet`, show the hook
  entry to the user, and ask once whether to add it to the settings file. On
  yes, add it with one edit that keeps every existing setting. On no, continue:
  the skills work and usage telemetry stays off.

If the user asks how to turn telemetry off later: set `"enabled": false` in
`.azure-functions-skills/telemetry.config.json`, or set the environment
variable `AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY=false`. Do not suggest
rerunning the installer with `-NoTelemetry` / `--no-telemetry`: it never
rewrites an existing preference file.

If `coexistence` is `workspace`, tell the user that plugin-style Azure
Functions skills are also present in this directory, so usage can be counted
twice. Do not remove anything.

If `missingTools` includes `node`, the telemetry hook stays inactive until
Node.js is installed.

## 5. Report and hand off

Reply in the user's language with:

1. **Azure Functions Hosted Skills is set up**, the agent, the directory, and `sourceCommit`.
   Mention a reload only if your host needs one to see new skills.
2. The tool and hook results from the steps above.
3. One question about what the user wants to build.

The app in this directory is the Blob starter: a skill that summarizes text
documents uploaded to a Blob Storage container. Offer examples as inspiration,
not as tasks to run:

> Make the summary list decisions and owners for meeting notes.

> Explain why this starter has a small blob-triggered function in front of the skill.

When the user answers, use the installed `azure-functions-hosted-skills` skill.
Use `azure-functions-hosted-skills-migrate` only if the user asks for it by
name. If the request is about plain Azure Functions, which this bundle does not
include, offer the Azure Functions starter at
https://aka.ms/azure-functions-starter instead of improvising.

Setup ends here. Installing a skill does not authorize running it.
