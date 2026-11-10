# azure-functions-best-practices

| 項目 | 内容 |
| --- | --- |
| 変更の大きさ | 中 |
| 使うコマンド | `app inventory`(必要なら `--with-health`) |
| 段階 | P2 |
| 対象ファイル | `templates/skills/azure-functions-best-practices/SKILL.md` |

## 概要と目的

レビューは、証拠を集めてからチェックリストで評価します。
証拠集めを1回の実行にまとめます。また、SKILL.md に直接書かれている代替の `az` コマンド4つをなくし、収集の方法を1つにします。

## 現状でターンを使っている部分

| 手順 | 今のやり方 |
| --- | --- |
| 手順1 静的な証拠 | inventory スキルを読み込んで実行。使えなければ `az` を4回実行 |
| 手順2 実行時の証拠 | health-status スキルを読み込んで実行 |
| 手順4 参照の選択 | 結果を読んで `routing.md` で選ぶ |
| 手順10 変更後の確認 | 同じ収集をもう一度行う |

見積もりでは、収集の3〜6回が1回になります。変更後の確認も1回です。

## スクリプトの使い方

```text
# quick / configuration / security / cost
node ../azure-functions-common/scripts/functions-tools.mjs app inventory --app <name>

# full / performance-scale / observability
node ../azure-functions-common/scripts/functions-tools.mjs app inventory --app <name> --with-health
```

## インストラクションの変更

| 節 | 変更 |
| --- | --- |
| Workflow 1 | 「`app inventory` を実行する」に置き換える。代替の `az` コマンド4つは消し、「`node` が使えないときは inventory スキルの手動手順に従う」にする |
| Workflow 2 | 「範囲が full、performance-scale、observability のとき、または劣化しているアプリのときは `--with-health` を付ける」に変える。手順1と1回にまとめる |
| Workflow 3 | 変更しない。MCP のベストプラクティスの取得はエージェントが行う |
| Workflow 4 | 「`data.referenceTags` に合う参照だけを読む」に変える |
| Workflow 10 | 「同じコマンドをもう一度実行して比べる」と書く |
| Core principles / Output shape | 変更しない |

## スクリプトにしない部分

- MCP のベストプラクティスの取得
- チェックリストによる評価と、優先度付け
- 修正の承認と適用

チェックリストの機械的な判定(HTTPS のみ、TLS のバージョン、FTPS など)をスクリプトに入れることは、今回は行いません。
MCP の指針で基準が変わるため、評価はエージェントに残します。

## 受け入れ基準

- SKILL.md に、直接実行する `az` コマンドが残らない(手動手順の参照を除く)。
- アプリ設定の値が出力に含まれない。
- `--with-health` なしの実行では、Application Insights に問い合わせない。
