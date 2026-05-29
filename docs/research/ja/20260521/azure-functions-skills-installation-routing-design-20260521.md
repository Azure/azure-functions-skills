# Azure Functions Skills インストール / ルーティング設計

作成日: 2026-05-21  
対象: GitHub Copilot CLI / Claude Code / OpenAI Codex での Azure Functions Skills 配布、workspace 適用、plugin install 導線

## 設計コンセプト

この設計の中心は、**plugin と workspace-local files の責務を分ける**ことである。

- **plugin** は、Azure Functions Skills の reusable な本体を versioned package として配るためのもの。
- **workspace-local files** は、その workspace で plugin / skills をどう使うかを決める routing、activation、policy、project-specific wiring のためのもの。

この分離が必要な理由は、plugin install だけでは「その workspace で Azure Functions workflow を優先する」「どの agent surface で route する」「MCP や hooks をどの scope で有効にする」といった project-specific な判断までは表現しきれないためである。特に Direct plugin commands で入るのは基本的に plugin payload、つまり skills pack であり、workspace 側の `CLAUDE.md`、`AGENTS.md`、Copilot agent definition、repo settings、MCP policy などは別途 apply する必要がある。

したがって推奨形は次である。

```text
plugin install         # versioned skills pack を agent に登録する
workspace apply/update # routing / activation / policy を workspace に適用する
```

この考え方により、plugin の標準性と update 管理を使いつつ、context pollution、skill overflow、誤 routing、customer-owned instructions の上書きを避けやすくなる。

設計上の原則は次の通り。

1. **plugin は原則 skills-only を default にする**  
   Copilot / Claude / Codex の全てで skill は progressive disclosure に向く。一方、MCP、hooks、agents は常時 tool / lifecycle / routing surface に影響しやすい。plugin payload に含める場合も、default install では有効化を絞り、`--include-mcp`、`--include-hooks`、`--include-agent` のような明示 opt-in にする。

2. **workspace routing は agent ごとの native surface に置く**  
   - GitHub Copilot CLI: `.github/agents/functions-copilot.agent.md` と `.github/copilot/settings.json`。
   - Claude Code: `CLAUDE.md`、必要なら `.claude/settings.json` の project plugin enablement / default agent。
   - Codex: `AGENTS.md`、必要なら `.agents/plugins/marketplace.json` と `.codex/config.toml`。

3. **Direct plugin commands の後にも workspace apply を案内する**: Direct plugin commands は agent に plugin payload を登録するだけであり、routing や MCP / hooks の workspace policy は未設定のままになる。README と CLI 出力では、Direct plugin install 後に `azure-functions-skills workspace apply --mode plugin-reference` を実行する理由と手順を明示する。

4. **CLI は install orchestrator と workspace applier を兼ねる**  
   ユーザーに agent ごとの plugin command を覚えさせるより、`azure-functions-skills plugin install` と `azure-functions-skills workspace apply` を用意し、内部で Copilot / Claude / Codex の差を吸収する。

5. **既存の customer-owned files は絶対に上書きしない**  
   `CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md` は workspace の中核設定である。CLI は managed block、include file、または fail-if-exists を選べる必要がある。

6. **`--dry-run` で透明性を担保する**: plugin install や workspace apply は、agent ごとに実行 command と変更 file が異なる。`--dry-run` は実行予定 command、生成予定 file、既存 file への merge diff、MCP / hooks / agent の opt-in 状態を表示し、何が起こるかを user / reviewer が事前に確認できるようにする。

## 最新 docs で確認した事実

### GitHub Copilot CLI

- `copilot plugin install SPECIFICATION` は marketplace、GitHub repo、repo subdir、Git URL、local path を受ける。
- installed plugin の実体は `~/.copilot/installed-plugins/...` に置かれる。
- repository settings は `.github/copilot/settings.json` で、`enabledPlugins` と `extraKnownMarketplaces` を宣言できる。
- local override は `.github/copilot/settings.local.json`。
- user / repository / local settings は cascade し、repository が user を、local が repository を上書きする。
- project-level agents / skills は plugin より優先される。plugin skills は project/user skill より後ろ。
- MCP は user-level config より plugin が強くなる場面があり、tool pollution に注意が必要。
- `gh skill install` は `--agent` と `--scope project|user` を持ち、default scope は `project`、default agent は `github-copilot`。

