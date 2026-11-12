# 01. スクリプトカタログ

作るスクリプトは `functions-tools.mjs` の1本です。6つのグループに、合計15個のコマンドがあります。
グループを増やすときは、既存のグループに入らない理由をこの文書に書いてからにします。

```text
node functions-tools.mjs <group> <command> [options]
```

共通の出力形式、終了コード、安全ルールは [00-overview.md](00-overview.md) を見てください。

## 一覧

| グループ | コマンド | 種類 | 使うスキル |
| --- | --- | --- | --- |
| `env` | `check` | 読み取り | setup、deploy、hosted-skills、update |
| `project` | `inspect` | 読み取り | deploy、doctor、create、diagnostics、hosted-skills、connector-create、connector-mcp、update、migrate |
| `project` | `scan` | 読み取り | doctor |
| `project` | `verify-local` | プロセス起動 | create、update |
| `template` | `find` | 読み取り(ネットワーク) | create、hosted-skills |
| `template` | `write` | ファイル書き込み | create、hosted-skills |
| `app` | `inventory` | 読み取り | inventory、diagnostics、best-practices |
| `app` | `health` | 読み取り | health-status、diagnostics、best-practices |
| `app` | `deploy-status` | 読み取り | deploy、hosted-skills |
| `hosted` | `models` | 読み取り | hosted-skills |
| `hosted` | `sync-settings` | ファイル書き込み | hosted-skills |
| `hosted` | `invoke` | 関数を1回起動 | hosted-skills、connector-validate |
| `connector` | `status` | 読み取り | connector-create、connector-mcp、connector-validate |
| `connector` | `contract` | 読み取り | connector-create、connector-mcp |
| `connector` | `gates` | 読み取り | connector-validate |

## env — 開発マシンの確認

### `env check [--language <lang>] [--for deploy]`

- `az`、`azd`、`func`、`node`、`python`/`python3`、`dotnet`、`go` のバージョンを並列に取得する。
- `--language` を省略したら `--dir` のプロジェクトから言語を推定し、関係のない言語は確認しない。
- 下限と比べる。Go のときは Core Tools 4.12、Azure CLI 2.87.0 を使う。
- `az account show` と `azd auth login --check-status` でログイン状態を確認する。
- `data`: ツールごとの `{ found, version, required, ok }`、`os`、`shell`、`subscription`(名前と ID)。
- `findings`: 不足や古いツール。`fix` には実行中の OS に合うコマンドだけを入れる。
- Azure Skills プラグインの有無は調べない。これはエージェントが自分のスキル一覧で確認する。

## project — ローカルのプロジェクト

### `project inspect [--hash]`

プロジェクトの事実を1回で集めます。複数のスキルが最初に呼ぶ、共通の入口です。

- `host.json` を探し、Functions アプリのルートを列挙する(複数あればすべて)。
- 言語、プログラミングモデル、トリガーとバインディング、依存関係のファイル、IaC(Bicep / Terraform / `azure.yaml`)を判定する。
- Hosted Skills アプリかどうかを判定する(`*.agent.md`、`agents.config.yaml`、`mcp.json`、`function_app.py`)。
- デプロイの状態を判定する。`.azure/deployment-plan.md` の有無と状態、`azure.yaml` の `metadata.template`、`infra/main.bicep` または `infra/*.tf`、`.azure/*/config.json` の azd 環境名。
- `--hash` を付けると、対象ファイルの SHA-256 を返す(migrate 用)。
- `next`: deploy 用に `hosted-skills` / `azure-prepare` / `azure-validate` / `azure-deploy` のどれに進むかを返す。
- `data.doctorTags`: doctor が読むべきチェックリストのタグ(`language:python`、`iac`、`supply-chain` など)。
- `data.referenceTags`: common の参照を選ぶためのタグ(言語と、トリガーやバインディングの種類)。
- C# プロジェクトでは、`TargetFramework`、Functions 関連のパッケージ参照(宣言されたバージョン)、in-process か isolated かの判定を返す。`next.scenario` に update のシナリオ名を入れる。

### `project scan [--scope <all|config|security|supply-chain>]`

doctor の「ファイルだけで判定できるチェック」を実行します。プロジェクトのコードは実行しません。

- 対象: `CF-001`〜`003`、`RT-002`、`RT-004`、`AS-001`〜`003`、`AS-006`〜`008`、`DP-002`〜`004`、`DP-008`、`PY-008`、`PY-009`、`SC-001`(秘密の走査)、言語別の機械的なもの(`GO-004`、`JS-004`、`JS-005` など)。
- `findings`: doctor の出力スキーマと同じ項目(`id`、`category`、`severity`、`status`、`file`、`line`、`recommendation`)。
- `data.notChecked`: スクリプトが判定しなかったチェック ID の一覧。エージェントはこの分だけを見る。
- チェック ID とルールの対応表は、`references/*.md` の表を正とし、テストで食い違いを検出する。

### `project verify-local [--http <path>] [--port <n>]`

- 言語に応じてビルドする(`npm run build`、`dotnet build`、`mvn package` など)。
- `func start` を起動し、関数の一覧が出るまで待つ。時間切れは `--timeout`。
- HTTP トリガーには GET を1回送り、状態コードと本文の先頭を記録する。HEAD は使わない。
- 必ずプロセスを止めてから終了する。
- `data`: ビルド結果、登録された関数、リスナー、HTTP の結果。ログは `--out` のファイルに書く。
- エミュレーターの起動やインストールはしない。必要な場合は `gaps` に書く。

