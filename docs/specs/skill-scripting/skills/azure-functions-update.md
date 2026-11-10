# azure-functions-update

| 項目 | 内容 |
| --- | --- |
| 変更の大きさ | 小 |
| 使うコマンド | `project inspect`、`env check`、`project verify-local` |
| 段階 | P4 |
| 対象ファイル | `templates/skills/azure-functions-update/SKILL.md`、`references/dotnet-isolated.md` |

## 概要と目的

このスキルは、承認と証拠の扱いを細かく決めた、判断中心のワークフローです。
スクリプトにするのは、事実を集める3か所だけです。手順2の環境確認、手順3のインベントリの出発点、手順5のホスト起動の確認です。
計画、承認、移行そのもの、完了条件の評価は変更しません。

## 現状でターンを使っている部分

| 手順 | 今のやり方 |
| --- | --- |
| 2 ツールの確認 | Core Tools のバージョンとパス、言語のツールを個別に確認 |
| 3 インベントリ | プロジェクト、言語、モデル、トリガーとバインディング、IaC、CI を個別に探す |
| 3 シナリオの選択 | csproj を読み、in-process かどうかを判断する |
| 5 ホストの確認 | `func` を起動し、登録された関数とリスナーをログから読む |

見積もりでは、インベントリの8〜15回の呼び出しが1回になります。全体に占める割合は大きくありません。

## スクリプトの使い方

```text
node ../azure-functions-common/scripts/functions-tools.mjs env check --dir . --language csharp
node ../azure-functions-common/scripts/functions-tools.mjs project inspect --dir .
node ../azure-functions-common/scripts/functions-tools.mjs project verify-local --dir . --out <approved-log-file>
```

`project inspect` は、C# プロジェクトについて次の事実を返します。

- `TargetFramework`、`AzureFunctionsVersion`、`OutputType`
- Functions 関連のパッケージ参照と、宣言されたバージョン
- in-process か isolated かの判定と、その根拠(`Microsoft.NET.Sdk.Functions` と `Microsoft.Azure.Functions.Worker` のどちらを使っているか)
- `next.scenario`: シナリオ表の行に対応する値。該当がなければ `none`

これは「宣言されたバージョン」だけです。実際に解決されたバージョンは、今までどおり、承認されたリストアの後にエージェントが確認します。

## インストラクションの変更

| 節 | 変更 |
| --- | --- |
| 2. Check tools | 「承認された操作に必要な範囲で `env check` を実行する」と足す。インストールの前に尋ねるルールは変更しない |
| 3. Inventory | 「`project inspect` を出発点にする。出力は宣言された値であり、解決されたバージョンの証拠ではない」と足す |
| 3. シナリオの選択 | 「`next.scenario` を、観測した事実の1つとして使う。複数に該当するときはユーザーに尋ねる」と足す |
| 5. Verify behavior | 「ホストの起動、関数の登録、リスナーの確認に `project verify-local` を使える。これは E2E の成功ではない」と足す |
| Keep evidence complete | 「`--out` で長い出力を承認されたファイルに書く」と足す。この節の方針と一致する |
| 10. Perform the final review | 「Doctor/inventory helpers are advisory and not assumed read-only」の文を、「`project inspect` と `project scan` は読み取り専用。`verify-local` はプロセスを起動する」に直す |
| 1、4、6〜9、11 | 変更しない |

## スクリプトにしない部分

- 読み取りの許可と、計画の保存
- 依存関係のリストア、ビルド、テストの実行(フィード、認証、フックの確認と承認が必要)
- 公式の移行ガイドの調査
- コードと設定の変更
- トリガーの E2E テスト
- 完了条件の ID ごとの評価と、最終報告

## 受け入れ基準

- `Microsoft.NET.Sdk.Functions` を参照するプロジェクトで、`next.scenario` が `dotnet-isolated` になる。
- すでに isolated のプロジェクトで、`next.scenario` が `none` になる。
- `project inspect` は、リストアやビルドを実行しない。
- 出力に「解決されたバージョン」という項目を作らない(宣言された値だけ)。
