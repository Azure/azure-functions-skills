# FRD-0004: Prompt-driven starter onboarding

| Metadata | Value |
| --- | --- |
| Status | Finalized |
| Revision | 12 |
| Created | 2026-11-14 |
| Updated | 2026-11-15 |
| Author | Claude Code, based on Tsuyoshi Ushio's requirements and decisions |
| Depends on | None. Extends the collector lookup defined by [FRD-0003](0003-azure-deployment-observation-telemetry.md) (ST-015) |
| Component | Shared infrastructure: starter build, installer scripts, and telemetry integration |

## 1. Summary

This is a proposal. A user pastes one short prompt into GitHub Copilot, Claude
Code, or Codex. The agent reads a `start.md` behind an aka.ms link, runs one
OS-specific one-liner, and the workspace has the selected Azure Functions skills
and telemetry hooks installed. The one-liner needs only PowerShell or a POSIX
shell. It reports missing tools together with install commands, which the agent
runs after one user approval.

The repository publishes independent starters from one engine. Version 1 has two:

| Bundle | Contents | Typical target | Link |
| --- | --- | --- | --- |
| `functions` | The 12 Azure Functions skills | New or existing Functions project | `aka.ms/azure-functions-starter` |
| `hosted-skills` | The 5 Hosted Skills and Connector skills, plus one cached app template (`timer` in version 1) | New app directory | `aka.ms/hosted-skills-timer-starter` |

The `hosted-skills` bundle selects its starter app template by name. Version 1
has one template, `timer` (the daily-blog sample). Each template has its own
aka.ms link, so templates can be added or replaced later without changing the
bundle or its skills.

The design ports the prototype at
`TsuyoshiUshio/azure-functions-hosted-skills-starter` into this repository and
generalizes it.

## 2. Motivation / problem

Today's onboarding is a plugin install: several host-specific commands, then a
separate request to run `azure-functions-setup`. Node.js 20+ is a stated
prerequisite. Each step is an agent turn or a manual action.

The prototype showed a faster path that users liked: paste a prompt, and setup
finishes in one installer run. It has three layers:

1. `start.md` tells the agent to select the OS and agent, and to run one command.
2. `install.ps1` / `install.sh` resolve `main` to a commit SHA and download that
   archive.
3. `bootstrap.ps1` / `bootstrap.sh` read `cache/files.tsv` (scope, SHA-256,
   source, destination), verify bytes, stop on conflicts before any write, copy
   files, inventory tools, and print one JSON report.

Gaps that prevent reusing the prototype as it is:

- It lives in a personal repository and covers only Hosted Skills.
- Its skill cache is a pinned copy of this repository, built by a Python script.
  Skills drift until someone refreshes the cache.
- It reports missing tools with documentation links only.
- Its bootstrap path sends no setup event, so onboarding volume is not measurable.
- It stops on any differing file, including its own provenance record. That
  suits a one-time new app. The `functions` bundle is applied to existing
  projects and is re-run as `main` moves.

Gaps in this repository:

- Workspace hooks run `bash ...track-telemetry.sh`. On Windows this needs Git
  Bash. The prototype's `node -e` hook commands have a PowerShell form.
- Azure Functions Skills is in preview and may move to another public repository
  or split into several plugins. Onboarding must not depend on the current
  repository name.

## 3. Goals / non-goals

### Requirements and acceptance criteria

| ID | Requirement | Observable acceptance criterion |
| --- | --- | --- |
| ST-001 | Each starter has a generated `start.md` and a configured aka.ms link. The README prompt names only that link and states what the user authorizes. | Build test: each README prompt contains its configured link and the authorization sentence. Operational gate (not CI): the link resolves to the generated raw `start.md`. |
| ST-002 | Setup needs no prerequisite beyond Windows PowerShell 5.1 / PowerShell 7, or a POSIX shell with standard utilities. | Bootstrap tests pass with `node`, `python`, `git`, `az`, and `azd` absent from `PATH`, and under Windows PowerShell 5.1 with process execution policy `Restricted`. |
| ST-003 | Apply is one installer run that prints one JSON report with a fixed schema. A second run happens only as an optional check. | `start.md` has one apply command per OS. The report validates against the schema in section 4 for every test fixture. |
| ST-004 | The report lists missing tools with an OS-specific install command where one exists. `start.md` has the agent show the commands and run them together after one user approval. | `missingTools[]` entries have `tool`, `reason`, `docs`, and `command` (string or null). `start.md` specifies one approval question, one batch, and no agreement-acceptance flag that the user has not seen. |
| ST-005 | `functions` and `hosted-skills` install independently and can coexist in one workspace, including when installed from different commits. They share no skill. | Installing both in either order from one commit, and from two commits with different runtime bytes, exits 0. |
| ST-006 | Repository identity (owner, name, branch, path) is defined in one configuration file and embedded at build time. | A test builds with a fake repository; no generated file, URL, or archive directory name refers to the real one. |
| ST-007 | GitHub Copilot, Claude Code, and Codex are supported. | Per-agent tests assert the paths in the installed-layout table and the `clientName` each hook reports. |
| ST-008 | Usage telemetry works after starter setup on all three agents, and on Windows without Git Bash. | The installed hook command string, run verbatim in bash and in PowerShell from a subdirectory of the fixture, delivers one usage event to the local test transport. |
| ST-009 | The installer sends one setup event without Node.js. | Offline test captures one `AzureFunctionsSkillsStarterSetup` request with the specified envelope from each of `install.ps1` and `install.sh`. |
| ST-010 | Every existing opt-out is honored before any request, and telemetry never changes the setup outcome. | Zero requests with the flag, either environment variable (any letter case), a disabled or unreadable preference in the destination or an ancestor. Exit code is unchanged by an unreachable endpoint, an invalid preference file, or `-NoTelemetry` against an enabled preference. |
| ST-011 | Starter files are generated from `templates/` and are byte-identical on every OS. `npm run check` verifies them. | `npm run verify:starter-payload` fails after a hand edit under `starter/`; it passes on Windows and Linux checkouts of the same commit. |
| ST-012 | Downloaded content is integrity-checked. No file is overwritten in version 1. | Tests for a corrupted payload file, path traversal, a symlink in an apply path, and a differing file with no provenance record each exit 2 with nothing written. |
| ST-013 | A differing host settings file does not block installation, and the hook state has a stable end state. | With an existing differing `.claude/settings.json` or `.codex/hooks.json`: skills are applied, the file is byte-identical, `telemetry.hooks` is `needs-merge`, exit 0. After the hook is merged a check run reports `merged`. |
| ST-014 | The `hosted-skills` app template is selected by name, and each template has its own `start.md` and aka.ms link. Adding a template changes neither skills nor engine. | A build with a second fixture template emits a second `start.md` and template payload; skill payload and engine scripts are byte-identical. `-Template timer` applies only that template's files. |
| ST-015 | Deployment observation works after a starter install. | `azure-functions-deploy` and the Hosted Skills deployment reference name the starter runtime path; a test runs `deployment-observed` against the installed starter tree and gets a valid status. |
| ST-016 | A rerun after `main` has moved is safe. | With a bundle installed at commit X, a run at commit Y exits 0, writes no existing file, and reports each file as `current`, `outdated`, or `modified`. |
| ST-017 | The hook loads its runtime only from the project. | With a hostile runtime in an ancestor directory and none in the project, the hook sends nothing and executes nothing from the ancestor. |
| ST-018 | Existing plugin-style workspace assets are detected and reported. | With `.github/skills/azure-functions-*` or a `hooks/runtime/telemetry.mjs` present, the report has `coexistence: "workspace"`. |
| ST-019 | Installer failures are distinguishable. | Each failure in the failure table returns its `error.code`; a test with an HTTP 403 from the SHA lookup and a failed ref advertisement returns `rate-limited`; with a working ref advertisement the install succeeds with the advertised commit. |

