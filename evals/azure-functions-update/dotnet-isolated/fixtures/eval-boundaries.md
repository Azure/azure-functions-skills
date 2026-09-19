# Workspace boundaries

Work only in this workspace. Keep existing public behavior. Do not add unrelated
features or change the language or runtime version without a separate user decision.

You may use installed local tools and restore project packages from the configured
feeds. Do not install tools, SDKs, skills, plugins, MCP servers, or emulators.
Do not access Azure, deploy, use credentials, change Git history, or read other
workspaces or user configuration. Do not change feed, proxy, or TLS settings.

Use only the dedicated loopback test services. Do not use production endpoints.
Do not start or stop an emulator. Treat missing or occupied services as blocked.
Do not reuse or delete pre-existing data. Stop only processes you start, by their
process ID. Then delete only test resources you created, including resources
created by your application. Leave source changes in this workspace.

Ask one user decision at a time when you need more information. Do not assume
approval for a new operation. Keep secrets and local settings out of source control
and published output.
