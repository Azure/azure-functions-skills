# Convert Source Scripts to Python

Use this reference when a source skill depends on executable scripts. Convert required supported
processing to Python. Keep the original scripts unchanged in the source directory. Do not copy
Bash, PowerShell, JavaScript, or other source scripts into the Hosted app for runtime execution.
Existing Python scripts need adaptation when their paths, entry points, or dependencies differ.

## Inspect before conversion

Read the script and its callers without executing them. Record arguments, defaults, environment
variables, input/output formats, error behavior, dependencies, file access, and side effects.
Inspect imported helpers and child scripts that are needed to understand its operations.
If code is missing, obfuscated, or cannot be understood, mark the conversion `unverified`.
Do not guess its behavior or run it to discover what it does.

Split a mixed script into operations. For example, a script that gets mail and formats a report
has two requirements: approved service access and deterministic report processing. Classify
both through the conversion-support reference before generation.

## First-release conversion

| Source behavior | Target |
| --- | --- |
| App-specific filtering, calculation, validation, or report formatting on approved input | Python tool or shared Python helper |
| Supported service access | Approved Connector or remote HTTP MCP operation; pass its result to the Python processing |
| Existing Python processing | Adapt to the Hosted tool contract and check runtime compatibility |
| Laptop file path | Approved trigger input/output or supported storage operation; obtain approval for the path change |
| Git/PR, build, deployment, arbitrary commands, or unsupported service access | Out of scope; Python does not remove the exclusion |

Do not add direct HTTP/SDK service access to make an unsupported operation work.
Do not use subprocess calls, a shell, an embedded language interpreter, a CLI wrapper, or execution
sessions to run the original script. General-purpose browsing or arbitrary code execution remains
outside this migration scope. Use Python only for the approved app-specific processing.

If a script cannot be converted within these rules, return to step 3. Explain the blocker and
ask about removal or a supported replacement. Do not silently drop required processing.

## Implement the Python contract

Follow the current `azure-functions-hosted-skills` custom-tool reference.

1. Write tests for expected behavior before the implementation.
2. Expose an agent-callable operation under `src/tools/` with the supported `@tool` contract.
   Use one tool per file, explicit parameter types, and a Pydantic schema when needed.
3. Put shared helpers in importable app modules outside the Markdown skill directory. Check
   imports and tool discovery in the actual template runtime; do not assume a package is loaded.
4. Preserve required input fields, defaults, output fields, ordering, formats, and error behavior.
   Explain and obtain approval for changes such as stdout text becoming structured tool output.
5. Return JSON-serializable results. Surface invalid inputs and processing failures explicitly.
6. Add required packages to `requirements.txt`. Check Python version and dependency compatibility.
   Keep configuration in environment settings and secrets in approved secret storage.
   Use the target project's existing test layout and runner. If neither exists, agree on a Python
   test setup. Keep test-only packages separate from runtime requirements.
7. Update the Hosted skill's instructions and all callers to use exact discovered tool names.
   Remove source script paths and shell invocation instructions from the Hosted copy.

The source script is not a tool contract. For example, flags and exit codes may need to become
typed inputs and explicit errors. Record that mapping instead of assuming a literal translation.

## Verify behavior

Use trusted expected results from the source specification or user-approved fixtures. Do not run
unreviewed original scripts to obtain a baseline. If expected behavior is unknown, ask for evidence.

Check representative, empty, invalid, and boundary inputs. Include relevant date/time-zone rules,
numeric precision, sort order, Unicode encoding, file format, and size limits. Confirm dependencies
are available and the callable tool produces the expected result in the Hosted runtime.

Test the actual Hosted Skill's use of the tool, not only helper functions or Python syntax.
Keep service-side tests under the Connector/MCP approval and cleanup rules.
