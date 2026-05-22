# Copilot / Claude Code / Codex の plugin・skill scope 比較

作成日: 2026-05-21  
対象: GitHub Copilot CLI / Claude Code / OpenAI Codex

## 結論

GitHub Copilot CLI の **plugin** は、公式ドキュメント上は「プロジェクトに物理インストールする」scope は確認できませんでした。`copilot plugin install` は marketplace、GitHub repository、Git URL、local path などから install できますが、install 実体は Copilot の user config directory、つまり `~/.copilot/installed-plugins/` 配下に置かれる設計です。

ただし Copilot CLI には repository-level の `settings.json` があり、`.github/copilot/settings.json` の `enabledPlugins` と `extraKnownMarketplaces` により、repository で plugin を宣言し、利用者の CLI に自動 install / enable させる形はサポートされています。つまり「project source から install」「repository で plugin 利用を宣言」は可能ですが、「plugin を project scope に物理配置する install」は、現時点の公式 docs では確認できません。

一方で **GitHub Copilot の skill** は別物です。`gh skill install` には `--scope project|user` があり、デフォルトは `project`、デフォルト agent は `github-copilot` です。プロジェクトに共有したいものが単体 skill で足りるなら、Copilot では plugin より skill project scope の方が明快です。

Claude Code は plugin install scope が最も明確で、`user` / `project` / `local` / `managed` を公式に持ち、`claude plugin install <plugin> --scope project` が `.claude/settings.json` に書きます。Codex は repo marketplace と personal marketplace の区別があり、repo で plugin catalog を共有できますが、installed copy は `~/.codex/plugins/cache/...`、enable / disable 状態は主に `~/.codex/config.toml` に保存されます。

## Copilot plugin は project に install できるか

| 観点 | 回答 |
| --- | --- |
| plugin を project directory に物理 install | 公式 docs では未確認。install 済み plugin は `~/.copilot/installed-plugins/` 配下。 |
| project/repo から plugin を install | 可能。`copilot plugin install` は GitHub repo、repo subdirectory、Git URL、local path を source として扱える。 |
| repo で plugin を宣言 | 可能。`.github/copilot/settings.json` の `enabledPlugins` / `extraKnownMarketplaces`。repository settings は user settings と merge され、同じ key は repository が上書き。 |
| local project override | 可能。`.github/copilot/settings.local.json` は repository settings より優先し、通常 gitignored。 |
| enterprise managed | 可能。enterprise の `.github-private` repository にある `.github/copilot/settings.json` で known marketplaces と default-enabled plugins を配布できる。 |
| skill の project install | 可能。`gh skill install ... --scope project`。デフォルト scope も `project`。 |

実務上の言い換え:

- Copilot plugin: user cache に入る package。ただし repo settings で「この repo ではこの plugin を使う」と宣言できる。
- Copilot skill: project scope に実ファイルを配置できる workflow 単位。
- Azure Functions Skills のように「各 agent に同じ知識を配る」場合、Copilot では plugin + repo settings + 必要最小限の repo-local files の hybrid が現実的。

## Plugin install / enablement 方法の比較

