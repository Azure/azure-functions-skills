# F15: Distribution — Installation and Workspace Routing

**Status:** 📋 Proposed  
**Draft Spec Section:** 10, 11  
**Depends on:** F14 (Build System)

## Problem

Generated artifacts need to reach developers without polluting every global agent session. Each target platform has its own plugin mechanism, while repo-local instruction files are the best place for project-specific routing. The repository needs a distribution strategy that:

- Avoids naming collisions between plugin skills and repo-local skills
- Supports independent versioning per target
- Enables both plugin-based and repo-template-based distribution
- Keeps MCP, hooks, and agent guidance opt-in because those surfaces are not progressive disclosure in the same way skills are

## Feature

A two-layer distribution strategy:

1. **Plugin Skills Pack** — default global plugin payload containing skills and minimal host manifests only.
2. **Workspace Activation Pack** — repo-local routing, plugin references, and opt-in MCP/hooks/agent guidance.

## Package Naming

| Target | Package Name | Registry |
|--------|-------------|----------|
| GHCP | `azure-functions-skill-pack-ghcp` | GitHub Marketplace / Extension |
| Claude Code | `azure-functions-skill-pack-claude` | Claude plugin registry |
| Codex | `azure-functions-skill-pack-codex` | Codex agent registry |

Canonical repo: `azure-functions-skills` (one repo, one source of truth)

## Distribution Channels

### 1. Plugin Distribution

Skills packaged as installable plugins per target. The default payload is skills-only:

```
azure-functions-skills/
├── skills/
│   ├── azure-functions-setup.md
│   ├── azure-functions-create.md
│   ├── azure-functions-deploy.md
│   └── ...
├── plugin.json
├── .plugin/plugin.json
├── .claude-plugin/plugin.json
└── .codex-plugin/plugin.json
```

The full profile remains available for explicit builds:

```bash
node lib/build/build.js --plugin-profile full
```

Full profile includes MCP, hooks, and agent definitions for validation or advanced distribution scenarios.

### 2. Workspace Activation

Workspace activation adds project-local routing and optional surfaces after plugin install:

```bash
azure-functions-skills workspace apply --agent claude --mode plugin-reference --dry-run
azure-functions-skills workspace apply --agent claude --mode plugin-reference --yes
azure-functions-skills workspace apply --agent codex --mode plugin-reference --merge-strategy include-file --yes
azure-functions-skills workspace apply --agent codex --mode plugin-reference --include-mcp --include-hooks --yes
```

Important instruction files are protected:

- Existing `CLAUDE.md` / `AGENTS.md` without an Azure Functions managed block require `--yes` before appending.
- Existing Azure Functions managed blocks are idempotent and can be refreshed with `workspace update`.
- `include-file` keeps important instruction files small by writing routing content under `.azure-functions-skills/`.

### 3. Repo Templates

Project-level instructions that developers copy into their repo:

```
repo-template/
├── .github/
│   └── copilot-instructions.md    # Project-aware guidance
├── .claude/
│   └── instructions.md            # Claude Code project config
└── .codex/
    └── instructions.md            # Codex project config
```

Repo template content includes:

- "This is an Azure Functions project"
- Recommended workflow: setup → create → deploy → observability
- Language-specific guidance based on detected runtime
- Links to relevant skills

### 4. azd Templates (Future)

Integration with Azure Developer CLI templates:

```bash
azd init --template azure-functions-python-starter
# Template includes repo-level skill instructions
```

## ID Collision Prevention

**Critical:** GitHub Copilot CLI gives priority to project-level skills/agents over plugin-level ones with the same ID. If a repo template defines `azure-functions-discovery` and the plugin also has `azure-functions-discovery`, the repo version wins and the plugin version is ignored.

### Rules

1. Plugin skills use `azure-functions-` prefix: `azure-functions-setup`, `azure-functions-deploy`, etc.
2. Repo template instructions do NOT define skills with `azure-functions-` prefix
3. Repo template uses `copilot-instructions.md` for guidance (not skill definitions)
4. If a repo needs to override a plugin skill, it must be intentional and documented

## Versioning

```
azure-functions-skills (canonical repo)
  └── v1.0.0
       ├── azure-functions-skill-pack-ghcp@1.0.0
       ├── azure-functions-skill-pack-claude@1.0.0
       └── azure-functions-skill-pack-codex@1.0.0
```

- Canonical repo uses semver tags
- Each target package tracks the canonical version
- Breaking changes in skill IDs or graph structure = major version bump
- New skills or content updates = minor version bump
- Bug fixes = patch version bump

## Release Pipeline

```
1. Author updates canonical sources in src/
2. PR review + merge
3. CI runs build (F14)
4. CI validates graph integrity
5. CI runs tests (generated output validation)
6. Tag release on canonical repo
7. Per-target publish uses the skills-only default plugin payload
8. Optional full-profile payloads are generated only for advanced validation or explicit distribution needs
9. Update repo templates in azd template gallery (optional)
```

## Discoverability via Repo Templates

Repo templates are the strongest discoverability mechanism because they embed workflow guidance directly in the developer's project:

```markdown
<!-- .github/copilot-instructions.md (generated) -->
# Azure Functions Project

This project uses Azure Functions with Python v2 programming model.

## Recommended Workflow

1. **azure-functions-setup** — Verify your environment has Azure CLI, Core Tools, and Python
2. **azure-functions-create** — Scaffold new functions with templates
3. **azure-functions-deploy** — Deploy to Azure (Flex Consumption recommended)
4. **azure-functions-observability** — Set up Application Insights monitoring
5. **azure-functions-feedback** — Share your experience to improve these skills

## Available Skills

Use `@azure-functions` to access all skills, or `@functions-copilot` for guided assistance.
```

## Cross-Target Implementation

| Target | Distribution Method |
|--------|-------------------|
| GHCP | GitHub Marketplace extension + repo template |
| Claude Code | Plugin package + project instructions |
| Codex | Agent package + project instructions |
| All | Repo templates via azd or manual copy |
