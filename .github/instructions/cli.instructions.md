---
applyTo: "bin/**,src/templates/**,src/telemetry/**"
---

# CLI Development Rules

## Usability First

- The CLI is designed with usability as the top priority.
- Commands must be intuitive — users should never feel lost or confused.
- Error messages must be specific and actionable: tell the user *what went wrong* and *what to do next*.
- Provide helpful defaults so common workflows require minimal flags.

## Output

- Keep output concise and scannable.
- Use color and formatting consistently (success = green, error = red, warning = yellow).
- Progress indicators for long-running operations.
- Respect `--quiet` and `--json` flags where applicable.

## After Changes

- Always compile: `npm run compile`
- Run unit tests: `npm test`
- **Manual verification is mandatory**: run the actual CLI command in an isolated workspace.
  ```bash
  node bin/azure-functions-skills.js <cmd> --dir <isolated-workspace>
  ```
- Never run `template apply` from the repo root — it pollutes the working tree.

## Architecture

- CLI entry point: `bin/azure-functions-skills.js`
- Domain modules: `src/build/`, `src/telemetry/`, `src/templates/`
- Keep option parsing in `bin/`; keep business logic in `src/`.
- Separate concerns — do not mix I/O, validation, and domain logic in one function.