| Agent | 方法 | scope / 効果 | メリット | デメリット |
| --- | --- | --- | --- | --- |
| GitHub Copilot CLI | `copilot plugin marketplace add` + `copilot plugin install` | user の installed plugin として追加 | 配布・更新が簡単。skills / agents / hooks / MCP / LSP / commands を bundle できる | 公式 docs 上、`--scope project` 相当は見当たらない。利用者ごとの install 状態に依存 |
| GitHub Copilot CLI | GitHub repo / repo subdir / Git URL / local path から direct install | source は repo/local、実体は user 側 | 開発中 plugin や repo 内 plugin を試せる | project に install されたわけではない。更新・有効化は user 状態 |
| GitHub Copilot CLI | `.github/copilot/settings.json` の `enabledPlugins` / `extraKnownMarketplaces` | repository shared settings | repo clone 後に標準 plugin を宣言できる。team onboarding に向く | 実体は user cache。trust / install / user environment の影響を受ける |
| GitHub Copilot CLI | enterprise-managed plugin standards | enterprise users | 管理者が marketplace と default-enabled plugin を一元管理 | enterprise 前提。project 単位の微調整とは目的が違う |
| GitHub Copilot / others | `gh skill install --agent github-copilot --scope project` | project skill | 単体 skill の共有が明快。複数 agent 向け install も `--agent` で対応 | plugin ではないため MCP / hooks / agents などを一括配布する単位ではない |
| Claude Code | `/plugin install` or `claude plugin install <plugin>` | default user | UI で中身と token cost を見て install できる | user 個人の状態に依存 |
| Claude Code | `claude plugin install <plugin> --scope project` | `.claude/settings.json` | team 全体で plugin を共有できる。公式に project scope | repo trust と user consent が絡む。plugin は高信頼コンポーネント |
| Claude Code | `--scope local` | `.claude/settings.local.json` | project 固有だが個人だけの試験に向く | 共有されない |
| Claude Code | managed settings | managed | policy と配布を強制できる。marketplace allowlist / plugin-only customization も可能 | 管理者権限・組織運用が必要 |
| Codex | `$REPO_ROOT/.agents/plugins/marketplace.json` | repo marketplace | repo に curated plugin list を置ける。team に「この repo の catalog」を提示できる | installed copy は user cache。enable 状態は user config 側 |
| Codex | `~/.agents/plugins/marketplace.json` | personal marketplace | 個人用 catalog を作れる | team 共有には向かない |
| Codex | `codex plugin marketplace add ...` | configured marketplace | GitHub / Git URL / local marketplace を追跡できる | project install というより marketplace 登録 |
| Codex | `policy.installation: INSTALLED_BY_DEFAULT` in marketplace | marketplace policy | repo catalog 側で default install 意図を表せる | 実行時の enable / trust / user config の影響を受ける |

## Skill scope の比較

| Agent | Project / repo | Local | User / personal | Managed / admin | plugin skill | 優先順位・注意点 |
| --- | --- | --- | --- | --- | --- | --- |
| GitHub Copilot CLI | `.github/skills/`, `.agents/skills/`, `.claude/skills/`。`gh skill install --scope project` も対応 | 明示的な local skill scope は目立たない。additional dirs / env / settings で拡張は可能 | `~/.copilot/skills/`, `~/.agents/skills/` | enterprise / org remote customizations は agent などで存在 | installed plugin から skill を提供 | plugin reference では project skill が user skill より先に見える。plugin skill は project/user より後ろ。skill は command より優先 |
| Claude Code | `.claude/skills/<name>/SKILL.md`。親 dir と nested `.claude/skills/` も検出 | skill visibility override は `.claude/settings.local.json`。local skill directory そのものは主流ではない | `~/.claude/skills/<name>/SKILL.md` | managed settings / enterprise skills | plugin の `skills/`。plugin skill は namespaced | docs では skill 名衝突時は enterprise > personal > project。plugin skill は `plugin-name:skill-name` で衝突しにくい |
| Codex | `$CWD/.agents/skills`, parent dirs, `$REPO_ROOT/.agents/skills` | repo 内の current directory / parent による scoped skill が local-like に働く | `$HOME/.agents/skills` | `/etc/codex/skills` と system bundled skills | plugin の `skills/` | Codex は同名 skill を merge せず、selector に複数出ることがある。initial skill list には budget がある |

## Plugin scope / install location の比較

| Agent | User | Project / repo | Local | Managed | install 実体 |
| --- | --- | --- | --- | --- | --- |
| GitHub Copilot CLI | `~/.copilot/settings.json`, `~/.copilot/installed-plugins/` | `.github/copilot/settings.json` で plugin 宣言と marketplace 追加 | `.github/copilot/settings.local.json` | enterprise `.github-private` の settings | `~/.copilot/installed-plugins/{marketplace}/{plugin}` or `_direct` |
| Claude Code | `~/.claude/settings.json` | `.claude/settings.json`。`--scope project` で書き込み | `.claude/settings.local.json`。`--scope local` | managed settings。managed plugin は read-only / update only | `~/.claude/plugins/cache`。plugin data は `~/.claude/plugins/data/{id}` |
| Codex | `~/.agents/plugins/marketplace.json`, `~/.codex/config.toml` | `$REPO_ROOT/.agents/plugins/marketplace.json` | repo marketplace 内 local source path で開発用に近い運用 | system / MDM / cloud / `requirements.toml` による managed hooks・requirements | `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/`。enable state は `~/.codex/config.toml` |

