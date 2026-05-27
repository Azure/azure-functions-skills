# Bug Bash Chat E2E Test Steps - 2026-05-19

This checklist validates `azure-functions-skills chat` for the three supported coding agents, using both the locally built repository and the npm-published package.

## Scope

Test matrix:

| Package source | GitHub Copilot CLI | Claude Code | Codex CLI |
| --- | --- | --- | --- |
| Local build | chat | chat | chat |
| npm published | chat | chat | chat |

Expected package version for npm path: `@azure/functions-skills@0.12.0`.

## Prerequisites

Run from PowerShell.

```powershell
$Repo = 'Q:\repos\functions-skills\azure-functions-skills'
Set-Location $Repo
git status --short --branch
node --version
npm --version
copilot --version
claude --version
codex --version
```

Make sure the repo is on latest `main` and clean enough for testing:

```powershell
git switch main
git pull --ff-only origin main
git status --short --branch
```

If you previously ran fake-agent tests, remove stale fake wrappers from `PATH` for this PowerShell session:

```powershell
$env:PATH = ($env:PATH -split ';' | Where-Object { $_ -ne 'Q:\workspaces\skill-testing\claude-format-chat-bin' }) -join ';'
where.exe claude
where.exe copilot
where.exe codex
```

Expected real Claude path on this machine is usually:

```text
C:\Users\tsushi\.local\bin\claude.exe
```

For Codex, verify auth before the chat test. If this reports logged in but `codex exec` later returns `401 Unauthorized`, classify Codex runtime validation as blocked by Codex/OpenAI auth rather than a package failure.

```powershell
codex login status
codex doctor
```

## Prepare Run Directory

Use an isolated bug bash directory outside the repository root pollution surface.

```powershell
$RunId = Get-Date -Format 'yyyyMMddTHHmmss'
$Base = "Q:\workspaces\skill-testing\bug-bash-chat-$RunId"
$Logs = Join-Path $Base 'logs'
New-Item -ItemType Directory -Force -Path $Base, $Logs | Out-Null
```

## Build Local Version

```powershell
Set-Location $Repo
npm ci
npm run build
node .\bin\azure-functions-skills.js --help
```

Use this local command path in the local-build scenarios:

```powershell
$LocalCli = Join-Path $Repo 'bin\azure-functions-skills.js'
```

Use `cmd.exe /d /s /c` in the npm-published scenarios. The wrapper avoids Windows PowerShell argument-passing quirks around scoped npm packages.

```powershell
$NpmPackage = '@azure/functions-skills@0.12.0'
```

## Local Build Chat Tests

### 1. GitHub Copilot CLI - Local Build

```powershell
$Ws = Join-Path $Base 'local-ghcp'
New-Item -ItemType Directory -Force -Path $Ws | Out-Null
Set-Location $Ws

$Prompt = 'Inspect this workspace for Azure Functions Skills setup. Return concise JSON with fields agent, workspaceRoot, startupContextVisible, skillsCount, hasCopilotInstructions, hasFunctionsCopilotAgent, hasMcp, passed, notes. Do not edit files.'
$Log = Join-Path $Logs 'local-ghcp.log'
& node $LocalCli chat --agent github-copilot --dir . --skip-prerequisites -- -p $Prompt --output-format json -s --allow-all --no-ask-user *> $Log

Test-Path "$Ws\.github\copilot-instructions.md"
Test-Path "$Ws\.github\agents\functions-copilot.agent.md"
(Get-ChildItem "$Ws\.github\skills\*\SKILL.md" -ErrorAction SilentlyContinue).Count
Test-Path "$Ws\.github\hooks\welcome-setup.json"
Test-Path "$Ws\.vscode\mcp.json"
Get-Content $Log -Tail 40
```

Pass criteria:

- Command exits successfully.
- `functions-copilot` is selected or reported by the agent.
- 9 Azure Functions skills are visible.
- Workspace files above exist.
- If Azure MCP fails to start but skills and chat work, record a warning, not a chat failure.

