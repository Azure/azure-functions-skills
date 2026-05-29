# VS Code Skills 調査

日付: 2026-05-20
対象リポジトリ: `microsoft/vscode`
ローカルパス: `vscode/`
調査対象コミット: `0d944f4012c30d278fc803338cbdf022f2cd8ea6`（調査時点の `origin/main`）

## 調査したこと

1. どういうきっかけで Skill が実行されるのか。
2. VS Code リポジトリにはどういう Skill が格納されているのか。
3. Azure Functions に関係する Skill は存在するのか。

## 要約

VS Code / Copilot は、`SKILL.md` ファイルや extension / plugin の contribution から Skill を検出する。

Skill の実行経路は大きく 2 つある。

- ユーザーが `/create-skill` のような slash command として明示的に呼び出す。
- モデルがユーザーの依頼内容と Skill の `description` を照合し、該当すると判断して Skill を読み込む。

調査時点の tracked な VS Code リポジトリには、合計 49 個の `SKILL.md` が存在した。内訳は、リポジトリ固有 Skill、Copilot extension が contribution する Skill、Copilot extension 内の agent Skill、built-in session Skill など。

Azure Functions 専用の Skill は存在しなかった。Azure という名前を含む Skill としては `azure-pipelines` があるが、これは VS Code build 用の Azure DevOps pipeline 検証 Skill であり、Azure Functions の開発・デプロイ・診断用ではない。

## Skill が実行されるきっかけ

### 1. Slash command による呼び出し

Skill は chat 上で `/create-skill` や `/unit-tests` のような slash command として表示・実行できる。

`/` の候補には、prompt file と `user-invocable` な Skill が含まれる。Skill は既定では user-invocable だが、以下を設定すると `/` メニューに表示されない。

```yaml
user-invocable: false
```

関連する実装ポイント:

- `IPromptsService.getSlashCommands()` が workspace / user / extension-provided source から prompt file と Skill を返す。
- chat input completion 側は `userInvocable` かつ現在の session type に一致するものだけを `/` 候補として表示する。

主な関連ファイル:

- `vscode/extensions/copilot/src/platform/promptFiles/common/promptsService.ts`
- `vscode/src/vs/workbench/contrib/chat/browser/widget/input/editor/chatInputCompletions.ts`
- `vscode/src/vs/workbench/contrib/chat/common/promptSyntax/service/promptsServiceImpl.ts`

### 2. モデルによる自動 Skill 読み込み

モデルは prompt 内で Skill 一覧を見る。ユーザーの依頼が Skill の domain や `description` に一致すると、モデルは作業を始める前に Skill を読み込むよう指示される。

ただし、以下の Skill は model-triggered invocation から除外される。

- `description` がない。
- `disable-model-invocation: true` を設定している。
- 現在の session type と一致しない。
- `troubleshoot` Skill で、agent debug log file logging が無効になっている。

関連する実装ポイント:

- `computeAutomaticInstructions.ts` が `findAgentSkills()` を呼び、model-invocable な Skill を絞り込む。
- prompt に `<skills>` ブロックとして Skill の `name`、`description`、file path を注入する。
- Skill tool が有効な場合、モデルには Skill 名を指定して `skill` tool を呼ぶよう指示する。
- Skill tool が無効な場合、モデルには対象の `SKILL.md` を直接読むよう指示する。

主な関連ファイル:

- `vscode/src/vs/workbench/contrib/chat/common/promptSyntax/computeAutomaticInstructions.ts`
- `vscode/extensions/copilot/src/extension/prompts/node/agent/agentPrompt.tsx`

### 3. `skill` tool による実行

Copilot extension は language model tool として `skill` を contribution している。この tool の model description には、次の趣旨が書かれている。

- Skill は `SKILL.md` ファイルから検出される。
- ユーザーの task が利用可能な Skill に一致したら、この tool を呼ぶ。
- `/deploy` や `/test` のような slash command は Skill invocation として扱う。
- tool には Skill 名だけを渡す。

