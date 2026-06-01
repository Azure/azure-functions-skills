---
description: "Scaffold and validate a new skill end to end"
name: "skill-dev"
---

Create a new skill following the established workflow:

1. Scaffold: `npm run new:skill` and follow the prompts.
2. Edit `templates/skills/<skill-name>/SKILL.md` — write clear, unambiguous instructions.
3. Add supporting material in `references/` (checklists, examples, patterns).
4. Validate: `npm run validate:skills`
5. Regenerate plugin payload: `npm run build:plugin-payload`
6. Verify payload consistency: `npm run verify:plugin-payload`
7. Run full gate: `npm run check`
8. Optionally add a Vally evaluation spec under `evals/<skill-name>/eval.yaml`.

Review the skill content carefully — it will be loaded as LLM agent instructions with elevated permissions.