### Non-goals

- Registering Azure MCP or any MCP server (v1; D-004).
- Changing how the plugin is installed. Both paths remain. The plugin payload is
  regenerated because usage events gain two properties.
- Changing the plugin's or the `dist/workspace` layout's hook command form.
  The `node -e` form is starter-only in version 1.
- Installing tools without user approval, signing in, running the app, or deploying.
- Updating or overwriting installed files (after v1; D-011).
- Migrating workspaces installed by the prototype repository.
- Moving skills to another repository or splitting the plugin. This FRD only
  keeps that move cheap (ST-006).
- A general JSON/TOML merge engine for host settings.

## 4. Proposed design

### Sources and bundle definition

Hand-written inputs live in two places. Everything under `starter/` is generated.

- `starter.config.json` at the repository root: repository identity, bundles,
  templates, tools.
- `templates/starter/`: engine scripts, `start.md` templates, hook snippets,
  instruction files, and the tool-install table.

```json
{
  "schemaVersion": 1,
  "source": { "repository": "Azure/azure-functions-skills", "branch": "main", "path": "starter" },
  "bundles": {
    "functions": {
      "akaLink": "https://aka.ms/azure-functions-starter",
      "skills": ["azure-functions-help", "azure-functions-setup", "azure-functions-create",
        "azure-functions-deploy", "azure-functions-best-practices", "azure-functions-diagnostics",
        "azure-functions-health-status", "azure-functions-inventory", "azure-functions-doctor",
        "azure-functions-common", "azure-functions-feedback", "azure-functions-update"],
      "tools": ["node", "func", "az", "azd"]
    },
    "hosted-skills": {
      "skills": ["azure-functions-hosted-skills", "azure-functions-hosted-skills-migrate",
        "azure-functions-connector-create", "azure-functions-connector-mcp",
        "azure-functions-connector-validate"],
      "templates": {
        "timer": {
          "akaLink": "https://aka.ms/hosted-skills-timer-starter",
          "repository": "Azure-Samples/functions-daily-blog-hosted-skills-azd",
          "commit": "<pinned SHA>"
        }
      },
      "tools": ["python", "func", "azurite", "azd", "az", "node"]
    }
  }
}
```

The build fails if a skill is listed in two bundles or is missing from
`templates/skills/`. A bundle without `templates` installs skills only and has
one `akaLink` of its own. A bundle with `templates` has one link per template.

### Generated layout

`npm run build:starter` (new module `src/starter/`) writes:

```text
starter/
  install.ps1  install.sh        shared engine: resolve SHA, download, call bootstrap
  bootstrap.ps1  bootstrap.sh    shared engine: verify, preflight, apply, report
  runtime/                       telemetry runtime tree and its files.tsv
  hooks/                         per-agent hook snippets
  functions/
    start.md  files.tsv  skill/...
  hosted-skills/
    files.tsv  skill/...  agent-files/...
    templates/timer/
      start.md  files.tsv  app/...
```

`starter/` is committed, like the plugin payload, so raw GitHub URLs work
without a release step. It joins the "never hand-edit" list in `AGENTS.md`.

- **Bytes.** `.gitattributes` gains `starter/** -text`. The build normalizes
  text to LF before hashing and writing, because this repository's working tree
  can be CRLF on Windows. Verify compares bytes.
- **Manifest.** `files.tsv` keeps the prototype's four columns and scopes
  (`common`, `agents`, `copilot`, `claude`, `codex`, `preference-on`,
  `preference-off`).
