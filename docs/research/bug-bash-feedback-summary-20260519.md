# Azure Functions Skills Bug Bash Feedback Summary

Date: 2026-05-19  
Scope: bug bash conversation notes in `azure-functions-skills-bug-bash.md` and GitHub issues #68 and later in `Azure/azure-functions-skills`.

## 1. Executive Summary

今回の bug bash で集まったフィードバックは、単なる個別バグ修正ではなく、Azure Functions Skills をどのような責務を持つ skill suite として育てるか、という設計上の論点が中心だった。

全体として、Azure Functions に特化した Copilot/agent skills の方向性は好意的に受け止められている。特に、Azure Functions team が持つドメイン知識を、作成、診断、ベストプラクティス、アップグレード、運用レビューの形で agent に渡せることには価値がある、という認識が共有された。一方で、Azure Skills との重複、plugin install の UX、skill の多さによる routing の不透明さ、品質評価の難しさが大きな課題として挙がっている。

最重要テーマは次の 5 つに集約できる。

1. Azure Skills と Azure Functions Skills のスコープ境界を明確化する。
2. 100 個以上の skill が見える環境でも、正しい skill が選ばれる routing/agent 体験を作る。
3. install、reload、account、plugin/CLI 差分など、導入 UX の摩擦を減らす。
4. Functions team の推奨知識を、best practices、diagnostics、upgrade、testing、observability などの実用 skill に落とし込む。
5. E2E と agent-based eval を組み合わせ、非決定的な LLM 出力でも品質を継続的に評価できる仕組みを作る。

## 2. Input Sources

- Local bug bash notes: `azure-functions-skills-bug-bash.md`
- GitHub issues reviewed: #68 through #79
- GitHub issue comments: none were returned for #68 through #79 at the time of collection.

## 3. Overall Sentiment

### Positive Signals

- Azure Functions 専用の skill suite を持つこと自体は、複数参加者から肯定的に見られている。
- 汎用 Azure Skills では拾いきれない Functions-specific な設計、移行、診断、ベストプラクティスに価値がある。
- workspace-local な CLI/setup 体験は、global plugin よりも競合を避けやすく、方向性として評価されている。
- 「skill そのもの」よりも「Azure Functions team の知識を agent が利用できること」が本質的価値だ、という理解が強い。

### Main Concerns

- Azure Skills と Azure Functions Skills の境界が不明確で、create/deploy/best-practices/upgrade のような領域で重複や競合が起きる。
- plugin install が global に効くため、ユーザーが意図しない skill routing や skill 衝突に遭遇する可能性がある。
- install 手順や reload 要否がわかりにくく、特に GitHub Copilot CLI、VS Code、EMU/個人アカウント、plugin/CLI の体験差が混乱を生んでいる。
- skill が増えるほど discoverability よりも selection/routing の問題が大きくなる。
- LLM skill の品質評価は非決定的であり、通常の unit test だけでは十分ではない。

## 4. Detailed Discussion Notes

### 4.1 Scope: Azure Skills vs Azure Functions Skills

最も重要な論点は、Azure Skills と Azure Functions Skills の責務分担である。参加者の意見として、Azure Functions 専用 skill を分離することには価値があるが、汎用 Azure Skills と同じ領域を二重実装すると、ユーザーも agent も混乱するという指摘があった。

特に `create`、`deploy`、`best practices`、`upgrade` は Azure Skills 側にも近い概念が存在する。Azure Functions Skills は、Azure 全般の一般論ではなく、Functions 固有の runtime、trigger/binding、language worker、hosting plan、scale behavior、diagnostics、migration path に寄せるべきだ、という方向性が見えている。

Madhura の整理として、Day 0 の作成や汎用 deployment preparation は Azure Skills に寄せ、Day 1+ の troubleshooting、upgrade、comparison、operational review は Azure Functions Skills が強く担当する、という考え方が重要である。この分担により、Azure Functions Skills は「Functions 固有の深い判断」を提供し、汎用 Azure Skills は共通 Azure platform workflow を担う、という補完関係にできる。

