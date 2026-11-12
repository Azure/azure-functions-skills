# azure-functions-doctor

| 項目 | 内容 |
| --- | --- |
| 変更の大きさ | 大 |
| 使うコマンド | `project inspect`、`project scan` |
| 段階 | P1 |
| 対象ファイル | `templates/skills/azure-functions-doctor/SKILL.md`、`references/routing.md`、`references/source-only-checks.md` |

## 概要と目的

doctor のチェックには、ファイルを読めば機械的に決まるもの(`host.json` の有無や値、設定名、秘密の文字列など)と、コードの意味を読む必要があるものがあります。
前者をスクリプトに移します。エージェントは、スクリプトが判定しなかったチェックだけを行います。
ターンが減るだけでなく、同じプロジェクトに対して毎回同じ結果が出るようになります。

## 現状でターンを使っている部分

| 手順 | 今のやり方 |
| --- | --- |
| ルートと言語の検出 | `host.json`、依存関係のファイル、IaC を探して読む |
| チェックリストの選択 | `routing.md` を読み、タグを決める |
| source-only のチェック | 20個以上のチェックを、ファイルを1つずつ読んで判定する |
| 秘密の走査 | grep を何度か実行する |

見積もりでは、15〜25回の呼び出しが2回と、意味解析に必要な読み取りだけになります。

## スクリプトの使い方

```text
node ../azure-functions-common/scripts/functions-tools.mjs project inspect --dir <root>
node ../azure-functions-common/scripts/functions-tools.mjs project scan --dir <root> [--scope <...>]
```

- `inspect` の `data.doctorTags` で、読むチェックリストを決める。
- `scan` の `findings` は、そのまま報告に使える形で出る。
- `scan` の `data.notChecked` に、エージェントが見るべきチェック ID が入る。

## インストラクションの変更

| 節 | 変更 |
| --- | --- |
| Instructions 1〜2 | 「`project inspect` を実行する。アプリが複数あれば、どれを分析するかユーザーに尋ねる」に置き換える |
| Instructions 3 | 「`data.doctorTags` に合うチェックリストだけを読む」に変える。`routing.md` は手動手順として残す |
| Instructions 4 | 「`project scan` を実行する。その後、`data.notChecked` のチェックと、意味・言語・サプライチェーンのチェックを行う」に変える |
| Analysis scope | 「source-only のチェックはスクリプトが行う。`source-only-checks.md` は、結果の説明が必要なときと手動手順のときだけ読む」と足す |
| Output | 変更しない。スクリプトの `findings` とエージェントの所見を、重大度の順に1つの一覧にする、と足す |
| Rules 3 | 「スクリプトとエージェントが同じ問題を見つけたら、1回だけ報告する」と足す |
| Rules 6 | 変更しない。`project scan` はプロジェクトのコードを実行しないので、このルールに反しない |

`references/source-only-checks.md` の各行に「スクリプトが判定する」の印を付け、表を正本として残します。

## スクリプトにしない部分

- 意味のチェック(`CQ-*`、`EH-*`、`SC-002`、`SC-009`)
- 言語別のチェックのうち、コードを読む必要があるもの(クライアントの再利用、ブロッキング呼び出しなど)
- Azure のリソース情報が必要なチェック(`RT-003` の EOL 判定など)。`gaps` に入れて、エージェントが `az` で確認する
- 修正の適用

## 受け入れ基準

- `host.json` がないとき `CF-001`、JSON が壊れているとき `CF-002` が出る。
- 接続文字列がコードに入っているとき `SC-001` が出て、出力にはその値が含まれない。
- `local.settings.json` の値は読むが、出力には名前と有無だけが出る。
- スクリプトが判定するチェック ID の一覧と、`source-only-checks.md` の印が一致する(テストで確認)。
- プロジェクトのファイルを変更しない。
