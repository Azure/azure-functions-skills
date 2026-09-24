# Doctor Reference Routing

Use this file first. Load only the reference files needed for the current project and scope.

## Tags

| Tag | Load | Use when |
|-----|------|----------|
| `source-only` | `source-only-checks.md` | Every analysis: local config, binding inventory, package files, secrets, deploy artifact |
| `semantic` | `ai-semantic-checks.md` | Reviewing code behavior |
| `supply-chain` / `security` | `supply-chain-checks.md` | Any project with dependency manifests (`package.json`, `requirements.txt`, `pom.xml`, etc.) |
| `iac` | `iac-azure-resource-checks.md` | Bicep, ARM, Terraform, AZD, or deployment config exists |
| `azure-resource` | `iac-azure-resource-checks.md` | Azure CLI login/resource context is available |
| `language:csharp` | `language-checks.md` | C#/.NET Functions project |
| `language:node` | `language-checks.md` | JavaScript or TypeScript Functions project |
| `language:python` | `language-checks.md` | Python Functions project |
| `language:java` | `language-checks.md` | Java Functions project |
| `language:powershell` | `language-checks.md` | PowerShell Functions project |
| `language:go` | `language-checks.md` | Go Functions project (`go.mod` present, or `FUNCTIONS_WORKER_RUNTIME=native` with a Go signal) |

## Loading rules

1. Always load `source-only-checks.md` and do its checks first.
2. For a full analysis, also load `ai-semantic-checks.md` plus the matching language section from `language-checks.md`.
3. Load `supply-chain-checks.md` whenever the project has a dependency manifest — supply chain risk is language-independent.
4. Load `iac-azure-resource-checks.md` only when IaC files or Azure resource access are available.
5. If the user asks for a narrow scope (for example, "only security"), load only the files for that scope.