推奨される方向性は、明確な境界と routing contract を文書化することである。Functions-specific な問いは Functions Skills が直接処理し、共通 Azure pattern は Azure Skills へ redirect または delegate する。たとえば Consumption から Flex Consumption への hosting plan migration は Azure Skills の `azure-upgrade` が既に扱うなら、Functions 側の upgrade skill はそこへ route する設計が望ましい。

### 4.2 Routing and Skill Collision

skill が増えるほど、ユーザーにとっての問題は「skill を見つけられるか」だけではなく、「正しい skill が選ばれるか」になる。bug bash では、100 個以上の skill が見える状況や、Functions 系と汎用 Azure 系の skill が混在する状況が指摘された。

この状態では、Copilot がどの skill を選ぶかが不透明になり、ユーザーはなぜその回答になったのかを理解しにくい。plugin が global にインストールされる場合、別 workspace や別 task でも意図せず skill が routing 候補に入るため、衝突や誤選択が起きやすい。

Lily らの観点として、agent が router として機能し、visible な skill を agent や workspace の context によって絞る設計が必要である。現在の CLI/setup アプローチは workspace-local に skill を配置できるため、global plugin の副作用を減らせる点で評価されている。

今後は、`functions-copilot` agent がどの user intent をどの skill に route するかを、routing table として明文化し、必要に応じて Azure Skills への delegation も含めるべきである。

### 4.3 Installation and Onboarding UX

install UX は大きな摩擦点として挙がった。特に GitHub Copilot CLI の plugin install において、自然言語に見える `copilot plugin marketplace add ...` が agent prompt として解釈され、不要な skill routing が発生して install が遅くなる、という issue #69 が作成されている。

期待される体験は、install が direct command として実行され、無関係な skill resolution を起こさないことである。そのため README などの手順は `/plugin marketplace add Azure/azure-functions-skills` のような slash command 形式に更新する必要がある。

また、install 後に reload/restart が必要な場合にそれが明示されない、skills list に反映されない、EMU と個人アカウントで挙動が異なる、CLI と plugin の体験差がある、という混乱も挙げられた。これらは feature の良し悪し以前に、初回体験で信頼を損なう可能性がある。

今後の install UX では、次の情報を明示すべきである。

- どの agent/host でどの install path を使うべきか。
- install 後に reload/restart が必要か。
- plugin install と workspace-local setup の違い。
- global plugin が他 workspace に影響する可能性。
- GitHub Copilot CLI、VS Code、Claude Code、Codex での差分。

### 4.4 Discoverability: VS Code, Portal, Marketplace

skill をどこで発見し、どこから使うのかも未整理である。候補として、VS Code extension への統合、Azure Portal Copilot への統合、marketplace/plugin からの導入、CLI setup などが挙がっている。

ただし、この議論の本質は単なる露出面の増加ではない。露出が増えるほど、skill の重複と routing の問題も増える。そのため、discoverability の改善は routing、scope control、install guidance とセットで考える必要がある。

Azure Portal Copilot に入れる場合は、既に対象 resource context があるため inventory/health/best-practices/diagnostics と相性が良い。一方、VS Code extension 統合では local project context、code anti-pattern detection、test generation、migration assistance と相性が良い。チャネルごとに「何を主導する UI か」を分けると、導線が整理しやすい。

### 4.5 Value Proposition: Best Practices, Diagnostics, Optimization

参加者から強く支持された価値は、Azure Functions team の推奨を agent が proactive に提供することである。特に、StackOverflow や古い blog に残る outdated な知識より、Functions team の現在の推奨を参照できることが価値だという意見があった。

代表的な高価値領域は次の通りである。

- outdated な programming model や runtime version を検出し、推奨移行先を提示する。
- Python v1 model、Node.js v3 model、.NET in-process など、移行が必要な領域を明確にする。
- HTTP client misuse、connection management、Service Bus message lock、retry/concurrency 設定など、customer code anti-pattern を検出する。
- deployment 前に misconfiguration を見つける what-if/preflight 的なチェックを提供する。
- concurrency、scale、hosting plan、trigger behavior に基づく cost/performance optimization を提案する。
- event-driven architecture、Service Bus、Blob、Cosmos DB など、Functions の主用途に近い設計支援を行う。