### Claude Code

- plugin install scope は `user` / `project` / `local` / `managed`。
- `claude plugin install <plugin> --scope project` は `.claude/settings.json` に plugin enablement を書く。
- `enabledPlugins` と `extraKnownMarketplaces` が settings に存在する。
- plugin は skills、agents、hooks、MCP servers、LSP servers、monitors、themes などを含められる。
- plugin root の `CLAUDE.md` は project context として load されない。
- plugin details は component inventory と token cost を表示できる。
- `skillOverrides`、`skillListingBudgetFraction`、`maxSkillDescriptionChars` があり、context pollution への制御が比較的進んでいる。

### Codex

- skills は repo `.agents/skills`、user `~/.agents/skills`、admin `/etc/codex/skills`、system bundled から読まれる。
- skill list は context window の約 2% または不明時 8,000 chars 程度に制限され、多すぎると description が短縮または一部 omitted される。
- `agents/openai.yaml` の `policy.allow_implicit_invocation: false` で manual-only skill にできる。
- plugin は `.codex-plugin/plugin.json`、`skills/`、`hooks/`、`.mcp.json`、`.app.json`、`assets/` を持てる。
- repo marketplace は `$REPO_ROOT/.agents/plugins/marketplace.json`、personal marketplace は `~/.agents/plugins/marketplace.json`。
- installed copy は `~/.codex/plugins/cache/$MARKETPLACE_NAME/$PLUGIN_NAME/$VERSION/`。
- enable / disable 状態は `~/.codex/config.toml` に保存される。
- plugin-bundled hooks は `[features].plugin_hooks = true` が必要。

## 採用する配布モデル

### 1. Plugin Skills Pack

目的: reusable Azure Functions workflows を versioned package として配布する。

Default payload:

```text
plugin/
  plugin.json or .plugin/plugin.json
  .claude-plugin/plugin.json
  .codex-plugin/plugin.json
  skills/
    azure-functions-setup/SKILL.md
    azure-functions-create/SKILL.md
    azure-functions-deploy/SKILL.md
    azure-functions-diagnostics/SKILL.md
    azure-functions-best-practices/SKILL.md
    azure-functions-health-status/SKILL.md
    azure-functions-inventory/SKILL.md
    azure-functions-feedback/SKILL.md
    azure-functions-common/SKILL.md
```

Default では含めない、または inactive にするもの:

```text
agents/                  # --include-agent で有効化
hooks.json / hooks/       # --include-hooks で有効化
.mcp.json                 # --include-mcp で有効化
```

理由:

- skills は説明だけが常時見え、本文は invocation 時に読むため、context pollution が比較的軽い。
- MCP は tool list を増やし、権限・認証・外部接続面が広がる。
- hooks は全 turn / lifecycle に影響し、agent ごとの trust model 差も大きい。
- agents は routing 候補を増やし、特に user-level plugin では agent pollution になりやすい。

### 2. Workspace Activation Pack

目的: 「この workspace では Azure Functions Skills をどう使うか」を明示する。

GitHub Copilot CLI:

```text
.github/copilot/settings.json          # plugin marketplace / enabledPlugins / disabledSkills optional
.github/agents/functions-copilot.agent.md
.github/copilot-instructions.md        # thin routing only
.github/hooks/welcome-setup.json       # opt-in / setup mode only
.vscode/mcp.json                       # VS Code MCP, opt-in
AGENTS.md                              # cross-agent fallback, optional
```

Claude Code:

```text
CLAUDE.md                              # thin routing only
.claude/settings.json                  # project plugin enablement / optional default agent / MCP policy
.claude/settings.local.json            # personal local opt-in, not committed
.claude/skills/                        # copy mode fallback only
```

Codex:

```text
AGENTS.md                              # primary routing anchor
.agents/plugins/marketplace.json       # repo curated plugin catalog
.codex/config.toml                     # MCP / hooks / skill policy, opt-in
.codex/hooks.json                      # setup mode only, trust-gated
.agents/skills/                        # copy mode fallback only
```

## Supported install modes

### Mode A: `chat`

想定ユーザー: 今すぐ Azure Functions workflow を開始したいユーザー。context pollution を避けたいユーザー。

`chat` は plugin install を使わない。起動前に必要な Azure Functions skills と routing files を workspace-local に install / update し、その workspace だけで見える形にしてから agent CLI を起動する。したがって user-level plugin による skill overflow や MCP / hook pollution を避けたいユーザー向けの導線である。

