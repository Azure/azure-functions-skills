# E2E Test Command Reference

This is the authoritative source of truth for Azure Functions Skills CLI E2E commands. Execute every numbered command in order and record its evidence.

## Conventions

- `$REPO` = repository root
- `$CLI` = `node $REPO/bin/azure-functions-skills.js`
- `$RUN` = `$REPO/reports/e2e/<run-id>`
- `$WS` = `$RUN/workspaces/<test-case-id>`
- Every install and update uses an absolute `--dir $WS`.
- Commands use POSIX syntax. On Windows, translate shell syntax while preserving each command ID and its semantics.

## Supported surface

The package CLI supports workspace-local distribution only. Host tools own plugin installation, and the package no longer provides `chat`.

| Agent | Install value | Skills | MCP | Telemetry hook |
| --- | --- | --- | --- | --- |
| GHCP | `ghcp` | `.github/skills/` | `.mcp.json` | `.github/hooks/azure-functions-telemetry.json` |
| Claude | `claude` | `.claude/skills/` | `.claude/settings.json` | `.claude/hooks/hooks.json` |
| Codex | `codex` | `.agents/skills/` | `.codex/config.toml` | `.codex/hooks.json` |

All layouts must contain `azure-functions-help/SKILL.md`, telemetry scripts, and no `.azure-functions-skills`, generated AGENTS/CLAUDE instructions, agent definitions, startup prompts, or welcome hooks.

## Preflight

Expected commands: 2

```text
PF-1. $CLI --version
PF-2. $CLI --help
```

PF-2 must list `install --local` and `update --local`, and must not list `chat` or `setup`.

## Scenario 1: Fresh local install

### TC-S1-GHCP-LOCAL

Expected commands: 5

```text
S1GL-1. mkdir -p $WS
S1GL-2. $CLI install --local --agent ghcp --dir $WS
S1GL-3. find $WS -type f | sort
S1GL-4. test -f $WS/.github/skills/azure-functions-help/SKILL.md && test -f $WS/.mcp.json && test -f $WS/.github/hooks/azure-functions-telemetry.json && test -f $WS/.github/hooks/scripts/track-telemetry.sh
S1GL-5. test ! -e $WS/.azure-functions-skills && test ! -e $WS/AGENTS.md && test ! -e $WS/.github/agents && test ! -e $WS/.github/hooks/welcome-setup.json
```

Pass when every command exits 0 and the file list contains only the expected skill, MCP, and telemetry surfaces.

### TC-S1-CLAUDE-LOCAL

Expected commands: 5

```text
S1CL-1. mkdir -p $WS
S1CL-2. $CLI install --local --agent claude --dir $WS
S1CL-3. find $WS -type f | sort
S1CL-4. test -f $WS/.claude/skills/azure-functions-help/SKILL.md && test -f $WS/.claude/settings.json && test -f $WS/.claude/hooks/hooks.json && test -f $WS/.claude/hooks/scripts/track-telemetry.sh
S1CL-5. test ! -e $WS/.azure-functions-skills && test ! -e $WS/CLAUDE.md && test ! -e $WS/.claude/agents
```

Pass when every command exits 0 and the file list contains only the expected skill, MCP/settings, and telemetry surfaces.

### TC-S1-CODEX-LOCAL

Expected commands: 5

```text
S1XL-1. mkdir -p $WS
S1XL-2. $CLI install --local --agent codex --dir $WS
S1XL-3. find $WS -type f | sort
S1XL-4. test -f $WS/.agents/skills/azure-functions-help/SKILL.md && test -f $WS/.codex/config.toml && test -f $WS/.codex/hooks.json && test -f $WS/.codex/hooks/scripts/track-telemetry.sh
S1XL-5. test ! -e $WS/.azure-functions-skills && test ! -e $WS/AGENTS.md && test ! -e $WS/.agents/agents
```

Pass when every command exits 0 and the file list contains only the expected skill, MCP, and telemetry surfaces.

## Scenario 2: Ownership-aware update and legacy cleanup