## template — テンプレートの取得

### `template find --language <lang> [--id <template-id>] [--resource <name>]`

- マニフェストを CDN から取得する。失敗したら GitHub の同じファイルを使う。
- 言語、リソース、IaC で絞り込み、候補を返す。
- `data`: `id`、説明、`repositoryUrl`、`folderPath`、`gitRef`。

### `template write --from <mcp-json-file | template-id> --dir <target> [--merge]`

- `--from` にファイルを渡すと、MCP の `functions_template_get` が返した JSON の `files` 配列をそのまま書き出す。
- `--from` にテンプレート ID を渡すと、マニフェストの `repositoryUrl`、`folderPath`、`gitRef` から取得して書き出す。
- 対象フォルダーの外には書かない(パスを正規化して確認する)。既存ファイルは上書きせず、`data.skipped` に入れる。
- `--merge` のときは、`local.settings.json` の設定と依存関係を既存のファイルに足す。
- `data`: 書いたファイル、飛ばしたファイル、足した設定名。

## app — デプロイ済み Function App

### `app inventory --app <name> [--subscription] [--resource-group] [--with-health] [--hours <n>]`

- 既存の `get-functionapp-inventory.ps1` / `.sh` と同じ項目を集める。`az` の呼び出しは並列にする。
- サブスクリプションやリソースグループが分からなければ探す。複数見つかったら候補を返して終わる。
- `--with-health` を付けると `app health` の結果も同じ出力に入れる(diagnostics、best-practices 用)。
- `data.referenceTags`: common の参照を選ぶためのタグ。`project inspect` と同じ形にする。

### `app health --app <name> [--hours <n>]`

- 既存の `get-functionapp-health-status.ps1` / `.sh` と同じ項目を集める。
- Application Insights のクエリは、ワークスペース型の表(`AppRequests` など)を先に使う。
- `%SETTING_NAME%` が解決されていないログを見つけたら `findings` に入れる。

### `app deploy-status --resource-group <name>`

- リソースグループ、デプロイの `provisioningState`、Function App の状態を1回で返す。
- `azd up` の表示が止まって見えるときに、進行中かどうかを確かめるために使う。

## hosted — Hosted Skills アプリ

### `hosted models --location <region> [--subscription]`

- `AIServices` `S0` が使えるか、GPT モデルの一覧、`GlobalStandard` のクォータを並列に取得する。
- `data.candidates`: モデル名、バージョン、残りクォータ、推奨順位。クォータ 0 のものは `deployable: false`。
- 推論設定に対応しているかは判定しない。公式文書の確認はエージェントに残す。
- 取得に失敗したら `gaps` に書く。エージェントは `gpt-4.1` に戻す(今のルールと同じ)。

### `hosted sync-settings [--env <azd-env>]`

- `azd env get-values` の値を `src/local.settings.json` に反映する。
- 出力には設定の名前だけを返し、値は返さない。

### `hosted invoke --app <name> --function <stem> [--wait <分>]`

- マスターキーを取得し、`POST /admin/functions/<stem>` を **1回だけ** 送る。キーは出力しない。
- 起動時刻より後の `requests`、`traces`、`exceptions` を、結果が出るか時間切れになるまで確認する。
- `data`: 受け付けの状態コード、実行の成否、所要時間、エラーの要約。
- 時間切れのときは `gaps` に書いて終わる。関数をもう一度起動しない。

## connector — Connector Namespace

### `connector status --gateway <name> --resource-group <name> [--connection <name>]`

- 接続の `overallStatus`、アクセスポリシー、MCP サーバー設定(有効か、参照先の接続、エンドポイントの有無)を返す。
- エンドポイント URL やランタイム URL は出力しない。有無だけを返す。

### `connector contract --connector <name> --location <region> [--operations <id,...>] [--auth-only]`

- 管理 API のメタデータを取得する。`--auth-only` のときは `connectionParameters` と `connectionParameterSets` だけを返す。
- `--operations` を付けると、指定した操作の入力スキーマをそのまま `--out` のファイルに書く。スキーマは加工しない。
- 動的スキーマ(`dynamicInvoke`)が必要な操作は `gaps` に入れる。

### `connector gates --gateway <name> --resource-group <name> --app <name> --expect <handoff.json>`

- 検証ゲートの1〜7(接続、ID のアクセス、設定、アプリ設定の解決、`initialize`、`tools/list`、スキーマ比較)を順に実行する。
- ゲートが失敗したら、それに依存する後のゲートは実行せず `not verified` にする。
- `data.gates`: ゲートごとの `pass` / `fail` / `not verified`、伏せ字済みの根拠、担当スキル。
- ゲート8以降(読み取りテスト、書き込みテスト、Hosted Skill の実行)は実行しない。

## スクリプトにしないもの

| 処理 | 理由 |
| --- | --- |
| Azure リソースの作成・変更(`azd up`、Bicep の適用、MCP 設定の登録) | 承認が必要で、Azure Skills や利用者のリポジトリが担当する |
| OAuth 同意 | 人が行う操作 |
| コネクターの書き込みテスト | 対象と後始末を、毎回ユーザーが決める |
| デプロイ観測のテレメトリ | `telemetry.mjs`(FRD-0003)が担当する |
| Issue や PR の作成 | 毎回内容が違い、承認が必要 |