現行維持でよい。`chat` は次を実行する。

1. agent CLI を検出または `--agent` で指定。
2. workspace に Azure Functions skills / activation pack が無ければ、plugin を使わず workspace-local setup を実行する。
3. prerequisite check を実行。
4. startup prompt を agent CLI に渡す。
5. GitHub Copilot では `--agent functions-copilot` を付ける。

推奨コマンド:

```bash
npx @agent-loom/azure-functions-skills chat --agent github-copilot --dir ./my-app
npx @agent-loom/azure-functions-skills chat --agent claude-code --dir ./my-app
npx @agent-loom/azure-functions-skills chat --agent codex --dir ./my-app
```

追加オプション:

| Option | 意味 |
| --- | --- |
| `--agent github-copilot|claude-code|codex` | 起動する agent CLI |
| `--dir <path>` | 対象 workspace |
| `--prompt <text>` | startup prompt を上書き |
| `--workspace-mode minimal|copy|plugin-reference` | chat 前の workspace 適用方式 |
| `--skip-prerequisites` | prerequisite check を skip |
| `--check-prerequisites` | prerequisite check のみ |
| `--` | agent CLI への passthrough |

### Mode B: `setup` / `workspace apply`

想定ユーザー: plugin を入れず、workspace-local に明示的な routing と skills を置きたいユーザー。

現行 `setup` は維持。ただし意味を整理し、将来的には `workspace apply` を alias または後継にする。

```bash
npx @agent-loom/azure-functions-skills setup --agent ghcp --dir ./my-app
npx @agent-loom/azure-functions-skills setup --agent claude --dir ./my-app
npx @agent-loom/azure-functions-skills setup --agent codex --dir ./my-app
```

推奨オプション:

| Option | Default | 意味 |
| --- | --- | --- |
| `--agent ghcp|claude|codex|all` | auto | 対象 agent surface |
| `--dir <path>` | cwd | 対象 workspace |
| `--mode minimal|copy|plugin-reference` | `copy` for backward compatibility | `minimal` は routing のみ、`copy` は skills copy、`plugin-reference` は plugin 前提の routing / settings のみ |
| `--update` | false | 既存 managed block を最新化 |
| `--dry-run` | false | 書き込み予定を表示 |
| `--merge-strategy managed-block|include-file|fail-if-exists|append` | `managed-block` | 既存 `CLAUDE.md` / `AGENTS.md` との統合方式 |
| `--include-mcp` | false | workspace-level MCP を追加 |
| `--include-hooks` | false | workspace-level hooks を追加 |
| `--force` | false | conflict 時に上書き許可 |

`setup --update` は今回の方針で重要。plugin 更新だけでは workspace routing file は更新されないため、CLI が managed block を差し替える必要がある。

`workspace apply` は、Direct plugin commands の後に実行する導線としても使う。plugin を除いた workspace 分だけを適用するため、skills の二重 copy を避けられる。

```bash
npx @agent-loom/azure-functions-skills workspace apply --agent ghcp --mode plugin-reference --dir ./my-app
npx @agent-loom/azure-functions-skills workspace apply --agent claude --mode plugin-reference --dir ./my-app
npx @agent-loom/azure-functions-skills workspace apply --agent codex --mode plugin-reference --dir ./my-app
```

`--mode plugin-reference` では、workspace-local skill 本体は copy しない。代わりに、plugin を使うための thin routing、settings、marketplace reference、managed block だけを生成または更新する。

### Mode C: `plugin install`

想定ユーザー: 標準的な versioned install を使いたいユーザー。手間をかけないユーザー。

新コマンドとして追加する。

```bash
npx @agent-loom/azure-functions-skills plugin install --agent github-copilot --scope user
npx @agent-loom/azure-functions-skills plugin install --agent claude-code --scope project --dir ./my-app
npx @agent-loom/azure-functions-skills plugin install --agent codex --scope project --dir ./my-app
```

共通オプション:

