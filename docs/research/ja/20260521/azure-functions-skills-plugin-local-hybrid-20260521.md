# Azure Functions Skills: plugin / workspace-local / hybrid 設計調査

日付: 2026-05-21
対象: Azure Functions Skills repository の GitHub Copilot / Claude Code / Codex 向け配布・起動設計

## 調査した問い

Azure Functions の skill repository を、複数の coding agent で使える形にするうえで、次の3点を整理した。

1. Global plugin として多数の skill が入ったとき、Azure Functions 用の agent / skill へ優先的に route する設計を Claude Code / Codex でどう実現するか。
2. CLI が workspace-local に展開している welcome message、prerequisite check、最初に使う skill 案内を Claude Code / Codex でどう実現するか。
3. 同じことを CLI 抜きの plugin-only でどこまで実現できるか。

結論から言うと、推奨は hybrid である。Global / user plugin は再利用可能な skill bundle として残し、workspace-local には「この repo では Azure Functions を扱う」という activation / routing / hook / policy を薄く置くのが最も安定する。Claude Code は project/local plugin scope があるため plugin-only に近い運用も可能だが、Codex は plugin hooks が opt-in かつ trust-gated なので、onboarding と deterministic routing には workspace-local の価値がかなり大きい。

## 公式資料から確認した事実

### GitHub Copilot / Agent Skills

GitHub Copilot の Agent Skills は、project skill と personal skill を持つ。project skill は `.github/skills`、`.claude/skills`、`.agents/skills` などに置ける。personal skill は `~/.copilot/skills` や `~/.agents/skills` に置ける。Copilot は `SKILL.md` の `description` を見て関連する skill を選び、選ばれたときに skill 本文を context に入れる。

Copilot CLI の custom instructions は `.github/copilot-instructions.md`、`.github/instructions/*.instructions.md`、`AGENTS.md` などを読める。root の `AGENTS.md` と `.github/copilot-instructions.md` は併用される。

参考:
- https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills
- https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions

### Claude Code

Claude Code の plugin は、skills、agents、hooks、MCP servers、LSP servers などを同梱できる。plugin manifest は `.claude-plugin/plugin.json` で、plugin root の `skills/`、`agents/`、`hooks/`、`.mcp.json` などを指せる。

重要なのは scope である。Claude Code の plugin は user だけでなく project / local / managed scope でも有効化できる。project scope は `.claude/settings.json` に保存され、team で共有できる。local scope は `.claude/settings.local.json` に保存され、gitignore される。これは「global install しかできない」という前提を少し弱める。

Claude Code の skills は `.claude/skills/<skill-name>/SKILL.md`、`~/.claude/skills/<skill-name>/SKILL.md`、または plugin の `skills/` から読まれる。`description` と `when_to_use` が routing に使われる。skill descriptions は budget 内で context に載り、budget を超えると description が短縮・省略される。設定として `skillListingBudgetFraction`、`maxSkillDescriptionChars`、`skillOverrides` がある。ただし `skillOverrides` は plugin skills には効かず、plugin は `/plugin` で管理する。

Claude Code の custom subagents は user / project / plugin で配布できる。project subagent は `.claude/agents/` に置ける。plugin subagent は namespaced identifier になる。`agent` setting を `.claude/settings.json` に置くと、その project の session default agent にできる。subagent は `skills` field で skill を preload できるため、Azure Functions router agent に必要 skill を明示的に持たせる設計ができる。

Claude Code hooks は plugin からも project settings からも構成できる。`SessionStart` などの lifecycle event があり、startup guidance や prerequisite check の入口になり得る。ただし trust と policy の影響を受けるので、project-local で有効化する場合も利用者に明示する必要がある。

参考:
- https://code.claude.com/docs/en/plugins-reference
- https://code.claude.com/docs/en/settings
- https://code.claude.com/docs/en/skills
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/discover-plugins

### Codex

Codex の skills は `.agents/skills`、`~/.agents/skills`、admin/system の locations から読まれる。Codex も progressive disclosure で、初期 context には skill name、description、path が入り、full `SKILL.md` は選択時に読む。初期 skill list の budget は context window の約 2% または不明時 8,000 chars とされ、description が先に短縮され、大量の skill があると一部 skill が初期一覧から外れる可能性がある。これは global plugin pollution の影響を受けやすい。

