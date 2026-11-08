<!--injected-by-void-v1.1.11-->
## Void

- This project uses [Void](https://void.cloud), a full-stack Vite framework for Cloudflare Workers with file-based API routing, server-rendered pages, and typed backend services.
- Use Void's CLI and typed APIs. Before working with Void, read the relevant Markdown docs in `node_modules/void/docs/`; start with `guide/quickstart.md` for setup and `reference/cli.md` for commands.

<!--/injected-by-void-->

## アーキテクチャ（Functional DDD）

ビジネスロジックは `domain/` に閉じ込める。依存の向きは `pages/ routes/ middleware/ crons/ auth.ts → server/ → domain/ ← adapter/`。

| ディレクトリ | 役割 |
| :-- | :-- |
| `domain/<Context>/` | コンテキスト（イベストの集約）ごとのドメイン。コンテキストは Content・Member・Notification の 3 つ。Content と Notification はフォルダの直下に置く。Member は `invite/`（招待）と `profile/`（プロフィール・ログイン）にサブフォルダで分け、`workflow.ts`・`query.ts` でそれぞれの WorkFlows・Queries を 1 つにまとめる。各フォルダに、`vo.ts`（Value Object）・`type.ts`（型）・`logic.ts`（純粋な関数）・`port.ts`（副作用のインターフェース）・`workflow.ts`（コマンド。`okAsync(...).andThen(...)` でつなぐユースケース）・`query.ts`（Read Model。状態を変えずに読むだけ）を置く。コンテキスト同士は互いを知らず、つなぐのは `server/policy.ts`（ポリシー）と `server/container.ts` |
| `domain/*.ts` | コンテキストをまたいで使うもの（`vo.ts`・`port.ts`、ブラウザからも使う `youtube.ts`・`url.ts`・`base64url.ts`） |
| `schema/service.ts` | 集約ごとの WorkFlows（コマンド）と Queries（Read Model）の I/F と、Cmd / Evt / Query / View / DTO。Web 層はここに定義した WorkFlows と Queries だけを呼ぶ |
| `error.ts` | `AppError`（判別共用体）。エラーは例外ではなく `Result` で返す |
| `adapter/` | Port の実装（`drizzle/`・`r2/`・`webpush/`・`youtube/`・`system.ts`）。SQL はここにだけ書く |
| `server/` | `container.ts`（Composition Root）・`http.ts`（AppError → HTTP）など、Web 層とドメインをつなぐもの |
| `src/lib/` | ブラウザと UI のコードだけ |

### WorkFlows と Queries

- 状態を変えるもの（イベストの「〜する」）は WorkFlows（`workflow.ts`）、読むだけのもの（Read Model）は Queries（`query.ts`）に置く
- better-auth の手前のチェック（`validateProfileUpdate`・`validateSignUp`・`checkPasskeyDeletion`）と、登録の入口のチェック（`startInvite`）は、書き込み（登録・更新・削除）の前提を確かめるコマンドの一部なので WorkFlows に置く
- 名前: コマンドの入力は `…Cmd`、結果は `…Evt`（起きたこと）。Query の入力は `…Query`、戻り値は `…View`（画面 1 つ分などのまとまり）か `…Dto`（その中の 1 件）
- 別の集約の Read Model を使うときは（例: 通知のバッジの本数）、`server/container.ts` で Queries を Port に渡す

### 守ること

- `domain/` は `void/*`・`hono`・`better-auth`・`svelte`・`@schema` や外側の層を import しない（Biome で禁止している）
- Web 層（`pages/`・`routes/`・`middleware/`・`crons/`・`auth.ts`）は DB を直接触らない。必要なら WorkFlow か Query を足して `server/container.ts` から呼ぶ（Biome で禁止している）
- `auth.ts` は Void の CLI（`void db generate` など）から Node で直接読み込まれる。そこから辿られる `domain/`・`schema/`・`adapter/`・`server/` では:
  - 相対 import に必ず `.ts` を付ける（拡張子なしは解決できない。Biome で強制している）
  - `@schema` などの Vite のエイリアスを使わない。`db/schema.ts` は相対パスで読む（Biome で禁止している）
  - 型だけの import は `import type` にし、enum など型を消すだけで動かない構文を使わない（`verbatimModuleSyntax`・`erasableSyntaxOnly`）
- ブラウザからも使う定数や判定は、zod に依存しないファイル（例: `domain/Member/profile/rule.ts`）に置く。zod の VO を import すると、ツリーシェイキングで消えずにクライアントのバンドルに入る
- 確認と書き込みを 1 文で行う必要がある操作（招待の発行と消費、通知済みにする、など）は、Port の 1 メソッドにして、その契約をコメントに書く
- drizzle の `db.batch` は `db.run(sql)` を受け付けない。複数の文は 1 つずつ実行する
- 日時は `ClockPort`、乱数は `RandomPort` から受け取る（ドメインで `new Date()`・`Math.random()` を直接使わない）
- ログは `server/log.ts` の `log()`（`@nw-union/nw-utils` の `Logger`）から出す。`console.*` を直接使わない。出力先と最小レベルは環境変数 `LOG_ADAPTER`（json / console）と `LOG_LEVEL`。DB・ストレージ・外部サービスのエラーは `logAppError`（`server/logger.ts`）で残し、画面には出さない
- `@nw-union/nw-utils` のエラークラス（`AppError`・`ValidationError` など）はドメインのエラーには使わない。`error.ts` の判別共用体（`type`）で `ts-pattern` の `.exhaustive()` を使うため。nw-utils のエラーを使うのは、ロガーに渡すときの `SystemError` だけ

### テスト

- ドメインのロジック・ワークフロー・Query には、実装と同じ場所に `*.test.ts` を書く（`bun test`）。ワークフローと Query は fake の Port でテストする
- fake の Port では SQL・エイリアス・CLI からの読み込みの問題は見つからない。adapter や `auth.ts` から辿られるファイルを変えたら、`bun run build` と `bunx void db generate` も通ることを確かめる
- `bun run check` で、フォーマット・lint・型チェック・テストをまとめて確かめる
