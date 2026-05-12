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
az --version        # Azure CLI ≥ 2.60
azd version         # Azure Developer CLI, required for Azure Skills deployment workflows
func --version      # Azure Functions Core Tools ≥ 4.x
node --version      # Node.js ≥ 18 (if Node project)
python3 --version   # Python ≥ 3.9 (if Python project)
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
2. **How to fix** — exact install/fix command
3. **Docs link** — Microsoft Learn URL

| Tool | Install Command | Docs |
|------|----------------|------|
| Azure CLI | `curl -sL https://aka.ms/InstallAzureCLIDeb \| sudo bash` | https://learn.microsoft.com/cli/azure/install-azure-cli |
| Azure Developer CLI | See docs for OS-specific install | https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd |
| Core Tools | `npm install -g azure-functions-core-tools@4 --unsafe-perm true` | https://learn.microsoft.com/azure/azure-functions/functions-run-local |
| Node.js | `nvm install 22` or download from https://nodejs.org | https://nodejs.org |
| Python | `sudo apt install python3.11` or download from https://python.org | https://python.org |
| .NET SDK | `dotnet-install.sh --channel 8.0` | https://learn.microsoft.com/dotnet/core/install/ |

## After Setup

When all checks pass, suggest the next step:

> ✅ Your environment is ready! Next: use **azure-functions-create** to scaffold a new Azure Functions project.

For deployment, confirm the Azure Skills plugin is available before suggesting **azure-functions-deploy**. `azure-functions-deploy` delegates to `azure-prepare`, `azure-validate`, and `azure-deploy`.

## Next steps

- On success, suggest `azure-functions-create` because the environment is ready to create an Azure Functions app.
- On failure, keep the user in `azure-functions-setup`: explain fixes, then ask them to rerun setup verification.
- If deployment is requested and Azure Skills is missing, keep the user in `azure-functions-setup` until the Azure Skills plugin is installed or the user explicitly chooses a fallback deployment path.