Codex plugin は `.codex-plugin/plugin.json` を entry point とし、`skills/`、`hooks/`、`.mcp.json`、`.app.json` などを plugin root に置ける。repo marketplace は `$REPO_ROOT/.agents/plugins/marketplace.json`、personal marketplace は `~/.agents/plugins/marketplace.json` で作れる。

Codex hooks は `~/.codex/hooks.json`、`<repo>/.codex/hooks.json` などから読まれる。project-local hooks は workspace trust が必要で、plugin bundled hooks は現在 `[features].plugin_hooks = true` を有効にしないと実行されない。`SessionStart` hook は stdout または JSON の `hookSpecificOutput.additionalContext` を developer context として追加できるため、welcome / prerequisite の技術的な入口はある。しかし plugin-only ではユーザーが plugin hooks を有効化し trust する必要があり、初回体験としては不確実である。

Codex の custom agents は `~/.codex/agents/` または `.codex/agents/` に TOML で定義できる。ただし Codex は subagent を自動では spawn せず、明示的な指示で spawn する。routing の default anchor としては `AGENTS.md` と skills の description の方が重要になる。

参考:
- https://developers.openai.com/codex/skills
- https://developers.openai.com/codex/hooks
- https://developers.openai.com/codex/plugins/build
- https://developers.openai.com/codex/guides/agents-md
- https://developers.openai.com/codex/subagents

## 現行 repository の観察

`azure-functions-skills/` はすでに hybrid に近い構造を持っている。

- canonical source は `templates/` 配下にある。
- `src/build/build-target.ts` が `ghcp`、`claude`、`codex` の workspace-local artifacts を生成する。
- `src/build/build-target.ts` が plugin payload も生成する。
- `src/setup/index.ts` の `applySetup` は、target workspace に workspace-local files をコピーし、prerequisite check を走らせる。
- `src/chat/index.ts` は selected CLI agent を起動する前に setup が済んでいなければ自動 setup し、startup prompt を渡す。
- `README.md` は plugin / chat / setup の3通りの入口を説明している。

生成される plugin payload は以下の形である。

```text
.github/plugins/azure-functions-skills/
  plugin.json
  .plugin/plugin.json
  .claude-plugin/plugin.json
  .codex-plugin/plugin.json
  skills/<skill-id>/SKILL.md
  agents/functions-copilot.agent.md
  hooks.json
  .mcp.json
```

workspace-local setup は概ね以下を生成する。

```text
GitHub Copilot:
  .github/copilot-instructions.md
  .github/agents/functions-copilot.agent.md
  .github/skills/<skill-id>/SKILL.md
  .github/hooks/welcome-setup.json
  .vscode/mcp.json
  AGENTS.md

Claude Code:
  CLAUDE.md
  .claude/settings.json
  .claude/skills/<skill-id>/SKILL.md

Codex:
  AGENTS.md
  .agents/skills/<skill-id>/SKILL.md
  .codex/config.toml
  .codex/hooks.json
```

この構成は方向性として良い。ただし、公式仕様と照らすと改善余地がある。

- Claude Code plugin manifest は `agents` を出していない。`functions-copilot` 相当の Claude subagent を plugin に入れるなら `.claude-plugin/plugin.json` に `agents` を含める必要がある。
- Claude workspace-local 出力は `CLAUDE.md` に全 skill 本文を inline 展開している。skill 本文が多くなると常時 context cost が高い。`CLAUDE.md` は routing / startup / skill map に絞り、詳細は `.claude/skills` に任せる方が Claude の progressive loading と相性がよい。
- Codex plugin manifest には `agents` が入っているが、Codex plugin docs の package structure では `skills`、`mcpServers`、`apps`、`hooks` が主な manifest fields として説明されている。Codex custom agents は `.codex/agents/` の TOML であり、plugin の `agents` field が実際に有効な配布面かは要検証である。
- `hooks.json` は GHCP / Claude / Codex plugin payload で共有されているが、Codex hooks schema は `SessionStart` の下に matcher group と hooks array を置く形で、Claude hooks も event ごとの schema がある。1つの hook file を全 host にそのまま使える前提は危険で、host-specific hook generation に分けるべきである。
- `generateCodexHooks()` が `bash -c` 前提なので Windows 体験が弱い。Codex hooks の公式例も command hook だが、Windows を support するなら node script か PowerShell fallback が必要である。