- **Engine.** The scripts are ported from the prototype with `-Bundle` /
  `--bundle` and `-Template` / `--template`. The template name is data read from
  the manifest path, not engine code. Repository identity, including the archive
  directory name, is substituted at build time.
- **App template cache.** The `timer` app files are a committed, pinned cache.
  `starter.lock.json` records the template commit and each file's hash; verify
  checks the cache against it offline. A refresh is an explicit maintainer
  command. `local.settings.json` is not committed: only
  `local.settings.json.sample` is cached, and `files.tsv` maps it to both
  `src/local.settings.json` and `src/local.settings.json.sample`.

### Flow

1. The user pastes the README prompt. The agent fetches the aka.ms link, which
   redirects to the raw `start.md`.
2. `start.md` has the agent select OS and agent slug from its own context, then
   run one command, for example:

   ```powershell
   & ([scriptblock]::Create((Invoke-RestMethod '<raw>/starter/install.ps1'))) -Bundle functions -Agent claude -Json
   ```

3. `install.*` resolves the branch to a commit SHA once, downloads that archive
   from `codeload.github.com`, extracts only `starter/` into a short temporary
   path, and calls bootstrap. `install.ps1` loads `bootstrap.ps1` as a script
   block with an explicit `-SourceRoot`, so no script file is executed and
   execution policy does not apply. Neither script calls `exit` inside the
   caller's session; the one-liner converts the result to an exit code.
4. Bootstrap verifies every selected file's SHA-256, runs the whole preflight
   before any write, copies with create-new semantics, inventories tools, writes
   a small result file for the installer, and prints the JSON report.
5. The installer reads the result file, sends the setup event when applicable,
   and removes its temporary directory.
6. The agent reports the result, handles `missingTools`, and asks what the user
   wants to build. For `functions` it hands off to `azure-functions-help`; for
   `hosted-skills` to the authoring or migration skill. When a skill routes to a
   skill of the other bundle that is not installed, the agent offers that
   bundle's starter link.

`install.*` also accepts `-Check` / `--check`, which performs steps 3 and 4
without writing and sends no event.

### Installed layout

| Agent | Skill root | Hook location | Reported `clientName` | Instructions (`hosted-skills` only) |
| --- | --- | --- | --- | --- |
| Copilot | `.agents/skills` | `.github/hooks/azure-functions-skills.json` (starter-owned) | `copilot-cli` | `AGENTS.md`, `.github/copilot-instructions.md` |
| Claude Code | `.claude/skills` | `.claude/settings.json` (user-owned) | `claude-code` | `AGENTS.md`, `CLAUDE.md` |
| Codex | `.agents/skills` | `.codex/hooks.json` (user-owned) | `codex` | `AGENTS.md` |

`codex` is added to the usage-event client names; the hook passes the client
explicitly instead of relying on input-shape inference. The prototype's guard
against Copilot CLI executing Claude hooks is ported.

Shared state:

```text
.azure-functions-skills/
  telemetry.config.json               preference: {"enabled": true|false}
  runtime.json                        runtime provenance and file hashes
  <bundle>.json                       bundle provenance and file hashes
  hooks/<agent>.json                  intended hook snippet (reference copy)
  runtime/
    telemetry.mjs  package.json  THIRD-PARTY-NOTICES.txt
    vendor/applicationinsights/package.json
```

The `functions` bundle writes no instruction files.

### File states and reruns (ST-012, ST-016)

Provenance records are installer-owned. They are never compared for conflicts
and are rewritten only by a run that creates files. For every payload file the
preflight computes one state:

| State | Condition | Version 1 action |
| --- | --- | --- |
| `missing` | Destination absent | Create |
| `current` | Bytes equal the incoming hash | None |
| `outdated` | Bytes equal the recorded baseline, incoming differs | None; reported |
| `modified` | Recorded, bytes differ from baseline and incoming | None; reported |
| `conflict` | No record, bytes differ from incoming | Stop the whole run, exit 2 |

The shared runtime follows the same table through `runtime.json`. A second
bundle installed from a later commit therefore finds the runtime `outdated`, not
in conflict, and keeps it. An outdated runtime still reports skill invocations;
reference files added after its build are not on its allowlist until the update
mode replaces it. The report shows `sourceCommit` and each installed record's
commit separately.

### Report schema (ST-003)

```json
{
  "schemaVersion": 1,
  "mode": "apply | check",
  "ready": true,
  "bundle": "functions",
  "template": null,
  "agent": "claude",
  "destination": "<path>",
  "sourceCommit": "<sha>",
  "installed": { "bundleCommit": "<sha>", "runtimeCommit": "<sha>" },
  "skills": ["..."],
  "files": { "created": 0, "current": 0, "outdated": 0, "modified": 0 },
  "missingTools": [{ "tool": "func", "reason": "...", "command": "... or null", "docs": "<url>" }],
  "telemetry": { "preferenceEnabled": true, "hooks": "installed | needs-merge | merged | absent", "hookSnippet": "<path or null>" },
  "coexistence": "none | workspace",
  "error": null
}
```

The setup-event result is not in the report, because the event is sent after it
is printed and must not affect it. Exit codes: 0 ready, 1 check mode found
missing files, 2 failure.

### Failure table (ST-019)

| `error.code` | Cause | What `start.md` has the agent say |
| --- | --- | --- |
| `resolve-failed` | SHA lookup failed or returned an invalid value | Retry later, or use a pinned SHA |
| `rate-limited` | SHA lookup returned 403/429 (unauthenticated limit, often shared egress) and the Git ref advertisement fallback also failed (D-035) | Retry later, or use a pinned SHA |
| `download-failed` | Archive download failed | Check GitHub HTTPS access |
| `engine-mismatch` | Archive needs a newer installer than the cached raw `install.*` | Retry in a few minutes |
| `integrity-failed` | A payload hash did not match | Stop; report the file |
| `conflict` | A `conflict` state file exists | List the files; nothing was written |
| `invalid-argument` | Unknown bundle, template, or agent | Fix the command |

