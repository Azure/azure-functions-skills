# E2E Test Command Reference

This is the authoritative source of truth for all E2E test commands. Execute every numbered command in order. Do NOT skip any command. Do NOT modify commands unless the user explicitly requests it.

## Conventions

- `$REPO` = repository root (use `git rev-parse --show-toplevel` or known path)
- `$CLI` = `node $REPO/bin/azure-functions-skills.js` (current branch under test)
- `$RUN` = `$REPO/reports/e2e/<run-id>` where `<run-id>` = date stamp like `20260531-001`
- `$WS` = `$RUN/workspaces/<test-case-id>` (fresh per test case)
- All commands use `--dir $WS` with absolute paths
- Resolve `$REPO` once at preflight; do NOT use relative paths after changing directories

## Agent ID mapping

| Purpose | GHCP | Claude | Codex |
|---------|------|--------|-------|
| install `--agent` | `ghcp` | `claude` | `codex` |
| chat `--agent` | `github-copilot` | `claude-code` | `codex` |
| plugin CLI | `copilot` | `claude` | `codex` |

## Expected workspace files after install

### GHCP — local mode (`install --local --agent ghcp`)

| File | Required | Max size |
|------|----------|----------|
| `.github/agents/functions-copilot.agent.md` | YES | — |
| `.github/skills/azure-functions-setup/SKILL.md` | YES | — |
| `.github/skills/azure-functions-create/SKILL.md` | YES | — |
| `.github/skills/azure-functions-deploy/SKILL.md` | YES | — |
| `.github/skills/azure-functions-diagnostics/SKILL.md` | YES | — |
| `.github/skills/azure-functions-doctor/SKILL.md` | YES | — |
| `.github/skills/azure-functions-feedback/SKILL.md` | YES | — |
| `.github/skills/azure-functions-health-status/SKILL.md` | YES | — |
| `.github/skills/azure-functions-inventory/SKILL.md` | YES | — |
| `.github/skills/azure-functions-best-practices/SKILL.md` | YES | — |
| `.github/skills/azure-functions-common/SKILL.md` | YES | — |
| `.github/hooks/welcome-setup.json` | YES | — |
| `.vscode/mcp.json` | YES | — |
| `AGENTS.md` | YES | — |
| `.github/copilot-instructions.md` | **NO** | Must NOT exist |
| `.azure-functions-skills/state.local.json` | YES | — |

### GHCP — plugin mode (`install --agent ghcp`)

| File | Required | Notes |
|------|----------|-------|
| `.github/copilot-instructions.md` | YES | Small routing block with managed markers |
| `.github/agents/functions-copilot.agent.md` | YES | — |
| `.github/hooks/welcome-setup.json` | YES | — |
| `.vscode/mcp.json` | YES | — |
| `.github/copilot/settings.json` | YES | Plugin reference |

### Claude — local mode (`install --local --agent claude`)

| File | Required | Max size |
|------|----------|----------|
| `CLAUDE.md` | YES | 3000 bytes |
| `.claude/settings.json` | YES | — |
| `.claude/skills/azure-functions-setup/SKILL.md` | YES | — |
| `.claude/skills/azure-functions-create/SKILL.md` | YES | — |
| `.claude/skills/azure-functions-deploy/SKILL.md` | YES | — |
| `.claude/skills/azure-functions-diagnostics/SKILL.md` | YES | — |
| `.claude/skills/azure-functions-doctor/SKILL.md` | YES | — |
| `.claude/skills/azure-functions-feedback/SKILL.md` | YES | — |
| `.claude/skills/azure-functions-health-status/SKILL.md` | YES | — |
| `.claude/skills/azure-functions-inventory/SKILL.md` | YES | — |
| `.claude/skills/azure-functions-best-practices/SKILL.md` | YES | — |
| `.claude/skills/azure-functions-common/SKILL.md` | YES | — |
| `.azure-functions-skills/state.local.json` | YES | — |

### Claude — plugin mode (`install --agent claude`)

| File | Required | Notes |
|------|----------|-------|
| `CLAUDE.md` | YES | Small routing block with managed markers |
| `.claude/settings.json` | YES | MCP entries |

