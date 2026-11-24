# スキルの定型処理スクリプト化 — 仕様ドキュメント一覧

> 状態: **提案(Draft)**。実装はまだ始めていません。
> このフォルダーは通常の設計メモであり、`docs/frds/` の FRD プロセスには乗せていません。

## 目的

各スキルのワークフローには、毎回同じ手順で実行する「読み取りと判定」の処理があります。
現在はエージェントがこれを1コマンドずつ実行しているため、ターン数と待ち時間が増えています。
この処理を、依存性のない Node スクリプト1本にまとめ、エージェントは判断が必要な部分だけを担当するようにします。

## 読む順番

| 文書 | 内容 |
| --- | --- |
| [00-overview.md](00-overview.md) | 方針、Node を選ぶ理由、配置、出力の共通ルール、安全ルール、段階的な進め方、未決事項 |
| [01-script-catalog.md](01-script-catalog.md) | 作るスクリプトの全体像。1本のツールと6つのコマンドグループ |
| [skills/](skills/) | スキルごとの仕様(下の一覧) |

## スクリプトの全体像

作るのは `functions-tools.mjs` の **1本だけ** です。中身は6つのコマンドグループに分かれます。

| グループ | 対象 | コマンド |
| --- | --- | --- |
| `env` | 開発マシン | `check` |
| `project` | ローカルのプロジェクト | `inspect` / `scan` / `verify-local` |
| `template` | テンプレート取得 | `find` / `write` |
| `app` | デプロイ済み Function App | `inventory` / `health` / `deploy-status` |
| `hosted` | Hosted Skills アプリ | `models` / `sync-settings` / `invoke` |
| `connector` | Connector Namespace | `status` / `contract` / `gates` |

## スキル別の仕様一覧

「効果」は SKILL.md の手順から数えた見積もりで、実測値ではありません。

| # | スキル | 変更の大きさ | 使うコマンド | 変更の要点 | 段階 |
| --- | --- | --- | --- | --- | --- |
| 1 | [setup](skills/azure-functions-setup.md) | 大 | `env check` | 8個のバージョン確認とログイン確認を1回にする | P0 |
| 2 | [deploy](skills/azure-functions-deploy.md) | 大 | `project inspect`、`app deploy-status` | 前提確認と「次に呼ぶスキル」の判定を1回にする | P1 |
| 3 | [doctor](skills/azure-functions-doctor.md) | 大 | `project inspect`、`project scan` | 機械的なチェックをスクリプトに移し、エージェントは意味解析に集中する | P1 |
| 4 | [create](skills/azure-functions-create.md) | 大 | `template find`、`template write`、`project verify-local` | テンプレートの書き出しとローカル検証をそれぞれ1回にする | P1・P3 |
| 5 | [inventory](skills/azure-functions-inventory.md) | 中 | `app inventory` | ps1/sh の二重実装を Node に一本化する | P2 |
| 6 | [health-status](skills/azure-functions-health-status.md) | 中 | `app health` | 同上。クエリを並列実行する | P2 |
| 7 | [diagnostics](skills/azure-functions-diagnostics.md) | 中 | `app inventory --with-health` | inventory と health を1回で集める | P2 |
| 8 | [best-practices](skills/azure-functions-best-practices.md) | 中 | `app inventory --with-health` | 証拠集めを1回にし、手書きの代替コマンドをなくす | P2 |
| 9 | [hosted-skills](skills/azure-functions-hosted-skills.md) | 大 | `project inspect`、`template`、`hosted *` | モデル選定、設定反映、手動実行と観測をそれぞれ1回にする | P3 |
| 10 | [connector-validate](skills/azure-functions-connector-validate.md) | 大 | `connector gates` | ゲート1〜7を1回で判定する | P4 |
| 11 | [connector-mcp](skills/azure-functions-connector-mcp.md) | 中 | `connector contract`、`connector status` | メタデータ取得をまとめる。登録(書き込み)は対象外 | P4 |
| 12 | [connector-create](skills/azure-functions-connector-create.md) | 小 | `connector status`、`connector contract --auth-only` | 現状確認と接続の検証だけ | P4 |
| 13 | [hosted-skills-migrate](skills/azure-functions-hosted-skills-migrate.md) | 小 | `project inspect --hash` | ソースのハッシュ記録だけ | P4 |
| 14 | [update](skills/azure-functions-update.md) | 小 | `project inspect` | インベントリの初期事実だけ | P4 |
| 15 | [feedback](skills/azure-functions-feedback.md) | なし | — | 変更しない | — |
| 16 | [help](skills/azure-functions-help.md) | なし | — | 変更しない | — |
| 17 | [common](skills/azure-functions-common.md) | 配置先 | (全コマンドの置き場所) | `scripts/` にツールを配置し、呼び出し方を1か所に書く | P0 |

## 段階

| 段階 | 内容 |
| --- | --- |
| P0 | 基盤(ビルドへの組み込み、共通の出力形式、コマンド実行ヘルパー)と `env check` |
| P1 | `project` グループ。setup / deploy / doctor / create に適用 |
| P2 | `app` グループ。既存の ps1/sh を置き換える |
| P3 | `template` と `hosted` グループ |
| P4 | `connector` グループと、migrate / update の小さな変更 |

各段階は単独でリリースできます。段階ごとに、スクリプトの追加と SKILL.md の変更を同じ PR に入れます。
