# azure-functions-create

| 項目 | 内容 |
| --- | --- |
| 変更の大きさ | 大 |
| 使うコマンド | `project inspect`、`template find`、`template write`、`project verify-local` |
| 段階 | P1(`verify-local`)、P3(`template`) |
| 対象ファイル | `templates/skills/azure-functions-create/SKILL.md` |

## 概要と目的

プロジェクト作成で時間がかかるのは、テンプレートのファイルを1つずつ書く部分と、ローカル検証の部分です。
MCP が返すファイル一覧は 100KB を超えることがあり、今はエージェントが JSON を読んで1ファイルずつ書いています。
これを1回の書き出しにします。ローカル検証(ビルド、起動、リクエスト、停止)も1回にします。

## 現状でターンを使っている部分

| 手順 | 今のやり方 |
| --- | --- |
| 既存プロジェクトかどうか | `host.json` を探す |
| A.4 / A.5 のファイル書き出し | `files` 配列の要素ごとに Write を実行。大きい出力は一時ファイルを読み直す |
| 設定と依存関係のマージ | `local.settings.json` と依存関係のファイルを読んで編集 |
| Path B のマニフェスト取得と絞り込み | 取得、失敗時の代替、絞り込み、ZIP またはファイル単位のダウンロード |
| A.6 / B.3 の検証 | ビルド、`func start`、起動の待機、`curl`、停止を個別に実行 |

見積もりでは、Path A のファイル書き出しが10〜30回から1回に、検証が5〜8回から1回になります。

## スクリプトの使い方

```text
# 既存プロジェクトかどうか
node ../azure-functions-common/scripts/functions-tools.mjs project inspect --dir <target>

# Path A: MCP の結果を書き出す(MCP の出力を保存したファイルを渡す)
node ../azure-functions-common/scripts/functions-tools.mjs template write --from <mcp-output.json> --dir <target> [--merge]

# Path B: マニフェストから探して書き出す
node ../azure-functions-common/scripts/functions-tools.mjs template find --language <lang> --resource <name>
node ../azure-functions-common/scripts/functions-tools.mjs template write --from <template-id> --dir <target>

# 検証
node ../azure-functions-common/scripts/functions-tools.mjs project verify-local --dir <target> --http /api/<name>
```

## インストラクションの変更

| 節 | 変更 |
| --- | --- |
| Step 0 / Step 1 | 変更しない。MCP ツールの有無はエージェントが確認する |
| A.1〜A.3 | 変更しない。MCP の呼び出しとテンプレートの選択はエージェントが行う |
| A.4 / A.5 | 「MCP の出力をファイルに保存し、`template write --from <file>` を1回実行する。ファイルを1つずつ書かない」に置き換える。大きな出力の注意書きは「出力が一時ファイルに保存されたら、そのパスを `--from` に渡す」に短くする |
| A.6 | 「`project verify-local` を1回実行する」に置き換える。エミュレーターの承認ルールと、エミュレーターがない場合の説明は残す |
| B.1 | 9段階のうち 1〜5(取得、絞り込み、ダウンロード)を `template find` と `template write` に置き換える。6〜7(合成と不要コードの削除)はエージェントに残す。9の `azd up` は消し、deploy スキルへの案内にする |
| B.3 | A.6 と同じ |
| Path C(Go) | 変更しない。`verify-local` は Go にも使える、と1行足す |
| Adding functions to existing projects | 「`project inspect` で既存プロジェクトと分かったら、`template write --merge` を使う」に変える |

## スクリプトにしない部分

- MCP ツールの呼び出し(スクリプトからは呼べない)
- テンプレートの選択とユーザーへの確認
- 複数テンプレートの合成、業務ロジックの追加、不要なデモコードの削除
- エミュレーターのインストールと起動
- `npm install` などの依存関係の取得。`verify-local` はビルドの前に、必要なら実行することを `findings` で知らせるだけにする(未決: 実行まで含めるか)

## 受け入れ基準

- `template write` は対象フォルダーの外に書かない(`../` を含むパスを拒否する)。
- 既存ファイルは上書きせず、`data.skipped` に出る。
- `--merge` のとき、`local.settings.json` の既存の設定を消さない。
- `verify-local` は、成功しても失敗しても `func` のプロセスを残さない。
- HTTP の確認に HEAD を使わない。
- CDN が使えないとき、GitHub の代替から取得する。両方失敗したら終了コード 3 になる。
