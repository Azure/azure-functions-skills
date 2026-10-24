# Convert Source Scripts to Python

Convert required supported processing to Python; adapt existing Python too. Preserve originals.
Apply the main workflow's read permissions. Do not execute source scripts to discover behavior.

## Inspect and split

Read required scripts, imported helpers, child scripts, and callers. Record arguments/defaults,
environment variables, inputs/outputs, errors, dependencies, file access, and side effects.
Missing, obfuscated, or unclear required code is `unverified`; ask for a trusted specification.
Split mixed scripts into operations before applying [conversion-support.md](conversion-support.md).

| Source operation | Target |
| --- | --- |
| App-specific filtering, calculation, validation, report formatting | Python tool/helper on approved inputs or tool results |
| Supported service access | User-selected Connector, remote HTTP MCP, or bounded Python API/SDK tool |
| Existing Python | Adapt paths, entry points, dependencies, and Hosted contract |
| Laptop files | Approved trigger input/output or verified storage operation; obtain approval |
| Git/PR/build/deploy, shell, unsupported service access | Excluded; return to step 3 |

Do not replace deterministic results with model-generated output. Direct HTTP/SDK service access
requires the user's selected operation and the custom-tool checks in the support reference.
Do not use it, subprocess/shell calls, embedded interpreters, CLI wrappers, or execution sessions
to bypass exclusions or run the old language. Generic browsing/arbitrary code execution is not
part of this migration.

## Implement

Follow the Hosted Skills custom-tool reference. Write tests before implementation.
Expose callable operations in `src/tools/`, one per file, with the supported `@tool` contract,
explicit types, and Pydantic schemas when needed. Put shared helpers in importable app modules
outside `src/skills/`; check discovery/imports in the actual template runtime.
Preserve fields, defaults, ordering, formats, and error behavior. Record flag/exit-code mappings
to typed inputs/explicit errors. Obtain approval for contract changes, such as stdout becoming
structured output. Return JSON-serializable results; surface invalid input and failures.

Add compatible runtime packages to `requirements.txt`; check Python version/imports. Use
environment settings and approved secret storage. Keep test packages separate. Use the target's
test layout/runner; agree on a setup if absent. Update all callers to exact discovered tool names,
not script paths or `python` shell commands.

## Verify

Use trusted specification results or approved fixtures; ask if expected behavior is unknown.
Test representative/empty/invalid/boundary cases, including dates/time zones, precision, sort
order, Unicode, format, and size limits when applicable. Verify packages/imports and runtime
calls. Test the actual Hosted Skill using the converted tool and result, not only Python syntax
or helper functions. Service tests remain subject to approval/cleanup.
Use HSM-12 through HSM-15 and HSM-24/25 in the common DoD; do not keep a second checklist.
