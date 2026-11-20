# azure-functions-connector-mcp

| 項目 | 内容 |
| --- | --- |
| 変更の大きさ | 中 |
| 使うコマンド | `project inspect`、`connector status`、`connector contract` |
| 段階 | P4 |
| 対象ファイル | `templates/skills/azure-functions-connector-mcp/SKILL.md`、`references/metadata-to-mcp.md` |

## 概要と目的

MCP の公開では、コネクターのメタデータからスキーマを「加工せずに」取り出すことが重要です。
今はエージェントが `az rest` を何度も実行し、大きな応答をコンテキストに読み込んでいます。
取得をスクリプトにまとめ、スキーマをファイルに直接書き出すようにします。
ターンが減るだけでなく、エージェントがスキーマを要約したり省略したりする危険も減ります。

## 現状でターンを使っている部分

| 手順 | 今のやり方 |
| --- | --- |
| 1 現状の確認 | `infra/`、`mcp.json`、デプロイ済みの設定を個別に読む |
| 前提の確認 | 接続の状態とアクセスポリシーを `az` で確認 |
| 2 操作の一覧 | `az rest` で操作カタログを取得 |
| 3 スキーマの取得 | 操作ごとに `az rest` を実行。Swagger のエクスポートも取得 |
| 8 エンドポイントの取得 | 登録後に `az rest` で設定を読む |

見積もりでは、8〜15回の呼び出しが3回になります。

## スクリプトの使い方

```text
node ../azure-functions-common/scripts/functions-tools.mjs project inspect --dir .
node ../azure-functions-common/scripts/functions-tools.mjs connector status --gateway <name> --resource-group <rg> --connection <name>
node ../azure-functions-common/scripts/functions-tools.mjs connector contract --connector <name> --location <region> \
  --operations <id,id,...> --out <dir>
```

- `--operations` なしの `connector contract` は、操作の一覧(ID、種類、読み取りか書き込みか、非推奨かどうか)だけを返す。
- `--operations` 付きのときは、スキーマを `--out` のフォルダーに1操作1ファイルで書く。標準出力には要約だけを出す。
- 動的な値やスキーマが必要な操作は `gaps` に入る。その分は、エージェントが `dynamicInvoke` を使って解決する。
- `connector status` は、登録後のエンドポイントの「有無」を返す。値は返さない。

## 検証の引き渡しの形式

手順10の引き渡しを、`connector gates --expect` が読めるファイルにします。

```json
{
  "connection": "<name>",
  "operations": [
    { "operationId": "GetEmails", "toolName": "<tools/list で見えた名前>", "sideEffect": "read",
      "schemaAssertions": { "required": ["folderPath"] } }
  ],
  "excludedOperations": ["SendEmail"],
  "safeReadTest": { "toolName": "...", "arguments": {} }
}
```

この形式は `references/metadata-to-mcp.md` の「Validation handoff」に書きます。

## インストラクションの変更

| 節 | 変更 |
| --- | --- |
| Preconditions | 「`connector status` を実行して確認する」に変える |
| Workflow 1 | 「`project inspect` と `connector status` を実行する」に変える。共有されている設定の利用者を確認するルールは残す |
| Workflow 2 | 「`connector contract` で操作の一覧を取得する」に変える。選ぶ基準は残す |
| Workflow 3〜4 | 「`connector contract --operations` でスキーマをファイルに書き出す。書き出されたスキーマを書き換えない」に変える。保持のルールは残す |
| Workflow 5〜7 | 変更しない。パラメーターの分け方、安全面の確認、登録は、エージェントと利用者のリポジトリが行う |
| Workflow 8 | 「`connector status` でエンドポイントがあることを確認する」と足す。値を環境の設定に保存する処理は、今までどおりデプロイ側で行う |
| Workflow 10 | 引き渡しを上の JSON の形式で書く、と変える |
| `references/metadata-to-mcp.md` | `az rest` のコマンドは手動手順として残す |

## スクリプトにしない部分

- 操作の選択と、書き込み操作の承認
- `userParameters` と `agentParameters` の分け方
- MCP 設定の登録(PUT)。利用者のリポジトリのブートストラップ処理が行う
- `mcp.json` の編集
- 動的スキーマの解決(`dynamicInvoke`)

## 受け入れ基準

- 書き出したスキーマが、API の応答と同じ内容である(入れ子、配列、必須、形式、列挙、説明を保つ)。
- 出力に、エンドポイント URL やランタイム URL が含まれない。
- トリガーと非推奨の操作が、一覧で区別できる。
- スクリプトは PUT、POST、PATCH、DELETE を送らない(`dynamicInvoke` も送らない)。
