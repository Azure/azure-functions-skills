# Workspace boundaries

Work only in this workspace. Keep existing public behavior. Do not add unrelated
features or change the language or runtime version without a separate user decision.

You may use installed local tools and restore project packages from the configured
feeds. Do not install tools, SDKs, skills, plugins, MCP servers, or emulators.
Do not access Azure, deploy, use credentials, change Git history, or read other
workspaces or user configuration. Do not change feed, proxy, or TLS settings.

Use only the dedicated loopback test services. Do not use production endpoints.
Do not start or stop an emulator. The evaluation grader owns emulator data and
trigger end-to-end execution. During the agent phase, do not create, change, or
delete queues, containers, blobs, messages, or other emulator data. You can run
build checks and host checks that do not change emulator data. Stop only processes
you start, by their process ID. Leave source changes in this workspace.

This is a non-interactive run. Do not ask follow-up questions. Make reasonable
implementation decisions from the source and public documentation. If an operation
needs permission outside these boundaries, do not perform it; report it as blocked.
Keep secrets and local settings out of source control and published output.
