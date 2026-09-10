# Isolated local HTTP evaluation

This is the first native Vally proof, not a published benchmark or an ON/OFF
comparison. It uses `@microsoft/vally-cli` **0.16.0**, `copilot-sdk`,
`claude-sonnet-5`, and one trial. No MCP servers, other Functions skills, Azure
credentials, deployment, or emulators are required.

Use only reviewed, trusted local code. Never execute this from PR-triggered CI
or against untrusted contributor content. GitHub Actions evaluation still
requires the repository's reviewer-gated environment.

## Requirements and limits

- Node.js **22.12+**, PowerShell 7 (`pwsh`), npm, and Functions Core Tools v4
  (`func`) on PATH. This scenario's command grader is PowerShell-based.
- Copilot access to the exact model. Do not substitute another model on failure.
- An explicitly approved inference budget and owned-process cleanup policy.
  `runs: 1`, `timeout: 10m`, `constraints.max_duration: 10m`, and
  `--max-retries 0` bound this proof. They are **not** a token or monetary cap.
  In Vally 0.16.0, `max_turns` and `max_tokens` are validated but not enforced by
  the execution pipeline; this eval intentionally does not advertise them.

The graders require session completion, `tsconfig.json`, an independent build,
and real HTTP responses both with and without a name. The command grader starts
its own Functions host on a dynamically selected port and stops its owned
process tree in `finally`. A host-side watchdog also stops that tree if the
grader parent dies or the host lifetime reaches 200 seconds (beyond the grader's
three-minute timeout), including when
Vally forcibly terminates the grader on timeout. It does not trust the agent's prose. The score
threshold is 1; skill activation is diagnostic, not a pass requirement.

## Isolation protocol

Do **not** run the bare eval command from the repository or a normal developer
profile. The root `.vally.yaml` and older routing suites are not the baseline
configuration for this scenario.

Perform the following in a disposable `pwsh -NoProfile` process, with a new root
outside the repository, worktrees, user home, and their discovery ancestors:

1. Resolve the repository path and the installed entrypoints before changing cwd:
   `node_modules\@microsoft\vally-cli\dist\index.js` and
   `node_modules\@github\copilot-win32-x64\index.js` on Windows. The latter is the
   entrypoint the installed SDK resolves, not a globally installed Copilot.
2. Retain only executable/OS environment variables and a narrowly scoped Copilot
   authentication token. The proof retained PATH, PATHEXT, SystemRoot, WINDIR,
   SystemDrive, ComSpec, ProgramFiles variants, PROCESSOR_ARCHITECTURE,
   NUMBER_OF_PROCESSORS, OS, and GH_TOKEN. Never print the token, put it in YAML,
   copy a credential store, or retain Azure/provider credentials.
3. Point HOME, USERPROFILE, HOMEDRIVE/HOMEPATH, APPDATA, LOCALAPPDATA,
   XDG_CONFIG_HOME, GH_CONFIG_DIR, and TEMP/TMP at owned empty directories.
   Set GIT_CONFIG_GLOBAL to `NUL` and GIT_CONFIG_NOSYSTEM to `1` on Windows.
   Point npm_config_userconfig/globalconfig at nonexistent files in that home;
   use an explicit trusted npm registry. Do not copy normal npm credentials.
4. Set COPILOT_AUTO_UPDATE to `false`, VALLY_TELEMETRY_OPTOUT to `1`, and
   FUNCTIONS_CORE_TOOLS_TELEMETRY_OPTOUT to `1`. Do not retain ambient
   COPILOT_CLI_PATH, COPILOT_CLI_BINARY_VERSION, COPILOT_SKILLS_DIRS,
   COPILOT_CUSTOM_INSTRUCTIONS_DIRS, EVALUATE_USE_HOST_COPILOT_HOME, provider,
   extension, plugin, MCP, or telemetry-export settings.
5. Check the new root and ancestors for discovery configuration before proceeding:
   no AGENTS.md, .github, .agents, .claude, .copilot, or .vally.yaml.
   Set cwd and Vally `--work-dir` to an empty directory under that root.
