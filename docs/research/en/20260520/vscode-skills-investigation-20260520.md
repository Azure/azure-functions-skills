# VS Code Skills Investigation

Date: 2026-05-20  
Target repository: `microsoft/vscode`  
Local path: `vscode/`  
Investigated commit: `0d944f4012c30d278fc803338cbdf022f2cd8ea6` (`origin/main` at investigation time)

## Questions Investigated

1. What triggers skill execution?
2. What skills are stored in the VS Code repository?
3. Are there any skills related to Azure Functions?

## Summary

VS Code / Copilot discovers skills from `SKILL.md` files and from extension/plugin contributions.

There are two major skill execution paths.

- The user explicitly invokes a skill as a slash command, such as `/create-skill`.
- The model compares the user request with skill descriptions and loads a relevant skill automatically.

At the investigated commit, the tracked VS Code repository contained 49 `SKILL.md` files. They included repository-specific skills, skills contributed by the Copilot extension, agent skills inside the Copilot extension, and built-in session skills.

There was no Azure Functions-specific skill. The only skill containing Azure in its name was `azure-pipelines`, which validates Azure DevOps pipeline changes for the VS Code build and is not related to Azure Functions development, deployment, triggers, bindings, or diagnostics.

## What Triggers Skill Execution?

### 1. Slash Command Invocation

Skills can appear and run as chat slash commands such as `/create-skill` or `/unit-tests`.

The slash menu includes prompt files and user-invocable skills. Skills are user-invocable by default, but this frontmatter hides them from the slash menu:

```yaml
user-invocable: false
```

Relevant implementation points:

- `IPromptsService.getSlashCommands()` returns prompt files and skills from workspace, user, and extension-provided sources.
- Chat input completions include only entries that are `userInvocable` and match the current session type.

Relevant files:

- `vscode/extensions/copilot/src/platform/promptFiles/common/promptsService.ts`
- `vscode/src/vs/workbench/contrib/chat/browser/widget/input/editor/chatInputCompletions.ts`
- `vscode/src/vs/workbench/contrib/chat/common/promptSyntax/service/promptsServiceImpl.ts`

### 2. Model-Triggered Automatic Skill Loading

The model sees a list of available skills in the prompt. When the user request matches a skill's domain and `description`, the model is instructed to load that skill before working.

The following skills are excluded from model-triggered invocation:

- Skills without `description`.
- Skills with `disable-model-invocation: true`.
- Skills that do not match the current session type.
- The `troubleshoot` skill when agent debug log file logging is disabled.

Relevant implementation points:

- `computeAutomaticInstructions.ts` calls `findAgentSkills()` and filters model-invocable skills.
- Skill metadata is injected into the prompt inside a `<skills>` block with name, description, and file path.
- If the skill tool is enabled, the model is instructed to call the `skill` tool with the skill name.
- If the skill tool is disabled, the model is instructed to read the target `SKILL.md` directly.

Relevant files:

- `vscode/src/vs/workbench/contrib/chat/common/promptSyntax/computeAutomaticInstructions.ts`
- `vscode/extensions/copilot/src/extension/prompts/node/agent/agentPrompt.tsx`

### 3. `skill` Tool Execution

The Copilot extension contributes a language model tool named `skill`. Its model-facing description says that:

- Skills are discovered from `SKILL.md` files.
- If the user's task matches an available skill, the tool should be called.
- Slash commands such as `/deploy` or `/test` should be treated as skill invocations.
- The tool input is only the skill name.

The tool is enabled by this setting:

```text
config.github.copilot.chat.skillTool.enabled
```

At runtime, `skillTool.ts` resolves the `SKILL.md` URI from the skill name, reads the skill content, and returns it as `<skill-context>`. If the skill frontmatter contains `context: fork`, the skill is delegated to a subagent instead of being returned inline.

Relevant files:

- `vscode/extensions/copilot/package.json`
- `vscode/extensions/copilot/src/extension/tools/node/skillTool.ts`

## Skill Discovery Locations

VS Code discovers skills from multiple locations.

| Source | Pattern |
| --- | --- |
| Repository, Copilot convention | `.github/skills/<name>/SKILL.md` |
| Repository, agents convention | `.agents/skills/<name>/SKILL.md` |
| Repository, Claude convention | `.claude/skills/<name>/SKILL.md` |
| User, Copilot convention | `~/.copilot/skills/<name>/SKILL.md` |
| User, agents convention | `~/.agents/skills/<name>/SKILL.md` |
| User, Claude convention | `~/.claude/skills/<name>/SKILL.md` |
| Environment / configured directories | `COPILOT_SKILLS_DIRS` or `chat.agentSkillsLocations` |
| Extension contribution | `contributes.chatSkills` |
| Agent plugins | `<pluginRoot>/skills/<name>/SKILL.md` |
| Built-in session skills | `src/vs/sessions/skills/<name>/SKILL.md` |

Useful skill frontmatter fields include:

```yaml
---
name: skill-name
description: What and when to use this Skill.
argument-hint: Optional hint shown for slash invocation
user-invocable: true
disable-model-invocation: false
context: inline
---
```

`context: fork` is a special mode in the `skill` tool. It causes the skill to execute through a subagent rather than returning inline context.

## Tracked Skills in the VS Code Repository

The investigation used:

```bash
git ls-files '*SKILL.md'
```