Finbar の観点として、CRI や production incident を未然に防ぐことが非常に重要である。問題が起きた後に診断するだけでなく、bad code patterns や misconfiguration を事前に検出する仕組みが求められている。

Swapnil の観点として、Functions 利用者の churn の一因は「知らないこと」にある。ユーザーが知らない runtime behavior、binding recommendation、testing approach、observability setup を agent が補うことで、学習コストと運用リスクを下げられる。

### 4.6 Knowledge as the Asset

bug bash では、「重要なのは skill そのものではなく domain knowledge である」という認識が繰り返し出ている。skill は知識を agent に届けるための packaging であり、価値の中心は Azure Functions team が持つ operational knowledge、known issues、migration paths、best practices、source-level references である。

この観点では、知識の分散と drift が大きなリスクになる。Dobby、SRE agent、Azure Skills、Azure Functions Skills、docs repo、internal troubleshooting knowledge が別々に存在すると、同じ問いに対して異なる回答が出る可能性がある。

理想は、Functions-specific knowledge をできるだけ single source of truth に寄せ、それを複数 agent/channel から利用できるようにすることである。skill repo は、その知識を agent-consumable な workflow、checklist、reference、script に変換する場所として設計するとよい。

### 4.7 Evaluation and Quality

LLM skill の品質担保は未解決の大課題として挙がっている。通常の deterministic test と違い、agent は同じ prompt でも出力が揺れる。text-based skill の品質をどのように CI で検証するかは、今後の重要テーマである。

現在の方向性として、CLI ベースの E2E test、install から agent execution までの smoke test、出力の部分検証が進められている。一方で、過剰な E2E はコストが高く、maintenance burden も大きい。

Zach のアイデアとして、outer agent が inner agent の出力を評価する agent-based eval が挙がった。これは、単純な string assertion では評価しにくい「正しい skill を使ったか」「必要な観点を含んだか」「危険な提案を避けたか」を判定するのに有効である。

今後は、次のような layered evaluation が現実的である。

- Static validation: SKILL.md、frontmatter、references、links、agent manifests の構造検証。
- Unit/integration tests: CLI setup、plugin packaging、script behavior の deterministic test。
- E2E smoke tests: agent が skill を認識し、期待される high-level output を返すか。
- Agent-based eval: 出力品質、routing、coverage、safety を rubric で評価する。

### 4.8 Feedback Collection

フィードバックは Teams thread、meeting chat、GitHub issues、feedback skill に分散している。Madhura からは、複数の場所から集約する必要があるという指摘があった。

この分散は、bug bash のような短期イベントでは特に問題になる。重要な提案が chat に残り、issue 化されないまま失われる可能性がある。逆に issue だけを見ると、会話上の背景や優先順位が抜け落ちる。

今後は、feedback skill を使って chat/thread から issue draft を生成する、または bug bash summary を定期的に生成して GitHub issue に link するなど、単一の intake/triage flow を作るべきである。

## 5. GitHub Issues #68-#79

### #68: azure-functions-best-practices review dimensions expansion

Author: MadhuraBharadwaj-MSFT  
State: OPEN  
URL: https://github.com/Azure/azure-functions-skills/issues/68

`azure-functions-best-practices` は現状でも security、networking、identity、observability、scale などを評価できるが、full review で自動的に含めるべき重要観点が不足しているという提案である。

不足していた観点は、Node/Python の programming model version、Functions runtime version、extension bundle range、reliability posture である。Flex Consumption Node.js 22 app の full review では、zonal zone redundancy が有効であることや global DR gap が、ユーザーが明示的に聞くまで報告されなかった。

提案アクションは、`review-checklist.md` に reliability section を追加し、full/reliability scope では reliability assessment に route し、output shape に programming model、runtime、extension bundle range を明示することである。

### #69: GHCP install instructions should use slash command

Author: MadhuraBharadwaj-MSFT  
State: OPEN  
URL: https://github.com/Azure/azure-functions-skills/issues/69

