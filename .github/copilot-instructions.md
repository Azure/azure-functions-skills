# Copilot Instructions

This repository is the **Azure Functions Skills** plugin (skills + telemetry) with a small companion CLI — it equips coding agents (GitHub Copilot, Claude Code, Codex) with Azure Functions–specific knowledge.

## Key Rules

- **TypeScript strict mode** — no `any` types; use interfaces and generics.
- **ESM only** — `import`/`export`, never `require()`.
- **TDD** for code changes — write tests first (`npm test`, `npm run test:watch`).
- **Lint before commit** — `npm run lint` and `npm run typecheck`.
- **Templates are canonical** — edit `templates/`, then `npm run build:plugin-payload`. Never hand-edit generated files.
- **CLI usability** — commands must be intuitive; error messages must be actionable.
- **Manual check for CLI changes** — run `node bin/azure-functions-skills.js <cmd> --dir <isolated-workspace>`.

## Security

- No secrets in code.
- Never run LLM-backed skill evaluations in PR-triggered CI or on unreviewed, untrusted contributor code.

## Full Gate

```bash
npm run check   # lint + typecheck + security lint + skill validation + tests + build
```

See `AGENTS.md` at repo root for the complete development standards.
