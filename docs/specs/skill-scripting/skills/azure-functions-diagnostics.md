# azure-functions-diagnostics

| 項目 | 内容 |
| --- | --- |
| 変更の大きさ | 中 |
| 使うコマンド | `app inventory --with-health`、`project inspect` |
| 段階 | P2 |
| 対象ファイル | `templates/skills/azure-functions-diagnostics/SKILL.md`、`references/workflow.md` |

## 概要と目的

診断の最初の2手順は、必ず inventory と health-status の収集です。
今は2つのスキルを順に読み込み、スクリプトを2回実行しています。
これを1回の実行にまとめ、原因の調査に早く入れるようにします。

## 現状でターンを使っている部分

| 手順 | 今のやり方 |
| --- | --- |
| 静的な情報の収集 | inventory スキルを読み込み、スクリプトを実行 |
| 健全性の収集 | health-status スキルを読み込み、スクリプトを実行 |
| 参照の選択 | 結果からランタイムとトリガーを読み取り、`routing.md` で参照を選ぶ |
| ローカルだけの問題 | 言語、トリガー、設定を手で探す |

見積もりでは、最初の4〜6回の呼び出しが1回になります。2つのスキルの SKILL.md を読む分も省けます。

## スクリプトの使い方

```text
# デプロイ済みアプリ
node ../azure-functions-common/scripts/functions-tools.mjs app inventory --app <name> --with-health [--hours <n>]

# ローカルだけの問題
node ../azure-functions-common/scripts/functions-tools.mjs project inspect --dir .
```

- 出力の `data.referenceTags`(言語と、トリガーやバインディングの種類)で、common の参照を選ぶ。

## インストラクションの変更

| 節 | 変更 |
| --- | --- |
| Fast path 1〜2 | 「`app inventory --with-health` を1回実行する。inventory と health-status のスキルを個別に読み込まない」に置き換える |
| Fast path 3 | 「`data.referenceTags` に合う参照だけを読む」に変える。`routing.md` は、タグから参照ファイルへの対応表として残す |
| Required inputs の最後 | 「ローカルだけの問題のときは `project inspect` を実行する」に変える |
| Reference loading rules / Guardrails / Output shape | 変更しない |
| `references/workflow.md` | 収集の手順を同じように書き換える |

## スクリプトにしない部分

- 症状の聞き取り
- 原因の推定と、根拠の確認(`evidence-checklist.md`)
- 公式文書やリポジトリの調査
- 設定変更、再起動、デプロイなどの対処

## 受け入れ基準

- 1回の実行で、inventory と health の両方の項目が出る。
- health の収集が失敗しても、inventory の結果は返る。
- .NET アプリで、Extension Bundles の参照タグが出ない(今の読み込みルールと同じ)。
