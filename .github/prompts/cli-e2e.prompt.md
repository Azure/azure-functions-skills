---
description: "Verify CLI changes with end-to-end execution"
name: "cli-e2e"
---

Verify CLI changes by running actual commands in an isolated workspace:

1. Compile: `npm run compile`
2. Verify help: `node bin/azure-functions-skills.js --help`
3. Run the modified subcommand with `--dir <isolated-workspace>` to avoid repo root pollution.
4. For setup/chat flows, create a temporary workspace first:
   ```bash
   node bin/azure-functions-skills.js setup --agent ghcp --dir <temp-dir> --skip-prerequisites
   node bin/azure-functions-skills.js chat --agent github-copilot --dir <temp-dir> --skip-prerequisites -- -p "List skills"
   ```
5. Confirm output is correct, no errors, and messages are user-friendly.
6. Check that the command behaves intuitively — no confusing prompts or ambiguous output.