## 問題1: global plugin 下で Azure Functions skill へ優先 route する方法

### GitHub Copilot

現行の `functions-copilot.agent.md` は明確な router agent になっており、GitHub Copilot では `copilot --agent functions-copilot` や `@functions-copilot` が使える。これは維持すべきである。

workspace-local の `.github/agents/functions-copilot.agent.md` は project に anchor を置けるので、global skills が多い環境でも「この session は Azure Functions 用」と明示しやすい。

### Claude Code

Claude Code では3段階が考えられる。

1. Plugin skills only: plugin skill は namespaced なので衝突しにくい。ただし routing は description と skill listing budget に依存する。
2. Plugin agent: plugin の `agents/` に `functions-copilot` 相当を入れ、user が `@agent-azure-functions-skills:functions-copilot` または `claude --agent <scoped-name>` で使う。project `.claude/settings.json` の `agent` に設定できれば session default にできる。
3. Project-local agent/instructions: `.claude/agents/functions-copilot.md` と `CLAUDE.md` を置き、project scope の方を routing anchor にする。

推奨は、plugin には reusable skills と optional router agent を含め、workspace-local には `.claude/settings.json` で project plugin enablement / default agent を置くか、`.claude/agents/functions-copilot.md` を置く構成である。Claude Code は project/local plugin scope があるため、CLI が `claude plugin install azure-functions-skills@... --scope project` を案内または実行できるなら、workspace に skill 本体をコピーしない pinned-reference mode も現実的である。

### Codex

Codex は skill list budget が明示されており、大量 skill 下で description が落ちやすい。さらに subagent は自動 spawn されない。したがって Codex の優先 routing は plugin agent ではなく、以下の組み合わせが中心になる。

- root `AGENTS.md` に「Azure Functions ではまず azure-functions-setup / create / deploy / diagnostics に route する」と短く書く。
- `.agents/skills/<skill-id>/SKILL.md` に workspace-local の skill entries を置く、または plugin install を前提に `AGENTS.md` から namespaced skill を明示する。
- `.codex/config.toml` で不要 skill の disable や MCP policy を置く余地を作る。
- 必要なら `.codex/agents/functions-copilot.toml` を作る。ただし Codex は明示指示で subagent を使うため、初回 route の主役にはしない。

Codex では workspace-local `AGENTS.md` が一番強い anchor である。plugin-only で全 routing を任せると、skill list budget と implicit invocation の不確実性が残る。

## 問題2: welcome message / prerequisite check / initial guidance

### 現行方式

現行 CLI は `setup` で workspace-local files を置き、`chat` で startup prompt を agent CLI に渡す。これは最も確実である。特に Codex では plugin hooks が opt-in のため、`chat` が startup prompt を渡す設計は残す価値が高い。

### GitHub Copilot

`.github/hooks/welcome-setup.json` と `.github/copilot-instructions.md` の組み合わせで実現する。ただし hook support の host 差異を考えると、welcome は hook に完全依存せず、`chat` startup prompt と `azure-functions-setup` skill にも同じ情報を持たせるのがよい。

### Claude Code

選択肢は3つある。

1. `CLAUDE.md` に first-time setup guidance を置く。
2. `.claude/settings.json` の hooks に `SessionStart` hook を置く。
3. plugin hook を使う。

Claude Code では hooks と settings が project / local / user scope で扱えるので、workspace-local hook は実現しやすい。ただし plugin root の `CLAUDE.md` は project context としては読まれないため、plugin-only の場合は hook または skill / agent に guidance を持たせる必要がある。

推奨は、workspace-local `CLAUDE.md` を薄い入口にし、`SessionStart` hook は prerequisite check の deterministic context injection に使うことである。skill 本文の巨大 inline 展開は避ける。

### Codex

Codex では `.codex/hooks.json` の `SessionStart` が入口になる。stdout や JSON additionalContext を developer context に追加できるため、welcome と prerequisite 結果を渡せる。

ただし project-local hooks は trust review が必要で、plugin hooks は `[features].plugin_hooks = true` が必要である。したがって Codex の初回体験は以下が良い。

- `chat` command は startup prompt を直接渡す。
- `setup` は `.codex/hooks.json` と `AGENTS.md` を生成する。
- plugin-only の場合は「plugin hooks を有効化すると SessionStart prerequisite check が動く」と案内するが、必須導線にはしない。