### Codex — local mode (`install --local --agent codex`)

| File | Required | Max size |
|------|----------|----------|
| `AGENTS.md` | YES | 5000 bytes |
| `.codex/config.toml` | YES | — |
| `.codex/hooks.json` | YES | — |
| `.agents/skills/azure-functions-setup/SKILL.md` | YES | — |
| `.agents/skills/azure-functions-create/SKILL.md` | YES | — |
| `.agents/skills/azure-functions-deploy/SKILL.md` | YES | — |
| `.agents/skills/azure-functions-diagnostics/SKILL.md` | YES | — |
| `.agents/skills/azure-functions-doctor/SKILL.md` | YES | — |
| `.agents/skills/azure-functions-feedback/SKILL.md` | YES | — |
| `.agents/skills/azure-functions-health-status/SKILL.md` | YES | — |
| `.agents/skills/azure-functions-inventory/SKILL.md` | YES | — |
| `.agents/skills/azure-functions-best-practices/SKILL.md` | YES | — |
| `.agents/skills/azure-functions-common/SKILL.md` | YES | — |
| `.azure-functions-skills/state.local.json` | YES | — |

### Codex — plugin mode (`install --agent codex`)

| File | Required | Notes |
|------|----------|-------|
| `AGENTS.md` | YES | Small routing block with managed markers |
| `.codex/config.toml` | YES | MCP entries |
| `.codex/hooks.json` | YES | Hook entries |

---

## Preflight (PF)

Expected commands: 5

```
PF-1. $CLI --version
PF-2. $CLI --help
PF-3. copilot --version
PF-4. claude --version
PF-5. codex --version
```

If PF-3 fails: mark all GHCP plugin test cases `blocked`.
If PF-4 fails: mark all Claude plugin test cases `blocked`.
If PF-5 fails: mark all Codex plugin test cases `blocked`.
Local-mode test cases do NOT require agent CLIs and should still run.

---

## Scenario 1: Install + Chat Test

### TC-S1-GHCP-LOCAL

**Description**: Install GHCP locally and verify workspace + chat.
**Expected commands**: 8

```
S1GL-1. mkdir -p $WS
S1GL-2. $CLI install --local --agent ghcp --dir $WS --yes --skip-prerequisites
S1GL-3. Verify workspace files per "GHCP — local mode" table above
S1GL-4. Verify .github/copilot-instructions.md does NOT exist
S1GL-5. Verify AGENTS.md content is reasonable (< 5KB, contains development standards)
S1GL-6. Verify .github/agents/functions-copilot.agent.md contains skill routing table
S1GL-7. Verify no duplicate skill content between AGENTS.md and .github/agents/functions-copilot.agent.md
S1GL-8. $CLI chat --agent github-copilot --dir $WS --skip-prerequisites -- -p "List all visible Azure Functions skills, MCP servers, hooks, and agents you can see in this workspace. Return a structured summary." --output-format json -s --allow-all --no-ask-user
```

**Pass criteria**:
- S1GL-2 exits 0
- All files in the "GHCP — local mode" table exist
- `.github/copilot-instructions.md` does NOT exist
- No file in the workspace exceeds 10KB (skills excluded — SKILL.md may be larger)
- S1GL-8 exits 0 and response mentions Azure Functions skills, OR exits non-zero and is marked `blocked` with evidence

**Fail criteria**:
- S1GL-2 exits non-zero
- Required file is missing
- `.github/copilot-instructions.md` exists
- Routing files contain full skill content inlined (> 10KB)

---

### TC-S1-GHCP-PLUGIN

**Description**: Install GHCP as plugin and verify workspace activation + chat.
**Expected commands**: 10
**Requires**: `copilot` CLI (PF-3 must pass)

