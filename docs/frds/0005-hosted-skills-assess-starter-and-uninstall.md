# FRD-0005: Hosted Skills assessment starter and standard starter uninstall

| Metadata | Value |
| --- | --- |
| Status | Draft |
| Revision | 1 |
| Created | 2026-11-19 |
| Updated | 2026-11-19 |
| Author | Claude Code, based on Tsuyoshi Ushio's requirements |
| Depends on | FRD-0004 (prompt-driven starter onboarding; Azure/azure-functions-skills#307 and #310, not yet on `main`). The advisor skill from Azure/azure-functions-skills#312 |
| Component | Shared infrastructure: starter bundles, installer scripts. Skill: `azure-functions-hosted-skills-advisor` (report format addition) |

## 1. Summary

This is a proposal. Nothing in it is implemented.

It adds two things to the FRD-0004 starter engine:

1. **An assessment starter for existing apps.** A user pastes one prompt into an
   existing Azure Functions app. The installer adds skills only, with no app
   template and no agent instruction files. The agent then runs
   `azure-functions-hosted-skills-advisor` once, read-only, writes one report
   file, summarizes the top opportunities in chat, and stops to ask which one to
   try. Applying an opportunity is a separate step that needs a new approval; it
   is handled later by `azure-functions-hosted-skills`.
2. **A standard uninstall for every starter.** The installers gain
   `--uninstall` / `-Uninstall`. It uses the existing provenance records to
   remove only the files a starter installed and that the user has not changed.

The two parts are delivered as two later implementation PRs: the shared
uninstall first, then the assessment bundle.

## 2. Motivation / problem

FRD-0004 starters fit new work. The `functions` bundle adds general skills; the
`hosted-skills` bundle creates a new app from a cached template. Neither fits a
common question from teams that already run Azure Functions: "Where in my
existing app would Hosted Skills help?"

PR #312 adds `azure-functions-hosted-skills-advisor`, a read-only skill that
scans a Function App and writes a Markdown report of evidence-backed
opportunities. Today a user can reach it only through a plugin install or by
copying skills by hand, and then must ask for the assessment in a separate
turn. There is no one-prompt path, and no clear boundary between "look at my
code" and "change my code".

Gaps in the current engine and starters:

- A bundle without templates exists (`functions`), but every bundle is assumed
  to end in a handoff to free-form work. There is no bundle whose purpose is one
  bounded, read-only run of a named skill.
- The `hosted-skills` bundle installs `AGENTS.md`, `CLAUDE.md`, and
  `.github/copilot-instructions.md`. In an existing project those files are the
  team's own, and adding them is intrusive.
- The advisor report names the trigger of each opportunity, but not the
  starter template that could seed an implementation. The user cannot see
  which opportunities have a ready template.
- FRD-0004 records every installed file with its hash, but no starter can be
  removed. Users who try a starter in an existing repository need a clean,
  safe way back.
- FRD-0004 forbids a skill in two bundles (D-005, D-015). The assessment bundle
  needs the Hosted Skills skills that the `hosted-skills` bundle also ships.

## 3. Goals / non-goals

### Requirements and acceptance criteria

Assessment starter:

| ID | Requirement | Observable acceptance criterion |
| --- | --- | --- |
| AS-001 | An `assess` bundle kind exists in `starter.config.json`. An assess bundle has no templates, names one entry skill, and installs skills only. | Build test: an assess bundle with `templates` or without `entrySkill` fails the build; the generated `files.tsv` has only skill and runtime rows. |
| AS-002 | The `hosted-skills-assess` bundle installs the advisor, the Hosted Skills skill, and the connector skills, and no agent instruction file. | Bootstrap test per agent: the installed skill set equals the configured list; `AGENTS.md`, `CLAUDE.md`, and `.github/copilot-instructions.md` are absent, or byte-identical when they existed before. |
| AS-003 | The installer stops before any write when the destination is not an Azure Functions app. | Fixture without `host.json`: exit 2, `error.code` `not-functions-app`, nothing written. The message names the `functions` and `hosted-skills` starter links. |
| AS-004 | The prompt authorizes three bounded actions: one installer run, one read-only advisor run, and one report write. Applying any opportunity needs a new user approval. | Build test: the README prompt contains the scope sentence. `start.md` tells the agent to stop and ask after the summary. Manual run transcript: no customer file changes, and an approval question before any apply step. |
| AS-005 | The assessment writes exactly one report at a fixed path and changes no other file. | Evaluation: the report exists at `.azure-functions-skills/reports/hosted-skills-assessment.md` (or the advisor's numbered suffix on a rerun); all fixture files match their SHA-256 baseline; no other new file outside the installed set. |
| AS-006 | Each opportunity in the advisor report names its trigger type and a matching manifest template id, or `none` with a reason. | Unit test: the mapping reference matches `starter.config.json` `manifestId` values. Evaluation: every opportunity line has a trigger and a template id that follows the mapping table. |
| AS-007 | The chat summary lists the top opportunities, then stops and asks which one to try. | Manual run transcript; evaluation grader checks that the agent made no further file change after the report. |
| AS-008 | Telemetry is unchanged: the existing setup event with `template: none`. No assessment content is sent. | Setup-event test: one `AzureFunctionsSkillsStarterSetup` with `bundle: hosted-skills-assess`, `template: none`, and no other new property. No new event name in `sender.ts`. |
| AS-009 | The flow can be evaluated by a local agent on reviewed code, never in PR-triggered CI. | A repository-local evaluation skill and an `AGENTS.md` pointer exist; no workflow with a `pull_request` trigger references the evaluation. |

Standard uninstall:

| ID | Requirement | Observable acceptance criterion |
| --- | --- | --- |
| UN-001 | `install.ps1` and `install.sh` accept `-Uninstall` / `--uninstall`, with `-Check` / `--check` (dry run) and `-Json` / `--json`. Uninstall reads only local records; it resolves no commit and downloads no archive. | Uninstall test with networking disabled succeeds. A `--check` run writes and removes nothing and lists the same files a real run removes. |
| UN-002 | Only recorded files whose current hash equals the recorded hash are removed. | Fixture with one modified skill file: it is reported `kept: modified` and is byte-identical afterwards; every unmodified recorded file is gone. |
| UN-003 | Unrecorded files are never touched, including the advisor report. | Fixture with an extra file in a skill directory and a report in `.azure-functions-skills/reports/`: both remain, and their directories remain. |
| UN-004 | Only directories created by the install, and empty after removal, are removed. | Pre-existing empty `.claude/` and `.github/` remain; skill directories created by the install are removed when empty. |
| UN-005 | The shared runtime stays while another bundle record remains. `--bundle` selects the bundle. | With two bundles installed, uninstalling one keeps `runtime.json` and the runtime files; uninstalling the second removes them. With two records and no `--bundle`, exit 2 `invalid-argument` listing the bundles. |
| UN-006 | Telemetry preference and hook files are removed only when the installer created them and they are unmodified. Hooks merged into user-owned settings are left, and the report says what to remove. | Created and unmodified Copilot hook file: removed. Pre-existing `.claude/settings.json` with the merged hook: byte-identical, listed in `skipped` with the marker to remove. Preference changed to `enabled: false`: kept. |
| UN-007 | Exit codes and output follow FRD-0004. JSON output lists `removed`, `kept`, and `skipped`. | Schema test on every uninstall fixture; exit 0 on success, 1 when `--check` finds files to remove, 2 on failure. |
| UN-008 | Uninstall sends no telemetry. | Uninstall with a mock endpoint and telemetry enabled: zero requests. |
| UN-009 | `start.md`, the setup report output, and the advisor report show the one-line uninstall command. | Build test on every generated `start.md`; bootstrap report has `uninstall` with a command string; evaluation grader finds the command in the assessment report. |

### Non-goals

- Fetching a template at install or assessment time. Template fetching for the
  apply step belongs to Hosted Skills, which is moving to scripted fetching.
- Implementing the apply step. This FRD only fixes its authorization boundary
  and the data the report hands to it.
- Changing the advisor's detection, scoring, or language support from #312,
  beyond the template field in each opportunity.
- Installing agent instruction files into existing projects.
- New telemetry events or properties, including an uninstall event.
- Editing user-owned settings files during uninstall, or reverting a user's
  changes to installed files.
- Uninstalling plugin installs, or workspace assets from `dist/workspace`.
- Running any LLM-backed evaluation in PR-triggered CI.

## 4. Proposed design

### Part A: assessment starter

#### Bundle definition (AS-001, AS-002)

`starter.config.json` gains an optional `kind` per bundle. Existing bundles are
`kind: "standard"` by default. An assess bundle:

```json
"hosted-skills-assess": {
  "kind": "assess",
  "akaLink": "https://aka.ms/hosted-skills-assess-starter",
  "entrySkill": "azure-functions-hosted-skills-advisor",
  "report": ".azure-functions-skills/reports/hosted-skills-assessment.md",
  "requires": ["host.json"],
  "skills": ["azure-functions-hosted-skills-advisor", "azure-functions-hosted-skills",
    "azure-functions-connector-create", "azure-functions-connector-mcp",
    "azure-functions-connector-validate"],
  "tools": []
}
```

Build rules for `kind: "assess"`: no `templates`, no `agentFiles`, `entrySkill`
must be in `skills`, `report` must be under `.azure-functions-skills/reports/`.
The bundle has one aka.ms link, like `functions`.

`tools` is empty. The advisor needs no tool; tool checks belong to the apply
step, where `azure-functions-hosted-skills` and `azure-functions-setup` already
cover them. The report therefore has no `missingTools` entries for this bundle.

**Shared skills.** FRD-0004 fails the build when a skill is in two bundles. The
Hosted Skills and connector skills are needed in both `hosted-skills` and
`hosted-skills-assess`. The build instead allows a skill in several bundles when
every bundle ships identical bytes for it. Both records then list the same
paths. The FRD-0004 file states still apply per record: a second bundle that
finds a shared file with equal bytes reports `current` and records it. A file
listed in another bundle's record is never a `conflict`. This narrows FRD-0004
D-005 and D-015 (bundles share no skill) for this case only, so it needs its
own decision (D-004).

#### Precondition (AS-003)

Bootstrap checks `requires` during preflight, before any write. The check
passes when `host.json` is in the destination root or in an immediate
subdirectory (for example `src/host.json`), skipping hidden directories and
`node_modules`. Otherwise it fails with a new `error.code`:

| `error.code` | Cause | What `start.md` has the agent say |
| --- | --- | --- |
| `not-functions-app` | An assess bundle found no `host.json` | This directory is not an Azure Functions app. For a new app, use `aka.ms/azure-functions-starter` or a Hosted Skills starter such as `aka.ms/hosted-skills-timer-starter`. Nothing was installed. |

`start.md` also tells the agent to check for `host.json` before running the
one-liner, so the user gets the message without a download. The installer check
stays authoritative.

#### Three phases with separate authorization (AS-004 to AS-007)

| Phase | What happens | Authorized by | Writes |
| --- | --- | --- | --- |
| 1. Install | One installer run, skills only | The pasted prompt | Skills, runtime, hooks, records (FRD-0004 rules) |
| 2. Assess | One run of `azure-functions-hosted-skills-advisor`, read-only, on the current directory | The pasted prompt | One report file |
| 3. Apply | `azure-functions-hosted-skills` implements one selected opportunity, starting from a matching manifest template when one exists | A new user approval that names an opportunity | Customer code, settings, and dependencies as the skill decides with the user |

Phase 2 details:

- `start.md` tells the agent to invoke the entry skill by name and to pass the
  configured report path. The advisor already supports a requested path inside
  the workspace and never overwrites a report (it adds `-2`, `-3`, ...).
- The fixed path keeps the report out of the app's source tree and lets the
  uninstall recognize it as user output. `start.md` tells the user the report is
  a local file; whether to commit it is the user's choice.
- In chat the agent gives the report path, the opportunity count, and the top
  three opportunities (or fewer), each with its function, trigger, and template
  id or `none`. With zero opportunities, it says so and gives the advisor's
  one-sentence reason.
- The agent then stops and asks which opportunity to try. It does not start
  phase 3, open a canvas, or load other skills in the same turn.

Phase 3 is out of scope for implementation. The contract handed to it is the
opportunity number, its location, its trigger, and its template id from the
report.

#### Prompt wording (draft)

README prompt for the assessment starter:

> Read https://aka.ms/hosted-skills-assess-starter and follow it to check this
> existing Azure Functions app for Hosted Skills opportunities. Use the
> one-liner for your OS and coding agent; I authorize that one command for this
> directory only, and one read-only assessment that writes only its report. Do
> not change my code. After the summary, stop and ask me which opportunity to
> try. Do not open a Canvas.

It follows FRD-0004 D-036: one link, one authorized command, and an explicit
scope. It adds the read-only run and the stop point.

#### No agent instruction files (D-003)

The assess bundle installs no `AGENTS.md`, `CLAUDE.md`, or
`.github/copilot-instructions.md` (option A). Guidance comes from `start.md`
for the session and from the installed skills afterwards. The alternatives were
(B) installing them only when absent, which still leaves files the team did not
ask for, and (C) appending a marked section, which edits user-owned files and
needs a merge engine that FRD-0004 rules out.

#### Template mapping in the advisor report (AS-006)

Each opportunity's `Where:` line in the #312 report format already shows the
trigger type. The format gains one line:

```markdown
Where: <path:start-end> in `<function>` (<trigger type>)
Starter template: `<manifest id>` | none (<reason>)
```

A new advisor reference, `references/template-mapping.md`, holds a static
mapping. The advisor reads it; it does not contact the manifest. Today's
mapping, from the templates manifest version used by FRD-0004 D-039:

| Trigger | Language | Template id |
| --- | --- | --- |
| Timer | Python | `ai-hosted-skills-python` |
| Storage queue | Python | `ai-hosted-skills-starter-queue-python` |
| Service Bus | Python | `ai-hosted-skills-starter-servicebus-python` |
| Blob | Python | `ai-hosted-skills-starter-blob-python` |
| Cosmos DB | Python | `ai-hosted-skills-starter-cosmos-python` |
| Any other trigger (HTTP, Event Hubs, Event Grid, Durable, ...) | Python | none (no starter template for this trigger yet) |
| Any trigger | .NET | none (no .NET starter template yet) |
| Any trigger | Node.js, Java, PowerShell | none (Hosted Skills does not support this language yet) |

Only Python templates exist today. Multi-language manifest templates are
expected in about a month. Until then a supported .NET opportunity is still
reported in full, with `none (no .NET starter template yet)`; the apply step
works from the advisor's sketch instead of a template. Blocked languages keep
the advisor's existing "blocked" handling.

A unit test checks that every template id in the mapping is a `manifestId` in
`starter.config.json`, so the mapping cannot name a template the starters do
not know. When new manifest templates arrive, the mapping and the test data are
updated together.

#### Telemetry (AS-008)

Unchanged. The installer sends the existing `AzureFunctionsSkillsStarterSetup`
event with `bundle: hosted-skills-assess` and `template: none`. Usage events
from the installed hooks behave as in FRD-0004, with `bundle` derived from the
records. No report content, opportunity count, trigger, or template id is sent.

#### Evaluation (AS-009)

The five #312 fixtures (`expense`, `delivery`, `crud`, `dotnet`, `node`) are
reused as existing apps. Each trial:

1. Copies a fixture into an isolated workspace outside the checkout.
2. Runs the installer against the local `starter/` payload of the reviewed
   commit, with `--no-telemetry`, using the offline source that the FRD-0004
   tests use. No GitHub download.
3. Runs the agent with the assessment prompt and a local copy of `start.md`.
4. Grades: install report `ready: true`; report at the fixed path; opportunity
   count matches the fixture (`crud` zero, the others at least one); each
   opportunity's template id follows the mapping table (`dotnet` and `node`
   give `none`); customer files match `baseline.json`; no agent instruction
   files; no file change after the report; the uninstall line is present.

A repository-local skill under `.github/skills/` describes how to run this with
the local coding agent, and `AGENTS.md` points to it. The existing rules apply:
reviewed, trusted code only; confirm target, budget, repetition count, and
cleanup before a model-backed run; never PR-triggered CI.

### Part B: standard uninstall (UN-001 to UN-009)

#### Command

```powershell
& ([scriptblock]::Create((Invoke-RestMethod '<raw>/starter/install.ps1'))) -Uninstall -Bundle hosted-skills-assess -Json
```

```bash
curl -fsSL '<raw>/starter/install.sh' | sh -s -- --uninstall --bundle hosted-skills-assess --json
```

`-Check` / `--check` lists what would happen and changes nothing. `--bundle`
may be omitted when exactly one bundle record exists. With several records and
no `--bundle`, the run fails with `invalid-argument` and lists them.

The uninstall path reads only `.azure-functions-skills/*.json` and the
destination's files. It does not resolve a commit or download an archive, so it
works offline once the installer script is obtained and does not depend on the
version that installed the bundle.

#### Removal rules

For the selected bundle record, and for `runtime.json` when it is the last
bundle record:

| Case | Action | Reported as |
| --- | --- | --- |
| Recorded, current hash equals the record | Remove | `removed` |
| Recorded, hash differs | Keep | `kept`, reason `modified` |
| Recorded, file absent | Nothing | `skipped`, reason `missing` |
| Recorded, also listed in another remaining bundle record | Keep | `kept`, reason `shared` |
| Not recorded (including the advisor report) | Never touched, not listed | — |

Directories: the record format gains a `directories` list of directories the
install created. Uninstall removes a listed directory only when it is empty
after the file removals, deepest first. For records written before this field,
only empty directories under starter-owned roots are removed: the bundle's
skill directories (`<skill root>/<skill name>/`) and `.azure-functions-skills/`
subdirectories. Shared parents such as `.claude/`, `.github/`, and `.agents/`
are left.

A record file is deleted after its files are processed. Kept files then become
unrecorded user files; a later reinstall reports them as `conflict`, which is
the existing safe behavior. `.azure-functions-skills/` is removed only if it is
empty, so an advisor report keeps it.

#### Telemetry preference and hooks

- `telemetry.config.json` and the Copilot hook file
  `.github/hooks/azure-functions-skills.json` are already recorded in
  `runtime.json`. They follow the removal rules, only with the last bundle.
- Today the engine never records `.claude/settings.json` or `.codex/hooks.json`,
  even when it created them. The uninstall PR records them in `runtime.json`
  when the installer creates them, so uninstall can remove them when unmodified.
- A hook merged into a user-owned settings file is left. The output lists the
  file in `skipped` with reason `user-owned`, and the human-readable message
  names the marker `.azure-functions-skills/runtime/telemetry.mjs` so the user
  can remove that entry.
- The reference snippet `.azure-functions-skills/hooks/<agent>.json` is
  installer output. The uninstall PR records it in `runtime.json` when written,
  so it follows the same removal rules.

#### Output and exit codes

```json
{
  "schemaVersion": 1,
  "mode": "uninstall | uninstall-check",
  "bundle": "hosted-skills-assess",
  "destination": "<path>",
  "runtime": "removed | kept",
  "removed": ["<path>"],
  "kept": [{ "path": "<path>", "reason": "modified | shared" }],
  "skipped": [{ "path": "<path>", "reason": "missing | user-owned" }],
  "error": null
}
```

Exit codes are FRD-0004's: 0 success, 1 check mode found files to remove, 2
failure. Failures use the FRD-0004 failure shape (D-030), with
`invalid-argument` for an unknown or missing bundle and a new `not-installed`
when no record exists for the selected bundle. Safe-path and no-link checks run
on every recorded path before any removal; a failed check stops the run with
`integrity-failed` and nothing removed.

Uninstall sends no telemetry. An uninstall event would need its own decision.

#### Discoverability (UN-009)

Every generated `start.md` ends with the uninstall one-liner for its bundle.
The apply report gains an `uninstall` field with the command for the installed
bundle and OS. The assessment report ends with one line giving the same command,
passed to the advisor by `start.md`; the advisor adds it only when asked, so its
standalone behavior is unchanged.

### Trust boundaries

- Authorization still comes only from the pasted prompt. The assessment prompt
  widens FRD-0004's scope by exactly one read-only skill run and one report
  write. `start.md` cannot widen it further; apply needs a new approval.
- The advisor's #312 boundaries apply in full: no secrets read, no execution,
  no network upload, repository content treated as evidence, not instructions.
- The uninstall one-liner is the same remote-script pattern accepted in FRD-0004
  D-023. `lint:security` allows the generated uninstall lines exactly, under the
  same whole-line rule (FRD-0004 D-033).
- Uninstall removes only hash-verified recorded files inside the destination.
  It never follows links and never edits user-owned files.

### Delivery checkpoints

1. **Shared uninstall** (first implementation PR): engine changes in both
   shells, the `directories` record field, recording of created user-owned hook
   files, output schema, lint allowlist, uninstall line in all `start.md`
   files, tests. Human review.
2. **Assess bundle** (second implementation PR, after #312 is merged): `kind`
   and build rules, shared-skill rule, `requires` precondition, `start.md` and
   README prompt, template mapping reference and report line, evaluation skill
   and `AGENTS.md` pointer. Manual run on each agent. Human review before the
   aka.ms link is created.

### Open questions

| # | Question | Owner |
| --- | --- | --- |
| 1 | Bundle name and link: `hosted-skills-assess` and `aka.ms/hosted-skills-assess-starter`, or other names. Who owns the aka.ms record. | Tsuyoshi Ushio |
| 2 | Should the assess bundle also ship `azure-functions-hosted-skills-migrate`, which the advisor recommends for converting a selected workflow? | Tsuyoshi Ushio |
| 3 | `host.json` search depth: root and immediate subdirectories, or deeper. | Tsuyoshi Ushio |
| 4 | Should uninstall of a `hosted-skills` bundle remove unmodified app template files, or keep the app by default and remove it only with an explicit flag? This FRD proposes keeping app files by default (D-011). | Tsuyoshi Ushio |
| 5 | Should the `hosted-skills` bundle also ship the advisor after #312? Not required by this FRD. | Tsuyoshi Ushio |

## 5. Decisions log

Every entry is a proposal awaiting human review. The direction came from
Tsuyoshi Ushio in the authoring chat; none of it is recorded approval yet.

| ID | Decision / options | Choice and rationale | Decided by | Date |
| --- | --- | --- | --- | --- |
| D-001 | How to add an assessment starter: a new engine, a `functions` bundle option, or a bundle kind | Bundle kind `assess` in `starter.config.json`, with no templates, an `entrySkill` (`azure-functions-hosted-skills-advisor`), and a skills-only payload (advisor, Hosted Skills, connector skills). Reuses the FRD-0004 engine unchanged except for the precondition. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |
| D-002 | Behavior in a directory without `host.json` | Stop before any write with `not-functions-app` and point to the `functions` and `hosted-skills` starters. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |
| D-003 | Agent instruction files in existing projects: (A) none, (B) only when absent, (C) appended section | (A) none. Guidance comes from `start.md` and the skills. Existing projects own those files. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |
| D-004 | Shared skills between bundles | Allow a skill in several bundles when the bytes are identical; a file in another bundle's record is never a conflict and is kept on uninstall while that record remains. Narrows FRD-0004 D-005 and D-015 for `hosted-skills` and `hosted-skills-assess`. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |
| D-005 | Authorization for install, assessment, and apply | Three phases. Install and the read-only assessment are authorized by the prompt; apply needs a new approval naming an opportunity. One report at `.azure-functions-skills/reports/hosted-skills-assessment.md`; chat gets the top opportunities, then the agent stops and asks. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |
| D-006 | Prompt wording | The draft in section 4: one link, one authorized command, one read-only assessment writing only its report, no code change, stop and ask. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |
| D-007 | Template fetching in this FRD | Out of scope. Hosted Skills is moving to scripted fetching, and multi-language manifest templates are expected in about a month (Python only today). Opportunities without a template report `none` with a reason. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |
| D-008 | How the report links opportunities to templates | Add `Starter template:` to each opportunity, from a static mapping reference in the advisor, checked by a unit test against `starter.config.json`. The advisor does not contact the manifest. A small addition to the #312 report format. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |
| D-009 | Telemetry for the assessment | Existing setup event only, with `template: none`. No assessment results sent. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |
| D-010 | Evaluation | Reuse the #312 fixtures as existing apps: installer, assessment, then check opportunity count and trigger-to-template mapping. Runnable by a local agent through a repository-local skill and an `AGENTS.md` pointer. Never in PR-triggered CI. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |
| D-011 | Uninstall scope and rules | One uninstall for all starters, from the provenance records: `--uninstall` / `-Uninstall` with `--check` and `--json`; remove only recorded files with matching hashes; keep modified files (`kept: modified`); never touch unrecorded files, including the advisor report; remove only install-created directories that are empty; keep the runtime while another bundle record remains; `--bundle` selects. Proposed detail for open question 4: `hosted-skills` app template files are kept unless an explicit flag asks to remove them. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |
| D-012 | Telemetry preference and hooks on uninstall | Remove them only when the installer created them and they are unmodified. Record created `.claude/settings.json` and `.codex/hooks.json` from now on. Leave hooks merged into user settings and say what to remove. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |
| D-013 | Uninstall output and telemetry | Same exit codes as FRD-0004; JSON lists `removed`, `kept`, `skipped`. No telemetry; an uninstall event would need a separate decision. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |
| D-014 | Discoverability of uninstall | `start.md`, the setup report, and the advisor report always show the one-line uninstall command. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |
| D-015 | Delivery | Two implementation PRs after this FRD is finalized: (1) shared uninstall, (2) assess bundle after #312 merges. Proposal; not approval. | Claude Code (proposal) | 2026-11-19 |

## 6. Test plan

Unit and engine tests are Vitest files under `tests/`, following the FRD-0004
`starter-*.test.ts` pattern, with both shells driven against the committed
payload.

| Requirement | Test / fixture / experiment | Expected evidence |
| --- | --- | --- |
| AS-001, AS-002 | `starter-build.test.ts`: assess bundle with and without `templates`, `entrySkill`, and `agentFiles`; shared skill with equal and different bytes | Build accepts only the valid forms; equal shared bytes pass, different bytes fail |
| AS-002, D-004 | `starter-bootstrap.test.ts`: assess bundle per agent; `hosted-skills` then `hosted-skills-assess` and the reverse | Skill set as configured; no agent files; shared files `current`, never `conflict` |
| AS-003 | `starter-failures.test.ts`: no `host.json`; `host.json` in `src/`; `host.json` only in a hidden directory | `not-functions-app` with nothing written; pass; `not-functions-app` |
| AS-004, AS-007 | `starter-build.test.ts` on the README prompt and `start.md`; manual paste-a-prompt run on each agent in an isolated copy of a fixture | Scope sentence present; transcript shows one install, one advisor run, a summary, then a question |
| AS-005, AS-006, AS-009 | Local-agent evaluation over the five #312 fixtures, on reviewed code | Report at the fixed path; counts and template ids as expected; customer files match baselines |
| AS-006 | `advisor-template-mapping.test.ts`: mapping reference against `starter.config.json` | Every template id is a configured `manifestId` |
| AS-008 | `starter-setup-event.test.ts` with the assess bundle | One event, `template: none`, no new properties |
| UN-001 to UN-005 | `starter-uninstall.test.ts`: one and two bundles; modified file; extra file; report present; pre-existing empty parents; `--check`; offline; missing and unknown bundle | Exact `removed` / `kept` / `skipped`; unrecorded files and parents intact; runtime kept until the last bundle |
| UN-006 | `starter-uninstall.test.ts` hook cases: created Copilot hook; created and pre-existing Claude and Codex settings; changed preference | Removed only when created and unmodified; user-owned files byte-identical and listed |
| UN-007, UN-008 | Schema check on every uninstall fixture; mock endpoint | Valid JSON; exit codes 0 / 1 / 2; zero requests |
| UN-002, UN-003 | Path traversal and symlink rows in a tampered record | `integrity-failed`, nothing removed |
| UN-009 | `starter-build.test.ts` on every `start.md`; bootstrap report field; evaluation grader | Uninstall command present in all three places |

No LLM-backed evaluation runs in pull-request CI. Model-backed runs need the
separate confirmation of target, budget, repetition count, and cleanup.

## 7. Docs impact

- `README.md`: the assessment prompt next to the other starters; a short
  uninstall section.
- `docs/starter.md` (from FRD-0004): bundle kinds, the `not-functions-app` and
  `not-installed` codes, uninstall arguments, output schema, and removal rules.
- `templates/starter/start.md` templates: uninstall line for every bundle; a new
  assess `start.md` with the three phases.
- `templates/skills/azure-functions-hosted-skills-advisor/references/report-format.md`
  and a new `references/template-mapping.md` (after #312 merges).
- `AGENTS.md`: a pointer to the local assessment evaluation skill.
- `.github/skills/`: the local evaluation skill.
- `scripts/lint-skill-content.mjs`: allow the generated uninstall one-liners.
- `docs/frds/README.md`: index entry for this FRD.
- Generated `starter/` and plugin payloads are regenerated, not edited.
  `templates/agents/AGENTS.md` is not changed.

## 8. Status & sign-off

| Item | Evidence |
| --- | --- |
| Independent architecture review | Pending |
| Human approval | Pending |
| Approved revision and scope | Pending; record commit SHA or content hash |
| Approval reference and date | Pending |
| Implementation reference | Not started |
| Acceptance evidence | Not collected |

Status remains Draft until ready for review. No feature implementation before
explicit human sign-off and Finalized status. Update this section and the FRD
index together.
