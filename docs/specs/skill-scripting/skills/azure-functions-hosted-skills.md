# azure-functions-hosted-skills

| 項目 | 内容 |
| --- | --- |
| 変更の大きさ | 大 |
| 使うコマンド | `project inspect`、`template find` / `write`、`hosted models` / `sync-settings` / `invoke`、`app deploy-status` |
| 段階 | P3 |
| 対象ファイル | `templates/skills/azure-functions-hosted-skills/SKILL.md`、`references/models.md`、`references/testing.md`、`references/infra-and-deployment.md` |

## 概要と目的

このスキルは一番長く(444行)、デプロイと検証の定型手順が多くあります。
次の5つをそれぞれ1回の実行にします。

1. ワークスペースの確認
2. テンプレートの取得と書き出し
3. モデルとクォータの確認
4. `azd` の出力を `local.settings.json` に反映
5. バックグラウンドのエージェントを手動で起動し、結果を観測

特に5は、起動のしすぎ(同じ副作用を何度も起こす)を防ぐ意味でも、コードにする価値があります。

## 現状でターンを使っている部分

| 手順 | 今のやり方 |
| --- | --- |
| Assess the Workspace | 9種類のファイルを個別に探す |
| Scaffold | マニフェストの取得、MCP の呼び出し、`files` 配列の書き出し、失敗時の GitHub からの取得 |
| モデル選定 | `az cognitiveservices` の `list-skus`、`model list`、`usage list` を複数回実行し、結果を見比べる |
| ローカル開発の手順3 | `azd env get-values` の値を手で `local.settings.json` に写す |
| デプロイ後の検証 | マスターキーの取得、admin エンドポイントへの POST、Application Insights の3クエリを、結果が出るまで繰り返す |

見積もりでは、モデル選定が4〜6回から1回に、検証が6〜15回から1回になります。

## スクリプトの使い方

```text
node ../azure-functions-common/scripts/functions-tools.mjs project inspect --dir .
node ../azure-functions-common/scripts/functions-tools.mjs template find --language python --id ai-hosted-skills-python
node ../azure-functions-common/scripts/functions-tools.mjs template write --from <mcp-output.json | ai-hosted-skills-python> --dir <target>
node ../azure-functions-common/scripts/functions-tools.mjs hosted models --location <region>
node ../azure-functions-common/scripts/functions-tools.mjs hosted sync-settings --dir .
node ../azure-functions-common/scripts/functions-tools.mjs hosted invoke --app <name> --function <agent-file-stem> --wait 10
```

## インストラクションの変更

| 節 | 変更 |
| --- | --- |
| Assess the Workspace | ファイルの列挙を「`project inspect` を実行し、`data.hostedSkills` を読む」に置き換える。Connector Namespace のリソース種別の説明は残す |
| Scaffold a New App 1〜4 | 1を `template find` に、3〜4を `template write` に置き換える。2(MCP の呼び出し)は残す。旧 ID `ai-serverless-agents-python` の扱いは、`template write` が処理すると書く |
| Default scaffold choices / Model Selection Guidance | 「`hosted models` を実行し、`data.candidates` から選ぶ」に置き換える。推論対応の確認と、ユーザーに選んでもらう条件は残す |
| Local loop 3 | 「`hosted sync-settings` を実行する」に置き換える |
| Deploy and Verify | サブスクリプションの確認は `env check` の `data.subscription` を使う。バックグラウンドのエージェントの検証は「`hosted invoke` を1回実行する。時間切れのときは、もう一度起動せず `troubleshooting.md` に進む」に置き換える。待ち時間について事前にユーザーへ伝えるルールは残す |
| `references/models.md` | コマンドの節を手動手順として残し、冒頭に「通常は `hosted models` を使う」と足す |
| `references/testing.md` | admin エンドポイントと Application Insights のクエリを手動手順として残し、冒頭に同じ案内を足す |
| デプロイ観測 | 変更しない。`telemetry.mjs` が担当する |

## スクリプトにしない部分

- 要件の聞き取りと計画
- `.agent.md`、`agents.config.yaml`、`mcp.json` の編集
- 推論設定に対応するモデルかどうかの確認(公式文書を読む必要がある)
- `azd env set`、`azd up`、`azd provision` の実行
- チャット API など、対話型エンドポイントのテスト(1回の `curl` で済む)
- コネクターの作成、公開、検証(connector の3スキルに引き渡す)
- 目に見える副作用(Teams の投稿、メール)の確認

## 受け入れ基準

- `hosted models` で、クォータが 0 のモデルは `deployable: false` になり、推奨に入らない。
- 取得に失敗したとき、`gaps` に理由が出て、エージェントが `gpt-4.1` に戻せる。
- `hosted sync-settings` の出力に、設定の値が含まれない。
- `hosted invoke` は、どの経路でも POST を1回しか送らない(テストで確認)。
- `hosted invoke` の出力に、マスターキーや関数キーが含まれない。
- `template write` は、同梱のファイルではなく、MCP の出力またはマニフェストの取得先だけを使う。