The raw `install.*` can be older than the resolved commit because it is cached.
The archive carries an engine version; the installer stops with
`engine-mismatch` when the archive requires a newer one. There is no retry and
no fallback source. When the SHA lookup returns 403 or 429, the installer reads
the same branch from the same repository's Git ref advertisement
(`https://github.com/<repository>.git/info/refs?service=git-upload-pack`)
instead (D-035). This resolves the same commit; it is not another payload source.

### Prerequisite help (ST-004)

Bootstrap checks command presence only for the bundle's `tools`. It verifies no
versions, services, or sign-in; `azure-functions-setup` does that later.
`templates/starter/tool-install.json` holds, per tool and OS, the reason, the
documentation link, and an exact install command or null. Windows entries use
`winget install --exact --id <id>`; macOS entries use `brew`. Linux entries, and
tools without a single command such as Core Tools on Windows, have `command:
null` and a link. A unit test fails when a command in this file differs from the
table in `azure-functions-setup`.

`start.md` has the agent list the non-null commands verbatim, ask once, and run
them as one batch. The agent adds no agreement-acceptance or elevation flag that
was not shown. A new shell may be needed before the tools are on `PATH`, so the
agent says so and does not claim the tools are ready from a rerun in the same
shell.

Node.js is not needed to install. For the `functions` bundle it is listed first,
because `functions-tools.mjs` and the telemetry hooks need it.

### Telemetry (ST-008 to ST-010, ST-015, ST-017)

**Runtime.** The existing bundled runtime is reused. Required changes in
`src/telemetry/runtime.ts`:

- Export `runHook(client)` and guard the command-line entry so that an import
  does nothing. Today the file is a top-level script that needs `hook` in
  `argv` and exports nothing.
- Read the preference from `.azure-functions-skills/telemetry.config.json` when
  the runtime sits in `.azure-functions-skills/runtime/`, and add that path to
  the ancestor opt-out list that the file already builds for the three host
  directories.

**Hook command.** `node -e` with a bash and a PowerShell form. It looks for
`.azure-functions-skills/runtime/telemetry.mjs` only in the project root: the
host-provided project directory, or the nearest directory from the current
directory upward that contains `.git` or the agent's own hook file. When no
root is found before the home directory or the file-system root, it loads
nothing (D-032). It imports the file and calls `runHook`. With no
Node or no runtime it exits silently. Hook timeout is 8 seconds; the runtime
keeps its 5 second send and 5.5 second deadline.

**Properties.** Usage events gain two properties, set by the runtime and never
taken from hook input:

- `distribution`: `plugin`, `workspace`, or `starter`, from the runtime's location.
- `bundle`: the bundle whose provenance record lists the event's skill, or `none`.

Code impact: `ALLOWED_PROPERTIES`, the event type, enum validation, and the
property mapping in `sender.ts`; a parameter on `parseHookEvent`; derivation in
`runtime.ts`. The plugin payload is regenerated.

**Deployment observation.** `azure-functions-deploy/SKILL.md` and
`azure-functions-hosted-skills/references/infra-and-deployment.md` list where to
find the collector. Both gain `.azure-functions-skills/runtime/telemetry.mjs`.

**Setup event.** Sent by `install.*` with `Invoke-RestMethod` or `curl`, only in
apply mode and only when the run created at least one file. Hook state does not
matter. One POST to `<endpoint>/v2/track`, `Content-Type: application/json`,
5 second timeout, no retry, result ignored, no envelope tags:

```json
{
  "name": "Microsoft.ApplicationInsights.Event",
  "time": "<UTC ISO 8601>",
  "iKey": "<public instrumentation key>",
  "data": { "baseType": "EventData", "baseData": { "ver": 2,
    "name": "AzureFunctionsSkillsStarterSetup",
    "properties": { "distribution": "starter", "bundle": "functions", "template": "none",
      "agent": "claude-code", "os": "windows", "skillsVersion": "0.0.7-preview" } } }
}
```

`agent` uses the usage-event vocabulary (`copilot-cli`, `claude-code`, `codex`).
`os` is `windows`, `macos`, or `linux`. `skillsVersion`, the key, and the
endpoint are baked into the scripts at build time. Bootstrap passes
`filesCreated` and the preference state to the installer through a key=value
result file in the temporary directory, so the shell needs no JSON parser.

**Opt-out order.** Checked before any request, by both the installer and the
runtime:

1. `-NoTelemetry` / `--no-telemetry`.
2. `AZURE_FUNCTIONS_SKILLS_COLLECT_TELEMETRY` or `AZURE_MCP_COLLECT_TELEMETRY`
   equal to `false`, in any letter case.
3. `.azure-functions-skills/telemetry.config.json` and the three host
   `hooks/telemetry.config.json` paths, in the destination and every ancestor.
   `enabled: false`, invalid, or unreadable means disabled.

A fresh install writes `enabled: true`, or `enabled: false` with the flag. An
existing preference file is never rewritten. `-NoTelemetry` against an existing
enabled preference sends no setup event, leaves the file, reports
`preferenceEnabled: true`, and exits 0. An invalid existing preference is
reported and treated as disabled; it does not fail setup.