この tool は以下の設定で有効化される。

```text
config.github.copilot.chat.skillTool.enabled
```

実行時には、`skillTool.ts` が Skill 名から `SKILL.md` の URI を解決し、Skill 本文を読み込み、`<skill-context>` として返す。Skill frontmatter に `context: fork` がある場合は、inline context として返すのではなく subagent に委譲する。

主な関連ファイル:

- `vscode/extensions/copilot/package.json`
- `vscode/extensions/copilot/src/extension/tools/node/skillTool.ts`

## Skill の検出場所

VS Code は複数の場所から Skill を検出する。

| Source | Pattern |
| --- | --- |
| Repository, Copilot convention | `.github/skills/<name>/SKILL.md` |
| Repository, agents convention | `.agents/skills/<name>/SKILL.md` |
| Repository, Claude convention | `.claude/skills/<name>/SKILL.md` |
| User, Copilot convention | `~/.copilot/skills/<name>/SKILL.md` |
| User, agents convention | `~/.agents/skills/<name>/SKILL.md` |
| User, Claude convention | `~/.claude/skills/<name>/SKILL.md` |
| Environment / configured directories | `COPILOT_SKILLS_DIRS` または `chat.agentSkillsLocations` |
| Extension contribution | `contributes.chatSkills` |
| Agent plugins | `<pluginRoot>/skills/<name>/SKILL.md` |
| Built-in session Skills | `src/vs/sessions/skills/<name>/SKILL.md` |

Skill frontmatter では、たとえば以下のフィールドを使える。

```yaml
---
name: skill-name
description: What and when to use this Skill.
argument-hint: Optional hint shown for slash invocation
user-invocable: true
disable-model-invocation: false
context: inline
---
```

`context: fork` は `skill` tool の特殊モードで、Skill を inline context として返さず、subagent 経由で実行するために使われる。

## VS Code リポジトリ内の tracked Skill

調査には以下を使った。

```bash
git ls-files '*SKILL.md'
```

tracked な Skill の合計: 49

補足: `vscode/waza/` は `microsoft/vscode` repo 内では untracked だったため、この一覧から除外した。

### Repository Skills: `.github/skills`

| Skill | Purpose |
| --- | --- |
| `accessibility` | VS Code UI contribution 向けの accessibility guidance。 |
| `add-policy` | VS Code configuration policy の追加・変更・レビュー。 |
| `author-contributions` | 特定 author が branch 上で変更した file を trace する。 |
| `auto-perf-optimize` | VS Code の performance / memory investigation を agent 駆動で実行する。 |
| `azure-pipelines` | VS Code build 用 Azure DevOps pipeline 変更を検証する。 |
| `chat-customizations-editor` | Chat Customizations editor の作業用。 |
| `chat-perf` | chat performance benchmark と memory check を実行する。 |
| `code-oss-logs` | Code OSS dev build の log を探して読む。 |
| `component-fixtures` | screenshot testing 用 component fixture の作成・更新。 |
| `cpu-profile-analysis` | V8 / Chrome CPU profile と DevTools trace file を解析する。 |
| `fix-ci-failures` | PR の CI failure を調査して修正する。 |
| `fix-errors` | VS Code error telemetry dashboard 上の unhandled error を修正する。 |
| `heap-snapshot-analysis` | heap snapshot を解析し、memory leak や retainer を調査する。 |
| `hygiene` | VS Code の hygiene check に通るよう変更を確認する。 |
| `integration-tests` | VS Code integration test を実行する。 |
| `memory-leak-audit` | event listener、Disposable、lifecycle code の leak を監査する。 |
| `otel` | Copilot Chat の OpenTelemetry instrumentation を扱う。 |
| `sessions` | Agents window architecture と session feature の作業用。 |
| `tool-rename-deprecation` | built-in tool reference を rename するとき backward compatibility を保つ。 |
| `unit-tests` | VS Code unit test を実行する。 |
| `update-screenshots` | CI から screenshot baseline を取得して commit する。 |
| `vscode-dev-workbench` | vscode.dev を local で起動し、workbench / Agents window を操作する。 |