```
S1GP-1.  mkdir -p $WS
S1GP-2.  copilot plugin list
S1GP-3.  copilot plugin uninstall azure-functions-skills   (OK if "not installed")
S1GP-4.  $CLI install --agent ghcp --dir $WS --yes
S1GP-5.  copilot plugin list
S1GP-6.  Verify workspace files per "GHCP — plugin mode" table above
S1GP-7.  Verify .github/copilot-instructions.md contains managed block markers
S1GP-8.  Verify .github/copilot-instructions.md size < 2KB
S1GP-9.  $CLI chat --agent github-copilot --dir $WS --skip-prerequisites -- -p "List all visible Azure Functions skills, MCP servers, hooks, and agents. Return a structured summary." --output-format json -s --allow-all --no-ask-user
S1GP-10. copilot --agent azure-functions-skills:functions-copilot -p "What Azure Functions skills do you provide?" --output-format json -s --allow-all --no-ask-user
```

**Pass criteria**:
- S1GP-4 exits 0
- S1GP-5 shows azure-functions-skills installed
- All files in the "GHCP — plugin mode" table exist
- copilot-instructions.md has managed block markers and is small (< 2KB)
- S1GP-9 or S1GP-10 returns response mentioning Azure Functions skills

**Blocked criteria**:
- PF-3 failed (copilot CLI not available)
- S1GP-4 requires interactive approval that cannot be automated

---

### TC-S1-CLAUDE-LOCAL

**Description**: Install Claude locally and verify workspace + chat.
**Expected commands**: 7

```
S1CL-1. mkdir -p $WS
S1CL-2. $CLI install --local --agent claude --dir $WS --yes --skip-prerequisites
S1CL-3. Verify workspace files per "Claude — local mode" table above
S1CL-4. Verify CLAUDE.md size < 3KB (routing template only, no inlined skills)
S1CL-5. Verify CLAUDE.md contains skill routing list (skill IDs like azure-functions-setup)
S1CL-6. Verify .claude/settings.json contains MCP server entries
S1CL-7. $CLI chat --agent claude-code --dir $WS --skip-prerequisites -- -p --output-format json --no-session-persistence --permission-mode bypassPermissions --tools Read,LS,Grep,Glob "List all visible Azure Functions skills, MCP servers, and agents in this workspace. Return a structured JSON summary."
```

**Pass criteria**:
- S1CL-2 exits 0
- All files in the "Claude — local mode" table exist
- CLAUDE.md is small (< 3KB) and contains routing info
- S1CL-7 returns response mentioning skills, OR is marked `blocked`

---

### TC-S1-CLAUDE-PLUGIN

**Description**: Install Claude as plugin and verify workspace.
**Expected commands**: 6
**Requires**: `claude` CLI (PF-4 must pass)

```
S1CP-1. mkdir -p $WS
S1CP-2. claude plugin list --json   (record current state)
S1CP-3. $CLI install --agent claude --dir $WS --yes
S1CP-4. Verify workspace files per "Claude — plugin mode" table above
S1CP-5. Verify CLAUDE.md contains managed block markers and is small (< 2KB)
S1CP-6. $CLI chat --agent claude-code --dir $WS --skip-prerequisites -- -p --output-format json --no-session-persistence --permission-mode bypassPermissions --tools Read,LS,Grep,Glob "List all visible Azure Functions skills, MCP servers in this workspace."
```

**Pass criteria**:
- S1CP-3 exits 0
- All files in "Claude — plugin mode" table exist
- CLAUDE.md has managed markers and is small

---

### TC-S1-CODEX-LOCAL

**Description**: Install Codex locally and verify workspace + chat.
**Expected commands**: 7

```
S1XL-1. mkdir -p $WS
S1XL-2. $CLI install --local --agent codex --dir $WS --yes --skip-prerequisites
S1XL-3. Verify workspace files per "Codex — local mode" table above
S1XL-4. Verify AGENTS.md size < 5KB (routing + dev standards, no inlined skills)
S1XL-5. Verify AGENTS.md contains skill routing list and development standards
S1XL-6. Verify .codex/hooks.json uses cross-platform Node command (not bash)
S1XL-7. $CLI chat --agent codex --dir $WS --skip-prerequisites -- exec --sandbox workspace-write --json --output-last-message e2e-inspection.txt --ephemeral --skip-git-repo-check --cd $WS "List all visible Azure Functions skills, MCP servers, hooks, and agents. Return a structured summary."
```