## Plugin artifacts の比較

| Artifact | GitHub Copilot CLI plugin | Claude Code plugin | Codex plugin |
| --- | --- | --- | --- |
| skills | 対応 | 対応。`skills/`, `commands/`, root `SKILL.md` | 対応。`skills/` |
| agents / subagents | 対応 | 対応。`agents/`。plugin agents は `hooks`, `mcpServers`, `permissionMode` が ignored | plugin manifest docs では agent artifact は主対象ではない。custom agents は `.codex/agents/` / `~/.codex/agents/` が中心 |
| hooks | 対応。user / project / plugin hooks を combined | 対応。多数の lifecycle event、command/http/mcp_tool/prompt/agent hook types | 対応。ただし plugin-bundled hooks は `[features].plugin_hooks = true` が必要 |
| MCP servers | 対応 | 対応。`.mcp.json` or manifest inline | 対応。`.mcp.json` / `mcpServers` |
| LSP servers | 対応 | 対応。`.lsp.json` / manifest | 公式 plugin manifest の主な fields には LSP は見当たらない |
| commands | 対応 | 対応。commands は skill として扱われる | skill と prompt invocation が中心。Claude 型 commands とは別物 |
| apps / connectors | 目立った plugin artifact としては未確認 | channels / MCP integrations はあり | `.app.json`, `apps` 対応 |
| visual assets | marketplace / metadata 用にあり得る | themes, output styles, interface 情報 | `assets/`, interface metadata |
| bin / executables | plugin command / scripts として利用 | `bin/` が PATH に追加される | hooks / MCP / app integration 経由。明示的な bin artifact は docs 上の中心ではない |
| persistent plugin data | `~/.copilot/plugin-data/` | `${CLAUDE_PLUGIN_DATA}` under `~/.claude/plugins/data/{id}` | `${PLUGIN_DATA}` / `CLAUDE_PLUGIN_DATA` compatibility |

## Discovery / precedence の整理

| Surface | Discovery / precedence |
| --- | --- |
| Copilot settings | user `~/.copilot/settings.json` < repository `.github/copilot/settings.json` < local `.github/copilot/settings.local.json` < CLI options / env。repository は user と merge し、同じ key は repository が上書き。local が repository より優先 |
| Copilot skills | plugin reference 上は project `.github/skills`, `.agents/skills`, `.claude/skills`、親 directories、user `~/.copilot/skills`, `~/.agents/skills`、plugin skills、追加 directories の順。skill は commands より優先 |
| Copilot agents | docs 間で表現差あり。config dir docs は project-level agents が personal agents より優先と説明。plugin reference の load order は user agents が先に出る箇所があるため、CLI surface と cloud/custom-agent general docs を分けて確認する必要あり |
| Copilot hooks | user, project, plugins から load され、同じ event は全 entry が combined。repository hook files は `.github/hooks/*.json`。inline settings hooks も可 |
| Copilot MCP | user-level config より project-level MCP が同名 conflict で優先。plugin / CLI additional config は docs ごとに詳細確認が必要 |
| Claude settings | managed > command line > local `.claude/settings.local.json` > project `.claude/settings.json` > user `~/.claude/settings.json`。array settings は concat / dedupe されるものがある |
| Claude skills | Enterprise > Personal > Project。plugin skills は namespaced。skill descriptions は context budget 内で listing され、full content は invocation 時に load |
| Claude subagents | Managed > `--agents` CLI flag > project `.claude/agents/` > user `~/.claude/agents/` > plugin agents。plugin agents are lowest and scoped names are used |
| Claude plugins | install scope は user / project / local / managed。project が user より優先、local は project より優先、managed は不可上書き |
| Codex AGENTS.md | global `~/.codex/AGENTS.override.md` or `AGENTS.md` を先に読み、project root から CWD まで `AGENTS.override.md` > `AGENTS.md` > fallback names を各 directory 1つずつ追加。CWD に近いほど後ろに入り、実質的に強い |
| Codex skills | repo current/parent/root `.agents/skills`, user `$HOME/.agents/skills`, admin `/etc/codex/skills`, system bundled。大きな skill set では initial list budget により description が短縮 / 一部 omitted される可能性 |
| Codex hooks | user / project / plugin / managed hooks は matching したものがすべて走る。project `.codex/` は trust が必要。plugin hooks は `[features].plugin_hooks = true` が必要 |
| Codex custom agents | built-in `default`, `worker`, `explorer`。custom agents は `~/.codex/agents/` または `.codex/agents/`。同名なら custom が built-in より優先 |