**Coexistence.** The starter and the plugin use different skill roots and hook
files, so installing both causes no file conflict and both hooks fire. The
installer reports plugin-style workspace assets it can see (ST-018), and
`start.md` tells the user. A user-level plugin install cannot be seen by the
installer. Version 1 discloses this possible double count in
`docs/internal/telemetry-release.md`; `distribution` lets reports separate the
two sources.

### Hook state (ST-013)

| State | Meaning | Exit |
| --- | --- | --- |
| `installed` | The hook file was created by the starter, or equals the intended bytes | 0 |
| `needs-merge` | A user-owned settings file exists and does not contain the runtime path marker | 0 |
| `merged` | A user-owned settings file contains the marker `.azure-functions-skills/runtime/telemetry.mjs` | 0 |
| `absent` | Telemetry was disabled at install, so no hook was written | 0 |

`needs-merge` applies only to `.claude/settings.json` and `.codex/hooks.json`.
The Copilot hook file is starter-owned and follows the file-state table. The
installer never edits a user-owned settings file. It writes the intended snippet
to `.azure-functions-skills/hooks/<agent>.json`. `start.md` has the agent show
the snippet, ask the user once, and add it with one edit only after approval. A
declined merge is a valid end state: skills work and usage telemetry is off.

### Trust boundaries

The one-liner fetches and executes remote code. `SECURITY.md` names "skills that
instruct the agent to fetch and execute remote content" as a
remote-code-execution vector, and `lint:security` exists to keep that pattern
out of skills. `start.md` is not a skill, but it is the same pattern. The
human owner accepted it as an explicit exception on condition of the controls
below (D-023). The controls are therefore requirements, not options.

Controls:

- **Authorization** comes only from the README prompt the user pastes. It names
  the scope: install the bundle into the current directory. `start.md` cannot
  widen it; tool installs and the hook merge each need their own approval.
- **Integrity.** HTTPS only; the branch is resolved once to an immutable SHA;
  every payload file is SHA-256 checked; safe-path and no-link checks; no
  fallback source.
- **Pinning.** `install.*` itself is fetched from the mutable branch and is not
  hash-checked. A pinned run uses the full SHA in the raw URL and in `-Ref`.
  `docs/starter.md` documents this for policies that require review.
- **Blast radius.** Every merge to the configured branch reaches new users
  immediately, and the aka.ms records are a second control point. Both are
  covered by the same review as the plugin payload; the owner of the aka.ms
  records is recorded in the decision.
- **Lint.** `lint:security` is extended to `templates/starter/` and `starter/`,
  detects the download-then-run and `scriptblock` forms, and allows exactly the
  generated one-liners.
- **Hook code loading** is bounded to the project (ST-017).
- No npm lifecycle script is added.

### Supported baseline

Windows PowerShell 5.1 on Windows 10 1809 or later (TLS 1.2 by default), or
PowerShell 7. macOS and Linux with `sh`, `curl`, `tar`, `awk`, `mktemp`, and
`sha256sum` or `shasum`.

### Delivery checkpoints

1. Engine and bundle definition: config, `templates/starter/`, `src/starter/`
   build, ported scripts with file states and failure codes,
   `verify:starter-payload` in `npm run check`. Human review.
2. `functions` bundle: `start.md`, prerequisite help, hook states. Manual run on
   each agent. Human review.
3. Telemetry: `runHook` export, properties, setup event, opt-out order,
   deployment-observation lookup.
4. `hosted-skills` bundle with the `timer` template: app template cache and
   lock, template selection, instruction files. Tested through
   `aka.ms/hosted-skills-timer-starter`. Human review before the existing
   `aka.ms/hosted-skills-starter` link is repointed.
5. CI matrix on Windows, macOS, and Linux; README and docs.

### Open questions

| # | Question | Owner |
| --- | --- | --- |
| 1 | Name who controls the aka.ms records. Resolved by D-025: Tsuyoshi Ushio. | Tsuyoshi Ushio |
| 2 | Approve or change the agent proposals D-006 to D-009 and D-016 to D-022. Resolved by D-024: approved as written. | Tsuyoshi Ushio |
| 3 | Double counting when the plugin and a starter are both active. Resolved by D-026: disclose only. | Tsuyoshi Ushio |

The repointing of the existing `aka.ms/hosted-skills-starter` link is a later
operational gate (D-012), not an implementation assumption.

### Updates after v1

Version 1 never overwrites an installed file. After v1, the installer gains an
update mode that replaces `outdated` files and leaves `modified` ones (D-011).
The prototype's `skills-update` skill is not ported.

## 5. Decisions log

