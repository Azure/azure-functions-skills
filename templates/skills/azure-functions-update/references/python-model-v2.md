# Python Programming Model v2

Use this reference to change from configuration-based functions to decorator-based functions.

- Start with the [Python v2 programming model reference](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-python?pivots=python-mode-decorators#programming-model). Select the v1 model on the same page only if you need to compare the source model.
- For a binding used by the app, select its Python example from [supported bindings](https://learn.microsoft.com/en-us/azure/azure-functions/functions-triggers-bindings#supported-bindings).

These sources describe the models. They are not a dedicated migration guide. Preserve function names, routes, authorization, and binding settings when moving the definitions into code.

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
| PM-04 | No `function.json` file stays for a migrated function, and blueprints are registered on the app | File list, and the `register_functions` calls |
| PM-05 | Existing unit and local tests succeed | Actual commands and results; N/A only if inventory proves that no tests exist |
| PM-06 | `func` starts and lists every expected function with no indexing errors | Expected versus actual function list and redacted host logs |
