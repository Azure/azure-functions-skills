# Welcome & Setup Hook

This hook fires on first interaction in a new Azure Functions workspace. It provides a welcome message, runs prerequisite checks, and guides the user to create their first function.

## Trigger

Activate when any of these conditions are true:
- The workspace has no `host.json` file (no Functions project yet)
- The user's first message in the conversation
- The user explicitly asks for help getting started

## Welcome Message

```
⚡ Welcome to Azure Functions!

Let me help you get started. First, I'll check your development environment.
```

## Prerequisite Check

Run these checks silently and report results:

```bash
az --version 2>/dev/null && echo "✅ Azure CLI" || echo "❌ Azure CLI — install: https://aka.ms/installazurecli"
azd version 2>/dev/null && echo "✅ Azure Developer CLI" || echo "❌ Azure Developer CLI — install: https://learn.microsoft.com/azure/developer/azure-developer-cli/install-azd"
func --version 2>/dev/null && echo "✅ Core Tools" || echo "❌ Core Tools — install: npm i -g azure-functions-core-tools@4"
node --version 2>/dev/null && echo "✅ Node.js" || echo "❌ Node.js — install: https://nodejs.org"
```

For deployment workflows, also verify the **Azure Skills plugin** is installed. `azure-functions-deploy` delegates to Azure Skills (`azure-prepare` → `azure-validate` → `azure-deploy`).

## Post-Check Guidance

### All checks pass

```
✅ Your environment is ready!

Would you like to create your first Azure Function?
I can scaffold a project with your preferred language and trigger type.

For deployment later, install the Azure Skills plugin so azure-functions-deploy can hand off to azure-prepare, azure-validate, and azure-deploy.

→ Just say "create a function" or use the azure-functions-create skill.
```

### Some checks fail

```
⚠️ Some tools are missing. Let me help you fix that.

[Show failing checks with install instructions]

After installing, run azure-functions-setup to verify everything works.
```

## Graph Transition

- All pass → suggest **azure-functions-create**
- Failures → suggest **azure-functions-setup** for detailed fix guidance