| ID | Decision / options | Choice and rationale | Decided by | Date |
| --- | --- | --- | --- | --- |
| D-001 | Host the Hosted Skills starter here, or keep the prototype repository and sync from this one | Host both starters here. The prototype is a personal repository; one source removes double maintenance. | Tsuyoshi Ushio | 2026-11-14 |
| D-002 | Send a setup event from the installer, or send nothing at setup as the prototype's bootstrap does | Send it from the installer with PowerShell / curl, so onboarding is measurable without Node. | Tsuyoshi Ushio | 2026-11-14 |
| D-003 | Prerequisite help: links only, show commands only, or run after approval | One approval, then run the install commands as one batch. | Tsuyoshi Ushio | 2026-11-14 |
| D-004 | Register Azure MCP during starter setup | Not in the first version. | Tsuyoshi Ushio | 2026-11-14 |
| D-005 | Do Hosted Skills skills depend on `azure-functions-common` or `azure-functions-deploy` | No. They are separate, so the bundles share no skill. | Tsuyoshi Ushio | 2026-11-14 |
| D-006 | Starter files: committed generated output, release assets, or a separate repository | Committed under `starter/`, verified in `npm run check`. Raw URLs work without a release. Proposal; not approval. | Claude Code (proposal) | 2026-11-14 |
| D-007 | Telemetry runtime: this repository's bundled runtime, or the prototype's SDK-free runtime | This repository's runtime, with the prototype's hook command form. One event schema and one sender. Proposal; not approval. | Claude Code (proposal) | 2026-11-14 |
| D-008 | Existing differing hook/settings file: stop everything, merge in script, or report for an agent merge | Apply the rest and report `needs-merge`. A POSIX-shell JSON merge is fragile; a full stop blocks existing projects. Proposal; not approval. | Claude Code (proposal) | 2026-11-14 |
| D-009 | Portability: runtime parameter, or build-time constant from one config file | Build-time constant in `starter.config.json`. A move is a config change, a rebuild, and an aka.ms update. Proposal; not approval. | Claude Code (proposal) | 2026-11-14 |
| D-010 | aka.ms name for the `functions` bundle | `aka.ms/azure-functions-starter`. | Tsuyoshi Ushio | 2026-11-14 |
| D-011 | Update path: port the prototype's `skills-update` skill, or an installer update mode | Installer update mode, after v1, as the agent recommended. `skills-update` is not ported. | Tsuyoshi Ushio | 2026-11-14 |
| D-012 | Link for the Hosted Skills starter | Take `aka.ms/hosted-skills-timer-starter` and test with it, because other Hosted Skills starters may be supported later. Timing is about one week out. The bundle is named `hosted-skills-timer` to match (agent interpretation of the naming; corrected by D-015). | Tsuyoshi Ushio | 2026-11-14 |
| D-013 | Extra privacy review for the setup event | Not needed; the existing telemetry release process applies. | Tsuyoshi Ushio | 2026-11-14 |
| D-014 | Skills shared between bundles: forbid, or allow identical copies | Allow, so several Hosted Skills starters can reuse the five skills. Superseded by D-015. Proposal; not approval. | Claude Code (proposal) | 2026-11-14 |
| D-015 | How to allow other Hosted Skills starters later: one bundle per starter, or one `hosted-skills` bundle with a selectable app template | One `hosted-skills` bundle; the starter template is selectable and each template has its own aka.ms link (`timer` → `aka.ms/hosted-skills-timer-starter`). Corrects the agent's naming interpretation in D-012 and supersedes D-014: bundles again share no skill. | Tsuyoshi Ushio | 2026-11-14 |
| D-016 | Reruns and cross-commit installs: byte equality only, or provenance-based file states | File states from provenance records; only an unrecorded differing file is a conflict. Byte equality alone fails every rerun after `main` moves and every second bundle installed later (review B1, B2). Proposal; not approval. | Claude Code (proposal) | 2026-11-14 |
| D-017 | Hook entry: change the runtime to export `runHook`, or have the stub spawn `node <path> hook` | Export `runHook` with a guarded command-line entry; one process per hook. Proposal; not approval. | Claude Code (proposal) | 2026-11-14 |
| D-018 | Runtime search: unbounded ancestor walk as in the prototype, or bounded to the project root | Bounded. An unbounded walk can import a planted file from a shared parent (review M1). Proposal; not approval. | Claude Code (proposal) | 2026-11-14 |
| D-019 | Source of origin in events: one `distribution` value per bundle, or `distribution` plus `bundle` | `distribution` (`plugin`, `workspace`, `starter`) plus `bundle`. One shared runtime cannot name a single bundle (review M4). Supersedes the `starter-<bundle>` values of revision 3. Proposal; not approval. | Claude Code (proposal) | 2026-11-14 |
| D-020 | `-NoTelemetry` against an enabled preference, and an invalid preference: fail setup as the prototype does, or continue | Continue with exit 0, send nothing, never rewrite the file. Telemetry must not change the setup outcome (review M5). Proposal; not approval. | Claude Code (proposal) | 2026-11-14 |
| D-021 | Sample `local.settings.json` in the template cache: commit it, or cache only the `.sample` and map it to both destinations | Cache only the `.sample`. `AGENTS.md` forbids committing `local.settings.json` (review M10). Proposal; not approval. | Claude Code (proposal) | 2026-11-14 |
| D-022 | Tool-install commands: one generated source shared with `azure-functions-setup`, or a starter data file with a consistency test | Starter data file plus a test against the skill's table. The build has no include mechanism for skill markdown (review M8). Supersedes the "one source" wording of revision 1. Proposal; not approval. | Claude Code (proposal) | 2026-11-14 |
| D-023 | Remote one-liner that fetches and executes `install.*`: accept as an exception to the `SECURITY.md` threat model, or redesign | Accept, with the controls in "Trust boundaries" (authorization from the README prompt only, SHA resolution, SHA-256 checks, pinned-run documentation, extended `lint:security`, bounded hook loading). `SECURITY.md` is updated to state the exception. The owner of the aka.ms records is still to be named (open question 1). | Tsuyoshi Ushio (human) | 2026-11-14 |
| D-024 | Agent proposals D-006 to D-009 and D-016 to D-022 | Approved as written. | Tsuyoshi Ushio (human) | 2026-11-15 |
| D-025 | Owner of the aka.ms records `aka.ms/azure-functions-starter` and `aka.ms/hosted-skills-timer-starter` | Tsuyoshi Ushio. | Tsuyoshi Ushio (human) | 2026-11-15 |
| D-026 | Double counting when the plugin and a starter are both active | Disclose only in `docs/internal/telemetry-release.md`; `distribution` separates the sources. No de-duplication rule in version 1. | Tsuyoshi Ushio (human) | 2026-11-15 |
| D-027 | Delivery order | Implement checkpoints 1 to 3 in one pass, then request human review. Checkpoint 4 (`hosted-skills`) and 5 follow. | Tsuyoshi Ushio (human) | 2026-11-15 |
| D-028 | PowerShell exit code: the one-liner calls `exit` with the result, or the installer sets `$LASTEXITCODE` and returns | Set `$LASTEXITCODE` and return; the one-liner has no `exit`. Some hosts keep one PowerShell session per conversation, and `exit` would close it. The JSON report carries `ready` and `error` either way. Changes the flow text "the one-liner converts the result to an exit code". Proposal; not approval. | Claude Code (proposal) | 2026-11-15 |
| D-029 | Install record commit when a later run only finds files current | A record and its commit change only when the run created a file in that record's group, so `installed.runtimeCommit` names the commit whose bytes are installed. Clarifies D-016. Proposal; not approval. | Claude Code (proposal) | 2026-11-15 |
| D-030 | Failure report shape | On failure the report is `{schemaVersion, ready: false, error: {code, message[, files]}}` without the other fields, because a failure can happen before they are known. Clarifies the report schema. Proposal; not approval. | Claude Code (proposal) | 2026-11-15 |
| D-031 | Review of D-028 to D-030 | Approve D-028, D-029, and D-030 as proposed. | Tsuyoshi Ushio (human) | 2026-11-17 |
| D-032 | Hook runtime search in a project without `.git` and without a host project directory | The project root is the host project directory, or the nearest directory that contains `.git` or the agent's hook file (`HOOK_DESTINATIONS`). The runtime is loaded only from that root; with no root before the home directory or the file-system root, nothing is loaded. Before this, a missing local runtime let the walk continue to a shared ancestor such as a Windows drive root, where any user can create folders (PR review). Tightens D-018. Proposal; not approval. | Claude Code (proposal) | 2026-11-17 |
| D-033 | `lint:security` exception for the one-liners | The whole line must equal a generated installer command (bundle, optional template, agent placeholder or slug). A line that only contains the approved URL, for example in a comment next to another command or with a second command appended, is rejected (PR review). Tightens D-023's lint control. Proposal; not approval. | Claude Code (proposal) | 2026-11-17 |
| D-034 | Review of D-032 and D-033 | Approve D-032 and D-033 as proposed. | Tsuyoshi Ushio (human) | 2026-11-17 |
| D-035 | Commit lookup when the anonymous GitHub API is rate limited | On HTTP 403 or 429 from `api.github.com`, read `refs/heads/<branch>` from the same repository's Git ref advertisement on `github.com` and use that commit; only when that also fails, stop with `rate-limited`. The API stays first because it is the documented interface. Found in the end-to-end test: the anonymous limit is 60 requests per hour per IP address, and a shared corporate egress used it up, so the first pasted prompt failed. The archive download and SHA-256 checks are unchanged. Proposal; not approval. | Claude Code (proposal) | 2026-11-17 |
| D-036 | README prompt wording, and whether to stop asking about the hook merge | Use the prompt: "Read https://aka.ms/azure-functions-starter and follow it to set up Azure Functions Skills in this directory. Use the one-liner for your OS and coding agent; I authorize that one command for this directory only. Do not open a Canvas. Load no other skills until setup is reported; then use the skills it added to this directory." It is faster in practice than a prompt that lists every approval, and it keeps the authorization to one command for this directory. Keep the installer free of dependencies: it does not merge hooks into user-owned settings files, and `start.md` keeps asking once before the agent merges (`needs-merge`). Telemetry stays on by default; the user is asked only in the `needs-merge` case. `start.md` also says how to turn telemetry off later (preference file or environment variable), because an agent suggested a `-NoTelemetry` rerun, which never rewrites an existing preference. Found in the manual end-to-end runs. | Tsuyoshi Ushio (human) | 2026-11-17 |

