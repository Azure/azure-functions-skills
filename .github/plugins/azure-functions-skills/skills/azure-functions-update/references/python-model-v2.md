# Python Programming Model v2

Use this reference to change from configuration-based functions to decorator-based functions.

- Start with the [Python v2 programming model reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-python?pivots=python-mode-decorators#programming-model). Select the v1 model on the same page only if you need to compare the source model.
- For a binding used by the app, select its Python example from [supported bindings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings#supported-bindings).

These sources describe the models. They are not a dedicated migration guide. Preserve function names, routes, authorization, and binding settings when moving the definitions into code.

## Migration steps

1. Migrate every function in the app in the same phase. The
   [official v2 samples guide](https://github.com/Azure-Samples/functions-docs-python-v2/blob/main/getting_started.md)
   states that mixing v1 and v2 functions in the same function app is not supported.
   If the user wants a partial migration, split the app with separate approval first.
2. Create `function_app.py` at the project root with `app = func.FunctionApp()`. The main
   file must use that name. For a large app, put related functions in `func.Blueprint()`
   files and register each one with `app.register_functions(bp)`.
   If the app has Durable orchestrator, activity, entity, or client functions, use
   `app = df.DFApp()` from `azure.durable_functions` instead, because only `DFApp` (or a
   Durable SDK blueprint) exposes the Durable decorators. The
   [Durable bindings reference](https://learn.microsoft.com/azure/durable-task/durable-functions/durable-functions-bindings?pivots=programming-language-python)
   requires `azure-functions-durable` 1.2.2 or later. Replace the v1
   `main = df.Orchestrator.create(...)` and `df.Entity.create(...)` wrappers with the
   decorated functions, and keep orchestrators non-`async`. This is part of the model
   change, not a Durable extension migration.
3. For each `function.json`, find the actual handler from `scriptFile` and `entryPoint`
   (default `__init__.py` and `main`). Keep the v1 folder name as the function name with
   `@app.function_name(name="<folder>")`; the Python method name alone can differ.
4. Convert each binding to its decorator. Keep `direction`, the binding `name` as
   `arg_name`, paths, queue or container names, `connection` setting names, `dataType`
   as `data_type`, and `cardinality`. A `$return` output becomes the return value.
   Keep the HTTP `authLevel`, `methods`, and `route` per function; do not rely on a
   different app-level `http_auth_level` default.
5. Function folders are no longer packages for the entry point. Replace relative imports
   such as `from .helper import x` or `from ..shared_code import y` with imports that
   resolve from the project root. Keep shared helper modules and their behavior.
6. Keep the disabled state. A `"disabled": true` in `function.json` moves to the
   `AzureWebJobs.<FunctionName>.Disabled` app setting for the same function name.
7. Remove the `function.json` files and the empty function folders only after the new
   functions register. Keep `host.json`, `local.settings.json` values, and
   `requirements.txt` entries. For Python 3.13 and later, replace any
   `azure-functions-runtime-v1` reference, pinned or not, with `azure-functions-runtime`.
8. Keep the Python version. A requested or required Python version change uses
   [Python language stage](python-language.md) as a separate stage.

## Definition of done

These stable IDs are shared by planning, phase review, final review, and evaluation.
For each app and phase, record `pass`, `fail`, `blocked`, or `not-applicable`, with
artifact, proof, and applicability reason. N/A needs a condition below, not a tool or
permission gap.

| ID | Required condition | Evidence and applicability |
| --- | --- | --- |
| PM-01 | Supported Python version and Functions v4 runtime; the language version is unchanged in this stage | Effective project and app settings before and after |
| PM-02 | Each v1 function has one decorator-based function with the same name, trigger, route, methods, and authorization level | Function inventory before and after, and the diff |
| PM-03 | Each binding keeps its direction, argument name, path or queue, and connection setting name | `function.json` values compared with the decorators |
| PM-04 | No `function.json` file stays for a migrated function, no v1 function remains in the app, and blueprints are registered on the app | File list, and the `register_functions` calls |
| PM-05 | Existing unit and local tests succeed | Actual commands and results; N/A only if inventory proves that no tests exist |
| PM-06 | `func` starts and lists every expected function with no indexing errors | Expected versus actual function list and redacted host logs |
| PM-07 | Shared helper imports resolve, the disabled state of each function stays, every worker runtime package reference matches model v2, and Durable functions use `DFApp` | Import check or host start, settings diff, and `requirements.txt` diff; runtime package part N/A when no worker runtime package is referenced; Durable part N/A when the inventory has no Durable functions |

When a Python language stage is requested or required, also apply `PY-POST-01` to
`PY-POST-03` from [Python language stage](python-language.md).
