# Azure Skills と Azure Functions Skills の役割分担

作成日: 2026-05-21

この文書は、Azure Skills と Azure Functions Skills のどちらに機能追加、修正、フィードバックを入れるべきかを明確にするための contributor / PM 向けガイドです。

## 結論

Azure Skills は **Azure platform workflow engine** です。Azure 全体に共通する準備、検証、デプロイ、IaC、Azure resource provisioning を担当します。

Azure Functions Skills は **Azure Functions domain layer and router** です。Azure Functions 固有の作成、診断、運用レビュー、runtime / trigger / binding / language worker guidance、workspace-local setup、agent routing を担当します。

つまり、Azure Functions Skills は Azure Skills の置き換えではありません。Functions 固有の文脈を集め、必要に応じて Azure Skills に委譲する facade / domain layer として設計します。

## 役割分担マトリクス

| 領域 | 担当 | 理由 |
| --- | --- | --- |
| Azure 全体の app deployment lifecycle | Azure Skills | `azure-prepare` -> `azure-validate` -> `azure-deploy` が共通 deployment engine であるため |
| IaC、`azd`、Terraform、Bicep、Azure resource provisioning | Azure Skills | Functions 以外の App Service、Container Apps、DB、Storage、RBAC、region、subscription も扱うため |
| Azure Functions のユーザー向け入口 | Azure Functions Skills | `functions-copilot` が setup / create / deploy / diagnostics / best-practices へ routing するため |
| Azure Functions project scaffolding / add function | Azure Functions Skills | runtime、language worker、trigger / binding、official Azure Functions MCP templates を扱うため |
| Azure Functions deployment | Entry point は Azure Functions Skills、実行 engine は Azure Skills | `azure-functions-deploy` が Functions context を集め、`azure-prepare` / `azure-validate` / `azure-deploy` に委譲するため |
| Functions runtime、trigger、binding、language、extension references | Azure Functions Skills | Functions 固有の domain knowledge であり、`azure-functions-common` の reference routing と相性がよいため |
| Diagnostics、health、inventory、best practices、upgrade、Functions-specific migration、testing、performance tuning | Azure Functions Skills | Day 1+ の Functions 固有価値であり、runtime / trigger / binding evidence が必要なため |
| Lambda to Functions などのクロスクラウド移行 | 主担当は Azure Skills | `azure-cloud-migrate` が cross-cloud scenario 全体を持つため。Functions 固有の target validation は Azure Functions Skills と連携する |
| Agent / plugin / workspace setup and routing | Azure Functions Skills | `functions-copilot` agent、workspace-local setup、plugin payload がこの repo の責務であるため |

## Contributor 判断基準

変更内容が次のいずれに近いかで contribution 先を決めます。

| 追加・修正したい内容 | Contribution 先 |
| --- | --- |
| `azd up`、`azd deploy`、`az deployment`、Terraform apply、Bicep deploy | Azure Skills |
| deployment plan、validation proof、pre-deploy checklist、RBAC verification | Azure Skills |
| Azure resource provisioning、region selection、subscription、resource group、quota、汎用 Azure 認証 | Azure Skills |
| Azure Functions Core Tools、`host.json`、`local.settings.json`、`FUNCTIONS_WORKER_RUNTIME` | Azure Functions Skills |
| Functions language worker、programming model、extension bundle、trigger indexing、binding resolution | Azure Functions Skills |
| HTTP / Timer / Blob / Queue / Service Bus / Event Hubs / Cosmos DB / Durable trigger behavior | Azure Functions Skills |
| Official Azure Functions MCP template discovery or Functions project composition | Azure Functions Skills |
| 複数 Azure サービスにまたがる汎用的な「この app を Azure に deploy したい」 | Azure Skills |
| `functions-copilot` からの「この Azure Functions app を deploy したい」 | 入口は Azure Functions Skills。実行は Azure Skills に委譲する |
| IaC、`azd`、RBAC、resource group、Azure provisioning が原因の deployment failure | 原則 Azure Skills |
| Functions host、runtime setting、worker、trigger、binding、app settings、telemetry が原因の deployment failure | 原則 Azure Functions Skills |
| 汎用 Azure compliance、governance、security、cost review | Azure Skills |
| Functions-specific production readiness, scale, hosting plan, trigger / binding, observability, or language guidance | Azure Functions Skills |
| Programming model migration、runtime version migration、.NET in-process to isolated、extension bundle migration などの Functions 固有 migration | Azure Functions Skills |
| Lambda-to-Functions migration assessment and code conversion | 主担当は Azure Skills。必要に応じて Functions 固有 guidance を利用する |

