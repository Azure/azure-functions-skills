# Azure Skills Prerequisite Handling for CLI Setup/Chat

## Context

`azure-functions-deploy` delegates deployment execution to Azure Skills (`azure-prepare` → `azure-validate` → `azure-deploy`). Therefore the CLI commands in this package must not only install Azure Functions Skills, but also ensure the Azure Skills plugin is available for deployment scenarios.

Tracking issue: https://github.com/Azure/azure-functions-skills/issues/46

## Goals

- Add CLI-level prerequisite handling for Azure Skills in `setup` and `chat`.
- Support GitHub Copilot first.
- Use a structure that can later add Claude Code and Codex without changing setup/chat call sites.
- Prefer automatic installation for GitHub Copilot only when a reliable shell-executable path is available.
- Return clear status: already present, installed, skipped, unsupported, failed, or manual action required.

## Non-goals

- Do not vendor or copy Azure Skills content into this repository.
- Do not implement Claude Code or Codex installation in the first PR.
- Do not block non-deployment use cases when Azure Skills installation fails; report the limitation and continue installing Azure Functions Skills.
- Do not execute agent slash commands from the shell. Slash-command install paths should be shown as manual guidance unless the host exposes a reliable CLI equivalent.

## Proposed architecture

Add a shared prerequisite module under `src/setup/`:

```text
src/setup/prerequisites/
  index.ts
  azure-skills.ts
  types.ts
```

### Types

```ts
export type PrerequisiteMode = 'auto' | 'check-only' | 'skip';
export type PrerequisiteStatus =
  | 'present'
  | 'installed'
  | 'manual-action-required'
  | 'unsupported'
  | 'skipped'
  | 'failed';

export interface PrerequisiteContext {
  target: BuildTargetName;
  projectDir: string;
  mode: PrerequisiteMode;
  runner?: CommandRunner;
}

export interface PrerequisiteResult {
  id: string;
  target: BuildTargetName;
  status: PrerequisiteStatus;
  message: string;
  commands?: string[];
  details?: string[];
}

export interface PrerequisiteProvider {
  id: string;
  supports(target: BuildTargetName): boolean;
  check(context: PrerequisiteContext): Promise<PrerequisiteResult>;
  install(context: PrerequisiteContext): Promise<PrerequisiteResult>;
}
```

`setup` and `chat` should call one shared function:

```ts
ensurePrerequisites({
  targets,
  projectDir,
  mode: 'auto',
  prerequisites: ['azure-skills'],
});
```

This keeps setup/chat free of host-specific Azure Skills logic.

## GitHub Copilot provider design

### Target mapping

Use `BuildTargetName` as the provider target:

| Agent / launcher | Build target | Provider support in first PR |
| --- | --- | --- |
| GitHub Copilot CLI / VS Code-compatible layout | `ghcp` | Yes, auto-install only when `copilot plugin ...` is available |
| Claude Code | `claude` | No, return `unsupported` through the shared provider pipeline |
| Codex CLI | `codex` | No, return `unsupported` through the shared provider pipeline |

### Detection strategy for `ghcp`

Use best-effort detection in this order:

1. **GitHub Copilot CLI plugin list**
  - Run `copilot plugin list` when the `copilot` command is available.
  - Treat `azure` / `azure-skills` as present when listed.
  - This is the primary detection path because a plugin install is normally global/host-managed, not copied into the workspace.

2. **Workspace skill presence fallback**
  - Check for `.github/skills/azure-deploy/SKILL.md`, `.github/skills/azure-prepare/SKILL.md`, and `.github/skills/azure-validate/SKILL.md` under `projectDir` only as a compatibility fallback for manual/global `skills add` layouts.
  - Do not rely on workspace files as the plugin-mode signal.

3. **No reliable signal**
   - Return `manual-action-required` in `check-only` mode.
  - In `auto` mode, attempt the GitHub Copilot CLI plugin install below.

### Install strategy for `ghcp`

