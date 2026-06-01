# E2E Test Command Reference

This is the authoritative source of truth for all E2E test commands. Execute every numbered command in order. Do NOT skip any command. Do NOT modify commands unless the user explicitly requests it.

## Conventions

- `$REPO` = repository root (use `git rev-parse --show-toplevel` or known path)
- `$CLI` = `node $REPO/bin/azure-functions-skills.js` (current branch under test)
- `$RUN` = `$REPO/reports/e2e/<run-id>` where `<run-id>` = date stamp like `20260531-001`
- `$WS` = `$RUN/workspaces/<test-case-id>` (fresh per test case)
- All commands use `--dir $WS` with absolute paths
- Resolve `$REPO` once at preflight; do NOT use relative paths after changing directories

### Platform note

Commands are written in POSIX shell syntax. On Windows (PowerShell), translate as needed:
- `mkdir -p` → `New-Item -ItemType Directory -Force`
- `wc -c < file` → `(Get-Item file).Length`
- `find $WS -type f` → `Get-ChildItem -Recurse -File`
- `grep pattern file` → `Select-String -Pattern pattern file`
- `test -f` / `test ! -f` → `Test-Path` / `!(Test-Path)`
- `cat` → `Get-Content -Raw`

The command IDs and their semantics are platform-independent. The exact shell syntax may vary.

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
**Expected commands**: 10

```
S1GL-1.  mkdir -p $WS
S1GL-2.  $CLI install --local --agent ghcp --dir $WS --yes --skip-prerequisites
S1GL-3.  ls -R $WS | head -100   # list all workspace files; verify against "GHCP — local mode" table
S1GL-4.  test ! -f $WS/.github/copilot-instructions.md && echo "PASS: copilot-instructions.md absent" || echo "FAIL: copilot-instructions.md exists"
S1GL-5.  wc -c < $WS/AGENTS.md   # must be < 5120; then: cat $WS/AGENTS.md to verify content
S1GL-6.  cat $WS/.github/agents/functions-copilot.agent.md | grep -c 'azure-functions-'   # count skill references; expect ≥ 8
S1GL-7.  cat $WS/AGENTS.md | wc -c && cat $WS/.github/agents/functions-copilot.agent.md | wc -c   # neither should exceed 10KB; if both < 10KB, no duplicate inlining
S1GL-8.  cd $WS && git init && git add -A && git commit -m "e2e workspace init"   # required for copilot agent discovery
S1GL-9.  $CLI chat --agent github-copilot --dir $WS --skip-prerequisites -- -p "List all visible Azure Functions skills, MCP servers, hooks, and agents you can see in this workspace. Return a structured summary." --output-format json -s --allow-all --no-ask-user
S1GL-10. cat $WS/.azure-functions-skills/state.local.json   # verify state file content
```

**Pass criteria**:
- S1GL-2 exits 0
- All files in the "GHCP — local mode" table exist (S1GL-3)
- `.github/copilot-instructions.md` does NOT exist (S1GL-4)
- AGENTS.md < 5KB and agent.md < 10KB (S1GL-5, S1GL-7)
- Agent definition references ≥ 8 skill IDs (S1GL-6)
- S1GL-9 exits 0 and JSON output shows `skills_loaded` with Azure Functions skills, OR exits non-zero and is marked `blocked` with evidence

**Fail criteria**:
- S1GL-2 exits non-zero
- Required file is missing
- `.github/copilot-instructions.md` exists
- Routing files contain full skill content inlined (> 10KB)

---

### TC-S1-GHCP-PLUGIN

**Description**: Install GHCP as plugin and verify workspace activation + chat.
**Expected commands**: 12
**Requires**: `copilot` CLI (PF-3 must pass)