6. Materialize the ON preflight with native Vally (variables below are absolute
   paths). These commands do not run inference:

   ```powershell
   node $vally oracle --eval-spec $spec --stimulus typescript-http `
     --no-golden-input --skip-grade --workspace $preflightOn
   ```

7. For native discovery inspection, use a fresh COPILOT_HOME with `settings.json`
   containing exactly
   `{"disabledSkills":["customize-cloud-agent","github-pr-media"]}`. These are
   bundled runtime skills, not Functions dependencies. Use the same settings
   for both conditions. The eval passes this JSON through Vally's native
   `COPILOT_HOME_SETTINGS_JSON` into a fresh per-run config home.
8. In an empty OFF directory, with no COPILOT_SKILLS_DIRS, run
   `node $copilot skill list --json`. In the oracle ON directory, set
   COPILOT_SKILLS_DIRS to the copied `azure-functions-create` directory and run
   the same command. Require OFF's enabled set to be empty and ON's to be exactly
   `azure-functions-create`. Inspect paths too: ON contains only SKILL.md and its
   two bundled references, not common/setup skills. Fail closed on unexpected
   enabled skills. Unset COPILOT_SKILLS_DIRS after this diagnostic; Vally passes
   its own per-trial skillDirectories during evaluation.
9. Use a **new**, unused workspace for the paid trial:

   ```powershell
   node $vally eval --eval-spec $spec --work-dir $emptyDirectory `
     --workspace $freshTrialRoot --output-dir $privateResults `
     --workers 1 --runs 1 --max-retries 0 --require-pass
   ```

Vally copies only `agent_environment.skills` into its trial workspace.
An explicit empty skill array replaces the inherited skill set for OFF.
The executor supplies the trial cwd, a fresh configDirectory/COPILOT_HOME,
`requestExtensions: false`, and disables the undeclared hosted GitHub MCP.
Workspace discovery remains enabled, hence the clean directory/profile checks
are necessary. No custom SDK runner or event instrumentation is involved.

Inspect the actual native `session.start` for cwd, model, and runtime version.
Afterward, check for surviving owned processes, preserve native results
privately, and remove the owned trial/profile/temp directories. Never terminate
shared processes or delete shared emulator containers.

## Observed native outputs

The successful 2026-09-10 proof used bundled Copilot **1.0.80**, confirmed by its
native `session.start`, with Node 24.18.1 and Core Tools 4.10.0.
All three graders passed. These are one-trial observations, not reliability or
statistical claims.

Vally wrote `results.jsonl` (a `trial-result` followed by a `run-summary`),
`eval-results.md`, `otel-spans.jsonl`, and a per-trial directory
`<eval>/<stimulus>/<model>/0/` containing `events.jsonl`, `metadata.json`, and
`workspace.patch`. There was no separate `run-summary.jsonl` in this eval run.

| Field in the `trial-result` | Type / units | Observed value |
| --- | --- | --- |
| `status` | string, execution status; not the graded verdict | `success` |
| `gradeResult.passed` | boolean | `true` |
| `gradeResult.score` | number, normalized grader score | `1` |
| `gradeResult.details[]` | individual native grader outcomes | 3 passed |
| `durationMs` | number, trial duration in milliseconds | 191831 |
| `trajectory.metrics.wallTimeMs` | number, trajectory wall time in milliseconds | 183179 |
| `trajectory.metrics.tokenUsage.inputTokens` | number, tokens | 983203 |
| `trajectory.metrics.tokenUsage.outputTokens` | number, tokens | 6608 |
| `trajectory.metrics.tokenUsage.totalTokens` | number, input plus output | 989811 |
| `trajectory.metrics.tokenUsage.cacheReadTokens` | number, tokens | 947767 |
| `trajectory.metrics.tokenUsage.cacheWriteTokens` | number, tokens | 35360 |
| `trajectory.metrics.tokenUsage.callCount` | number | 38 |
| `trajectory.metrics.turnCount` | number, native assistant turns | 38 |
| `trajectory.metrics.toolCallCount` | number | 37 |
| `trajectory.metrics.errorCount` | number | 0 |
| `trajectory.metrics.skillActivationCount` | number | 1 |
| `trajectory.metrics.skillActivationBreakdown` | name-to-count object | `azure-functions-create: 1` |

`tokenUsage.byModel` and `tokenUsage.cost` were also present. Cost was recorded
natively as provider `github-copilot`, unit `nano-aiu`, amount `34418540000`;
do not relabel this as currency. Vally sums the provider's per-call input/output
usage; cache fields are separate sums and must not be added to `totalTokens`.
Do not interpret total tokens as uncached input or derive billing from them.
`wallTimeMs` uses native trajectory timestamps; it is not `durationMs`.

The dependency lock was generated by npm using the existing Microsoft package
proxy. That proxy supplied SHA-1 integrity for some packages, including 37
previously SHA-512 entries. This metadata was retained as returned, with explicit
approval prioritizing proxy/CI compatibility; hashes were not fabricated.
`npm --omit-lockfile-registry-resolved` omitted registry-specific URLs, and
`npm ci --ignore-scripts` succeeded against that proxy with an empty cache.

The summary has `passed`, `hadExecutionErrors`, and `evals[]` entries with
`overallScore`, `threshold`, `scoringApplied`, `stimuliRun`, and `stimuliTotal`.
Use these native verdicts; a completed execution alone is not a pass.

**Discovery caveat:** `trajectory.metadata.skillsLoaded` also listed the two
disabled built-ins. Vally's adapter retains names from `session.skills_loaded`
without filtering enabled state. It is not an enabled/exposed-skill inventory.
Use native discovery's enabled flags and effective configuration for isolation,
not this name list or zero activation counts.

All fields above were present in this successful run. Missing metrics in future
runs remain missing, not fabricated zeros. Raw outputs contain prompts, local
paths, command output, and generated files; keep them private. Any later
dashboard must consume native metrics, not parse trajectories to remeasure them.