Prefer the GitHub Copilot CLI plugin commands when the `copilot` command is available:

```bash
copilot plugin marketplace add microsoft/azure-skills
copilot plugin install azure@azure-skills
```

These are shell-level equivalents of the interactive slash commands documented by Azure Skills:

```text
/plugin marketplace add microsoft/azure-skills
/plugin install azure@azure-skills
```

The shell-executable `skills add` path is not implemented in the first PR. Keep it as a documented manual recovery option only, because it is not a host plugin install:

```bash
npx skills add https://github.com/microsoft/azure-skills/tree/main/.github/plugins/azure-skills/skills -a github-copilot -g -y
```

If the command succeeds:

- return `installed`
- include a message that the user may need to reload/restart the host for skill indexing
- optionally rerun `copilot plugin list`, but do not fail if the plugin list output is not parseable immediately after install

If the command fails:

- return `manual-action-required`
- show manual Copilot plugin commands:
  - `/plugin marketplace add microsoft/azure-skills`
  - `/plugin install azure@azure-skills`

### VS Code Copilot behavior

The first implementation targets the shell-available GitHub Copilot CLI plugin commands. For VS Code-only environments where `copilot plugin ...` is unavailable, setup/chat should not fail or try to mutate unknown VS Code state. Instead, the provider returns `manual-action-required` with the equivalent Copilot slash commands and the setup skill can guide the user through host-specific installation.

### Manual guidance for future providers

For `claude`:

```text
/plugin install azure@claude-plugins-official
```

For `codex`:

```bash
codex plugin marketplace add microsoft/azure-skills
```

Then install `azure` from `/plugins`.

## setup integration

`applySetup` should accept prerequisite options:

```ts
export interface SetupOptions {
  agents?: CliAgentName[];
  prerequisites?: PrerequisiteMode;
}
```

Default behavior:

- `setup`: `auto`
- `setup --skip-prerequisites`: `skip`
- `setup --check-prerequisites`: `check-only`

Flow:

1. Detect agents.
2. Install Azure Functions Skills workspace files as today.
3. Run `ensurePrerequisites` for selected targets.
4. Include prerequisite results in `SetupResult` and welcome message.

`SetupResult` extension:

```ts
export interface SetupResult {
  agents: CliAgentName[];
  filesWritten: number;
  welcomeMessage: string;
  prerequisites?: PrerequisiteResult[];
}
```

## chat integration

`chat` should ensure prerequisites before launching the selected agent:

1. Map launcher to setup target (`github-copilot` → `ghcp`).
2. Run current auto-setup if Azure Functions Skills are missing.
3. Run `ensurePrerequisites` for Azure Skills.
4. Print concise prerequisite status to stderr.
5. Launch agent even if Azure Skills install requires manual action, but include the manual action in startup output so users know deployment is limited.

`ChatOptions` extension:

```ts
export interface ChatOptions {
  agent?: LauncherId;
  prompt?: string;
  dir?: string;
  prerequisites?: PrerequisiteMode;
}
```

Default behavior:

- `chat`: `auto`
- `chat --skip-prerequisites`: `skip`
- `chat --check-prerequisites`: `check-only`

## CLI flags

Add shared setup/chat flags:

```text
--skip-prerequisites   Do not check or install external prerequisites such as Azure Skills
--check-prerequisites  Check prerequisites and print guidance, but do not install
```

Default is `auto` because the user asked setup/chat to install Azure Skills when missing.

## Test plan

### Unit tests

- `azureSkillsProvider.supports('ghcp')` returns true.
- `azureSkillsProvider.supports('claude' | 'codex')` returns false or manual-only for first PR.
- `check` returns `present` when `copilot plugin list` includes `azure` or `azure-skills`.
- `check` returns `present` when all workspace Azure Skills files exist only as fallback.
- `install` invokes `copilot plugin marketplace add microsoft/azure-skills` and `copilot plugin install azure@azure-skills` for `ghcp` in `auto` mode when `copilot` is available.
- The first implementation does not run the `npx skills add ... -a github-copilot -g -y` fallback automatically.
- `install` returns `manual-action-required` with slash-command guidance when command execution fails.
- `ensurePrerequisites` aggregates provider results and does not throw for manual-action-required.