## 6. Test plan

Tests are Vitest files under `tests/`, named `starter-*.test.ts`. Shell engines
are driven as child processes against the committed payload.

| Requirement | Test / fixture / experiment | Expected evidence |
| --- | --- | --- |
| ST-001, ST-006, ST-011, ST-014 | `starter-build.test.ts`: real and fake config, second fixture template, hand-edit detection, LF normalization | URLs and archive name follow config; verify fails on drift; skills and engine unchanged by a new template |
| ST-002, ST-003, ST-007 | `starter-bootstrap.test.ts`: `sh`, `pwsh`, and Windows PowerShell with a minimal `PATH`, per agent; 5.1 with `Restricted` policy | Exit 0; paths from the layout table; report validates against the schema |
| ST-004 | `starter-tools.test.ts`: tools absent; consistency with `azure-functions-setup` | Expected `missingTools`; null command where specified; no drift from the skill table |
| ST-005, ST-016 | `starter-rerun.test.ts`: both orders; bundle A at commit X then B at commit Y with different runtime bytes; rerun at Y over X | Exit 0; states `current` / `outdated` / `modified`; no existing file written |
| ST-008, ST-017 | `starter-hook.test.ts`: installed command string run verbatim in bash and PowerShell from a subdirectory; hostile ancestor runtime | One event with expected `clientName`, `distribution`, `bundle`; nothing sent or executed from the ancestor |
| ST-009, ST-010 | `starter-setup-event.test.ts`: local mock endpoint; flag, env vars in mixed case, disabled / invalid / unreadable preference in destination and ancestor; unreachable endpoint; check mode | Exact envelope once, or zero requests; exit code unchanged |
| ST-012, ST-019 | `starter-failures.test.ts`: corrupted file, traversal row, symlink, unrecorded differing file, 403 on SHA lookup, engine mismatch | Exit 2, nothing written, expected `error.code` |
| ST-013 | `starter-hook-state.test.ts`: existing `.claude/settings.json` and `.codex/hooks.json`, before and after adding the snippet | `needs-merge` then `merged`; user file byte-identical after the installer |
| ST-015 | `starter-deploy-observation.test.ts`: `deployment-observed` against the installed starter tree with the local transport | Valid status line; event carries `distribution: starter` |
| ST-018 | `starter-coexistence.test.ts`: fixture with plugin-style workspace assets | `coexistence: "workspace"` |
| ST-001 to ST-004, ST-013 | Manual run of the pasted prompt on each agent, on Windows and on macOS or Linux, in an isolated workspace, including the hook merge approval | Recorded transcript: one apply run, report, approvals asked once each |

