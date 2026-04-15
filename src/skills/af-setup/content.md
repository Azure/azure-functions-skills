> **Language**: Always respond in the same language the user is using.

# af-setup — Azure Functions Environment Setup

Verify that the developer's environment has all prerequisites for Azure Functions development.

## Checks

Run each check and report results:

```bash
az --version        # Azure CLI ≥ 2.60
func --version      # Azure Functions Core Tools ≥ 4.x
node --version      # Node.js ≥ 18 (if Node project)
python3 --version   # Python ≥ 3.9 (if Python project)
dotnet --version    # .NET SDK ≥ 8.0 (if .NET project)
```

## Output Format

Present results as a checklist:

```
Azure Functions Environment Check

  ✅ Azure CLI          <version>
  ✅ Core Tools         <version>
  ✅ Node.js            <version>
  ⚠️  Azure subscription  Not logged in → Run 'az login'
```

## Fix Instructions

For each failing check, provide:
1. **What's wrong** — one-line description
2. **How to fix** — exact install/fix command
3. **Docs link** — Microsoft Learn URL

| Tool | Install Command | Docs |
|------|----------------|------|
| Azure CLI | `curl -sL https://aka.ms/InstallAzureCLIDeb \| sudo bash` | https://learn.microsoft.com/cli/azure/install-azure-cli |
| Core Tools | `npm install -g azure-functions-core-tools@4 --unsafe-perm true` | https://learn.microsoft.com/azure/azure-functions/functions-run-local |
| Node.js | `nvm install 22` or download from https://nodejs.org | https://nodejs.org |
| Python | `sudo apt install python3.11` or download from https://python.org | https://python.org |
| .NET SDK | `dotnet-install.sh --channel 8.0` | https://learn.microsoft.com/dotnet/core/install/ |

## After Setup

When all checks pass, suggest the next step:

> ✅ Your environment is ready! Next: use **af-create** to scaffold a new Azure Functions project.