GitHub Copilot CLI の install 手順で、自然言語形式の `copilot plugin marketplace add Azure/azure-functions-skills` ではなく、slash command の `/plugin marketplace add Azure/azure-functions-skills` を使うべきという提案である。

自然言語形式だと agent が通常の conversation prompt として解釈し、不要な skill routing が走って install が遅くなる。期待される install は、direct command として一発で実行され、無関係な skill resolution を起こさないことである。

README と installation documentation 全体を更新する必要がある。

### #70: New azure-functions-upgrade skill

Author: MadhuraBharadwaj-MSFT  
State: OPEN  
URL: https://github.com/Azure/azure-functions-skills/issues/70

`azure-functions-upgrade` skill を新設し、Functions 固有の upgrade workflows をまとめて案内する提案である。

対象 dimension は、language version upgrade、Consumption v1 から Flex Consumption、extension bundles、programming model upgrade、.NET in-process から isolated worker、Functions runtime v1/v2/v3 から v4 である。

重要なのは、`azure-functions-best-practices` が outdated version を検出するだけでは不十分で、ユーザーには breaking changes、dependency update、code/config changes、validation steps を含む step-by-step migration assistance が必要だという点である。

設計としては、inventory から current state を検出し、適用可能な upgrade path を提示する。Consumption v1 から Flex Consumption は Azure Skills plugin の `azure-upgrade` に route する。

### #71: SDK-type bindings recommendation

Author: swapnil-nagar  
State: OPEN  
URL: https://github.com/Azure/azure-functions-skills/issues/71

Service Bus、Blob、Cosmos DB などで、modern recommended approach として SDK-type bindings を推奨する必要があるという提案である。issue body は空だが、bug bash の event-driven optimization や binding best practices の議論と一致している。

この内容は、best-practices、create、diagnostics、common references のいずれにも影響する。古い binding pattern や非推奨 pattern を検出し、言語別の推奨 SDK-type binding guidance を出す設計が考えられる。

### #72: Functions testing skills

Author: swapnil-nagar  
State: OPEN  
URL: https://github.com/Azure/azure-functions-skills/issues/72

Azure Functions の testing に関する新 skill 提案である。issue body は空だが、Functions 利用者が unit test、integration test、local emulator、trigger-specific test、CI validation をどう構成すべきかを案内する skill として価値がある。

特に、Service Bus、Storage、HTTP trigger、Timer trigger、Durable Functions など、trigger ごとに testing strategy が異なるため、Functions-specific knowledge を提供しやすい領域である。

### #73: OpenTelemetry skill for different language support

Author: swapnil-nagar  
State: OPEN  
URL: https://github.com/Azure/azure-functions-skills/issues/73

言語ごとの OpenTelemetry support を扱う新 skill 提案である。issue body は空だが、observability と Application Insights instrumentation の進化に関係する。

Functions の言語 worker ごとに OTEL setup、sampling、trace correlation、dependency tracking、logs/metrics/traces の出し方が異なるため、language-specific references と setup validation を持つ skill が有効と考えられる。

### #74: SCM publishing credentials and Entra token auth for Kudu API

Author: FinVamp1  
State: OPEN  
URL: https://github.com/Azure/azure-functions-skills/issues/74

Kudu VFS API を使って deployed content を検証する際、SCM basic auth publishing credentials が有効かどうかを事前に確認し、無効な場合は Entra ID token-based authentication に fallback すべきという具体的な診断改善である。

現状では、SCM basic auth が disabled の Function App に対して `az webapp deployment list-publishing-credentials` で取得した publishing credentials を使い、Kudu VFS API call が 401 Unauthorized になるケースがある。

期待動作は、`basicPublishingCredentialsPolicies` を確認し、SCM credentials が disabled なら App Service audience の Entra token を使うことである。影響範囲は diagnostics、inventory、health-status scripts、inventory scripts、関連 references である。

### #75: EOL language migration skill

Author: swapnil-nagar  
State: OPEN  
URL: https://github.com/Azure/azure-functions-skills/issues/75

End-of-life language version からの migration を扱う新 skill 提案である。issue body は空だが、#70 の `azure-functions-upgrade` と強く関連する。

