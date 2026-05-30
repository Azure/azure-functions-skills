---
description: "Create a checklist-driven implementation plan and execute step by step"
name: "checklist-plan"
---

Analyze the task and create an implementation plan following this structure:

1. **Investigate** — survey the affected files and understand the current behavior.
2. **Plan** — produce a numbered checklist in `plan.md` with clear, actionable steps.
3. **Execute** — work through each step one at a time; mark each item done as you go.
4. **Verify** — after all steps, run `npm run check` and confirm everything passes.

For code changes, follow TDD: write a failing test before implementing each step.
For non-code tasks (skills, CI, docs), skip TDD but still verify at the end.

Update the checklist after completing each step so progress is always visible.