| Option | Default | 意味 |
| --- | --- | --- |
| `--agent github-copilot|claude-code|codex|all` | auto | install 対象 |
| `--scope user|project|local|managed` | agent default | plugin registration scope。Copilot は `project` を repo settings 宣言として扱う |
| `--dir <path>` | cwd | project/local scope の対象 workspace |
| `--source marketplace|github|git|local|npm` | marketplace | plugin source |
| `--version <semver|tag|sha>` | latest | pin version |
| `--workspace apply|skip|prompt` | prompt | plugin install 後に workspace activation pack を適用するか |
| `--workspace-mode minimal|plugin-reference|copy` | minimal | activation pack の内容 |
| `--include-agent` | false | plugin / workspace agent を有効化 |
| `--include-mcp` | false | MCP を有効化 |
| `--include-hooks` | false | hooks を有効化 |
| `--dry-run` | false | 実行予定 command と file diff を表示 |

`plugin install --workspace apply` は、内部的には plugin registration の後に `workspace apply --mode plugin-reference` を呼ぶ。これにより implementation は重複せず、Direct plugin command を使ったユーザーにも同じ workspace activation path を案内できる。

`--dry-run` の表示例:

```text
Planned actions:
  Commands:
    - claude plugin install azure-functions-skills@azure-functions-skills --scope project
  Workspace files:
    - update .claude/settings.json: enabledPlugins / extraKnownMarketplaces
    - update CLAUDE.md: replace managed block azure-functions-skills
  Not enabled:
    - MCP servers (--include-mcp not set)
    - hooks (--include-hooks not set)
    - plugin agent (--include-agent not set)
```

`--dry-run` は command を実行せず、file も書かない。reviewer が CLI の意図を確認し、必要なら `--include-mcp` や `--merge-strategy include-file` などの option を調整できるようにする。

### Mode D: `plugin update`

目的: plugin package と workspace activation pack を一緒に更新する。

```bash
npx @agent-loom/azure-functions-skills plugin update --agent all --dir ./my-app
npx @agent-loom/azure-functions-skills workspace update --agent all --dir ./my-app
```

更新対象:

- plugin install / marketplace registration。
- `.github/copilot/settings.json` / `.claude/settings.json` / `.agents/plugins/marketplace.json`。
- managed block 内の `CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md`。
- generated hooks / MCP config。ただし opt-in のものだけ。

## Agent-specific design

### GitHub Copilot CLI

推奨 plugin install:

```bash
copilot plugin marketplace add Azure/azure-functions-skills
copilot plugin install azure-functions-skills@azure-functions-skills
copilot --agent azure-functions-skills:functions-copilot
```

CLI-mediated:

```bash
npx @agent-loom/azure-functions-skills plugin install --agent github-copilot --scope user --include-agent
npx @agent-loom/azure-functions-skills workspace apply --agent ghcp --mode plugin-reference --dir ./my-app
```

`--scope project` の扱い:

Copilot plugin は物理 project install が確認できないため、`--scope project` は次の repo settings を生成する意味にする。

```json
{
  "extraKnownMarketplaces": {
    "azure-functions-skills": {
      "source": {
        "source": "github",
        "repo": "Azure/azure-functions-skills"
      }
    }
  },
  "enabledPlugins": {
    "azure-functions-skills@azure-functions-skills": true
  }
}
```

注意:

- README には、GitHub Copilot plugin install 後に agent を明示選択する手順を必ず書く。
- installed plugin agent は `azure-functions-skills:functions-copilot` のような qualified id になる可能性がある。
- MCP は user-scope plugin から有効化すると tool pollution のリスクがあるため、default では含めない。
- Copilot に skill 単位の official manual-only frontmatter は確認できないため、dangerous workflow は narrow description と project routing で抑える。

### Claude Code

推奨 plugin install:

```bash
claude plugin install azure-functions-skills@azure-functions-skills --scope project
```

CLI-mediated:

```bash
npx @agent-loom/azure-functions-skills plugin install --agent claude-code --scope project --dir ./my-app --workspace apply
```

workspace apply が行うこと:

```json
{
  "enabledPlugins": {
    "azure-functions-skills@azure-functions-skills": true
  },
  "extraKnownMarketplaces": {
    "azure-functions-skills": {
      "source": {
        "source": "github",
        "repo": "Azure/azure-functions-skills"
      }
    }
  }
}
```

`CLAUDE.md` には full skill 本文を展開しない。短い routing だけを書く。