### setup tests

- `applySetup(..., { agents: ['ghcp'] })` calls Azure Skills prerequisite handling by default.
- `applySetup(..., { prerequisites: 'skip' })` does not call prerequisite handling.
- `SetupResult.welcomeMessage` includes Azure Skills prerequisite status.

### chat tests

- `chat({ agent: 'github-copilot' })` runs prerequisite handling before launch.
- `chat({ prerequisites: 'skip' })` skips prerequisite handling.
- Missing Azure Skills does not prevent chat launch when the result is `manual-action-required`; it prints guidance.

### CLI tests

- `setup --skip-prerequisites` maps to `prerequisites: 'skip'`.
- `chat --skip-prerequisites` maps to `prerequisites: 'skip'`.
- `--check-prerequisites` maps to `check-only`.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Plugin installs are host-managed and normally not visible in workspace files | Use `copilot plugin list` as the primary GitHub Copilot detection path |
| Slash commands cannot be executed from setup/chat shell | Use shell-level `copilot plugin marketplace add` / `copilot plugin install` commands for GitHub Copilot CLI and show slash commands as manual guidance |
| Global `npx skills add` fallback is not a plugin install | Keep it as fallback only, clearly label it as non-plugin compatibility behavior |
| Users only want local create/setup, not deployment | Do not fail setup/chat when Azure Skills cannot be installed; report degraded deployment capability |
| Claude/Codex install flows differ | Keep provider architecture target-based and return manual guidance until implemented |
| CI should not install global tools | Add `--skip-prerequisites` / `check-only` and injectable command runner for tests |

## Recommended first implementation PR

1. Add prerequisite types and `azureSkillsProvider` for `ghcp`.
2. Add `ensurePrerequisites` shared function.
3. Extend `SetupOptions`, `SetupResult`, and `ChatOptions` with prerequisite mode/result fields.
4. Implement GitHub Copilot plugin detection via `copilot plugin list`.
5. Implement GitHub Copilot plugin install via `copilot plugin marketplace add microsoft/azure-skills` and `copilot plugin install azure@azure-skills`.
6. Wire `setup` and `chat` to call `ensurePrerequisites` by default.
7. Add CLI flags for `--skip-prerequisites` and `--check-prerequisites`.
8. Add tests with a fake command runner and temporary workspace files.
9. Update README with the automatic GitHub Copilot prerequisite behavior and future Claude/Codex note.

## Implemented first pass

- Added `src/setup/prerequisites/types.ts`, `azure-skills.ts`, and `index.ts`.
- Added `azureSkillsProvider` for `ghcp` only.
- Added `ensurePrerequisites` with `auto`, `check-only`, and `skip` modes.
- Extended `SetupOptions`, `SetupResult`, and `ChatOptions` with prerequisite fields.
- Wired `applySetup` and `chat` to run prerequisite handling by default.
- Added setup/chat CLI flags: `--skip-prerequisites` and `--check-prerequisites`.
- Added fake-runner tests so CI does not run real global plugin installs.

## Open questions

- Is `copilot plugin install azure@azure-skills` stable enough to use as the default non-interactive install path in setup/chat?
- Should `setup` add the marketplace each time idempotently, or first query `copilot plugin marketplace list` once that output is validated?
- Should `npx skills add ... -g -y` remain available as an explicit fallback flag, or only be documented for manual recovery? Current first pass: manual recovery only.
- Should `chat` block launch when prerequisite install fails, or continue with a warning? Current recommendation: continue with warning.
- Should Azure Skills prerequisite handling run for every setup/chat invocation or only when a Functions project exists or deployment is likely? Current recommendation: run by default but non-blocking.
