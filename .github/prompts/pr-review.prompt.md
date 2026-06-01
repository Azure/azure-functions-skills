---
description: "Run a self-review checklist before opening a PR"
name: "pr-review"
---

Review the current changes against this checklist:

1. **Architecture** — is the separation of concerns appropriate? Are responsibilities clearly divided?
2. **Duplication** — does the code follow DRY? Is any logic repeated that should be extracted?
3. **Test coverage** — are edge cases, boundary values, and error paths tested?
4. **Security** — no secrets exposed, no unsafe input handling, no prompt injection vectors in skill content.
5. **Usability** (CLI changes) — are commands intuitive? Are error messages actionable?
6. **Lint & types** — does `npm run lint` and `npm run typecheck` pass cleanly?
7. **Documentation** — do affected docs (README, cli-reference.md, doctor-guide.md) need updates?
8. **Generated files** — if templates changed, was `npm run build:plugin-payload` run?

After the checklist, use `/rubber-duck` with a different model family for a cross-model review.
