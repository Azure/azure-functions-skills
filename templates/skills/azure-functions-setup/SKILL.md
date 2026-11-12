---
name: azure-functions-setup
title: Azure Functions Setup
description: Verify prerequisites and set up your environment for Azure Functions development
category: entry
---

> **Language**: Always respond in the same language the user is using.

# azure-functions-setup — Azure Functions Environment Setup

Verify that the developer's environment has all prerequisites for Azure Functions development.

## Checks

Run each check and report results:

```bash
az --version        # Azure CLI ≥ 2.60 (≥ 2.87.0 for Go deployments)
azd version         # Azure Developer CLI, required by azure-functions-deploy
func --version      # Azure Functions Core Tools ≥ 4.x (≥ 4.12 for Go projects)
node --version      # Node.js 24 or 22 for new Node.js/TypeScript projects
python --version    # Python 3.13 preferred; 3.10-3.13 supported for Python projects
python3 --version   # Use this fallback when python is not on PATH
dotnet --version    # .NET SDK ≥ 8.0 (if .NET project)
go version          # Go 1.24 or later (if Go project; Go support is in preview)
```

Run the language checks that match the user's project or stated intent. Do not report a missing Go toolchain as a problem for a Python project, and do not report a missing Python interpreter as a problem for a Go project.

## Deployment Sign-in Check

When the user plans to deploy, also check the sign-in state. `azure-functions-deploy` runs `azd` and verifies the result with `az`.

```bash
azd auth login --check-status
az account show --query "{name:name, id:id}" -o json
```

Report a signed-out tool as a warning with its sign-in command. Do not sign in for the user.

## Output Format

Present results as a checklist:

```
Azure Functions Environment Check

  ✅ Azure CLI          <version>
  ✅ Azure Developer CLI <version>
  ✅ Core Tools         <version>
  ✅ Node.js            <version>
  ⚠️  Azure subscription  Not logged in → Run 'az login'
  ⚠️  Azure Developer CLI sign-in  Not logged in → Run 'azd auth login'
```

## Fix Instructions

For each failing check, provide:
1. **What's wrong** — one-line description
2. **How to fix** — exact install/fix command for the user's OS and shell
3. **Docs link** — Microsoft Learn URL

Use the user's operating system when choosing fix commands. Do **not** give Linux-only installation commands to Windows or macOS users. If the operating system or package manager is unclear, show the OS-specific choices and ask the user to run the one that matches their machine.

For language runtimes, prefer the latest Azure Functions **GA-supported** version for new installs. Do not recommend preview runtimes unless the user explicitly asks for previews.

| Tool | Recommended version | Windows | macOS | Linux | Docs |
|------|---------------------|---------|-------|-------|------|
| Azure CLI | Latest stable, ≥ 2.60; **≥ 2.87.0 for Go** | `winget install --exact --id Microsoft.AzureCLI` | `brew update && brew install azure-cli` | Use the distro-specific Microsoft Learn command for your package manager | https://learn.microsoft.com/cli/azure/install-azure-cli |
| Azure Developer CLI | Latest stable | `winget install --exact --id Microsoft.Azd` | `brew install azure/azd/azd` | Use the Microsoft Learn instructions for your distro or install the signed `.deb`/`.rpm` package from the Azure Developer CLI release | https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd |
| Core Tools | v4.x; **4.12 or later for Go** | Download and run the v4.x 64-bit MSI installer from Microsoft Learn | `brew tap azure/functions && brew install azure-functions-core-tools@4` | Use the Microsoft package repository for your distro, then install `azure-functions-core-tools-4` | https://learn.microsoft.com/azure/azure-functions/functions-run-local |
| Node.js | Node.js 24 GA for new apps; Node.js 22 also supported | `winget install --exact --id OpenJS.NodeJS.LTS` or `fnm install 24` | `brew install node@24` or `fnm install 24` | Use your distro package manager or a version manager such as `fnm install 24` | https://learn.microsoft.com/azure/azure-functions/functions-versions |
| Python | Python 3.13 GA for new apps; 3.10-3.13 supported | `winget install --exact --id Python.Python.3.13` | `brew install python@3.13` | Use your distro package manager or a version manager such as `pyenv install 3.13` | https://learn.microsoft.com/azure/azure-functions/functions-versions |
| .NET SDK | .NET 8 LTS minimum; use the latest GA version supported by the target Functions model | `winget install --exact --id Microsoft.DotNet.SDK.8` | `brew install --cask dotnet-sdk` | Use the Microsoft Learn instructions for your distro | https://learn.microsoft.com/dotnet/core/install/ |
| Go | Go 1.24 or later (Go support is in preview) | `winget install --exact --id GoLang.Go` | `brew install go` | Use your distro package manager or the official tarball from the Go downloads page | https://go.dev/dl/ |

Azure Functions runtime 4.x currently supports Node.js 24 and 22 for Node.js/TypeScript apps, and Python 3.10 through 3.13 for Python apps. Python 3.14 can appear in preview; keep Python 3.13 as the default recommendation until the user opts into preview support. Mention hosting caveats when relevant: newer language versions might not be available on Linux Consumption, so Flex Consumption is the safer default for new Linux-hosted apps.

### Go prerequisites

Go support on Azure Functions is in **public preview**. Say so before recommending it for production work.

Go has two version floors that no other language has.

- **Core Tools 4.12 or later.** The `native` worker that runs Go ships in 4.12. Earlier 4.x versions reject a Go project with a misleading "unsupported worker runtime" error, so compare the reported `func --version` against 4.12 rather than only checking for a `4.` prefix.
- **Azure CLI 2.87.0 or later**, needed when creating Azure resources or deploying packages. The general 2.60 floor used elsewhere in this checklist is not sufficient for Go, so a Go environment can otherwise be reported as ready when it is not. Check with `az version`.

If the installed Core Tools or Azure CLI is present but below the Go floor, report it as a failing check and give the upgrade command for the user's platform.

Go projects also use `FUNCTIONS_WORKER_RUNTIME=native` in `local.settings.json`, not `go` or `golang`. Mention this when a Go project is detected, because it is the most common local configuration mistake.

Scaffold Go projects with `func init <project-name> --worker-runtime go`. `func new` is not supported for Go.

See https://learn.microsoft.com/azure/azure-functions/functions-reference-go for the authoritative prerequisite list.

## After Setup

After the environment check completes, report the checklist and recommend the most relevant next skill. No local setup state is created or updated.

When all checks pass, suggest the next step:

> ✅ Your environment is ready! Next:
> - Use **azure-functions-create** to scaffold a new Azure Functions project (HTTP triggers, timer triggers, queue triggers, etc.)
> - Use **azure-functions-hosted-skills** to build cloud-hosted, event-driven intelligent capabilities with Markdown, Functions triggers, code, tools, HTTP, and MCP

For deployment, suggest **azure-functions-deploy** when `azd` is installed and signed in. It plans, applies, and verifies the deployment with `azd`, and does not need another plugin.

## Next steps

- On success, suggest `azure-functions-create` for traditional Functions projects, or `azure-functions-hosted-skills` for Azure Functions Hosted Skills — let the user choose based on their goal.
- On failure, keep the user in `azure-functions-setup`: explain fixes, then ask them to rerun setup verification.
- If deployment is requested and `azd` is missing or signed out, keep the user in `azure-functions-setup` until it is fixed.