## メリット・デメリットの設計観点

| 方針 | 向いているケース | メリット | デメリット |
| --- | --- | --- | --- |
| repo-local skill | その repo 固有の workflow、薄い手順、team convention | clone した repo と一緒に version 管理できる。project scope が明確 | 複数 repo への展開や更新が手作業になりやすい |
| user-level skill/plugin | 個人 workflow、実験、複数 repo で使う personal tools | すぐ試せる。repo を汚さない | team で揃わない。再現性が弱い |
| project-declared plugin | team standard を repo に宣言したい | onboarding が楽。bundle 配布できる | trust / install / cache / user consent の差が残る |
| managed plugin/settings | enterprise policy、security guardrails、標準 plugin の強制 | governance と監査性が高い | 運用コストが高く、project ごとの柔軟性が落ちる |
| plugin + repo-local routing hybrid | Azure Functions Skills のように cross-agent で同じ domain workflow を配りたい | plugin に reusable payload、repo-local に activation / routing / pins を分けられる | 各 agent の scope と precedence 差を吸収する設計が必要 |

## hook / agent-definition / MCP / instructions を plugin に含めるべきか

結論として、これらを全部 plugin に閉じ込めるより、**plugin は再利用可能な部品、workspace-level files は有効化・制約・routing** という分担がよいです。特に user-level plugin として install される場合、常時有効な hook、MCP server、agent definition、広い instructions は、他の repository にまで影響して context pollution / tool pollution / policy pollution を起こしやすいです。

ただし「plugin に含めるべきでない」というより、**含める粒度と default enablement を絞る**のが重要です。plugin には reusable implementation を入れ、workspace 側には「この repo で使う」「この trigger で呼ぶ」「この MCP server を許可する」「この hook を有効化する」という薄い宣言を置くのが安全です。