### 2. Claude Code - Local Build

```powershell
$Ws = Join-Path $Base 'local-claude'
New-Item -ItemType Directory -Force -Path $Ws | Out-Null
Set-Location $Ws

$Prompt = 'Inspect this workspace for Azure Functions Skills setup. Return concise JSON with fields agent, workspaceRoot, skillsCount, hasClaudeMd, hasClaudeSettings, passed, notes. Do not edit files.'
$Log = Join-Path $Logs 'local-claude.log'
& node $LocalCli chat --agent claude-code --dir . --skip-prerequisites --prompt $Prompt -p --output-format text --no-session-persistence --permission-mode bypassPermissions --tools Read,LS,Grep,Glob *> $Log

Test-Path "$Ws\CLAUDE.md"
Test-Path "$Ws\.claude\settings.json"
(Get-ChildItem "$Ws\.claude\skills\*\SKILL.md" -ErrorAction SilentlyContinue).Count
Get-Content $Log -Tail 40
```

Pass criteria:

- Command exits successfully.
- Claude response contains `passed: true` or equivalent.
- 9 Azure Functions skills are visible.
- `CLAUDE.md` and `.claude/settings.json` exist.

### 3. Codex CLI - Local Build

```powershell
$Ws = Join-Path $Base 'local-codex'
New-Item -ItemType Directory -Force -Path $Ws | Out-Null
Set-Location $Ws

$Prompt = 'Inspect this workspace for Azure Functions Skills setup. Return concise JSON with fields agent, workspaceRoot, skillsCount, hasAgentsMd, hasCodexConfig, hasHooks, passed, notes. Do not edit files.'
$Log = Join-Path $Logs 'local-codex.log'
& node $LocalCli chat --agent codex --dir . --skip-prerequisites --prompt $Prompt exec --sandbox read-only --json --output-last-message e2e-chat-inspection.txt --ephemeral --skip-git-repo-check --cd . *> $Log

Test-Path "$Ws\AGENTS.md"
Test-Path "$Ws\.codex\config.toml"
Test-Path "$Ws\.codex\hooks.json"
(Get-ChildItem "$Ws\.agents\skills\*\SKILL.md" -ErrorAction SilentlyContinue).Count
if (Test-Path "$Ws\e2e-chat-inspection.txt") { Get-Content "$Ws\e2e-chat-inspection.txt" }
Get-Content $Log -Tail 60
```

Pass criteria:

- Command exits successfully.
- `e2e-chat-inspection.txt` exists and reports `passed: true` or equivalent.
- 9 Azure Functions skills are visible.
- `AGENTS.md`, `.codex/config.toml`, and `.codex/hooks.json` exist.

Blocked criteria:

- If the workspace files are installed but Codex returns `401 Unauthorized` from the OpenAI responses endpoint, record `chat runtime blocked by Codex auth`.

## npm Published Chat Tests

Use the same prompt expectations, but execute the npm-published package through `npx`.

### 4. GitHub Copilot CLI - npm Published

```powershell
$Ws = Join-Path $Base 'npm-ghcp'
New-Item -ItemType Directory -Force -Path $Ws | Out-Null
Set-Location $Ws

$Prompt = 'Inspect this workspace for Azure Functions Skills setup. Return concise JSON with fields agent, workspaceRoot, startupContextVisible, skillsCount, hasCopilotInstructions, hasFunctionsCopilotAgent, hasMcp, passed, notes. Do not edit files.'
$Log = Join-Path $Logs 'npm-ghcp.log'
$Cmd = "npx --yes --package $NpmPackage azure-functions-skills chat --agent github-copilot --dir . --skip-prerequisites -- -p `"$Prompt`" --output-format json -s --allow-all --no-ask-user"
& cmd.exe /d /s /c $Cmd *> $Log