## 委譲契約

### `azure-functions-deploy`

`azure-functions-deploy` は Azure Functions 向けの deployment entry point です。この skill は次の責務を持ちます。

1. Workspace が Azure Functions project であることを確認する。
2. Runtime、hosting plan preference、trigger shape、endpoint verification guidance、Application Insights expectations、Flex Consumption guidance など、Functions 固有の deployment context を集める。
3. Azure Skills を deployment engine として使う。
   - Plan がない場合: documented shortcut が適用される場合を除き、`azure-prepare` を invoke する
   - Plan が未検証の場合: `azure-validate` を invoke する
   - Plan が検証済みの場合: `azure-deploy` を invoke する
4. Azure Skills が対応できず、かつユーザーが明示的に fallback を承認した場合を除き、`azd up`、`azd deploy`、Terraform apply、`az deployment`、`func azure functionapp publish` などの deployment command を直接実行しない。
5. Deployment 後の verification は `azure-deploy` に任せ、その後に `azure-functions-health-status`、`azure-functions-diagnostics`、`azure-functions-best-practices` など Functions 固有の next step を追加する。

### Azure Skills

Azure Skills は、Azure compute target の 1 つとして Azure Functions を引き続き support します。ユーザーが Azure Skills だけを install している場合があるためです。ただし、Azure Functions Skills が install されている場合、またはユーザーが `functions-copilot` を使っている場合、Functions 固有の create / deploy / diagnose / review intent は、まず `azure-functions-*` skills から入るべきです。

Azure Skills は共通 deployment contract を担当します。

```text
azure-prepare -> azure-validate -> azure-deploy
```

Azure Functions Skills は Functions-facing contract を担当します。

```text
functions-copilot -> azure-functions-deploy -> azure-prepare -> azure-validate -> azure-deploy
```

## `functions-copilot` の routing rules

`functions-copilot` は user intent を次のように route します。

| User intent | Route |
| --- | --- |
| Local tools の setup または prerequisites verification | `azure-functions-setup` |
| 新しい Functions project の作成、または既存 project への function 追加 | `azure-functions-create` |
| Functions app の deploy | `azure-functions-deploy` から Azure Skills に委譲 |
| Function App の production readiness、best practices、security、observability、scale、cost review | `azure-functions-best-practices` |
| Runtime errors、trigger failures、binding issues、language worker errors、telemetry、logs、Azure deployment recovery 後の deployment symptoms の診断 | `azure-functions-diagnostics` |
| 診断なしで現在の deployed app shape を収集 | `azure-functions-inventory` |
| Current health、metrics、logs、Resource Health、Activity Log、host health evidence を収集 | `azure-functions-health-status` |
| この skill suite に対する再利用可能な feedback を記録 | `azure-functions-feedback` |

User intent が Functions 固有 context を含まない汎用 Azure deployment である場合は、Azure Skills に route します。Workspace または prompt が Azure Functions を明確に示す場合は、まず Azure Functions Skills に route し、必要なときだけ共通 Azure execution を Azure Skills に委譲します。

## 将来の skill の product boundary

新しい skill が Azure Functions Skills に属するかどうかは、次の基準で判断します。

### Azure Functions Skills に置くべきもの