独立 skill として作るより、まずは `azure-functions-upgrade` の language EOL dimension として統合し、必要なら後で分割するのが自然である。best-practices で EOL を検出し、upgrade skill へ route する導線が重要になる。

### #76: Performance and scaling configurations based on customer scenarios

Author: swapnil-nagar  
State: OPEN  
URL: https://github.com/Azure/azure-functions-skills/issues/76

customer scenario に基づいて performance と scaling configuration を提案する新 skill である。issue body は空だが、bug bash で強く支持された cost optimization、concurrency tuning、scale behavior、event-driven design と重なる。

この skill は、hosting plan、trigger type、message rate、cold start tolerance、concurrency、timeout、retry、batch size、Service Bus lock duration、storage account behavior などを踏まえて guidance を出すものとして設計できる。

### #77: Setup should warn about outdated tool versions

Author: MadhuraBharadwaj-MSFT  
State: OPEN  
URL: https://github.com/Azure/azure-functions-skills/issues/77

`azure-functions-setup` の environment check が、tool が古い場合でも all-green を出してしまうという UX/quality issue である。たとえば Azure Functions Core Tools 4.6.0 が入っていて latest が 4.10.0 の場合でも、警告なしに check mark が表示される。

期待動作は、latest または one minor version 以内なら OK、newer version available なら warning、missing/unsupported version なら error とする tiered indicator である。warning には upgrade command を含めるべきである。

これは setup skill の信頼性に直結する。すべて green なのに実際には outdated という状態は、ユーザーに誤った安心感を与える。

### #78: Incorrect root cause attribution for invalid FUNCTIONS_WORKER_RUNTIME

Author: FinVamp1  
State: OPEN  
URL: https://github.com/Azure/azure-functions-skills/issues/78

`WorkerConfig for runtime: node27 not found` の診断で、skill が原因を `WEBSITE_NODE_DEFAULT_VERSION` と誤って解釈したという root cause attribution の修正提案である。実際の原因は `FUNCTIONS_WORKER_RUNTIME=node27` という invalid value であり、error message も worker runtime setting を示している。

期待動作は、`WorkerConfig for runtime: X` pattern を `FUNCTIONS_WORKER_RUNTIME` の検証に結びつけ、valid values を `node`、`python`、`dotnet`、`dotnet-isolated`、`java`、`powershell`、`custom` に限定して check することである。

影響範囲は diagnostics、health-status、best-practices、common references である。inventory/best-practices checks に runtime validation を追加し、diagnostic routing で error pattern を正しく map する必要がある。

### #79: Use Functions Host health check endpoints

Author: FinVamp1  
State: OPEN  
URL: https://github.com/Azure/azure-functions-skills/issues/79

`azure-functions-health-status` が、metadata availability や telemetry queries だけでなく、Azure Functions Host に追加された native health check endpoints を利用すべきという提案である。

関連 endpoint は `/runtime/health`、`/runtime/health/live`、`/runtime/health/ready` である。現状は app metadata、Resource Health、Application Insights errors に依存しているが、Consumption では Resource Health が unsupported であるなど制約がある。

期待動作は、direct host health として liveness/readiness を health report に含め、telemetry analysis に fallback する前に health endpoint を確認することである。`get-functionapp-health-status.ps1/.sh` と `references/health-status-commands-and-kql.md`、output template の更新が必要である。

## 6. Consolidated Themes and Proposed Directions

### Theme A: Define the Product Boundary

Azure Functions Skills は、Azure 全般 skill の subset ではなく、Functions 固有の domain layer として位置付けるべきである。作成や deployment の共通部分は Azure Skills と連携し、Functions 固有の判断、検証、移行、診断を担当する。

Proposed direction:

- Scope matrix を作り、Azure Skills、Azure Functions Skills、shared/common の境界を明記する。
- `functions-copilot` agent の routing guidance に、Functions-specific / generic Azure / delegate to Azure Skills の判断基準を入れる。
- create/deploy/upgrade/best-practices の重複点を洗い出し、delegation pattern を決める。

### Theme B: Make Installation Boring and Predictable

