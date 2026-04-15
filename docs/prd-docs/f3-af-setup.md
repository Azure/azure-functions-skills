# F3: azure-functions-setup — Environment Verification

**Status:** 📋 Proposed  
**Draft Spec Section:** 3.1, 4.1  
**Depends on:** F1 (Skill Graph Metadata)

## Problem

New Azure Functions developers often fail at the first step: their environment is missing Azure CLI, Core Tools, a language runtime, or the right versions. Debugging these prerequisites wastes time and discourages adoption. There's no single skill that verifies everything needed and guides the user through fixes.

## Feature

`azure-functions-setup` verifies that the developer's environment has all prerequisites for Azure Functions development and provides actionable fix instructions for anything missing.

## Checks

| Check | How | Pass Criteria |
|-------|-----|---------------|
| Azure CLI | `az --version` | Exits 0, version ≥ 2.60 |
| Core Tools | `func --version` | Exits 0, version ≥ 4.x |
| Node.js | `node --version` | Exits 0, version ≥ 18 (if Node project) |
| Python | `python --version` or `python3 --version` | Exits 0, version ≥ 3.9 (if Python project) |
| .NET SDK | `dotnet --version` | Exits 0, version ≥ 8.0 (if .NET project) |
| Java | `java --version` + `mvn --version` | Both exit 0 (if Java project) |
| Azure subscription | `az account show` | Exits 0, subscription active |
| Docker (optional) | `docker --version` | Exits 0 (only if containerized deployment planned) |

## Output Format

```
Azure Functions Environment Check

  ✅ Azure CLI          2.67.0
  ✅ Core Tools         4.0.6610
  ✅ Node.js            22.12.0
  ⚠️  Azure subscription  Not logged in
  ─── Optional ───
  ✅ Docker             27.4.0

Issues Found:
  ⚠️  Azure subscription: Run 'az login' to authenticate.
     Docs: https://learn.microsoft.com/cli/azure/authenticate-azure-cli

Next Steps:
  → azure-functions-create: Your environment is ready. Create a new Functions app.
```

## Skill Metadata

```yaml
id: azure-functions-setup
title: Azure Functions Setup
intent:
  - verify_tooling
  - onboard_user
  - check_prerequisites
completion_signals:
  - azure_cli_available
  - core_tools_available
  - language_runtime_detected
suggestions:
  on_success:
    - target: azure-functions-create
      reason: "The environment is ready. The next logical step is to create a new Azure Functions app."
      priority: 100
    - target: azure-functions-help
      reason: "If the user is unsure what to do next, provide guided options."
      priority: 60
  on_failure:
    - target: azure-functions-help
      reason: "Setup could not be completed. Route to troubleshooting guidance."
      priority: 100
entry_conditions:
  - user_is_new
  - tooling_unknown
```

## Behavior

### Language-Aware Checks

If the current directory contains a Functions project, `azure-functions-setup` detects the language and only checks relevant runtimes:

- `requirements.txt` or `function_app.py` → check Python
- `package.json` with `@azure/functions` → check Node.js
- `*.csproj` with `Microsoft.Azure.Functions.Worker` → check .NET SDK
- `pom.xml` with `azure-functions-maven-plugin` → check Java + Maven

If no project is detected, only Azure CLI and Core Tools are checked.

### Fix Instructions

Each failed check includes:

1. **What's wrong** — one-line description
2. **How to fix** — exact command to run
3. **Docs link** — Microsoft Learn URL for detailed instructions

### Idempotent

Running `azure-functions-setup` multiple times is safe. Already-passing checks are shown as ✅ without re-installation.

## Agent Workspace Configuration

After environment checks complete, `azure-functions-setup` automatically places files needed for AI development based on the detected coding agent (adopting the design from func-emulate F20 `fnx setup`).

### Agent Detection

3-tier detection strategy:

| Detection Layer | Target | Method |
|----------------|--------|--------|
| CLI binary | Claude Code, Codex, Amp, etc. | `which` / `where.exe` |
| IDE config files | VSCode+Copilot, Cursor | Check for `.vscode/`, `.cursor/` |
| Explicit specification | All agents | User-specified |

### Generated Files

Files placed based on detected agent:

| File | Target Agent | Content |
|------|-------------|--------|
| `.github/copilot-instructions.md` | GitHub Copilot | Functions-specific coding guidance |
| `.vscode/mcp.json` | GitHub Copilot | Templates MCP server config (F19) |
| `.claude/settings.json` | Claude Code | MCP server + project settings |
| `.cursor/rules/azure-functions.mdc` | Cursor | Functions rules |
| `AGENTS.md` | Codex / generic | Agent-agnostic instructions |

### Agent Path Mapping (from func-emulate manifest)

```yaml
agentPaths:
  shared:
    projectSkills: ".agents/skills"
    agents: [github-copilot, cursor, codex, cline, gemini-cli, opencode, amp]
  custom:
    claude-code:
      projectSkills: ".claude/skills"
      instructions: ".claude/CLAUDE.md"
      mcp: ".claude/settings.json"
    github-copilot:
      instructions: ".github/copilot-instructions.md"
      agentDefs: ".github/agents/"
      mcp: ".vscode/mcp.json"
    cursor:
      rules: ".cursor/rules/"
      mcp: ".cursor/mcp.json"
```

### Idempotency

- Existing files are not overwritten without `--force`
- MCP settings use a merge strategy (preserve existing server configs and add Functions entries)
- On subsequent runs, only new modules are suggested

### Content Tailoring

Generated skill files and instruction files are customized to match the detected project:

- **Language-specific patterns** — v2/v4/isolated patterns for the detected runtime
- **SKU constraints** — Warnings about features not supported on the target SKU
- **Available MCP tools** — References to the Templates MCP

## Cross-Target Implementation

| Target | Surfacing |
|--------|-----------|
| GHCP | Skill runs checks via shell commands, configures `.github/` + `.vscode/mcp.json` |
| Claude Code | Skill configures `.claude/` directory with skills, instructions, MCP |
| Codex | Agent instruction with prerequisite verification + `AGENTS.md` generation |
| Cursor | Skill configures `.cursor/rules/` and `.cursor/mcp.json` |
| Repo Template | Pre-flight check + agent config setup in `copilot-instructions.md` |