**Pass criteria**:
- S1XL-2 exits 0
- All files in "Codex — local mode" table exist
- AGENTS.md < 5KB with routing + standards
- hooks.json uses `node -e` not `bash -c`
- S1XL-7 returns response or is `blocked`

---

### TC-S1-CODEX-PLUGIN

**Description**: Install Codex as plugin and verify workspace.
**Expected commands**: 6
**Requires**: `codex` CLI (PF-5 must pass)

```
S1XP-1. mkdir -p $WS
S1XP-2. codex plugin marketplace list   (record current state)
S1XP-3. $CLI install --agent codex --dir $WS --yes
S1XP-4. Verify workspace files per "Codex — plugin mode" table above
S1XP-5. Verify AGENTS.md contains managed block markers and is small (< 2KB)
S1XP-6. $CLI chat --agent codex --dir $WS --skip-prerequisites -- exec --sandbox workspace-write --json --output-last-message e2e-inspection.txt --ephemeral --skip-git-repo-check --cd $WS "List all visible Azure Functions skills, MCP servers, hooks, and agents."
```

**Pass criteria**:
- S1XP-3 exits 0
- All files in "Codex — plugin mode" table exist
- AGENTS.md has managed markers

---

## Scenario 2: Old Version Install + Update Test

Use `npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills` to install the old version. Then update with the current branch CLI.

### TC-S2-GHCP-LOCAL

**Description**: Install old version locally, then update.
**Expected commands**: 10

```
S2GL-1.  mkdir -p $WS
S2GL-2.  npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills --version
S2GL-3.  npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills install --local --agent ghcp --dir $WS --yes --skip-prerequisites
S2GL-4.  Record workspace files and sizes (snapshot before update)
S2GL-5.  $CLI update --dir $WS --yes
S2GL-6.  Verify .azure-functions-skills/state.local.json exists and contains valid JSON
S2GL-7.  Verify state file shows agent "ghcp" with installMode "local"
S2GL-8.  Verify workspace files per "GHCP — local mode" table (post-update)
S2GL-9.  Verify .github/copilot-instructions.md does NOT exist (removed by update if it existed)
S2GL-10. Compare pre/post file list: new files added, old files preserved or save-aside created
```

**Pass criteria**:
- S2GL-3 exits 0 (old version installs successfully)
- S2GL-5 exits 0 (update succeeds)
- State file is valid JSON with correct agent/mode
- Post-update workspace matches current expected layout
- No file corruption or inconsistency

**Fail criteria**:
- Update exits non-zero
- State file missing or invalid
- Post-update files are inconsistent (e.g., old + new mixed)

---

### TC-S2-GHCP-PLUGIN

**Description**: Install old version as plugin, then update.
**Expected commands**: 8
**Requires**: `copilot` CLI

```
S2GP-1. mkdir -p $WS
S2GP-2. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills --version
S2GP-3. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills install --agent ghcp --dir $WS --yes
S2GP-4. Record workspace files and sizes (snapshot before update)
S2GP-5. $CLI update --dir $WS --yes
S2GP-6. Verify .azure-functions-skills/state.local.json or plugin state exists
S2GP-7. Verify workspace files are consistent post-update
S2GP-8. copilot plugin list   (verify plugin still registered)
```

**Pass criteria**:
- Old version installs and update succeeds
- Plugin remains registered after update
- Workspace files are consistent

---

### TC-S2-CLAUDE-LOCAL

**Description**: Install old Claude locally, then update.
**Expected commands**: 9

```
S2CL-1. mkdir -p $WS
S2CL-2. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills --version
S2CL-3. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills install --local --agent claude --dir $WS --yes --skip-prerequisites
S2CL-4. Record workspace files and sizes (snapshot before update)
S2CL-5. Record CLAUDE.md size before update (may be large in old version)
S2CL-6. $CLI update --dir $WS --yes
S2CL-7. Verify state file is valid JSON with agent "claude" installMode "local"
S2CL-8. Verify CLAUDE.md is now small (< 3KB) after update (routing template only)
S2CL-9. Verify all skill files are present and updated
```