Each case modifies a bundled skill, seeds user-owned skills/settings/hooks, and records a legacy telemetry opt-out. Update must replace bundled content, preserve user content, migrate the opt-out, and remove legacy state.

### TC-S2-GHCP-LOCAL

Expected commands: 7

```text
S2GL-1. mkdir -p $WS
S2GL-2. $CLI install --local --agent ghcp --dir $WS
S2GL-3. printf 'stale bundled\n' > $WS/.github/skills/azure-functions-help/SKILL.md && mkdir -p $WS/.github/skills/azure-functions-internal-runbook && printf 'user-owned\n' > $WS/.github/skills/azure-functions-internal-runbook/SKILL.md
S2GL-4. mkdir -p $WS/.github/hooks/scripts && printf 'user-owned\n' > $WS/.github/hooks/scripts/custom-hook.sh && printf '{"inputs":[{"id":"subscription"}],"mcpServers":{"custom":{"command":"custom-server","args":[]}}}\n' > $WS/.mcp.json
S2GL-5. mkdir -p $WS/.azure-functions-skills $WS/.github/agents && printf '{"telemetry":{"enabled":false}}\n' > $WS/.azure-functions-skills/state.local.json && printf 'legacy\n' > $WS/.github/agents/functions-copilot.agent.md && printf 'customer\n<!-- azure-functions-skills:start version=0.0.2 -->\nlegacy routing\n<!-- azure-functions-skills:end -->\n' > $WS/AGENTS.md
S2GL-6. $CLI update --local --agent ghcp --dir $WS
S2GL-7. test -f $WS/.github/skills/azure-functions-help/SKILL.md && ! grep -q 'stale bundled' $WS/.github/skills/azure-functions-help/SKILL.md && test "$(cat $WS/.github/skills/azure-functions-internal-runbook/SKILL.md)" = "user-owned" && test ! -e $WS/.azure-functions-skills && test ! -e $WS/.github/agents/functions-copilot.agent.md && test "$(cat $WS/AGENTS.md)" = "customer" && test "$(cat $WS/.github/hooks/scripts/custom-hook.sh)" = "user-owned" && node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('$WS/.mcp.json'));const t=JSON.parse(fs.readFileSync('$WS/.github/hooks/telemetry.config.json'));if(m.mcpServers.custom.command!=='custom-server'||m.mcpServers.azure.command!=='npx'||t.enabled!==false)process.exit(1)"
```

### TC-S2-CLAUDE-LOCAL

Expected commands: 7

```text
S2CL-1. mkdir -p $WS
S2CL-2. $CLI install --local --agent claude --dir $WS
S2CL-3. printf 'stale bundled\n' > $WS/.claude/skills/azure-functions-help/SKILL.md && mkdir -p $WS/.claude/skills/azure-functions-internal-runbook && printf 'user-owned\n' > $WS/.claude/skills/azure-functions-internal-runbook/SKILL.md
S2CL-4. mkdir -p $WS/.claude/hooks && printf 'user-owned\n' > $WS/.claude/hooks/custom-hook.json && printf '{"permissions":{"allow":["Read"]},"mcpServers":{"custom":{"command":"custom-server","args":[]}},"hooks":{"PostToolUse":[{"hooks":[{"type":"command","command":"custom-hook"}]}]}}\n' > $WS/.claude/settings.json
S2CL-5. mkdir -p $WS/.azure-functions-skills && printf '{"telemetry":{"enabled":false}}\n' > $WS/.azure-functions-skills/state.local.json && printf 'customer\n<!-- azure-functions-skills:start version=0.0.2 -->\nlegacy routing\n<!-- azure-functions-skills:end -->\n' > $WS/CLAUDE.md
S2CL-6. $CLI update --local --agent claude --dir $WS
S2CL-7. test -f $WS/.claude/skills/azure-functions-help/SKILL.md && ! grep -q 'stale bundled' $WS/.claude/skills/azure-functions-help/SKILL.md && test "$(cat $WS/.claude/skills/azure-functions-internal-runbook/SKILL.md)" = "user-owned" && test ! -e $WS/.azure-functions-skills && test "$(cat $WS/CLAUDE.md)" = "customer" && test "$(cat $WS/.claude/hooks/custom-hook.json)" = "user-owned" && node -e "const fs=require('fs');const s=JSON.parse(fs.readFileSync('$WS/.claude/settings.json'));const t=JSON.parse(fs.readFileSync('$WS/.claude/hooks/telemetry.config.json'));if(s.permissions.allow[0]!=='Read'||s.mcpServers.custom.command!=='custom-server'||s.mcpServers.azure.command!=='npx'||!JSON.stringify(s.hooks).includes('custom-hook')||!JSON.stringify(s.hooks).includes('track-telemetry.sh')||t.enabled!==false)process.exit(1)"
```

