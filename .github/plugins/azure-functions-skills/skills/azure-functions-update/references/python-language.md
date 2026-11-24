# Python Language Stage

Shared reference for the Python scenarios. It is not a separate scenario. It defines
the separate Python version handoff in common step 8 and the Functions follow-up in
common step 9. The model/config phase keeps the app's current Python version.

Sources checked on **2026-11-14**:
[Supported languages](https://learn.microsoft.com/en-us/azure/azure-functions/supported-languages),
[language support policy](https://learn.microsoft.com/en-us/azure/azure-functions/language-support-policy),
and the [supported Python versions](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-python#supported-python-versions)
and [Python 3.13+ updates](https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-python#python-313-updates)
sections of the Python developer reference.

## Separate Python language handoff

Enter common step 8 only for a requested and approved update, or for an approved
prerequisite. Select the target from the supported-languages page for the actual
hosting plan and OS; do not assume the newest Python release is available there.

There is no dedicated Python upgrade agent for this handoff. If the user named another
tool or plugin, delegate to it through its own discovery and give it the handoff packet.
Otherwise, local toolchain changes are a separate, explicitly approved stage, not part
of the model/config phase. They can include the local interpreter and virtual
environment, `.python-version` or `pyproject.toml` constraints, CI `python-version`
values, and container base images. The Azure app's Python version is a site
configuration change; hand it off to Azure Skills under its own approval.

The handoff packet includes the current and target Python versions, the hosting plan and
OS, files allowed to change, the baseline and checkpoint, incomplete model work, the
original behavior, and all pending completion IDs. Do not change the SKU, hosting plan,
or OS image as an implicit part of the language stage. On a Linux Premium or Dedicated
plan, a Python 3.11 app on a Debian Bullseye managed image needs a separately approved
[image update](https://learn.microsoft.com/en-us/azure/azure-functions/set-runtime-version?pivots=platform-linux#update-the-managed-linux-image).

## Functions follow-up after the language stage

1. Recreate the virtual environment with the target interpreter and reinstall
   `requirements.txt`. Rebuild deployment artifacts; changing the Python version does
   not rebuild existing packages.
2. For Python 3.13 and later, every worker runtime package reference, pinned or not, must
   match the model:
   `azure-functions-runtime` for model v2 and `azure-functions-runtime-v1` for model v1.
   Do not pin production apps to prerelease runtime versions.
3. For Python 3.13 and later, `PYTHON_ENABLE_INIT_INDEXING` is no longer required for HTTP
   streaming, and `PYTHON_ISOLATE_WORKER_DEPENDENCIES` has no effect. Remove them only
   with approval; leaving them is not a failure.
4. Python 3.13 and later remove support for Python worker extensions and shared memory
   data transfer. If the app uses either, report the blocker before acceptance.
5. Rerun the selected scenario's completion IDs, unit/local tests, and `func` checks on the
   returned artifact. Old evidence is history, not proof for the new interpreter.

## Definition of done

Add these IDs to the selected Python scenario when a language stage is requested or
required. With no language stage, they are N/A with a reason. A requested but missing
handoff makes them blocked.

| ID | Required condition | Evidence and applicability |
| --- | --- | --- |
| PY-POST-01 | The effective local, CI, container, and Azure Python versions match the approved target for the actual plan and OS | Returned diff, resolved interpreter versions, and the Azure handoff result or its blocker |
| PY-POST-02 | Dependencies and deployment artifacts are rebuilt with the target interpreter, and every worker runtime package reference matches the model | Fresh install log and `requirements.txt` diff |
| PY-POST-03 | Version-specific settings and removed 3.13+ features are reviewed, and the scenario's completion IDs and checks pass on the returned artifact | Settings diff, feature review, and new test and host evidence |