```md
<!-- azure-functions-skills:start -->
# Azure Functions Skills

For Azure Functions setup, create, deploy, diagnostics, inventory, health, and best-practices tasks, prefer the Azure Functions Skills plugin. Route deployment through azure-functions-deploy, diagnostics through azure-functions-diagnostics, and static inventory through azure-functions-inventory.
<!-- azure-functions-skills:end -->
```

注意:

- 現行 README の `claude --add-dir ...` は plugin install としては弱い。最新 docs では `claude plugin install <plugin> --scope project|user|local` を主導線にする。
- `CLAUDE.md` が既にある場合は managed block だけを挿入する。
- Claude は plugin details で token cost を見られるため、README に確認手順を載せるとよい。
- side-effect skill は `disable-model-invocation: true` を検討する。ただし shared Agent Skills spec との互換を壊さないよう target-specific frontmatter generation で扱う。

### Codex

推奨 plugin install:

Codex は repo marketplace を活用する。

```bash
npx @agent-loom/azure-functions-skills plugin install --agent codex --scope project --dir ./my-app --workspace apply
```

workspace apply が生成する repo marketplace:

```json
{
  "name": "azure-functions-skills",
  "interface": {
    "displayName": "Azure Functions Skills"
  },
  "plugins": [
    {
      "name": "azure-functions-skills",
      "source": {
        "source": "git-subdir",
        "url": "https://github.com/Azure/azure-functions-skills.git",
        "path": "./.github/plugins/azure-functions-skills",
        "ref": "v0.12.1"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Development"
    }
  ]
}
```

`AGENTS.md` には routing anchor を managed block で追加する。

```md
<!-- azure-functions-skills:start -->
# Azure Functions Skills

For Azure Functions work, use the Azure Functions Skills plugin or repo-local `.agents/skills` entries. Prefer setup/create/deploy/diagnostics/best-practices skills by intent. Do not treat generic Azure tasks as Azure Functions tasks unless the user mentions Function Apps, triggers, bindings, host.json, or Functions deployment/runtime errors.
<!-- azure-functions-skills:end -->
```

注意:

- Codex plugin hooks は `[features].plugin_hooks = true` が必要なので default では有効化しない。
- `allow_implicit_invocation: false` は deploy / feedback / destructive workflows で検討する。
- Codex は skill list budget が明示的にあるため、description を狭くし、skills-only default を守る価値が高い。

## File merge strategy

`CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md` は customer-owned file とみなす。

Default: `managed-block`

```md
<!-- azure-functions-skills:start version=0.12.1 -->
...
<!-- azure-functions-skills:end -->
```

Rules:

1. block がなければ末尾に追加する。
2. block があれば `--update` で差し替える。
3. block 外の customer content は変更しない。
4. conflict がある場合は fail し、`--force` か `--merge-strategy include-file` を案内する。

Alternative: `include-file`

```md
See .azure-functions-skills/CLAUDE.azure-functions.md for Azure Functions routing.
```

この方式は root instructions を薄く保ちたい enterprise workspace に向く。

## Context pollution 対策

| Risk | Default 対策 | Opt-in |
| --- | --- | --- |
| Skill listing pollution | skills-only、narrow description、repo routing | `--mode copy` は必要時だけ |
| Instruction pollution | full skill 本文を `CLAUDE.md` / `AGENTS.md` に展開しない | `--mode copy --verbose-instructions` は advanced only |
| MCP tool pollution | plugin default から MCP を外す、workspace/local で明示 | `--include-mcp` |
| Hook pollution | plugin hooks default off、workspace hook は setup mode only | `--include-hooks` |
| Agent pollution | plugin agent default off、Copilot は user が agent を明示選択 | `--include-agent` |
| Duplicate skills | project skills が plugin skills より優先される前提を docs に書く | `workspace cleanup` command |

## README 更新方針

README の install section は次の順に変える。

1. **Recommended: CLI-mediated install**

```bash
npx @agent-loom/azure-functions-skills plugin install --agent github-copilot --scope user --workspace apply
npx @agent-loom/azure-functions-skills plugin install --agent claude-code --scope project --dir ./my-app --workspace apply
npx @agent-loom/azure-functions-skills plugin install --agent codex --scope project --dir ./my-app --workspace apply
```

2. **Direct plugin commands**

Direct plugin commands は plugin payload を agent に登録するだけである。routing、workspace instructions、repo settings、MCP / hooks policy は自動では入らないため、続けて `workspace apply --mode plugin-reference` を実行する。

