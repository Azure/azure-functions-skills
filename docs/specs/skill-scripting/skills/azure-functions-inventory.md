# azure-functions-inventory

| 項目 | 内容 |
| --- | --- |
| 変更の大きさ | 中 |
| 使うコマンド | `app inventory` |
| 段階 | P2 |
| 対象ファイル | `templates/skills/azure-functions-inventory/SKILL.md`、`scripts/`(削除) |

## 概要と目的

このスキルはすでにスクリプト化されています。ただし PowerShell 版と Bash 版の2つがあり、Bash 版は JSON の整形に Python が必要です。
これを Node の `app inventory` に一本化します。ねらいは、保守する実装を1つにすること、Python への依存をなくすこと、エージェントがシェルを選ぶ分岐をなくすことです。

## 現状の課題

| 課題 | 内容 |
| --- | --- |
| 二重実装 | ps1 が126行、sh が221行。同じ変更を2回入れる必要がある |
| 追加の依存 | sh 版は `python3` か `python` が必要 |
| 分岐 | エージェントが OS とシェルを見て、スクリプトと引数の形式(`-AppName` と `-a`)を選ぶ |
| 黙って行う設定変更 | `az config set` と `az extension add resource-graph` を実行している |
| 直列実行 | `az` を1つずつ呼んでいる |

ターン数はほぼ変わりません。変わるのは、保守の手間、失敗の少なさ、実行時間です。

## スクリプトの使い方

```text
node ../azure-functions-common/scripts/functions-tools.mjs app inventory --app <name> [--subscription <sub>] [--resource-group <rg>]
```

- 収集する項目は、SKILL.md の「Scope boundary」と同じにする。
- アプリが複数見つかったら、`data.candidates` を返して終わる。エージェントがユーザーに選んでもらう。

## インストラクションの変更

| 節 | 変更 |
| --- | --- |
| Fast path 2 | ps1 と sh の書き分けを消し、`app inventory` の1行にする。Python が必要という注意書きも消す |
| Fast path 3 | 変更しない。`references/inventory-commands.md` を手動手順として残す |
| Required interaction | 「複数見つかったら `data.candidates` を示して選んでもらう」と足す |
| Scope boundary / Output template | 変更しない。出力の項目名と `data` の項目の対応を1行足す |

`scripts/get-functionapp-inventory.ps1` と `.sh` は、Node 版と同じ PR で削除します(未決事項 Q2)。

## スクリプトにしない部分

- アプリが複数あるときの選択
- 結果の要約と、次のスキルの提案

## 受け入れ基準

- 既存スクリプトと同じ項目が出る(フィクスチャーで比べる)。
- アプリ設定は名前と有無だけが出て、値は出ない。
- `az` の設定を変更しない。拡張機能をインストールしない。Resource Graph が使えないときは `gaps` に出る。
- メトリックや Application Insights の情報を含まない(`--with-health` を付けない場合)。
