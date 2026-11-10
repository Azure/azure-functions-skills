# 00. 全体方針

## 1. 何を変えるか

スキルの手順のうち、次の3条件を満たす部分をスクリプトに移します。

- 毎回同じコマンド列になる
- 結果の解釈に判断が要らない(バージョン比較、ファイルの有無、状態値の確認など)
- 読み取りだけで完結する

次のものはスクリプトに移しません。エージェントとユーザーに残します。

- ユーザーへの質問と承認
- OAuth 同意、資格情報の入力
- Azure リソースの作成・変更・削除
- 設計判断、コードの意味解析、原因の推定

## 2. 目標

| 目標 | 確認方法 |
| --- | --- |
| 定型部分のツール呼び出し回数を減らす | 変更前後で同じシナリオを実行し、呼び出し回数を比べる |
| 3つのホスト(Copilot CLI / Claude Code / Codex CLI)と3つの OS で同じコマンドが動く | 各 OS の CI で単体テストを実行する |
| Node がない環境でも今までどおり使える | SKILL.md に手動手順への切り替えを残す |
| 既存の安全ルール(秘密を出さない、承認なしに書き込まない)を弱めない | スクリプト側で伏せ字と読み取り専用を強制し、テストで確認する |

## 3. Node を選ぶ理由

| 観点 | PowerShell + Bash | Node(単一の `.mjs`) |
| --- | --- | --- |
| 実装の数 | 2つ。現状 inventory は ps1 が126行、sh が221行 | 1つ |
| JSON の処理 | sh 版は `python3` が必要 | 標準機能で扱える |
| エージェントの分岐 | OS とシェルを見て選ぶ | `node <path>` の1通り |
| テスト | 既存の仕組みがない | `src/` に TypeScript で書き、Vitest で単体テストできる |
| 並列実行 | 書きにくい | `Promise.all` で `az` を並列に呼べる |
| 前例 | hooks の ps1/sh は node を呼ぶだけの薄い入口 | `hooks/runtime/telemetry.mjs` が同じ方式 |

Node の導入状況について。`docs/development.md` には、3つのホストがいずれも Node を必要とすると書かれています。
ただし、ネイティブ版のインストーラーで入れた場合は Node がないことがあります。
そのため「Node がなければ手動手順に切り替える」という逃げ道を必ず残します(5章)。

## 4. 配置とビルド

- ソースは `src/tools/` に TypeScript で置きます。グループごとに1ファイル(`env.ts`、`project.ts`、`template.ts`、`app.ts`、`hosted.ts`、`connector.ts`)と、共通部分の `shared/` です。
- ビルド時に esbuild で1ファイルにまとめ、`skills/azure-functions-common/scripts/functions-tools.mjs` として各ペイロードに出力します。テレメトリの `telemetry.mjs` と同じ流れです。
- `templates/` にはビルド結果を置きません。`templates/` は手書きの正本だけ、という今のルールを守ります。
- 実行時の依存パッケージはゼロにします。Node 18 の標準モジュールだけを使います。
- 各スキルからは `../azure-functions-common/scripts/functions-tools.mjs` という相対パスで呼びます。スキル間の相対参照は、すでに `../azure-functions-common/references/routing.md` で使われています。

common に置く理由は、プラグインとして入れた場合も、スキルだけを入れた場合も、同じ場所に届くからです。

## 5. SKILL.md の書き方の共通ルール

各スキルでは、定型部分を次の形に置き換えます。

```text
1. 次のコマンドを1回実行する。
   node "<このスキルのフォルダー>/../azure-functions-common/scripts/functions-tools.mjs" <group> <command> [options]
2. 出力の JSON を読み、`findings`、`gaps`、`next` に従う。
3. `node` がない、ファイルがない、または終了コードが 3 の場合は、references/<手動手順>.md に従う。
   パッケージマネージャーでの取得や Node のインストールはしない。
```

- 呼び出し方の詳細は common の `references/tools.md` に1回だけ書き、各スキルはそこを参照します。
- 手動手順の文書(既存の `references/*.md`)は消さずに残します。
- スクリプトの結果を、エージェントが同じコマンドでもう一度確かめる必要はない、と明記します。

## 6. 出力の共通ルール

標準出力には JSON を1つだけ出します。

```json
{
  "schemaVersion": 1,
  "command": "env check",
  "ok": true,
  "summary": "必須ツール 5 個中 4 個が条件を満たす",
  "data": {},
  "findings": [
    { "id": "ENV-AZ-LOGIN", "severity": "warn", "title": "Azure にログインしていない", "fix": "az login" }
  ],
  "gaps": [
    { "check": "resource-health", "reason": "Flex Consumption では未対応" }
  ],
  "next": { "skill": "azure-functions-create", "reason": "環境が整った" }
}
```

