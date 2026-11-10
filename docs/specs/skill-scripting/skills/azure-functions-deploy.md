# azure-functions-deploy

| 項目 | 内容 |
| --- | --- |
| 変更の大きさ | 大 |
| 使うコマンド | `project inspect`、`env check --for deploy`、`app deploy-status` |
| 段階 | P1 |
| 対象ファイル | `templates/skills/azure-functions-deploy/SKILL.md` |

## 概要と目的

このスキルは自分ではデプロイせず、Azure Skills の3つのスキルに引き渡します。
引き渡す前の「どれに渡すか」の判定は、ファイルの有無と内容だけで決まります。
この判定を1回の実行にまとめ、引き渡しまでのターンを減らします。Hosted Skills アプリの誤ルーティング(#299 で直した問題)も、判定をコードにすることで防ぎやすくなります。

## 現状でターンを使っている部分

| 手順 | 今のやり方 |
| --- | --- |
| Hosted Skills アプリかどうか | `*.agent.md` と `agents.config.yaml` を探す |
| 前提の確認 | `az`、`azd`、`az account show`、`host.json` を個別に確認 |
| ショートカットの4条件 | `azure.yaml`、`infra/`、`host.json`、`metadata.template` を個別に確認 |
| 計画の状態 | `.azure/deployment-plan.md` を読んで `Validated` かどうかを見る |
| `azd up` の進行確認 | `az group show`、`az deployment group list`、`az functionapp list` の3回 |

見積もりでは、引き渡し前の8〜12回の呼び出しが2回になります。

## スクリプトの使い方

```text
node ../azure-functions-common/scripts/functions-tools.mjs project inspect --dir .
node ../azure-functions-common/scripts/functions-tools.mjs env check --dir . --for deploy
node ../azure-functions-common/scripts/functions-tools.mjs app deploy-status --resource-group rg-<env-name>
```

`project inspect` の `next.skill` は次のどれかになります。

| 値 | 条件 |
| --- | --- |
| `azure-functions-hosted-skills` | Hosted Skills アプリ |
| `azure-validate`(ショートカット) | 4条件をすべて満たす |
| `azure-prepare` | 計画がない |
| `azure-validate` | 計画はあるが `Validated` でない |
| `azure-deploy` | 計画が `Validated` |

## インストラクションの変更

| 節 | 変更 |
| --- | --- |
| 冒頭の Hosted Skills 判定 | 「最初に `project inspect` を実行する。`data.hostedSkills` が true なら `azure-functions-hosted-skills` を呼んで終わる」に置き換える。会話の文脈による判定は残す |
| Prerequisites | 「`env check --for deploy` の `findings` が空であること」に置き換える。Azure Skills の有無はエージェントが確認する |
| Required delegation model | 規則1〜5は残す。判定の手順は「`next.skill` に従う」に短くする |
| Shortcut path | 4条件の説明は残し、確認はスクリプトが行うと書く。軽い `.azure/plan.md` の作成はエージェントが行う |
| Azure Functions context to inject / Go | 変更しない |
| Monitoring `azd up` progress | 3つのコマンドを `app deploy-status` に置き換える |
| Report a successful deployment | 変更しない。`telemetry.mjs` が担当する。azd 環境名は `project inspect` の `data.azd.environments` から取れる、と1行足す |

## スクリプトにしない部分

- `azure-prepare`、`azure-validate`、`azure-deploy` の呼び出し
- 計画を `Validated` にすること(`azure-validate` だけが行う)
- フォールバックの説明と承認
- デプロイそのもの

## 受け入れ基準

- `src/*.agent.md` と `agents.config.yaml` があるプロジェクトで、`next.skill` が `azure-functions-hosted-skills` になる。
- 4条件のうち `metadata.template` だけが欠けているとき、ショートカットにならない。
- 計画ファイルの状態が `Validated` 以外のとき、`azure-deploy` を返さない。
- スクリプトは `.azure/` の下に何も書かない。