Installer download is tested offline with a local archive and mock endpoint. No
LLM-backed evaluation runs in pull-request CI. The manual agent runs are done
locally on reviewed code. Live acceptance of the setup-event envelope by the
real ingestion endpoint is checked once, manually, under the existing telemetry
release process.

## 7. Docs impact

- `README.md`: the paste-a-prompt path for both starters, with the authorization
  sentence; the setup event and new properties in the telemetry section. Plugin
  install stays.
- New `docs/starter.md`: installer arguments, exit codes, report schema, failure
  codes, file states, SHA pinning, hook states, supported baseline, opt-out.
- `docs/development.md`: starter build, verify, lock file, template cache refresh.
- `AGENTS.md` and `.github/copilot-instructions.md`: `src/starter/` in the
  architecture list; `starter/` in the never-hand-edit list;
  `build:starter` and `verify:starter-payload` in the commands.
- `SECURITY.md`: the remote one-liner exception and its controls (D-023).
- `docs/internal/telemetry-release.md`: setup event, `distribution`, `bundle`,
  and the double-count limitation.
- `.gitattributes`: `starter/** -text`.
- `.github/workflows/`: a starter test job on Windows, macOS, and Linux.
- `scripts/lint-skill-content.mjs`: starter sources and the allowed one-liners.
- `templates/skills/azure-functions-deploy/SKILL.md` and
  `templates/skills/azure-functions-hosted-skills/references/infra-and-deployment.md`:
  the starter runtime path for deployment observation.
- Generated plugin payloads are regenerated, not edited.
  `templates/agents/AGENTS.md` is not changed.
- `docs/cli-reference.md`: no change.

## 8. Status & sign-off

| Item | Evidence |
| --- | --- |
| Independent architecture review | One pass on revision 3 by a separate Claude Code review agent, 2026-11-14: 6 blockers, 11 major, 11 minor. Addressed in revision 4 (D-016 to D-022, ST-015 to ST-019, open questions 1 to 3). Revision 5 adds only the human decision D-023; revision 6 records D-024 to D-027; revision 7 adds the implementation proposals D-028 to D-030; revision 8 records their approval (D-031); revision 9 adds the review-driven proposals D-032 and D-033; revision 10 records their approval (D-034); revision 11 adds D-035 from the end-to-end test; revision 12 records D-036. Revisions 4 to 12 are not re-reviewed by an agent; the human approver read revision 5. A review by a different model family, as `AGENTS.md` asks, is pending. |
| Human approval | Tsuyoshi Ushio |
| Approved revision and scope | Revision 5 (SHA-256 of LF-normalized content `8f0557575c06c3a136c1eab66ea4b04a43ade4e2f2208a3a43e4f2efb01ae64e`) plus the decisions D-024 to D-027 recorded in revision 6, D-028 to D-030 approved by D-031 in revision 8, and D-032 and D-033 approved by D-034 in revision 10. Whole document. |
| Approval reference and date | Chat approval in the authoring session, 2026-11-15: proposals approved and implementation requested. Chat approval of D-028 to D-030, 2026-11-17. Chat approval of D-032 and D-033, 2026-11-17. |
| Implementation reference | Branch `feat/prompt-starter` (uncommitted at the time of writing): checkpoints 1 to 3 implemented. `starter.config.json`, `templates/starter/`, `src/starter/`, `starter/`, telemetry changes in `src/telemetry/`, extended `scripts/lint-skill-content.mjs`. Checkpoint 4 (`hosted-skills` with the `timer` template, lock file, refresh) and checkpoint 5 (Windows/macOS/Linux CI matrix) are not started; CI runs the new tests on Ubuntu with `sh` and `pwsh`. D-028 to D-030 are approved (D-031). D-032 and D-033 are approved (D-034). D-035 awaits human review. |
| Acceptance evidence | Local run on Windows 11 with Git for Windows `sh`, PowerShell 7, and Windows PowerShell 5.1 (`Restricted` execution policy): `tests/starter-build.test.ts` (ST-001, ST-003, ST-006, ST-011, ST-014), `tests/starter-bootstrap.test.ts` (ST-002 to ST-005, ST-007, ST-010, ST-012, ST-013, ST-016, ST-018, ST-019), `tests/starter-tools.test.ts` (ST-004), `tests/starter-hook.test.ts` (ST-007, ST-008, ST-010, ST-015, ST-017), `tests/starter-install.test.ts` (ST-003, ST-009, ST-010, ST-019), `tests/starter-telemetry.test.ts` (D-019). Not yet: macOS and Linux runs, the symlink case on POSIX (skipped on Windows), manual paste-a-prompt runs on each agent, live ingestion of the setup event, and the aka.ms records. |

Not verified by the review, and still open as implementation risks: Windows
PowerShell 5.1 behavior (execution policy, path length), each host's hook schema
fields and whether its fetch tool follows the aka.ms redirect, `winget` / `brew`
behavior, and cross-OS byte determinism of the bundled runtime.

All open questions are resolved. Implementation follows the delivery
checkpoints (D-027). Update this section and the FRD index together.