install が遅い、skill が見えない、reload が必要かわからない、account によって違う、という問題は adoption を阻害する。

Proposed direction:

- README の GHCP install 手順を slash command に修正する。
- install 後の verification prompt と expected output を明記する。
- plugin と workspace-local setup の選び方を明確化する。
- reload/restart が必要な環境では、手順内で明示する。

### Theme C: Expand Best Practices from Checklist to Proactive Review

best-practices skill は、単に既知の checklist を読むだけでなく、runtime/model/bundle/reliability/identity/networking/security/observability/scale を横断して proactive に gap を見つけるべきである。

Proposed direction:

- #68 の dimensions を full review に追加する。
- #77 の outdated tool version warning を setup と best-practices の両方の観点で扱う。
- #78 の `FUNCTIONS_WORKER_RUNTIME` validation を best-practices と inventory に追加する。
- #71 の SDK-type bindings recommendation を language/binding references に追加する。

### Theme D: Build Upgrade as a First-Class Workflow

upgrade は bug bash 全体で重要な流れである。outdated/EOL を検出するだけではなく、実際に migration path を示す必要がある。

Proposed direction:

- #70 の `azure-functions-upgrade` を新設する。
- #75 の EOL language migration を upgrade skill の dimension として統合する。
- best-practices と setup から upgrade skill への route を作る。
- CV1 から Flex Consumption は Azure Skills の `azure-upgrade` へ delegate する。

### Theme E: Improve Diagnostics with Precise Evidence

diagnostics は root cause attribution の正確性が重要である。誤った設定を原因として提示すると、agent への信頼が下がる。

Proposed direction:

- #78 の worker runtime error mapping を diagnostics reference に追加する。
- #74 の Kudu auth path を scripts と docs に追加する。
- #79 の native health endpoints を health-status workflow に追加する。
- evidence-first output を徹底し、error string、setting value、expected valid values、next command を明示する。

### Theme F: Invest in Testing, Observability, Performance Skills

新 skill 案として、testing、OTEL、performance/scaling が挙がっている。これらは Functions 利用者の実務 pain に直結しており、優先度が高い。

Proposed direction:

- Testing skill は trigger-specific strategy と local/CI validation を扱う。
- OTEL skill は language-specific setup と trace/log/metric correlation を扱う。
- Performance/scaling skill は scenario-based tuning と cost optimization を扱う。

## 7. Prioritized TODO

### P0: Immediate Fixes

1. Update GHCP install documentation to slash command syntax.
   - Source: #69
   - Rationale: install UX の摩擦が大きく、修正範囲が小さい。
   - Deliverable: README、usage docs、plugin install examples の更新。

2. Add outdated-version warning behavior to `azure-functions-setup`.
   - Source: #77
   - Rationale: all-green の誤表示は setup skill の信頼性を落とす。
   - Deliverable: tiered indicator、latest/near-latest/outdated/unsupported 判定、upgrade command 表示。

3. Fix invalid `FUNCTIONS_WORKER_RUNTIME` diagnosis and validation.
   - Source: #78
   - Rationale: root cause attribution の誤りは diagnostics の信頼を直接損なう。
   - Deliverable: valid values reference、diagnostic pattern mapping、inventory/best-practices validation。

4. Add SCM publishing credentials policy check and Entra token fallback for Kudu API.
   - Source: #74
   - Rationale: real diagnostic path で 401 が発生しており、scripts/docs 両方の改善が必要。
   - Deliverable: inventory/health scripts update、auth path docs、validation for enabled/disabled SCM basic auth。

5. Add Functions Host health endpoints to health-status workflow.
   - Source: #79
   - Rationale: native liveness/readiness は direct host health evidence として価値が高い。
   - Deliverable: PowerShell/shell scripts update、health-status reference update、output template update。

### P1: Near-Term Product Improvements

6. Expand `azure-functions-best-practices` full review dimensions.
   - Source: #68
   - Rationale: full review が runtime/model/bundle/reliability を自動評価しないと、重要 gap が漏れる。
   - Deliverable: checklist update、workflow routing、report output shape update、reliability route。

