# azure-functions-connector-create

| 項目 | 内容 |
| --- | --- |
| 変更の大きさ | 小 |
| 使うコマンド | `project inspect`、`connector contract --auth-only`、`connector status` |
| 段階 | P4 |
| 対象ファイル | `templates/skills/azure-functions-connector-create/SKILL.md` |

## 概要と目的

このスキルは、接続の作成と承認という、特権のある作業を扱います。
ほとんどの手順は判断と承認なので、スクリプトにする部分は少なくします。
スクリプトにするのは、最初の現状確認、認証方式の情報の取得、最後の接続の検証の3つだけです。

## 現状でターンを使っている部分

| 手順 | 今のやり方 |
| --- | --- |
| 1 アプリの確認 | `azure.yaml`、`infra/`、`mcp.json`、既存のリソースを個別に読む |
| 3 コネクターの契約 | 管理 API のメタデータを `az rest` で取得し、`connectionParameters` と `connectionParameterSets` を探す |
| 8 接続の検証 | `overallStatus` とアクセスポリシーを `az` で確認 |

見積もりでは、5〜8回の呼び出しが3回になります。

## スクリプトの使い方

```text
node ../azure-functions-common/scripts/functions-tools.mjs project inspect --dir .
node ../azure-functions-common/scripts/functions-tools.mjs connector contract --connector <name> --location <region> --auth-only
node ../azure-functions-common/scripts/functions-tools.mjs connector status --gateway <name> --resource-group <rg> --connection <name>
```

- `--auth-only` は、認証のパラメーターとパラメーターセットだけを返す。必須かどうか、種類、秘密かどうかが分かる。
- `connector status` は、Function App の ID に明示的なアクセスポリシーがあるかどうかも返す。

## インストラクションの変更

| 節 | 変更 |
| --- | --- |
| Workflow 1 | 「`project inspect` を実行する。既存の Connector Namespace があれば `connector status` も実行する」に変える |
| Workflow 3 | 「`connector contract --auth-only` を実行する」に変える。「表示名から認証方式を推測しない」というルールは残す |
| Workflow 2、4〜7 | 変更しない |
| Workflow 8 | 「`connector status` を実行し、`Connected` であることと、アクセスポリシーがあることを確認する」に変える |
| Safety rules / Definition of done | 変更しない |

## スクリプトにしない部分

- 必要な機能の整理と、認証方式の選択
- Bicep の作成と、`azd` による作成
- OAuth 同意(人が `connectors.azure.com` で行う)
- 接続の所有者が意図したアカウントかどうかの確認
- 秘密の取り扱い

## 受け入れ基準

- `--auth-only` の出力に、秘密の値が含まれない(項目名と種類だけ)。
- リソースが作成済みでも `Connected` でなければ、`findings` に「未承認」と出る。
- スクリプトは、接続やアクセスポリシーを作成・変更しない。