## 問題3: CLI 抜き plugin-only で実行できるか

### できること

Plugin-only でも、以下は可能である。

- Skills を配布する。
- MCP server config を同梱する。
- Claude Code / Codex で hooks を同梱する。
- Claude Code では project/local plugin scope により、global install pollution をある程度避ける。
- Codex では repo marketplace を `.agents/plugins/marketplace.json` に置き、plugin の発見・install を repo に寄せられる。

### 難しいこと

Plugin-only だけでは、次が難しい。

- 「この workspace は Azure Functions の project である」という activation を安定して伝えること。
- hook を初回から確実に走らせること。Codex plugin hooks は opt-in、project hooks は trust-gated。
- prerequisite check の結果を user-visible な welcome として必ず表示すること。
- 大量 global skills の中で Azure Functions skills の description が必ず routing に残ること。Codex と Claude どちらも skill listing budget の影響がある。
- workspace の runtime / trigger / host.json 有無に応じた案内を plugin install だけで行うこと。

したがって plugin-only は「既に plugin を知っている user が reusable commands を使う」には良いが、「初回 onboarding」と「route の安定化」には不足が残る。

## 方式比較

| 方式 | 強み | 弱み | 向いている用途 |
| --- | --- | --- | --- |
| Plugin-only | skill 本体をコピーせず更新しやすい。Claude は project/local plugin scope も使える。 | 初回 activation と hooks が host 依存。Codex plugin hooks は opt-in。global skill budget の影響を受ける。 | 既存 user / reusable toolbox / managed enterprise 配布 |
| Workspace local-only | `AGENTS.md`、`CLAUDE.md`、`.github/copilot-instructions.md`、hooks で repo 固有 context を強く出せる。 | skill 本体がコピーされ、更新・drift 管理が必要。 | template repo / azd init / 初回 onboarding |
| Hybrid copy mode | 確実に動く。host ごとの差を吸収しやすい。 | skill 本体の drift と更新コストがある。 | 現行 `setup` の安定版 |
| Hybrid pinned-reference mode | plugin 本体は中央管理、workspace は activation と pin だけ。drift が少ない。 | host ごとの plugin install / trust / enablement の仕様差を扱う必要がある。 | 中期的な推奨形 |

## 推奨アーキテクチャ

### 1. Plugin payload は「reusable skill pack」に徹する

Plugin には以下を入れる。

- `skills/azure-functions-*`
- `mcpServers`
- host-specific hooks
- optional router agent
- install surface metadata

ただし plugin root の `CLAUDE.md` や generic `AGENTS.md` に頼らない。plugin は project context ではなく、invoked components を通じて効くものとして設計する。

### 2. Workspace-local activation pack を薄くする

`setup` が置く workspace-local files は、skill 本体の full copy よりも activation / routing / hook / pin に寄せる。

GitHub Copilot:

```text
.github/copilot-instructions.md
.github/agents/functions-copilot.agent.md
.github/hooks/welcome-setup.json
.vscode/mcp.json
AGENTS.md
```

Claude Code:

```text
CLAUDE.md
.claude/settings.json
.claude/agents/functions-copilot.md  # 必要なら
```

Codex:

```text
AGENTS.md
.codex/config.toml
.codex/hooks.json
.codex/agents/functions-copilot.toml  # 必要なら、明示利用向け
.agents/plugins/marketplace.json       # pinned plugin reference mode
```

skill 本体を workspace-local にコピーする copy mode は fallback として残す。plugin install が使える host では pinned-reference mode を優先する。

### 3. Router agent / instruction は host ごとに最適化する

GitHub Copilot は `functions-copilot.agent.md` を継続する。

Claude Code は plugin agent と project agent の両方をサポートする。project `.claude/settings.json` に `agent` を設定するかは opt-in にする。いきなり default agent を変えると user の通常作業を奪う可能性があるためである。

Codex は `AGENTS.md` を主役にする。custom agent は「明示的に functions-copilot agent を使う」ための補助と考える。

### 4. Hooks は host-specific に生成する

現在のように1つの `hooks.json` を plugin payload 全体で共有するのではなく、生成時に分ける。

```text
hooks/ghcp/hooks.json
hooks/claude/hooks.json
hooks/codex/hooks.json
scripts/prereq-check.mjs
```

