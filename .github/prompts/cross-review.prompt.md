---
description: "Cross-model self-review using /rubber-duck with a different model family"
name: "cross-review"
---

Perform a cross-model self-review after implementation:

1. Check the current model with `/model`.
2. Switch to a different model family for independent validation:
   - If currently using Claude (Ops family) → switch to the latest top-tier GPT model.
   - If currently using GPT → switch to the latest top-tier Claude model.
3. Run `/rubber-duck` to walk through the implementation and catch blind spots.
4. Review the feedback for:
   - Correctness and robustness
   - Edge cases and error handling
   - Architectural soundness
   - Test coverage gaps
5. Address any valid findings before finalizing.
