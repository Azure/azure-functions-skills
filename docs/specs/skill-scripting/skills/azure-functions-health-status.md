# azure-functions-health-status

| 項目 | 内容 |
| --- | --- |
| 変更の大きさ | 中 |
| 使うコマンド | `app health` |
| 段階 | P2 |
| 対象ファイル | `templates/skills/azure-functions-health-status/SKILL.md`、`scripts/`(削除) |

## 概要と目的

inventory と同じく、PowerShell 版(172行)と Bash 版(267行)の2つを Node の `app health` に一本化します。
このスキルはクエリの数が多いので、並列実行による時間短縮の効果が大きくなります。

## 現状の課題

| 課題 | 内容 |
| --- | --- |
| 二重実装と Python への依存 | inventory と同じ |
| 直列実行 | アプリの状態、Resource Health、メトリック、Application Insights の4〜5クエリ、Activity Log を順に実行している |
| 解釈ルールがスクリプトの外にある | `%SETTING_NAME%` の未解決や、Flex Consumption の `Unknown` を、エージェントが毎回判断している |

## スクリプトの使い方

```text
node ../azure-functions-common/scripts/functions-tools.mjs app health --app <name> [--subscription <sub>] [--resource-group <rg>] [--hours <n>]
```

- 既定の期間は24時間。
- 機械的に決まる解釈は `findings` と `gaps` に入れる。
  - Flex Consumption で Resource Health が `Unknown` / `Unsupported` → `gaps`
  - ログに `%SETTING_NAME%` が残っている → `findings`(設定またはインデックスの問題)
  - クラシックの表が空で、ワークスペース型の表にデータがある → ワークスペース型の結果を使う

## インストラクションの変更

| 節 | 変更 |
| --- | --- |
| Fast path 2 | ps1 と sh の書き分けを消し、`app health` の1行にする |
| Fast path 3 | 変更しない。`references/health-status-commands-and-kql.md` を手動手順として残す |
| Interpretation rules | 上の3つは「スクリプトが `findings` / `gaps` に入れる」と書き換える。秘密を伏せるルールは残す |
| Scope boundary / Output template | 変更しない |

`scripts/get-functionapp-health-status.ps1` と `.sh` は、同じ PR で削除します。

## スクリプトにしない部分

- 所見のまとめと、推奨する次の行動
- ランタイムやトリガーに固有の解釈(common の参照を使う)
- 生ログの提示(ユーザーが求めたときだけ、エージェントが追加で取得する)

## 受け入れ基準

- 既存スクリプトと同じ項目が出る。
- 例外やトレースのメッセージに含まれる接続文字列、キー、SAS が伏せ字になる。
- Application Insights がないアプリで、終了コードは 0、`gaps` に理由が出る。
- クエリの1つが失敗しても、残りの結果を返す。
