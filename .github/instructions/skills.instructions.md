---
applyTo: "templates/**"
---

# Skill and Template Development Rules

## Canonical Source

- `templates/` is the single source of truth for skills, telemetry hooks, and MCP definitions.
- Generated files under `.github/plugins/`, `.plugin/`, and `.claude-plugin/` are derived — never hand-edit them.

## Workflow

1. Edit the canonical source under `templates/`.
2. Validate: `npm run validate:skills`
3. Regenerate: `npm run build:plugin-payload`
4. Verify: `npm run verify:plugin-payload`
5. Run full gate: `npm run check`

## Skill Content

- Skill Markdown (`SKILL.md`) is loaded as LLM agent instructions. Write clearly and unambiguously.
- Include `references/` for checklists, examples, and supporting material.
- Tag skills with proper YAML front matter (name, title, description, category).

## Security

- Skill content can instruct an LLM agent with file-write and shell-execution permissions. Review every change carefully for prompt injection risks.
- Never include executable commands that could be harmful if run verbatim by an agent.
- CI runs `npm run lint:security` (including `lint-skill-content.mjs`) to scan for dangerous patterns.