hook command は bash one-liner ではなく Node script に寄せる。Windows / macOS / Linux で同じ挙動にし、出力 schema だけ host-specific adapter で変える。

### 5. `chat` は維持する

Plugin-only が成熟しても、`chat` は残すべきである。理由は明確で、`chat` は次を一度に保証できる。

- agent CLI の選択
- setup 済みチェック
- prerequisite check
- startup prompt の直接注入
- headless E2E の再現性

Codex のように plugin hook が opt-in の host では、`chat` が最も安定した first-run path になる。

## 具体的な次アクション

1. Claude plugin manifest に `agents` を追加するか検証する。
   - `agents/functions-copilot.agent.md` が Claude plugin agent として表示・実行できるかを E2E で確認する。
   - plugin subagent では `hooks`、`mcpServers`、`permissionMode` が無視される点を前提にする。

2. Claude workspace-local 出力を軽量化する。
   - `CLAUDE.md` に全 skill 本文を inline 展開する方式をやめ、skill map と routing guidance に絞る。
   - 詳細は `.claude/skills/<id>/SKILL.md` に残す。

3. Codex plugin manifest の `agents` field を検証する。
   - Codex docs 上は custom agents は `.codex/agents/*.toml` が中心なので、plugin manifest の `agents` が有効か確認する。
   - 有効でなければ Codex は `.codex/agents/functions-copilot.toml` を workspace-local artifact として生成する。

4. Hook 生成を host-specific に分離する。
   - `generateGhcpHooks`、`generateClaudeHooks`、`generateCodexHooks` を分ける。
   - shared prerequisite script は Node で実装し、hook はそれを呼ぶだけにする。
   - Codex hook は公式 schema に合わせて matcher group + hooks array を維持する。

5. Pinned-reference mode を設計する。
   - `setup --mode copy|pin` のようなオプションを検討する。
   - `pin` では workspace に skill 本体をコピーせず、plugin marketplace / plugin enablement / local instructions / hooks だけ置く。
   - Codex では `.agents/plugins/marketplace.json` を生成し、Claude では `.claude/settings.json` の `extraKnownMarketplaces` と `enabledPlugins` を使う。

6. Skill description の budget 対策をする。
   - 各 skill の `description` は trigger words を先頭に置く。
   - `azure-functions-common` のような shared reference skill は `user-invocable: false` や model invocation control を検討する。
   - Codex / Claude の大量 skill 環境で、Azure Functions の主要 skills が routing されるか E2E を追加する。

## 推奨するユーザー体験

### 初回 user

```bash
npx @agent-loom/azure-functions-skills chat --agent codex --dir ./my-app
```

または

```bash
npx @agent-loom/azure-functions-skills setup --agent codex --dir ./my-app
codex "set up Azure Functions"
```

初回は CLI を使わせる。welcome / prerequisites / startup guidance が最も安定するためである。

### 既存 user / team standard

```bash
codex plugin marketplace add Azure/azure-functions-skills
# install azure-functions-skills from /plugins
```

または Claude Code で project scope install を使う。

```bash
claude plugin install azure-functions-skills@<marketplace> --scope project
```

この場合も repository には薄い `AGENTS.md` / `CLAUDE.md` を置き、Azure Functions project であることと推奨 workflow を固定する。

## 最終結論

他エージェントの Hybrid 推奨は妥当である。ただし、Claude Code については project/local plugin scope が公式に用意されているため、「global plugin しかないから workspace copy が必須」とまでは言わない方がよい。Claude は pinned-reference mode に寄せやすい。

一方で Codex は、skills budget、plugin hooks opt-in、project hook trust、subagent explicit spawn という制約があるため、workspace-local `AGENTS.md` と `.codex/hooks.json` を残す価値が高い。Codex で plugin-only に寄せすぎると、まさに今回の懸念である「大量 skill の中から Azure Functions にうまく route されない」問題が再発しやすい。

したがって、この repository の次の設計目標は「copy everything の workspace setup」から「plugin 本体 + workspace activation pack」へ段階的に移行することだと考える。現行 `chat` / `setup` / plugin payload の骨格はそのまま使えるので、設計の芯はすでに良い位置にある。あとは host-specific な manifest / hooks / agent semantics をもう少し正確に分けるのが次の山である。