| 項目 | 意味 |
| --- | --- |
| `data` | コマンドごとの事実。形は [01-script-catalog.md](01-script-catalog.md) に書く |
| `findings` | 問題点。ID、重大度、根拠、直し方 |
| `gaps` | 実行できなかった確認と、その理由。「確認していない」を「問題なし」と区別する |
| `next` | 次に使うスキルや手順の候補。決めるのはエージェント |

| 終了コード | 意味 | エージェントの動き |
| --- | --- | --- |
| 0 | 実行できた(問題が見つかった場合も 0) | JSON に従う |
| 2 | 引数の誤り | 引数を直して1回だけ再実行 |
| 3 | 前提がない(`az` がない、未ログインなど) | `findings` の直し方を伝える、または手動手順へ |
| 1 | 想定外の失敗 | 手動手順へ。同じコマンドを繰り返さない |

共通オプション: `--dir <path>`(対象フォルダー)、`--out <file>`(大きな出力をファイルに書き、標準出力には要約だけ出す)、`--format text`(人が読む表示)、`--timeout <秒>`。

## 7. 安全ルール

- **既定は読み取り専用**。ファイルやプロセスに影響するコマンドは次の4つだけで、SKILL.md 側で承認の後に呼びます。

  | コマンド | 影響 |
  | --- | --- |
  | `template write` | `--dir` の下にファイルを書く。既存ファイルは上書きしない |
  | `project verify-local` | ビルドと `func start` を実行し、終わったら止める |
  | `hosted sync-settings` | `src/local.settings.json` を更新する |
  | `hosted invoke` | デプロイ済みの関数を1回だけ起動する。再試行しない |

- Azure リソースの作成・変更・削除はしません。`az` の設定変更や拡張機能のインストールもしません。
- 秘密は出力しません。接続文字列、キー、トークン、SAS、MCP エンドポイント URL、コールバック URL は、スクリプト内で伏せ字にします。設定は名前と有無だけを返します。
- ネットワークの接続先は、`az` / `azd` 経由の Azure と、テンプレートの CDN、GitHub だけです。
- テレメトリは送りません。デプロイ観測(FRD-0003)は今の `telemetry.mjs` のままにします。
- Windows では `az`、`azd`、`func` が `.cmd` なので、共通の実行ヘルパーで吸収します。引数は配列で渡し、文字列の連結でコマンドを組み立てません。

## 8. テスト

- `src/tools/` の関数は、コマンド実行とファイル読み取りを差し替えられる形にし、Vitest で単体テストします。リポジトリの TDD ルールに従い、テストを先に書きます。
- `az` の応答はフィクスチャーで再現します。実際の Azure への接続は単体テストでは行いません。
- 伏せ字は専用のテストを持ちます(秘密らしい値が出力に残らないこと)。
- `verify:plugin-payload` に、ツールがペイロードに入っていることの確認を足します。
- SKILL.md の変更は `validate:skills` と `lint:security` で確認します。

## 9. 進め方

段階は [README.md](README.md) の表のとおりです。各段階で次を1つの PR にまとめます。

1. `src/tools/` のコマンドとテスト
2. 対象スキルの SKILL.md の変更
3. `npm run build:plugin-payload` による生成物の更新

## 10. 未決事項

| # | 論点 | 提案 |
| --- | --- | --- |
| Q1 | 配置先は common の `scripts/` でよいか | よい。スキルだけを入れた場合にも届く。別案は `hooks/runtime/` の隣だが、スキルだけの導入では届かない |
| Q2 | 既存の ps1/sh をいつ消すか | P2 で Node 版に置き換える PR で同時に消す。手動手順の文書が残るので、逃げ道はある |
| Q3 | 既存スクリプトは `az config set` と `az extension add resource-graph` を黙って実行している。続けるか | やめる。Resource Graph が使えなければ `gaps` に書き、`az functionapp list` で探す |
| Q4 | `lint:security` と `validate:skills` が、ビルドで注入する `.mjs` を許すか | 未確認。P0 で確認し、必要ならルールを足す |
| Q5 | ターン数の効果をどう測るか | 変更前後で同じシナリオを手動で1回ずつ実行して数える。LLM を使う評価は `workflow_dispatch` か、信頼できるコードでのローカル実行に限る |
| Q6 | FRD にするか | 共有基盤の契約を足すので、FRD の対象になり得る。必要なら P0 の前に FRD を起こす |
