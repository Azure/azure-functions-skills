# azure-functions-setup

| 項目 | 内容 |
| --- | --- |
| 変更の大きさ | 大 |
| 使うコマンド | `env check` |
| 段階 | P0 |
| 対象ファイル | `templates/skills/azure-functions-setup/SKILL.md` |

## 概要と目的

環境確認は、このスキル群の入口です。今はバージョン確認を1つずつ実行し、エージェントが下限と見比べています。
これを1回の実行にまとめ、判定もスクリプトで行います。Go の下限(Core Tools 4.12、Azure CLI 2.87.0)のような見落としやすい比較を、確実にするねらいもあります。

## 現状でターンを使っている部分

| 手順 | 今のやり方 |
| --- | --- |
| バージョン確認 | `az`、`azd`、`func`、`node`、`python`、`python3`、`dotnet`、`go` を個別に実行(最大8回) |
| ログイン確認 | `az account show` などを別に実行 |
| 下限との比較 | エージェントが表を読んで判断 |
| OS に合う直し方の選択 | エージェントが OS を推定して表から選ぶ |

見積もりでは、8〜10回の呼び出しが1回になります。

## スクリプトの使い方

```text
node ../azure-functions-common/scripts/functions-tools.mjs env check --dir . [--language <lang>] [--for deploy]
```

- `data.tools` をそのままチェックリストの表示に使う。
- `findings[].fix` は実行中の OS に合うコマンドなので、そのまま案内に使う。

## インストラクションの変更

| 節 | 変更 |
| --- | --- |
| Checks | コマンドの列挙を消し、「`env check` を1回実行する」に置き換える。対象言語を絞るルールは `--language` の説明として残す |
| Azure Skills Plugin Check | 変更しない。スキル一覧の確認はエージェントにしかできない |
| Output Format | 変更しない。`data.tools` と `findings` から組み立てる、と1行足す |
| Fix Instructions | OS 別の表は `references/install-commands.md` に移し、手動手順として残す。本文は「`findings[].fix` を示す。docs リンクも出力に含まれる」に短くする |
| Go prerequisites | 下限の比較手順を消す(スクリプトが行う)。プレビューであること、`FUNCTIONS_WORKER_RUNTIME=native`、`func new` が使えないことの説明は残す |
| After Setup / Next steps | 変更しない |

`node` が使えないときは、`references/install-commands.md` の手順で今までどおり確認する、と書きます。

## スクリプトにしない部分

- Azure Skills プラグインの有無の確認と、ホスト別のインストール案内
- ツールのインストールの実行(案内だけを行う)
- 次に使うスキルの提案

## 受け入れ基準

- Python プロジェクトで実行したとき、Go がないことを問題として報告しない。
- Go プロジェクトで Core Tools が 4.11 のとき、`findings` に不足として出る。
- Windows で実行したとき、`fix` に Linux 用のコマンドが入らない。
- 未ログインのとき、終了コードは 0 で、`findings` に `az login` の案内が出る。