7. Define Azure Skills vs Azure Functions Skills scope matrix.
   - Source: bug bash discussion
   - Rationale: 重複と routing 不透明性を減らすための前提。
   - Deliverable: docs page or design note、skill ownership table、delegate-to-Azure-Skills rules。

8. Create `functions-copilot` routing matrix and conflict guidance.
   - Source: bug bash discussion
   - Rationale: skill 数が増えるほど agent router の明文化が必要。
   - Deliverable: agent instructions update、intent-to-skill table、fallback/delegation guidance。

9. Implement initial `azure-functions-upgrade` skill skeleton.
   - Source: #70, #75
   - Rationale: outdated/EOL detection から migration guidance へ進むための中核 workflow。
   - Deliverable: SKILL.md、references、inventory integration plan、best-practices route。

10. Add SDK-type bindings recommendation references.
    - Source: #71
    - Rationale: modern binding guidance は create/best-practices/diagnostics に横断的に効く。
    - Deliverable: common references、binding checklist、language-specific notes。

### P2: Medium-Term Skill Expansion

11. Design Functions Testing skill.
    - Source: #72
    - Rationale: trigger-specific testing と CI guidance は Functions 利用者の実務課題に近い。
    - Deliverable: scope doc、sample prompts、trigger matrix、test strategy references。

12. Design OTEL/observability skill or observability expansion.
    - Source: #73 and bug bash discussion
    - Rationale: language-specific OTEL setup と trace correlation は user confusion が大きい領域。
    - Deliverable: language support matrix、setup validation、App Insights/OTEL guidance。

13. Design performance/scaling optimization skill.
    - Source: #76 and bug bash discussion
    - Rationale: cost optimization、concurrency、scale tuning は高価値で incident prevention にも効く。
    - Deliverable: scenario intake questions、hosting plan/trigger tuning matrix、cost/performance checklist。

14. Build feedback aggregation workflow.
    - Source: bug bash discussion
    - Rationale: Teams、chat、issues、feedback skill に分散した情報を失わないようにする。
    - Deliverable: feedback intake template、summary generation flow、issue draft workflow。

15. Create layered eval strategy for skill quality.
    - Source: bug bash discussion, Zach's agent-based eval idea
    - Rationale: LLM output の非決定性に対して、static/unit/E2E/agent eval を組み合わせる必要がある。
    - Deliverable: eval rubric、representative prompts、CI gating level、outer-agent evaluator prototype。

### P3: Strategic Follow-Ups

16. Investigate VS Code extension and Azure Portal Copilot integration paths.
    - Source: bug bash discussion
    - Rationale: discoverability は重要だが、routing/scope 設計とセットで扱う必要がある。
    - Deliverable: channel-specific user journeys and integration proposal。

17. Establish a Functions knowledge registry or source-of-truth plan.
    - Source: bug bash discussion
    - Rationale: Dobby、SRE agent、Azure Skills、Functions Skills、docs の knowledge drift を防ぐ。
    - Deliverable: knowledge ownership map、reference update process、shared docs/references strategy。

18. Clarify global plugin vs workspace-local setup recommendation.
    - Source: bug bash discussion
    - Rationale: global plugin は便利だが skill collision の副作用がある。
    - Deliverable: decision guide、known limitations、recommended setup per scenario。

## 8. Suggested Triage Order

最初の実行順としては、次の流れが最も現実的である。

1. #69, #77, #78, #74, #79 の concrete fixes を先に片付ける。
2. #68 の best-practices expansion を実装し、best-practices を proactive review の中核にする。
3. Azure Skills vs Azure Functions Skills の scope/routing doc を作り、今後の skill 追加判断を安定させる。
4. #70/#75 を統合した `azure-functions-upgrade` を作る。
5. #71/#72/#73/#76 を新 skill backlog として整理し、testing、observability、performance/scaling の順で設計する。
6. E2E と agent-based eval の最小 rubric を作り、今後の skill 追加に対する quality gate にする。

この順序にすると、短期的な UX/bug fix、既存 skill の価値向上、新 skill 投資、品質基盤の整備をバランスよく進められる。