Test-Path "$Ws\.github\copilot-instructions.md"
Test-Path "$Ws\.github\agents\functions-copilot.agent.md"
(Get-ChildItem "$Ws\.github\skills\*\SKILL.md" -ErrorAction SilentlyContinue).Count
Test-Path "$Ws\.github\hooks\welcome-setup.json"
Test-Path "$Ws\.vscode\mcp.json"
Get-Content $Log -Tail 40
```

### 5. Claude Code - npm Published

```powershell
$Ws = Join-Path $Base 'npm-claude'
New-Item -ItemType Directory -Force -Path $Ws | Out-Null
Set-Location $Ws

$Prompt = 'Inspect this workspace for Azure Functions Skills setup. Return concise JSON with fields agent, workspaceRoot, skillsCount, hasClaudeMd, hasClaudeSettings, passed, notes. Do not edit files.'
$Log = Join-Path $Logs 'npm-claude.log'
$Cmd = "npx --yes --package $NpmPackage azure-functions-skills chat --agent claude-code --dir . --skip-prerequisites --prompt `"$Prompt`" -p --output-format text --no-session-persistence --permission-mode bypassPermissions --tools Read,LS,Grep,Glob"
& cmd.exe /d /s /c $Cmd *> $Log

Test-Path "$Ws\CLAUDE.md"
Test-Path "$Ws\.claude\settings.json"
(Get-ChildItem "$Ws\.claude\skills\*\SKILL.md" -ErrorAction SilentlyContinue).Count
Get-Content $Log -Tail 40
```

### 6. Codex CLI - npm Published

```powershell
$Ws = Join-Path $Base 'npm-codex'
New-Item -ItemType Directory -Force -Path $Ws | Out-Null
Set-Location $Ws

$Prompt = 'Inspect this workspace for Azure Functions Skills setup. Return concise JSON with fields agent, workspaceRoot, skillsCount, hasAgentsMd, hasCodexConfig, hasHooks, passed, notes. Do not edit files.'
$Log = Join-Path $Logs 'npm-codex.log'
$Cmd = "npx --yes --package $NpmPackage azure-functions-skills chat --agent codex --dir . --skip-prerequisites --prompt `"$Prompt`" exec --sandbox read-only --json --output-last-message e2e-chat-inspection.txt --ephemeral --skip-git-repo-check --cd ."
& cmd.exe /d /s /c $Cmd *> $Log

Test-Path "$Ws\AGENTS.md"
Test-Path "$Ws\.codex\config.toml"
Test-Path "$Ws\.codex\hooks.json"
(Get-ChildItem "$Ws\.agents\skills\*\SKILL.md" -ErrorAction SilentlyContinue).Count
if (Test-Path "$Ws\e2e-chat-inspection.txt") { Get-Content "$Ws\e2e-chat-inspection.txt" }
Get-Content $Log -Tail 60
```

## Final Review Checklist

For each of the six scenarios, record:

- command exit code
- log file path
- installed workspace files
- skill count (expected: 9)
- agent JSON or concise response
- warnings, especially MCP startup warnings
- blockers, especially Codex `401 Unauthorized`

Quick log scan:

```powershell
Get-ChildItem $Logs -Filter '*.log' | ForEach-Object {
  Write-Host "`n==== $($_.Name) ===="
  Select-String -Path $_.FullName -Pattern 'passed|skillsCount|Unauthorized|error|failed|Installed' -CaseSensitive:$false | Select-Object -First 20
}
```

Check for accidental repository-root pollution:

```powershell
Set-Location $Repo
git status --short -- .agents .claude .codex .github/agents .github/hooks AGENTS.md CLAUDE.md
```

If root-level generated files appear and were created by this bug bash, remove only those generated artifacts after confirming they are not user-authored changes.

## Expected Summary

- GitHub Copilot local build: pass, with possible Azure MCP warning.
- GitHub Copilot npm published: pass, with possible Azure MCP warning.
- Claude local build: pass.
- Claude npm published: pass.
- Codex local build: pass only when Codex auth is usable; otherwise blocked after workspace setup.
- Codex npm published: pass only when Codex auth is usable; otherwise blocked after workspace setup.