| Artifact | plugin に含めるべきもの | workspace-level に置くべきもの | user-level install のリスク | 推奨判断 |
| --- | --- | --- | --- | --- |
| Skill | Azure Functions の作成、診断、deploy routing など、repo をまたいで再利用できる workflow | repo 固有の build / test / deploy 手順、環境名、local emulator の使い方 | skill listing に名前・説明が載り、関係ない repo でも候補に出る。説明 budget を消費する | reusable skill は plugin。repo 固有 skill は `.github/skills`, `.claude/skills`, `.agents/skills` など workspace 側 |
| Hook | 汎用的な validation runner、telemetry adapter、policy helper script など | protected path、特定 command allowlist、repo の generated file policy、local emulator 起動制御 | 予期しない repository で tool call を止める、追加 context を注入する、外部 process を走らせる | default では弱くする。plugin hook は opt-in / project-enabled / managed-enabled を基本にする |
| Agent definition / subagent | Azure Functions reviewer、diagnostics researcher のような domain specialist | repo 固有の architecture、禁止 tool、担当 directory、service boundary、チーム運用 | agent descriptions が常時候補に入り、自動 delegation の誤爆や tool policy の混乱が起きる | reusable specialist は plugin。repo 固有 agent は workspace。plugin agent は低優先・namespaced を前提にする |
| MCP server config | Azure MCP / docs MCP のような標準 connector の template、起動 wrapper | subscription、resource group、local endpoint、secret env、承認済み tool subset | tool list が膨らむ。外部 system への接続が全 repo に見える。認証・権限 scope が曖昧になる | plugin は server definition の template まで。enablement と secrets は project/local/user/managed settings 側 |
| CLAUDE.md | 原則 plugin には置かない。Claude Code docs でも plugin root の `CLAUDE.md` は project context として load されない | `.claude/CLAUDE.md`, `CLAUDE.md`, `CLAUDE.local.md` など、その repo の常時規約 | user/plugin 経由で常時 instructions を注入すると全 repo の会話に混ざる | workspace-level に置く。plugin は必要なら skill として instruction を提供する |
| AGENTS.md | 原則 plugin には置かない。Codex の `AGENTS.md` は global / project instruction chain のための file | repo root / nested directory の `AGENTS.md` / `AGENTS.override.md` | global `AGENTS.md` 相当は全 repo に効くため、domain-specific だと強い汚染源になる | workspace-level に置く。plugin は `.agents/skills` や repo marketplace で補助する |
| Copilot custom instructions | plugin payload より repo settings / repo instruction files が適切 | `.github/copilot-instructions.md`, `AGENTS.md`, `.github/copilot/settings.json` | personal instructions と混ざると repository convention と衝突しやすい | repo convention は workspace。plugin は workflow skill / agent / hook として提供 |

### Context pollution の種類

| 種類 | 何が起きるか | 主な原因 | 対策 |
| --- | --- | --- | --- |
| Instruction pollution | 関係ない repo でも Azure Functions 前提の規約や手順が常時入る | user-level `CLAUDE.md`, `AGENTS.md`, broad custom instructions | 常時 instructions は workspace-level。plugin は skill の progressive disclosure に寄せる |
| Skill listing pollution | skill 名・説明が候補として増え、agent が誤って使う / budget を使う | user-level skills / plugin skills の入れすぎ | description を狭くする。manual-only / disable implicit invocation を使う。repo-specific skill は repo に置く |
| Tool pollution | MCP tools / LSP / commands が増え、tool selection と承認が複雑化する | user-level MCP / plugin MCP の常時 enable | MCP は project/local/managed で enable。tool allowlist を絞る |
| Hook pollution | どの repo でも lifecycle script が動き、tool call を止めたり追加 context を入れる | user-level hooks / plugin hooks の常時 enable | hook は project policy として repo に置く。plugin hook は opt-in、Codex は `plugin_hooks` gate を活用 |
| Agent pollution | specialist agent が関係ない作業で候補化・自動 delegation される | user-level / plugin-level agent definitions の過多 | agent description を狭くする。repo-specific agent は workspace。plugin agent は namespaced / low priority 前提 |

### Skill listing pollution を抑える具体策

`description を狭くする`、`manual-only / disable implicit invocation を使う`、`repo-specific skill は repo に置く` は、skill が関係ない場面で自動選択されることを減らすための技法です。どれも「skill をなくす」のではなく、agent が見る候補集合と trigger 条件を小さくするための設計です。

| 技法 | 目的 | GitHub Copilot CLI | Claude Code | Codex |
| --- | --- | --- | --- | --- |
| `description` を狭くする | implicit invocation の誤爆を減らす | 使える。skill description は自動選択の材料になる | 使える。`description` / `when_to_use` が skill listing に載る | 使える。`description` が implicit invocation の主要材料になる |
| 「使わない場面」を description に書く | 広い keyword match を避ける | 使える | 使える | 使える |
| manual-only skill にする | deploy / publish / destructive operation を勝手に走らせない | skill 単位の公式 frontmatter は未確認。明示 invocation と狭い description、`disabledSkills` 運用が中心 | `disable-model-invocation: true` が使える | `agents/openai.yaml` の `policy.allow_implicit_invocation: false` が使える |
| repo-specific skill を repo に置く | 他 repo への context pollution を避ける | `.github/skills/`, `.agents/skills/`, 必要に応じて `.claude/skills/` | `.claude/skills/<name>/SKILL.md` | `.agents/skills/<name>/SKILL.md` |
| user/plugin skill にしない | 個別 repo の環境名・deploy 手順を他 repo に漏らさない | 推奨 | 推奨 | 推奨 |