Tracked skill count: 49

Note: `vscode/waza/` was untracked inside the local `microsoft/vscode` repository and was excluded from the list.

### Repository Skills: `.github/skills`

| Skill | Purpose |
| --- | --- |
| `accessibility` | Accessibility guidance for VS Code UI contributions. |
| `add-policy` | Add, change, or review VS Code configuration policies. |
| `author-contributions` | Trace files changed by a specific author on a branch. |
| `auto-perf-optimize` | Agent-driven performance and memory investigation for VS Code. |
| `azure-pipelines` | Validate Azure DevOps pipeline changes for VS Code builds. |
| `chat-customizations-editor` | Work on the Chat Customizations editor. |
| `chat-perf` | Run chat performance benchmarks and memory checks. |
| `code-oss-logs` | Locate and read logs for Code OSS dev builds. |
| `component-fixtures` | Create or update component fixtures for screenshot testing. |
| `cpu-profile-analysis` | Analyze V8 / Chrome CPU profiles and DevTools trace files. |
| `fix-ci-failures` | Investigate and fix PR CI failures. |
| `fix-errors` | Fix unhandled errors from the VS Code error telemetry dashboard. |
| `heap-snapshot-analysis` | Analyze heap snapshots for leaks or retainers. |
| `hygiene` | Check changes against VS Code hygiene requirements. |
| `integration-tests` | Run VS Code integration tests. |
| `memory-leak-audit` | Audit event listeners, disposables, and lifecycle code for leaks. |
| `otel` | Work on Copilot Chat OpenTelemetry instrumentation. |
| `sessions` | Work on Agents window architecture and session features. |
| `tool-rename-deprecation` | Preserve backward compatibility when renaming built-in tool references. |
| `unit-tests` | Run VS Code unit tests. |
| `update-screenshots` | Download screenshot baselines from CI and commit them. |
| `vscode-dev-workbench` | Launch vscode.dev locally and automate workbench / Agents window actions. |

### Repository Agent Skills: `.agents/skills`

| Skill | Purpose |
| --- | --- |
| `launch` | Launch and automate Code OSS through Playwright / CDP. |

### Copilot Extension Contributed Skills

Declared under `contributes.chatSkills` in `vscode/extensions/copilot/package.json`.

| Skill | Purpose |
| --- | --- |
| `agent-customization` | Create, update, review, fix, and debug chat customization files. |
| `chronicle` | Use Copilot session history for standups, tips, search, and reindexing. |
| `create-agent` | Create custom `.agent.md` files. |
| `create-hook` | Create hook JSON files for agent lifecycle events. |
| `create-instructions` | Create `.instructions.md` files. |
| `create-prompt` | Create reusable `.prompt.md` files. |
| `create-skill` | Create reusable `SKILL.md` workflows. |
| `get-search-view-results` | Get current search results from the VS Code Search view. |
| `init` | Generate or update chat customization files. |
| `install-vscode-extension` | Install a VS Code extension by extension ID. |
| `project-setup-info-context7` | Scaffold complete projects using Context7-backed setup guidance. |
| `project-setup-info-local` | Scaffold complete projects using local setup guidance. |
| `troubleshoot` | Investigate unexpected chat agent behavior using debug logs. |

### Copilot Extension Agent Skills

| Skill | Purpose |
| --- | --- |
| `anthropic-sdk-upgrader` | Upgrade Anthropic SDK packages and address migration issues. |
| `github-copilot-upgrader` | Update GitHub Copilot CLI / SDK packages. |
| `launch` | Launch and automate VS Code Insiders with Copilot Chat. |

### Built-In Session Skills

| Skill | Purpose |
| --- | --- |
| `act-on-feedback` | Act on user feedback attached to the current session. |
| `commit` | Commit session changes with an AI-generated commit message. |
| `create-draft-pr` | Create a draft PR from current session changes. |
| `create-pr` | Create a PR from current session changes. |
| `generate-run-commands` | Generate or change run commands for the session Run button. |
| `merge` | Merge the topic branch into the base branch. |
| `sync-upstream` | Rebase a stale session branch onto latest origin. |
| `sync` | Sync, pull, rebase, push, publish, or set upstream for the session branch. |
| `update-pr` | Push new changes to an existing PR. |
| `update-skills` | Create or update repository skills/instructions from important learnings. |

## Azure Functions Relevance

Searches used:

```bash
git grep -n -i -E "azure functions|azure function|function app|serverless|azure functions" -- '*SKILL.md'
git grep -n -i -E "azure|azd|function app|serverless|azure functions" -- '*SKILL.md'
```

Results:

- The tracked VS Code repository does not contain an Azure Functions-specific skill.
- No skill targets Function App development, Azure Functions deployment, triggers, bindings, or diagnostics.
- The only Azure-specific skill is `azure-pipelines`, which is for VS Code build infrastructure and Azure DevOps pipeline validation.

## Key Points

- Skill discoverability strongly depends on `description`.
- Slash command visibility is controlled by `user-invocable`.
- Model-triggered loading depends on `description`, session type, and `disable-model-invocation`.
- Extension authors can distribute skills through `contributes.chatSkills`.
- At the investigated commit, the tracked `microsoft/vscode` repository did not include Azure Functions-specific skills.

Japanese source: `Research/ja/20260520/vscode-skills-investigation-20260520.md`
