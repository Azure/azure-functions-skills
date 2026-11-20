# azure-functions-common

| 項目 | 内容 |
| --- | --- |
| 変更の大きさ | 配置先(ワークフローの変更はなし) |
| 使うコマンド | 全コマンドの置き場所 |
| 段階 | P0 |
| 対象ファイル | `templates/skills/azure-functions-common/SKILL.md`、`references/tools.md`(新規)、`references/routing.md`、`src/build/` |

## 概要と目的

common は、スキル群が共有する参照資料の置き場所です。ここに、共有するスクリプトも置きます。
スクリプトの呼び出し方と出力の読み方を1か所に書き、他のスキルの SKILL.md には短い1行だけを書けるようにします。

## 変更の内容

### 1. スクリプトの配置

- ビルド時に、`skills/azure-functions-common/scripts/functions-tools.mjs` を各ペイロードに出力する。
- `templates/skills/azure-functions-common/` には置かない(`templates/` は手書きの正本だけ)。
- ライセンス表示が必要な依存は持たない(実行時の依存パッケージはゼロ)。

### 2. `references/tools.md`(新規)

他のスキルが参照する、呼び出し方の説明です。次の内容を書きます。

- 呼び出しの形と、パスの決め方(スキルのフォルダーからの相対パス)
- 出力の JSON の読み方(`data`、`findings`、`gaps`、`next`)
- 終了コードと、そのときの動き
- `node` がないときは、各スキルの手動手順に切り替えること。インストールやパッケージマネージャーでの取得はしないこと
- 影響のある4つのコマンド(`template write`、`project verify-local`、`hosted sync-settings`、`hosted invoke`)と、承認の後に呼ぶこと
- スクリプトの結果を、同じコマンドでもう一度確かめないこと

### 3. `references/routing.md`

- `project inspect` と `app inventory` が返す `referenceTags` と、参照ファイルの対応表を足す。
- 既存の読み込みルール(言語の参照は1つだけ、Extension Bundles は .NET 以外だけ、など)は変更しない。タグはこのルールに従って作る。

## インストラクションの変更

| 節 | 変更 |
| --- | --- |
| Scope | 「共有スクリプト `scripts/functions-tools.mjs` と、その使い方 `references/tools.md`」を足す |
| 「Task-specific skills keep their own workflows, scripts, ...」 | 「スキル固有のスクリプトは持たず、共有スクリプトを使う」に直す |
| Loading rules | 「`referenceTags` があるときは、それに合う参照だけを読む」を足す |

## ビルド側の変更

| ファイル | 変更 |
| --- | --- |
| `src/tools/` | 新規。グループごとのモジュールと `shared/` |
| `src/build/tools-runtime.ts` | 新規。esbuild で1ファイルにまとめる(`telemetry-runtime.ts` と同じ方式) |
| `src/build/build-target.ts` | common の `scripts/` にツールを書き出す処理を足す |
| `src/build/verify-plugin-payload.ts` | ツールがペイロードにあることと、内容がビルド結果と同じであることを確認する |
| `tests/tools-*.test.ts` | 新規。グループごとのテスト |

## 受け入れ基準

- 3つのホスト向けのペイロードすべてに、同じ内容のツールが入る。
- ツールは `node_modules` なしで動く。
- `npm run check` が通る。
- common の SKILL.md は、今までどおりワークフローを持たない。