#### `description` を狭くする

Skill は多くの agent で、まず skill 名と `description` を一覧として context に載せ、依頼内容と合うものを選びます。したがって `Helps with Azure Functions` のような広い説明は、Azure Functions という単語が出ただけで拾われやすくなります。

広すぎる例:

```yaml
description: Helps with Azure Functions.
```

狭い例:

```yaml
description: Use when diagnosing Azure Functions deployment failures, trigger indexing errors, or runtime startup failures. Do not use for creating a new function app or general Azure questions.
```

狭くする時の観点:

- 使う症状・入力・成果物を具体的に書く。
- 使わない場面も短く書く。
- `Azure` や `Functions` だけの広い keyword に依存しない。
- create / deploy / diagnostics / best practices のように skill を分ける。

これは GitHub Copilot CLI、Claude Code、Codex のすべてで有効です。

#### manual-only / disable implicit invocation

Manual-only は、ユーザーが明示的に呼んだ時だけ skill を使わせる設計です。副作用のある workflow、たとえば deploy、publish、Azure resource 作成、削除、外部送信、production 設定変更には特に重要です。

Claude Code では `SKILL.md` frontmatter に `disable-model-invocation: true` を置けます。

```yaml
---
name: deploy
description: Deploy the current application to production. Use only when the user explicitly requests deployment.
disable-model-invocation: true
---

Deploy the application following the project deployment checklist.
```

Codex では `SKILL.md` そのものではなく、追加 metadata の `agents/openai.yaml` で implicit invocation を止めます。

```yaml
policy:
   allow_implicit_invocation: false
```

GitHub Copilot CLI では、今回確認した公式 docs の範囲では、Claude Code の `disable-model-invocation` や Codex の `allow_implicit_invocation: false` に相当する skill 単位の明確な frontmatter は確認できていません。したがって Copilot では次の組み合わせが現実的です。

- `description` を狭くする。
- 危険な skill を user/plugin ではなく project scope に置く。
- 不要な skill は user settings の `disabledSkills` で抑える。
- deploy などは slash command / explicit invocation 前提の説明に寄せる。

#### repo-specific skill は repo に置く

Repo-specific skill とは、その repository の build、test、deploy、local emulator、resource naming、architecture、generated file policy などを前提にした skill です。これは user-level plugin や user-level skill に入れると、別 repository でも候補に出て context pollution になります。

Repo-specific な内容の例:

- この repo の `npm run test:e2e` 手順。
- この repo の Azure resource group / environment 名。
- この repo の local emulator 起動方法。
- この repo の deployment slot / staging rule。
- この repo の generated files や edit 禁止 path。
- この repo の service boundary や architecture 前提。

置き場所の目安:

| Agent | repo-specific skill の置き場所 |
| --- | --- |
| GitHub Copilot CLI | `.github/skills/`, `.agents/skills/`, 必要なら `.claude/skills/` |
| Claude Code | `.claude/skills/<skill-name>/SKILL.md` |
| Codex | `.agents/skills/<skill-name>/SKILL.md` |

設計上は、plugin skill と repo skill を次のように分けるのが安全です。

| 種類 | 置き場所 | 例 |
| --- | --- | --- |
| plugin skill | plugin | Azure Functions の一般的な create、diagnostics、best practices、deploy routing |
| repo skill | workspace | この repo の build/test/deploy 手順、local emulator、resource naming |
| manual-only skill | Claude Code / Codex では metadata で制御。Copilot は description と配置で制御 | production deploy、publish、resource 作成・削除、外部送信 |
| narrow-description skill | plugin または workspace | 読み取り中心・診断中心で、自動選択されても安全な workflow |

### Agent 別の含め方