### TC-S2-CODEX-LOCAL

Expected commands: 7

```text
S2XL-1. mkdir -p $WS
S2XL-2. $CLI install --local --agent codex --dir $WS
S2XL-3. printf 'stale bundled\n' > $WS/.agents/skills/azure-functions-help/SKILL.md && mkdir -p $WS/.agents/skills/azure-functions-internal-runbook && printf 'user-owned\n' > $WS/.agents/skills/azure-functions-internal-runbook/SKILL.md
S2XL-4. mkdir -p $WS/.codex/hooks && printf 'user-owned\n' > $WS/.codex/hooks/custom-hook.json && printf '{"hooks":{"PostToolUse":[{"type":"command","command":"custom-hook"}]}}\n' > $WS/.codex/hooks.json && printf 'model = "gpt-test"\n\n[mcp_servers.custom]\ncommand = "custom-server"\n\n[mcp_servers.azure]\ncommand = "old-azure"\n' > $WS/.codex/config.toml
S2XL-5. mkdir -p $WS/.azure-functions-skills && printf '{"telemetry":{"enabled":false}}\n' > $WS/.azure-functions-skills/state.local.json && printf 'customer\n<!-- azure-functions-skills:start version=0.0.2 -->\nlegacy routing\n<!-- azure-functions-skills:end -->\n' > $WS/AGENTS.md
S2XL-6. $CLI update --local --agent codex --dir $WS
S2XL-7. test -f $WS/.agents/skills/azure-functions-help/SKILL.md && ! grep -q 'stale bundled' $WS/.agents/skills/azure-functions-help/SKILL.md && test "$(cat $WS/.agents/skills/azure-functions-internal-runbook/SKILL.md)" = "user-owned" && test ! -e $WS/.azure-functions-skills && test "$(cat $WS/AGENTS.md)" = "customer" && test "$(cat $WS/.codex/hooks/custom-hook.json)" = "user-owned" && grep -q 'model = "gpt-test"' $WS/.codex/config.toml && grep -q '\[mcp_servers.custom\]' $WS/.codex/config.toml && grep -q 'command = "npx"' $WS/.codex/config.toml && ! grep -q 'old-azure' $WS/.codex/config.toml && node -e "const fs=require('fs');const h=JSON.parse(fs.readFileSync('$WS/.codex/hooks.json'));const t=JSON.parse(fs.readFileSync('$WS/.codex/hooks/telemetry.config.json'));if(!JSON.stringify(h.hooks).includes('custom-hook')||!JSON.stringify(h.hooks).includes('track-telemetry.sh')||t.enabled!==false)process.exit(1)"
```

For every Scenario 2 case, all seven commands must exit 0. A missing refreshed bundled skill, removed user asset, lost user setting/hook, lost telemetry opt-out, surviving legacy state, or surviving managed instruction block is a failure.

## Total command counts

| Test case | Expected commands |
| --- | ---: |
| Preflight | 2 |
| TC-S1-GHCP-LOCAL | 5 |
| TC-S1-CLAUDE-LOCAL | 5 |
| TC-S1-CODEX-LOCAL | 5 |
| TC-S2-GHCP-LOCAL | 7 |
| TC-S2-CLAUDE-LOCAL | 7 |
| TC-S2-CODEX-LOCAL | 7 |
| **Total** | **38** |

Every command ID must appear in the checklist and final report. Missing commands make the run incomplete.
