---
name: azure-functions-setup
description: "Verify prerequisites and set up your environment for Azure Functions development"
---


> **Language**: Always respond in the same language the user is using.

# azure-functions-setup — Azure Functions Environment Setup

Verify that the developer's environment has all prerequisites for Azure Functions development.

## Checks

Run each check and report results:

```bash
az --version        # Azure CLI ≥ 2.60
azd version         # Azure Developer CLI, required for Azure Skills deployment workflows
func --version      # Azure Functions Core Tools ≥ 4.x
node --version      # Node.js 24 or 22 for new Node.js/TypeScript projects
python --version    # Python 3.13 preferred; 3.10-3.13 supported for Python projects
python3 --version   # Use this fallback when python is not on PATH
dotnet --version    # .NET SDK ≥ 8.0 (if .NET project)
```

## Azure Skills Plugin Check

Azure Functions deployment is proxied through the Azure Skills deployment workflow. For deployment scenarios, verify that the Azure Skills plugin is installed and that these skills are available:

- `azure-prepare`
- `azure-validate`
- `azure-deploy`

**How to detect availability**: Check your current tool/skill list for the above skill names. If they appear in the list of available skills (e.g., in `<available_skills>` or equivalent plugin registry), they are installed. You do not need to run any commands — the presence of these skills in the agent's tool list is sufficient confirmation.

If the Azure Skills plugin is missing, install it for the active host before using `azure-functions-deploy`.

| Host | Install guidance |
|------|------------------|
| GitHub Copilot CLI | `/plugin marketplace add microsoft/azure-skills`, then `/plugin install azure@azure-skills` |
| Claude Code | `/plugin install azure@claude-plugins-official` |
| Codex CLI | `codex plugin marketplace add microsoft/azure-skills`, then install `azure` from `/plugins` |
| VS Code | Install the Azure MCP extension and companion Azure Skills integration, then reload VS Code |
| GitHub Copilot fallback | `npx skills add https://github.com/microsoft/azure-skills/tree/main/.github/plugins/azure-skills/skills -a github-copilot -g -y` |

## Output Format

Present results as a checklist:

```
Azure Functions Environment Check

  ✅ Azure CLI          <version>
  ✅ Azure Developer CLI <version>
  ✅ Core Tools         <version>
  ✅ Node.js            <version>
  ⚠️  Azure subscription  Not logged in → Run 'az login'
  ⚠️  Azure Skills plugin Missing → install before azure-functions-deploy
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
| Azure CLI | Latest stable, ≥ 2.60 | `winget install --exact --id Microsoft.AzureCLI` | `brew update && brew install azure-cli` | Use the distro-specific Microsoft Learn command for your package manager | https://learn.microsoft.com/cli/azure/install-azure-cli |
| Azure Developer CLI | Latest stable | `winget install --exact --id Microsoft.Azd` | `brew install azure/azd/azd` | Use the Microsoft Learn instructions for your distro or install the signed `.deb`/`.rpm` package from the Azure Developer CLI release | https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd |
| Core Tools | v4.x | Download and run the v4.x 64-bit MSI installer from Microsoft Learn | `brew tap azure/functions && brew install azure-functions-core-tools@4` | Use the Microsoft package repository for your distro, then install `azure-functions-core-tools-4` | https://learn.microsoft.com/azure/azure-functions/functions-run-local |
| Node.js | Node.js 24 GA for new apps; Node.js 22 also supported | `winget install --exact --id OpenJS.NodeJS.LTS` or `fnm install 24` | `brew install node@24` or `fnm install 24` | Use your distro package manager or a version manager such as `fnm install 24` | https://learn.microsoft.com/azure/azure-functions/functions-versions |
| Python | Python 3.13 GA for new apps; 3.10-3.13 supported | `winget install --exact --id Python.Python.3.13` | `brew install python@3.13` | Use your distro package manager or a version manager such as `pyenv install 3.13` | https://learn.microsoft.com/azure/azure-functions/functions-versions |
| .NET SDK | .NET 8 LTS minimum; use the latest GA version supported by the target Functions model | `winget install --exact --id Microsoft.DotNet.SDK.8` | `brew install --cask dotnet-sdk` | Use the Microsoft Learn instructions for your distro | https://learn.microsoft.com/dotnet/core/install/ |

Azure Functions runtime 4.x currently supports Node.js 24 and 22 for Node.js/TypeScript apps, and Python 3.10 through 3.13 for Python apps. Python 3.14 can appear in preview; keep Python 3.13 as the default recommendation until the user opts into preview support. Mention hosting caveats when relevant: newer language versions might not be available on Linux Consumption, so Flex Consumption is the safer default for new Linux-hosted apps.

## After Setup

After the environment check completes, report the checklist and recommend the most relevant next skill. No local setup state is created or updated.

When all checks pass, suggest the next step:

> ✅ Your environment is ready! Next:
> - Use **azure-functions-create** to scaffold a new Azure Functions project (HTTP triggers, timer triggers, queue triggers, etc.)
> - Use **azure-functions-agents** to build an AI-powered agent app on Azure Functions (scheduled agents, chat agents, connector-triggered agents, background AI workflows)

For deployment, confirm the Azure Skills plugin is available before suggesting **azure-functions-deploy**. `azure-functions-deploy` delegates to `azure-prepare`, `azure-validate`, and `azure-deploy`.

## Next steps

- On success, suggest `azure-functions-create` for traditional Functions projects, or `azure-functions-agents` for AI agent apps — let the user choose based on their goal.
- On failure, keep the user in `azure-functions-setup`: explain fixes, then ask them to rerun setup verification.
- If deployment is requested and Azure Skills is missing, keep the user in `azure-functions-setup` until the Azure Skills plugin is installed or the user explicitly chooses a fallback deployment path.