- Functions runtime、host、language worker、programming model、trigger、binding、extension bundle、Function App settings に依存するもの。
- Functions 固有の operational behavior を説明または修正するもの。
- Deployed functions、trigger metadata、worker runtime、host health endpoints、Functions の App Insights traces、trigger-specific metrics など、Functions 固有の evidence を必要とするもの。
- `functions-copilot` の route graph または workspace-local setup experience を改善するもの。
- Azure Functions team の知識を、agent が利用できる workflow、checklist、script、reference file に変換するもの。

例:

- `azure-functions-upgrade`
- Functions-specific migration guidance, such as programming model migration and .NET in-process to isolated worker migration
- Functions testing guidance
- Functions OpenTelemetry / observability guidance
- Functions performance and scaling tuning
- Runtime / programming model / extension bundle migration
- Trigger / binding diagnostics and best practices

### Azure Skills に置くべきもの

- Azure Functions だけでなく、複数の Azure compute services に適用されるもの。
- Azure resource creation、deployment execution、validation、IaC generation、cross-service architecture を担当するもの。
- `azure-prepare`、`azure-validate`、`azure-deploy` の behavior を変更するもの。
- Cross-cloud migration を portfolio-level workflow として扱うもの。
- 汎用 Azure governance、compliance、security、cost、RBAC、subscription、region、quota workflows を管理するもの。

例:

- Generic deployment engine improvements
- Bicep / Terraform / AZD deployment recipes
- Azure-wide resource lookup、cost、RBAC、compliance、diagnostics
- Cross-cloud migration orchestration
- Multi-service architecture planning

## 重複領域の扱い

一部の重複は自然であり、必ずしも問題ではありません。重要なのは、execution engine を重複実装しないことです。Functions 固有の context は Azure Functions Skills が wrap し、汎用 Azure workflow は Azure Skills に委譲します。

| 重複領域 | 判断 |
| --- | --- |
| Create | Azure Functions Skills が Functions project creation を担当する。Azure Skills は Azure infrastructure preparation と、Functions Skills 未導入ユーザー向け fallback を担当してよい。 |
| Deploy | Azure Functions Skills が Functions-facing entry point を担当する。Azure Skills が deployment execution を担当する。 |
| Best practices | Azure Functions Skills が Functions-specific review を担当する。Azure Skills が Azure-wide compliance、cost、governance、broad architecture guidance を担当する。 |
| Upgrade | Azure Functions Skills が Functions runtime / language / programming model / extension bundle upgrade guidance を担当する。Hosting-plan や platform migration が broader Azure upgrade workflow の一部である場合は Azure Skills が担当してよい。 |
| Diagnostics | Azure Functions Skills が Functions runtime / trigger / binding / worker diagnosis を担当する。Azure Skills が Azure resource provisioning と generic deployment failures を担当する。 |
| Migration | Programming model、runtime、language worker、extension bundle、.NET in-process to isolated などの Functions-specific migration は Azure Functions Skills が担当する。Lambda-to-Functions などの cross-cloud migration orchestration は Azure Skills が担当し、target Functions validation と post-migration operational guidance は Azure Functions Skills と連携する。 |

## 推奨 repo updates

この boundary を保つために、次の files を整合させます。

- `templates/agents/functions-copilot.agent.md`: routing と delegation rules を含める。
- `templates/skills/azure-functions-deploy/SKILL.md`: Azure Skills delegation model を明示し続ける。
- `templates/skills/azure-functions-common/references/routing.md`: Functions-specific reference routing を focused and small に保つ。
- Azure Skills `azure-prepare` specialized routing: Azure Functions Skills が install されている場合は `azure-functions-*` が preferred entry point であることを記載する。
- Azure Skills Functions references: Azure Functions Skills に属する深い runtime / trigger / binding diagnostics を重複させない。

## まとめ

Boundary は次のように説明します。

> Azure Skills は、共通 Azure deployment と platform workflows を担当する。Azure Functions Skills は、Azure Functions 固有の agent experience、domain knowledge、diagnostics、reviews、routing を担当する。両方が必要な場合、Azure Functions Skills が Functions context を集め、共通 Azure execution を Azure Skills に委譲する。