### Repository Agent Skills: `.agents/skills`

| Skill | Purpose |
| --- | --- |
| `launch` | Playwright / CDP を使って Code OSS を起動・自動操作する。 |

### Copilot Extension Contributed Skills

`vscode/extensions/copilot/package.json` の `contributes.chatSkills` で宣言されている Skill。

| Skill | Purpose |
| --- | --- |
| `agent-customization` | chat customization file の作成・更新・レビュー・修正・debug。 |
| `chronicle` | Copilot session history を使った standup、tips、search、reindex。 |
| `create-agent` | custom `.agent.md` file を作成する。 |
| `create-hook` | agent lifecycle event 用 hook JSON file を作成する。 |
| `create-instructions` | `.instructions.md` file を作成する。 |
| `create-prompt` | reusable `.prompt.md` file を作成する。 |
| `create-skill` | reusable `SKILL.md` workflow を作成する。 |
| `get-search-view-results` | VS Code Search view の現在の search result を取得する。 |
| `init` | chat customization file を生成・更新する。 |
| `install-vscode-extension` | extension ID から VS Code extension をインストールする。 |
| `project-setup-info-context7` | Context7-backed setup guidance で complete project を scaffold する。 |
| `project-setup-info-local` | local setup guidance で complete project を scaffold する。 |
| `troubleshoot` | debug log を使って予期しない chat agent behavior を調査する。 |

### Copilot Extension Agent Skills

| Skill | Purpose |
| --- | --- |
| `anthropic-sdk-upgrader` | Anthropic SDK package の upgrade と migration issue 対応。 |
| `github-copilot-upgrader` | GitHub Copilot CLI / SDK の更新。 |
| `launch` | Copilot Chat 付き VS Code Insiders を起動・自動操作する。 |

### Built-In Session Skills

| Skill | Purpose |
| --- | --- |
| `act-on-feedback` | 現在の session に attached された user feedback に対応する。 |
| `commit` | session changes を AI-generated commit message で commit する。 |
| `create-draft-pr` | 現在の session changes から draft PR を作成する。 |
| `create-pr` | 現在の session changes から PR を作成する。 |
| `generate-run-commands` | session Run button 用の run command を生成・変更する。 |
| `merge` | topic branch を base branch に merge する。 |
| `sync-upstream` | stale session branch を latest origin に rebase する。 |
| `sync` | session branch の sync、pull、rebase、push、publish、upstream 設定を行う。 |
| `update-pr` | 既存 PR に新しい変更を push する。 |
| `update-skills` | 重要な学びがあったとき repository Skill / instruction を作成・更新する。 |

## Azure Functions 関連の有無

tracked な `SKILL.md` に対して以下を検索した。

```bash
git grep -n -i -E "azure functions|azure function|function app|serverless|azure functions" -- '*SKILL.md'
git grep -n -i -E "azure|azd|function app|serverless|azure functions" -- '*SKILL.md'
```

結果:

- tracked な VS Code repo には Azure Functions 専用 Skill は存在しない。
- Function App development、Azure Functions deployment、trigger、binding、diagnostics を対象にした Skill も見つからない。
- Azure-specific な Skill は `azure-pipelines` のみで、これは VS Code build infrastructure 向け Azure DevOps pipeline validation の Skill。

## 重要ポイント

- Skill の discoverability は `description` に強く依存する。
- Slash command として表示されるかは `user-invocable` で決まる。
- モデルによる自動読み込みは `description`、session type、`disable-model-invocation` に左右される。
- Extension author は `contributes.chatSkills` で Skill を配布できる。
- 調査時点の tracked な `microsoft/vscode` repository には、Azure Functions 専用 Skill は含まれていない。
