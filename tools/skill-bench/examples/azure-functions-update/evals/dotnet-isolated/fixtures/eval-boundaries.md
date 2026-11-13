# Workspace boundaries

Work only in this workspace. Keep existing public behavior. Do not add unrelated
features or change the language or runtime version without a separate user decision.

You may use installed local tools and restore project packages from the configured
feeds. Do not install tools, SDKs, skills, plugins, MCP servers, or emulators.
Do not access Azure, deploy, use credentials, change Git history, or read other
workspaces or user configuration. Do not change feed, proxy, or TLS settings.

Use only the dedicated loopback test services. Do not use production endpoints.
Do not start or stop an emulator. Run applicable local end-to-end checks when the
installed tools and loopback services support them. The queue `greeting-requests`
and the containers `greeting-input` and `greeting-output` are evaluation-owned.
You may create, use, and delete only these emulator resources. Clean up resources
that you create. The independent grader resets these three names before its own
checks. Use only the dedicated emulator connection supplied by the evaluation
environment. Do not write account keys or cloud credentials. Do not read or change
any other emulator data. Stop every host or other process that you start, using its
process ID, before you finish. Leave source changes in this workspace.

This is a non-interactive run. Do not ask follow-up questions. Make reasonable
implementation decisions from the source and public documentation. If an operation
needs permission outside these boundaries, do not perform it; report it as blocked.
Keep secrets and local settings out of source control and published output.
