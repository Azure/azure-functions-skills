# azure-functions-connector-validate

| 項目 | 内容 |
| --- | --- |
| 変更の大きさ | 大 |
| 使うコマンド | `connector gates`、`hosted invoke` |
| 段階 | P4 |
| 対象ファイル | `templates/skills/azure-functions-connector-validate/SKILL.md`、`references/deployment-gates.md` |

## 概要と目的

検証は11個のゲートを順に実行します。このうち1〜7は、状態の読み取りと比較だけで判定できます。
この7つを1回の実行にまとめます。
このスキルには「エンドポイント URL やトークンを表示しない」という安全ルールがあります。伏せ字をスクリプトで強制することで、このルールを守りやすくなります。

## 現状でターンを使っている部分

| ゲート | 今のやり方 |
| --- | --- |
| 1 接続の状態 | `az resource show` / `az rest` |
| 2 ID のアクセス | アクセスポリシーを取得し、Function App の ID と見比べる |
| 3 設定の状態 | MCP サーバー設定を取得して確認 |
| 4 実行時の設定 | アプリ設定を取得し、エンドポイントが解決されているか確認 |
| 5 初期化 | トークンを取得して MCP `initialize` を送る |
| 6 ツールの検出 | `tools/list` を送り、期待する操作と見比べる |
| 7 スキーマ | 引き渡しの内容と1項目ずつ比べる |

見積もりでは、10〜20回の呼び出しが1回になります。

## スクリプトの使い方

```text
node ../azure-functions-common/scripts/functions-tools.mjs connector gates \
  --gateway <name> --resource-group <rg> --app <function-app> --expect <handoff.json>
```

- `--expect` は、connector-mcp が作る検証の引き渡し(期待する操作 ID、ツール名、スキーマの条件、除外する操作)です。形式は [connector-mcp の仕様](azure-functions-connector-mcp.md) で決めます。
- ゲートが失敗したら、後のゲートは `not verified` になります。
- `data.gates[]` は `deployment-gates.md` の証拠の記録と同じ項目(状態、使った ID、期待、観測、伏せ字済みの根拠、担当スキル)を持ちます。

ゲート10(Hosted Skill の実行)には `hosted invoke` を使えます。

## インストラクションの変更

| 節 | 変更 |
| --- | --- |
| Required inputs | 「期待するツールとスキーマの条件は、`--expect` に渡すファイルで受け取る」と足す |
| Validation sequence 1〜7 | 「`connector gates` を1回実行する。各ゲートの意味は下の表を見る」に置き換える。7つのゲートの説明は、結果を読むための表として残す |
| Validation sequence 5 | 「ローカルの実行は開発者の ID の経路を示すだけ」という注意は残す。スクリプトも `identityUsed` にそれを記録する |
| Validation sequence 8〜9 | 変更しない。読み取りテストと書き込みテストはエージェントが行う |
| Validation sequence 10 | 「`hosted invoke` を1回実行する」と足す。結果の扱いの確認はエージェントが行う |
| Validation sequence 11 | 「ゲート1〜7は `data.gates` をそのまま記録に使う」と足す |
| Safety rules | 変更しない |
| `references/deployment-gates.md` | 表に「スクリプトが判定する」の列を足す |

## スクリプトにしない部分

- ゲート8(読み取りのスモークテスト): 業務上の結果が正しいかの判断が必要
- ゲート9(書き込みテスト): 対象、確認方法、後始末を毎回ユーザーが決める
- ゲート10の結果の評価: 正しいツールを選んだか、結果を正しく扱ったか
- 失敗したときの修復(connector-create や connector-mcp に引き渡す)
- リリースの可否の判断

## 受け入れ基準

- 出力に、トークン、関数キー、MCP エンドポイント URL、ランタイム URL、コールバック URL が含まれない(テストで確認)。
- 期待にない書き込み系のツールが `tools/list` にあるとき、ゲート6が `fail` になる。
- 接続が `Connected` でないとき、ゲート2以降は `not verified` になる。
- スクリプトは `tools/call` を送らない。
- `identityUsed` に、開発者の ID で実行したことが記録される。
