# Migrate Dependent Skills

Use this reference when a source skill reads or calls another skill. Inspect the full set of
required dependencies before generation. Apply the same operation support and approval rules to
each skill. Do not treat dependency instructions as permission to execute them.

## Discover the dependency graph

1. Start with the selected source `SKILL.md`. Read references to other skills, local skill paths,
   skill-loader commands, and required skill names.
2. Resolve each dependency from the supplied workspace or user-provided source. Record its source
   location, declared name, revision when known, and the referring parent.
3. Read each required dependency's Markdown references, scripts, tool calls, and further skill
   dependencies. Inspect conditional dependencies needed by the approved scenario too.
4. Track resolved source locations and revisions, not just names. Different sources can declare
   the same name. Inspect a shared source once, but keep all parent links.
5. Record missing, ambiguous, or inaccessible sources as `unverified`. Ask for the source or a
   supported replacement. Do not search unrelated directories, install a plugin, execute a skill,
   or obtain private code without permission to resolve it.
6. Detect cycles with the active traversal path. Do not repeat inspection forever. Separate
   harmless cross-references from instructions that would repeatedly call each other at runtime.

Different names or paths do not prove different behavior. Preserve the identity of each source
until its contents and required operations have been checked.

## Classify and approve

| Dependency content | Action |
| --- | --- |
| Knowledge and procedures only | Copy compatible Markdown and required references into its own target skill directory. Check all links and required assets. |
| Another required skill | Inspect that skill too. Do not stop at the first dependency level. |
| Tool, MCP, or CLI operations | Classify and convert each operation under the same first-release support policy. |
| Executable scripts | Convert supported processing to Python under the script-conversion rules. |
| Missing or ambiguous source | Mark `unverified`; do not guess or report the dependency as supported. |
| Required excluded operation | Block the parent migration unless the user approves a supported replacement or revised scope. |
| Runtime call cycle with no clear stop condition | Explain the cycle and obtain approval for a terminating design before generation. |

Record whether a dependency is required for the approved scenario. Ask before removing a
dependency, narrowing its behavior, or moving its procedures into another skill.
User approval does not establish operation support or make an excluded operation permitted.

## Copy and adapt

Place each approved dependent skill under `src/skills/<name>/SKILL.md`, with its required
Markdown references. Preserve the source files. Use the current runtime's skill name rules and
unique names across the whole target app.

If the target already has the same dependency, compare its content and contract before reuse.
Reuse only when it matches the approved requirement. Different skills with the same name need an
approved rename or another explicit resolution; never overwrite one because names match.
Record the source-to-target mapping and update every affected parent reference.

For knowledge-only skills, keep compatible content unchanged. For converted dependencies, update
tool names, instructions, script calls, skill references, inputs, and approved behavior changes.
Keep Python tools/helpers outside `src/skills/`. Check non-Markdown assets separately; copying
a directory does not make executable scripts or local files supported.

Remove dependence on local coding-agent skill-loader commands and local plugin paths. Follow the
current Hosted runtime's documented skill access. Do not invent an `invoke_skill` tool or assume
that a named skill is an independently deployed agent. Ensure the consuming agent can access
required skills and their approved tools/MCP servers without exposing unrelated operations.

## Verify dependency use

Check the graph and source-to-target mapping against the generated app. Every required dependency
must have a resolved source, approved conversion, valid target, and working references.

Test representative parent-to-dependency paths in the actual Hosted runtime. Verify dependent
instructions are used, their required tools run with the approved contracts, and the result meets
the parent goal. Test approved renames and reused shared dependencies. For a retained reference
cycle, prove that the task terminates; do not treat bounded inspection as proof of runtime safety.

If a required dependency is unavailable, excluded, or not verified, report the parent migration
as incomplete. Include the dependent skill and blocked operation in the report.