```
S1GP-1.  mkdir -p $WS
S1GP-2.  copilot plugin list
S1GP-3.  copilot plugin uninstall azure-functions-skills   (OK if "not installed")
S1GP-4.  $CLI install --agent ghcp --dir $WS --yes
S1GP-5.  copilot plugin list   # verify azure-functions-skills appears
S1GP-6.  ls -R $WS | head -50   # list workspace files; verify against "GHCP — plugin mode" table
S1GP-7.  grep 'azure-functions-skills:start' $WS/.github/copilot-instructions.md   # verify managed block markers
S1GP-8.  wc -c < $WS/.github/copilot-instructions.md   # must be < 3000
S1GP-9.  cd $WS && git init && git add -A && git commit -m "e2e workspace init"
S1GP-10. $CLI chat --agent github-copilot --dir $WS --skip-prerequisites -- -p "List all visible Azure Functions skills, MCP servers, hooks, and agents. Return a structured summary." --output-format json -s --allow-all --no-ask-user
S1GP-11. copilot --agent azure-functions-skills:functions-copilot -p "What Azure Functions skills do you provide? List each skill name." --output-format json -s --allow-all --no-ask-user
S1GP-12. cat $WS/.azure-functions-skills/state.local.json
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
**Expected commands**: 8

```
S1CL-1. mkdir -p $WS
S1CL-2. $CLI install --local --agent claude --dir $WS --yes --skip-prerequisites
S1CL-3. ls -R $WS | head -80   # list workspace files; verify against "Claude — local mode" table
S1CL-4. wc -c < $WS/CLAUDE.md   # must be < 3000
S1CL-5. cat $WS/CLAUDE.md | grep -c 'azure-functions-'   # verify skill routing list present
S1CL-6. cat $WS/.claude/settings.json   # verify MCP server entries
S1CL-7. cat $WS/.azure-functions-skills/state.local.json
S1CL-8. $CLI chat --agent claude-code --dir $WS --skip-prerequisites -- -p "List all visible Azure Functions skills, MCP servers, and agents in this workspace. Return a structured JSON summary." --output-format json --no-session-persistence --permission-mode bypassPermissions --tools Read,LS,Grep,Glob
```

**Pass criteria**:
- S1CL-2 exits 0
- All files in the "Claude — local mode" table exist
- CLAUDE.md is small (< 3KB) and contains routing info
- S1CL-7 returns response mentioning skills, OR is marked `blocked`

---

### TC-S1-CLAUDE-PLUGIN

**Description**: Install Claude as plugin and verify workspace.
**Expected commands**: 7
**Requires**: `claude` CLI (PF-4 must pass)

```
S1CP-1. mkdir -p $WS
S1CP-2. claude plugin list --json   (record current state)
S1CP-3. $CLI install --agent claude --dir $WS --yes
S1CP-4. ls -R $WS | head -50   # list workspace files; verify against "Claude — plugin mode" table
S1CP-5. wc -c < $WS/CLAUDE.md && grep 'azure-functions-skills:start' $WS/CLAUDE.md   # managed block markers, must be < 3000 bytes
S1CP-6. cat $WS/.azure-functions-skills/state.local.json
S1CP-7. $CLI chat --agent claude-code --dir $WS --skip-prerequisites -- -p "List all visible Azure Functions skills, MCP servers in this workspace." --output-format json --no-session-persistence --permission-mode bypassPermissions --tools Read,LS,Grep,Glob
```

**Pass criteria**:
- S1CP-3 exits 0
- All files in "Claude — plugin mode" table exist
- CLAUDE.md has managed markers and is small

---

### TC-S1-CODEX-LOCAL

**Description**: Install Codex locally and verify workspace + chat.
**Expected commands**: 9

```
S1XL-1. mkdir -p $WS
S1XL-2. $CLI install --local --agent codex --dir $WS --yes --skip-prerequisites
S1XL-3. ls -R $WS | head -80   # list workspace files; verify against "Codex — local mode" table
S1XL-4. wc -c < $WS/AGENTS.md   # must be < 5120
S1XL-5. cat $WS/AGENTS.md | grep -c 'azure-functions-'   # verify skill routing list present
S1XL-6. cat $WS/.codex/hooks.json   # verify hook entries; check for cross-platform commands
S1XL-7. cat $WS/.codex/config.toml   # verify MCP entries
S1XL-8. cat $WS/.azure-functions-skills/state.local.json
S1XL-9. $CLI chat --agent codex --dir $WS --skip-prerequisites -- exec --sandbox workspace-write --json --output-last-message $WS/e2e-inspection.txt --ephemeral --skip-git-repo-check --cd $WS "List all visible Azure Functions skills, MCP servers, hooks, and agents. Return a structured summary."
```

**Pass criteria**:
- S1XL-2 exits 0
- All files in "Codex — local mode" table exist (S1XL-3)
- AGENTS.md < 5KB with routing + standards (S1XL-4, S1XL-5)
- hooks.json uses cross-platform commands (S1XL-6)
- S1XL-9 returns response or is `blocked`

---

### TC-S1-CODEX-PLUGIN

**Description**: Install Codex as plugin and verify workspace.
**Expected commands**: 8
**Requires**: `codex` CLI (PF-5 must pass)

```
S1XP-1. mkdir -p $WS
S1XP-2. codex plugin marketplace list   (record current state)
S1XP-3. $CLI install --agent codex --dir $WS --yes
S1XP-4. ls -R $WS | head -50   # list workspace files; verify against "Codex — plugin mode" table
S1XP-5. wc -c < $WS/AGENTS.md && grep 'azure-functions-skills' $WS/AGENTS.md   # managed markers, must be < 3000 bytes
S1XP-6. cat $WS/.codex/config.toml   # verify MCP entries
S1XP-7. cat $WS/.azure-functions-skills/state.local.json
S1XP-8. $CLI chat --agent codex --dir $WS --skip-prerequisites -- exec --sandbox workspace-write --json --output-last-message $WS/e2e-inspection.txt --ephemeral --skip-git-repo-check --cd $WS "List all visible Azure Functions skills, MCP servers, hooks, and agents."
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
S2GL-2.  npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills install --local --agent ghcp --dir $WS --yes --skip-prerequisites
S2GL-3.  find $WS -type f | sort | while read f; do wc -c < "$f" | tr -d ' '; echo " ${f#$WS/}"; done   # snapshot: list all files with sizes before update
S2GL-4.  test -f $WS/.github/copilot-instructions.md && wc -c < $WS/.github/copilot-instructions.md || echo "copilot-instructions.md absent"   # record pre-update state
S2GL-5.  $CLI update --dir $WS --yes
S2GL-6.  cat $WS/.azure-functions-skills/state.local.json   # verify valid JSON, agent ghcp, installMode local
S2GL-7.  find $WS -type f | sort | while read f; do wc -c < "$f" | tr -d ' '; echo " ${f#$WS/}"; done   # snapshot: post-update file list
S2GL-8.  test ! -f $WS/.github/copilot-instructions.md && echo "PASS: copilot-instructions.md absent" || (wc -c < $WS/.github/copilot-instructions.md; echo "FAIL: copilot-instructions.md still exists — stale file not cleaned up")
S2GL-9.  find $WS -name '*azure-functions-skills-new*' -type f   # list any save-aside files created
S2GL-10. diff <(find $WS -type f | sort) <(echo "expected file list") || true   # compare pre/post; record differences
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
S2GP-2. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills install --agent ghcp --dir $WS --yes
S2GP-3. find $WS -type f | sort | while read f; do wc -c < "$f" | tr -d ' '; echo " ${f#$WS/}"; done   # pre-update snapshot
S2GP-4. cat $WS/.github/copilot-instructions.md   # record pre-update content
S2GP-5. $CLI update --dir $WS --yes
S2GP-6. cat $WS/.azure-functions-skills/state.local.json   # verify state
S2GP-7. cat $WS/.github/copilot-instructions.md && wc -c < $WS/.github/copilot-instructions.md   # verify managed block preserved/updated
S2GP-8. copilot plugin list   # verify plugin still registered
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
S2CL-2. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills install --local --agent claude --dir $WS --yes --skip-prerequisites
S2CL-3. find $WS -type f | sort | while read f; do wc -c < "$f" | tr -d ' '; echo " ${f#$WS/}"; done   # pre-update snapshot
S2CL-4. wc -c < $WS/CLAUDE.md   # record pre-update size (may be large in old version)
S2CL-5. $CLI update --dir $WS --yes
S2CL-6. cat $WS/.azure-functions-skills/state.local.json   # verify JSON, agent claude, installMode local
S2CL-7. wc -c < $WS/CLAUDE.md   # must be < 3000 after update; if still large, check for save-aside
S2CL-8. find $WS -name '*azure-functions-skills-new*' -type f   # list save-aside files
S2CL-9. ls $WS/.claude/skills/*/SKILL.md | wc -l   # verify all skill files present (expect 10)
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
S2CP-2. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills install --agent claude --dir $WS --yes
S2CP-3. find $WS -type f | sort | while read f; do wc -c < "$f" | tr -d ' '; echo " ${f#$WS/}"; done   # pre-update snapshot
S2CP-4. cat $WS/CLAUDE.md   # record pre-update content
S2CP-5. $CLI update --dir $WS --yes
S2CP-6. cat $WS/.azure-functions-skills/state.local.json   # verify state
S2CP-7. cat $WS/CLAUDE.md && wc -c < $WS/CLAUDE.md   # verify managed block updated
```

---

### TC-S2-CODEX-LOCAL

**Description**: Install old Codex locally, then update.
**Expected commands**: 9

```
S2XL-1. mkdir -p $WS
S2XL-2. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills install --local --agent codex --dir $WS --yes --skip-prerequisites
S2XL-3. find $WS -type f | sort | while read f; do wc -c < "$f" | tr -d ' '; echo " ${f#$WS/}"; done   # pre-update snapshot
S2XL-4. wc -c < $WS/AGENTS.md   # record pre-update size (may be large in old version)
S2XL-5. $CLI update --dir $WS --yes
S2XL-6. cat $WS/.azure-functions-skills/state.local.json   # verify JSON, agent codex, installMode local
S2XL-7. wc -c < $WS/AGENTS.md   # must be < 5120 after update; if still large, check for save-aside
S2XL-8. find $WS -name '*azure-functions-skills-new*' -type f   # list save-aside files
S2XL-9. ls $WS/.agents/skills/*/SKILL.md | wc -l   # verify all skill files present (expect 10)
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
S2XP-2. npx --yes --package @azure/functions-skills@0.0.2-preview azure-functions-skills install --agent codex --dir $WS --yes
S2XP-3. find $WS -type f | sort | while read f; do wc -c < "$f" | tr -d ' '; echo " ${f#$WS/}"; done   # pre-update snapshot
S2XP-4. cat $WS/AGENTS.md   # record pre-update content
S2XP-5. $CLI update --dir $WS --yes
S2XP-6. cat $WS/.azure-functions-skills/state.local.json   # verify state
S2XP-7. cat $WS/AGENTS.md && wc -c < $WS/AGENTS.md   # verify managed block updated
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
| TC-S1-GHCP-LOCAL | 10 |
| TC-S1-GHCP-PLUGIN | 12 |
| TC-S1-CLAUDE-LOCAL | 8 |
| TC-S1-CLAUDE-PLUGIN | 7 |
| TC-S1-CODEX-LOCAL | 9 |
| TC-S1-CODEX-PLUGIN | 8 |
| TC-S2-GHCP-LOCAL | 10 |
| TC-S2-GHCP-PLUGIN | 8 |
| TC-S2-CLAUDE-LOCAL | 9 |
| TC-S2-CLAUDE-PLUGIN | 7 |
| TC-S2-CODEX-LOCAL | 9 |
| TC-S2-CODEX-PLUGIN | 7 |
| **Total** | **109** |

Every command must appear in the final report's evidence section. Missing commands make the run `incomplete`.