| Agent | plugin に入れるとよいもの | workspace に置くとよいもの | 注意点 |
| --- | --- | --- | --- |
| GitHub Copilot CLI | reusable skills、汎用 custom agents、optional hooks、MCP/LSP config templates | `.github/copilot/settings.json` の plugin enablement、`.github/hooks/*.json`、`.github/skills`、repo instructions | plugin install 実体は user cache。repo-specific hook / instruction は plugin より repo files の方が予測しやすい |
| Claude Code | skills、agents、hooks、MCP、LSP、monitors など reusable bundle | `.claude/settings.json` で project plugin enablement、`.claude/skills`、`.claude/agents`、`.mcp.json`、`CLAUDE.md` | Claude は project/local/managed plugin scope が強い。とはいえ plugin root `CLAUDE.md` は context として load されないので、常時規約は workspace memory に置く |
| Codex | skills、MCP config、apps、assets、optional hooks | `.agents/plugins/marketplace.json`、`.agents/skills`、`.codex/config.toml`、`.codex/hooks.json`、`AGENTS.md` | plugin hooks は `[features].plugin_hooks = true` が必要。AGENTS.md は project instruction chain なので plugin ではなく repo に置く |

### 判断ルール

1. **常時効くものは workspace-level を優先する**  
   `CLAUDE.md`、`AGENTS.md`、Copilot instructions、repo-specific hooks は、その repository の契約です。user-level plugin から常時注入すると他 repository へ漏れます。

2. **再利用可能だが重いものは plugin に入れ、必要時だけ load する**  
   長い診断手順、deployment workflow、Azure Functions best practices は skill として plugin に入れるのが向きます。skill は通常、説明だけが listing され、本文は invocation 時に load されます。

3. **side effect を持つものは project/local/managed で明示 enable する**  
   hooks、MCP servers、monitors、外部 command は、plugin に同梱しても default-on にしすぎない方が安全です。repo settings や local settings で enable すると、誰が・どの repo で使うかが見えます。

4. **secret / identity / cloud target は plugin に入れない**  
   subscription、resource group、connection string、function app name、local emulator endpoint は workspace local settings、environment variables、managed policy、または user prompt で扱うべきです。

5. **plugin は library、workspace files は wiring と考える**  
   plugin は「機能の実装と共通知識」、workspace は「この repository でどれを使うか」の wiring にすると、context 汚染と更新コストの両方を抑えられます。

## Azure Functions Skills への示唆

Azure Functions Skills の配布モデルは、単一の仕組みに寄せるよりも hybrid が現実的です。

1. plugin は reusable payload の配布単位にする  
   skills、agents、hooks、MCP config など、複数 repo で共通の成果物をまとめる。

2. repo-local files は activation と policy に使う  
   Copilot なら `.github/copilot/settings.json`、Claude Code なら `.claude/settings.json`、Codex なら `.agents/plugins/marketplace.json` / `.agents/skills` / `.codex` を使い分ける。

3. project install と user install を混同しない  
   Copilot plugin は特に、repo settings に宣言できても install 実体は user cache である点を README に明記した方がよい。

4. plugin artifacts の最大公約数に注意する  
   Claude Code は plugin artifact が最も広い。Codex は `.app.json` と MCP / skills / hooks に強いが、plugin hooks は opt-in。Copilot は plugin による bundle は可能だが、scope semantics は Claude より user-cache 寄り。

## 主要リファレンス

GitHub Copilot / GitHub CLI:

- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
- https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
- https://docs.github.com/en/copilot/concepts/agents/copilot-cli/comparing-cli-features
- https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-enterprise-plugin-standards
- https://docs.github.com/en/copilot/reference/hooks-reference
- https://docs.github.com/en/copilot/reference/custom-agents-configuration
- https://cli.github.com/manual/gh_skill
- https://cli.github.com/manual/gh_skill_install

Claude Code:

- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/discover-plugins
- https://code.claude.com/docs/en/plugins-reference
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/sub-agents

OpenAI Codex:

- https://developers.openai.com/codex/skills
- https://developers.openai.com/codex/plugins/build
- https://developers.openai.com/codex/hooks
- https://developers.openai.com/codex/guides/agents-md
- https://developers.openai.com/codex/subagents