**Pass criteria**:
- Old version installs; CLAUDE.md may be large (old behavior)
- After update, CLAUDE.md is slimmed to < 3KB
- All skills refreshed
- State file valid

---

### TC-S2-CLAUDE-PLUGIN

**Description**: Install old Claude as plugin, then update.
**Expected commands**: 7
**Requires**: `claude` CLI

```
S2CP-1. mkdir -p $WS
S2CP-2. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills --version
S2CP-3. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills install --agent claude --dir $WS --yes
S2CP-4. Record workspace files and sizes (snapshot before update)
S2CP-5. $CLI update --dir $WS --yes
S2CP-6. Verify workspace files are consistent post-update
S2CP-7. Verify CLAUDE.md managed block was updated (if applicable)
```

---

### TC-S2-CODEX-LOCAL

**Description**: Install old Codex locally, then update.
**Expected commands**: 9

```
S2XL-1. mkdir -p $WS
S2XL-2. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills --version
S2XL-3. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills install --local --agent codex --dir $WS --yes --skip-prerequisites
S2XL-4. Record workspace files and sizes (snapshot before update)
S2XL-5. Record AGENTS.md size before update (may be large in old version)
S2XL-6. $CLI update --dir $WS --yes
S2XL-7. Verify state file is valid JSON with agent "codex" installMode "local"
S2XL-8. Verify AGENTS.md is now small (< 5KB) after update
S2XL-9. Verify all skill files are present and updated
```

**Pass criteria**:
- Old version installs; AGENTS.md may be large (old behavior)
- After update, AGENTS.md is slimmed to < 5KB
- All skills refreshed
- State file valid

---

### TC-S2-CODEX-PLUGIN

**Description**: Install old Codex as plugin, then update.
**Expected commands**: 7
**Requires**: `codex` CLI

```
S2XP-1. mkdir -p $WS
S2XP-2. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills --version
S2XP-3. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills install --agent codex --dir $WS --yes
S2XP-4. Record workspace files and sizes (snapshot before update)
S2XP-5. $CLI update --dir $WS --yes
S2XP-6. Verify workspace files are consistent post-update
S2XP-7. Verify AGENTS.md managed block was updated (if applicable)
```

---

## File content quality checks

Apply these checks to every test case during workspace verification steps:

### No bloated files
- GHCP local: `.github/copilot-instructions.md` must NOT exist
- Claude local: `CLAUDE.md` must be < 3KB
- Codex local: `AGENTS.md` must be < 5KB
- Plugin mode: routing files must have managed block markers and be < 2KB

### No content duplication
- Skill content must NOT be duplicated between routing files and SKILL.md files
- Agent definition must NOT duplicate the full skill catalog
- If routing file contains skill IDs/descriptions (routing table), that is acceptable
- If routing file contains full skill instructions/steps, that is a FAIL

### Cross-file consistency
- MCP server entries should match between `.vscode/mcp.json` / `.claude/settings.json` / `.codex/config.toml`
- Hook commands should use cross-platform Node.js (`node -e`), not bash-only commands
- All skill IDs in routing tables should correspond to actual SKILL.md files

---

## Total command counts

| Test case | Expected commands |
|-----------|-------------------|
| Preflight | 5 |
| TC-S1-GHCP-LOCAL | 8 |
| TC-S1-GHCP-PLUGIN | 10 |
| TC-S1-CLAUDE-LOCAL | 7 |
| TC-S1-CLAUDE-PLUGIN | 6 |
| TC-S1-CODEX-LOCAL | 7 |
| TC-S1-CODEX-PLUGIN | 6 |
| TC-S2-GHCP-LOCAL | 10 |
| TC-S2-GHCP-PLUGIN | 8 |
| TC-S2-CLAUDE-LOCAL | 9 |
| TC-S2-CLAUDE-PLUGIN | 7 |
| TC-S2-CODEX-LOCAL | 9 |
| TC-S2-CODEX-PLUGIN | 7 |
| **Total** | **99** |

Every command must appear in the final report's evidence section. Missing commands make the run `incomplete`.