GitHub Copilot:

```bash
copilot plugin marketplace add Azure/azure-functions-skills
copilot plugin install azure-functions-skills@azure-functions-skills
copilot --agent azure-functions-skills:functions-copilot
npx @agent-loom/azure-functions-skills workspace apply --agent ghcp --mode plugin-reference --dir ./my-app
```

Claude Code:

```bash
claude plugin install azure-functions-skills@azure-functions-skills --scope project
npx @agent-loom/azure-functions-skills workspace apply --agent claude --mode plugin-reference --dir ./my-app
```

Codex:

```bash
codex plugin marketplace add Azure/azure-functions-skills --sparse .github/plugins
# Then install azure-functions-skills from /plugins, or let the repo marketplace expose it.
npx @agent-loom/azure-functions-skills workspace apply --agent codex --mode plugin-reference --dir ./my-app
```

この説明では、Direct plugin command と CLI-mediated install の違いを明確にする。CLI-mediated install は `--workspace apply` を指定すれば plugin install と workspace apply を一連の操作として実行する。Direct plugin command は agent-native な低レベル手順なので、workspace apply は明示的に別手順として書く。

3. **Workspace-local setup**

```bash
npx @agent-loom/azure-functions-skills setup --agent ghcp --dir ./my-app
npx @agent-loom/azure-functions-skills setup --agent claude --dir ./my-app
npx @agent-loom/azure-functions-skills setup --agent codex --dir ./my-app
```

4. **Chat**

```bash
npx @agent-loom/azure-functions-skills chat --agent github-copilot --dir ./my-app
```

## Implementation notes

Current code already has `setup --as-plugin` and `chat --as-plugin`, but the semantics should be redesigned.

Needed changes:

1. Replace `--as-plugin` internals with documented native plugin flows:
   - Copilot: `copilot plugin marketplace add` / `copilot plugin install`, plus optional `.github/copilot/settings.json` for project declaration.
   - Claude: `claude plugin install <plugin> --scope user|project|local` instead of `claude --add-dir` as primary path.
   - Codex: repo marketplace or `codex plugin marketplace add`; do not write only personal marketplace by default for project scope.
2. Split plugin payload variants:
   - `skills-only` default.
   - `full` advanced payload with MCP/hooks/agents.
   - host-specific manifests where needed.
3. Make `generateClaudeMd` and `generateCodexAgents` thin by default; avoid inlining all skill contents into `CLAUDE.md` / `AGENTS.md`.
4. Add managed-block merge utilities with tests.
5. Add `workspace apply/update` command or extend `setup --mode minimal|copy|plugin-reference --update`.
6. Implement `--dry-run` across `plugin install`, `workspace apply`, and `workspace update` so reviewers can inspect planned shell commands and file changes before mutation.
7. Add E2E scenarios for Copilot plugin install with qualified agent selection, Claude `--scope project` plugin install, Codex repo marketplace install, existing `CLAUDE.md` / `AGENTS.md` merge without overwrite, and Direct plugin command followed by `workspace apply --mode plugin-reference` for each agent.

## Open questions

1. Copilot plugin project scope が将来追加された場合、`--scope project` の semantics を repo settings declaration から native project install に切り替えるか。
2. Azure MCP を plugin default に含めるべきか、`--include-mcp` だけにするべきか。現時点では default off 推奨。
3. `azure-functions-deploy` が依存する Azure Skills plugin を、この CLI がどこまで自動 install するか。現行 prerequisite handling と整合させる必要がある。
4. Claude / Codex の manual-only metadata を shared skill source に入れるか、target-specific generation で入れるか。

## References

- GitHub Copilot CLI plugin reference: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
- GitHub Copilot CLI configuration directory: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
- GitHub CLI `gh skill install`: https://cli.github.com/manual/gh_skill_install
- Claude Code plugins reference: https://code.claude.com/docs/en/plugins-reference
- Claude Code settings: https://code.claude.com/docs/en/settings
- Codex plugin build docs: https://developers.openai.com/codex/plugins/build
- Codex skills docs: https://developers.openai.com/codex/skills
- Codex hooks docs: https://developers.openai.com/codex/hooks
- Existing research: `Research/azure-functions-skills-plugin-local-hybrid-20260521.md`
- Existing research: `Research/copilot-claude-codex-plugin-scope-comparison-20260521.md`
