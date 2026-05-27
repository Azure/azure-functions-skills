# Doctor Reference Routing

Use this file first. Load only the reference files needed for the current project and scope.

## Tags

| Tag | Load | Use when |
|-----|------|----------|
| `source-only` | `source-only-checks.md` | Interpreting built-in/no-deep checks, local config, binding inventory, package files |
| `deep` / `semantic` | `ai-semantic-checks.md` | Running `doctor --deep` and reviewing code behavior |
| `supply-chain` / `security` | `supply-chain-checks.md` | Any project with dependency manifests (`package.json`, `requirements.txt`, `pom.xml`, etc.) |
| `iac` | `iac-azure-resource-checks.md` | Bicep, ARM, Terraform, AZD, or deployment config exists |
| `azure-resource` | `iac-azure-resource-checks.md` | Azure CLI login/resource context is available |
| `language:csharp` | `language-checks.md` | C#/.NET Functions project |
| `language:node` | `language-checks.md` | JavaScript or TypeScript Functions project |
| `language:python` | `language-checks.md` | Python Functions project |
| `language:java` | `language-checks.md` | Java Functions project |
| `language:powershell` | `language-checks.md` | PowerShell Functions project |
| `ci` | `ci-usage.md` | GitHub Actions or CLI execution guidance is needed |

## Loading rules

1. Always use the Tier 1 built-in results as context; do not repeat already reported pass/fail items.
2. For default deep analysis, load `ai-semantic-checks.md` plus the matching language section from `language-checks.md`.
3. Load `supply-chain-checks.md` whenever the project has a dependency manifest — supply chain risk is language-independent.
4. Load `source-only-checks.md` when a Tier 1 result needs interpretation or a source-only issue is suspected.
5. Load `iac-azure-resource-checks.md` only when IaC files or Azure resource access are available.
6. Load `ci-usage.md` only for CI, GitHub Actions, agent CLI, Azure CLI, or `--no-deep` questions.
