<!--injected-by-void-v1.1.11-->
## Void

- This project uses [Void](https://void.cloud), a full-stack Vite framework for Cloudflare Workers with file-based API routing, server-rendered pages, and typed backend services.
- Use Void's CLI and typed APIs. Before working with Void, read the relevant Markdown docs in `node_modules/void/docs/`; start with `guide/quickstart.md` for setup and `reference/cli.md` for commands.

<!--/injected-by-void-->

## アーキテクチャ（Functional DDD）

ビジネスロジックは `domain/` に閉じ込める。依存の向きは `pages/ routes/ middleware/ crons/ auth.ts → server/ → domain/ ← adapter/`。コンテキストの入口の I/F は `api.ts`、出口の I/F（副作用）は `port.ts`。Scott Wlaschin の『Domain Modeling Made Functional』にならい、コンテキストの中は技術の種類ではなくワークフロー（近い操作のまとまり）で分ける。

| ディレクトリ | 役割 |
| :-- | :-- |
| `domain/<Context>/` | コンテキスト（イベストの集約）ごとのドメイン。コンテキストは Content・Member・Notification の 3 つで、どれも同じ形にする（下の「コンテキストの中身」）。コンテキスト同士は互いを知らず、つなぐのは `server/process/`（ポリシー）と `server/container.ts` |
| `domain/shared/` | コンテキストをまたいで使うドメインの概念。`error.ts`（`AppError`。判別共用体で、エラーは例外ではなく `Result` で返す）・`vo.ts`・`port.ts`（`ClockPort`・`RandomPort`） |
| `adapter/` | Port の実装（`drizzle/`・`r2/`・`webpush/`・`youtube/`・`system.ts`）。SQL はここにだけ書く |
| `server/` | Web 層とドメインをつなぐもの。直下に `container.ts`（Composition Root）。`process/`（コンテキストをつなぐ流れ: `policy.ts`（ポリシー）・`sync.ts`・`notify.ts`）・`http/`（HTTP の都合: `error.ts`（AppError → HTTP）・`invite-cookie.ts`・`avatar-file.ts`）・`log/`（ロガー） |
| `lib/` | どの層からも（ブラウザからも）使う、アプリに依存しない汎用の関数（`base64url.ts`・`youtube.ts`・`url.ts`）。フレームワークやアプリの層を import しない（Biome で禁止している） |
| `src/lib/` | ブラウザと UI のコードだけ。`components/`（Svelte のコンポーネント）・`client/`（ブラウザで動く処理: `push.ts`・`pwa.ts`・`youtube-player.ts`・`thumbnail.ts` など）・`styles/`（共通の CSS） |

### コンテキストの中身

```
domain/<Context>/
  api.ts         入口の I/F。…Usecase と、操作ごとの Cmd / Evt / Query / View、DTO
  type.ts        ドメインの型
  vo.ts          Value Object（valibot で検証して作る値）
  port.ts        副作用の I/F（adapter/ が実装する）
  converter.ts   Converter: ドメインの型 → DTO の変換（convTo…Dto など）。必要なコンテキストだけ
  workflow/      ワークフロー。近い操作をまとめて 1 ファイル（例: Content の sync.ts・playlist.ts・feed.ts）
  usecase.ts     new…Usecase。workflow/ に依存を渡して …Usecase を作るだけ
```

依存の向き（矢印は import する向き）:

```
usecase → workflow/* → api・converter・type・vo・port → shared → lib
                       converter → api・type
                       port → type・vo
                       type → vo
```

- `workflow/<名前>.ts` は、上から順に「依存（`Pick<…Port, "…">` で、そのワークフローが使うメソッドだけ）→ Step（純粋な関数。バリデーションや計算）→ 実装（`new…Workflow`。Step と Port を `okAsync(...).andThen(...)` でつなぐ）」と並べる。1 つのワークフローを 1 ファイルで上から読めるようにする
- 入力の検証（Cmd / Query → ドメインの型）は、そのワークフローの最初の Step にする（DTO → ドメインの型の変換は converter.ts に置かない）。複数のワークフローで使う検証は `vo.ts` に置く
- コマンド（状態を変えるもの）と Query（読むだけ）は分けずに、同じワークフローのファイルに置く
- Step や定数をほかのワークフローから使うときは、そのワークフローのファイルから import する（例: `workflow/account.ts` が `workflow/avatar.ts` の `removeOldAvatar` を使う）

### ユースケース（…Usecase）

- コンテキストごとに 1 つの `…Usecase`（`ContentUsecase`・`MemberUsecase`・`NotificationUsecase`）を `api.ts` に定義する。`server/container.ts` は `contentUsecase`・`memberUsecase`・`notificationUsecase` を返す
- Web 層は `domain/<Context>/api.ts` の型と、`server/container.ts` が返す `…Usecase` だけを使う
- `api.ts` の書き方（`domain/Content/api.ts` が見本）:
  - 操作ごとに関数の型を 1 つ書き（例: `type CreatePlaylist = (cmd: CreatePlaylistCmd) => ResultAsync<CreatePlaylistEvt, AppError>`）、そのすぐ後に、その操作の Cmd / Evt / Query / View を置く。関数の型には、何をするかと失敗の条件をコメントで書く
  - `// Commands` と `// Queries` の区切りで分け、最後に `…Usecase` の interface（`// Commands`・`// Queries` の順に、操作の名前と関数の型を並べる）と、複数の操作で使う DTO を置く
- 各ワークフローは `Pick<…Usecase, "…">` を返し、`usecase.ts` がまとめる（`…Usecase` をすべて実装していることを型で確かめる）
- better-auth の手前のチェック（`validateProfileUpdate`・`validateSignUp`・`checkPasskeyDeletion`）と、登録の入口のチェック（`startInvite`）は、書き込み（登録・更新・削除）の前提を確かめるコマンドの一部なのでコマンドに置く
- 名前: コマンドの入力は `…Cmd`、結果は `…Evt`（起きたこと）か `void`。DTO を返すときも `…Evt` で包む（例: `CreatePlaylistEvt = { playlist: PlaylistSettingDto }`）。Query の入力は `…Query`、戻り値は `…View`（画面 1 つ分などのまとまり）か `…Dto`（その中の 1 件）
- 別の集約の Read Model を使うときは（例: 通知のバッジの本数）、`server/container.ts` で `…Usecase` の Query を Port に渡す

### 守ること

- `domain/` は `void/*`・`hono`・`better-auth`・`svelte`・`@schema` や外側の層を import しない（Biome で禁止している）
- Port（`port.ts`）は `type.ts` のドメインの型を返す。`api.ts` の DTO を返さない（DTO への変換は `converter.ts` の `convTo…Dto` で行う）
- Web 層（`pages/`・`routes/`・`middleware/`・`crons/`・`auth.ts`）は DB を直接触らない。必要なら `…Usecase` にコマンドか Query を足して `server/container.ts` から呼ぶ（Biome で禁止している）
- `auth.ts` は Void の CLI（`void db generate` など）から Node で直接読み込まれる。そこから辿られる `domain/`・`adapter/`・`server/`・`lib/` では:
  - 相対 import に必ず `.ts` を付ける（拡張子なしは解決できない。Biome で強制している）
  - `@schema` などの Vite のエイリアスを使わない。`db/schema.ts` は相対パスで読む（Biome で禁止している）
  - 型だけの import は `import type` にし、enum など型を消すだけで動かない構文を使わない（`verbatimModuleSyntax`・`erasableSyntaxOnly`）
- 入力の検証（VO のスキーマ）は valibot で書き、`domain/shared/vo.ts` の `newVo`・`newVoOrNone` で VO を作る関数にする（`@nw-union/nw-utils/lib/valibot` の `newType` は nw-utils のエラーを返すので使わない）。文字数の上限は、ユーザーが入力するものはコードポイントで数える（`v.maxLength` は UTF-16 の長さで数える）
- ブラウザからも使う関数は、アプリに依存しないものなら `lib/` に置く。アプリの決まりごと（名前の上限など）でブラウザからも使うものは、いまは `domain/Member/rule.ts` に置いている（valibot・VO・`shared/error.ts` を import しない。Biome で禁止している）。VO を import すると、スキーマや `neverthrow` などがクライアントのバンドルに入る
- 確認と書き込みを 1 文で行う必要がある操作（招待の発行と消費、通知済みにする、など）は、Port の 1 メソッドにして、その契約をコメントに書く
- drizzle の `db.batch` は `db.run(sql)` を受け付けない。複数の文は 1 つずつ実行する
- 日時は `ClockPort`、乱数は `RandomPort` から受け取る（ドメインで `new Date()`・`Math.random()` を直接使わない）
- ログは `server/log/log.ts` の `log()`（`@nw-union/nw-utils` の `Logger`）から出す。`console.*` を直接使わない。出力先と最小レベルは環境変数 `LOG_ADAPTER`（json / console）と `LOG_LEVEL`。DB・ストレージ・外部サービスのエラーは `logAppError`（`server/log/logger.ts`）で残し、画面には出さない
- `@nw-union/nw-utils` のエラークラス（`AppError`・`ValidationError` など）はドメインのエラーには使わない。`domain/shared/error.ts` の判別共用体（`type`）で `ts-pattern` の `.exhaustive()` を使うため。nw-utils のエラーを使うのは、ロガーに渡すときの `SystemError` だけ

### テスト

- ワークフロー（`workflow/<名前>.ts`）・`converter.ts`・`vo.ts` には、実装と同じ場所に `*.test.ts` を書く（`bun test`）。ワークフローのテストには、Step（純粋な関数）のテストと、fake の Port を使った操作のテストの両方を置く。`usecase.ts` には、`…Usecase` の操作がそろっていることを確かめるテストを書く
- fake の Port では SQL・エイリアス・CLI からの読み込みの問題は見つからない。adapter や `auth.ts` から辿られるファイルを変えたら、`bun run build` と `bunx void db generate` も通ることを確かめる
- `bun run check` で、フォーマット・lint・型チェック・テストをまとめて確かめる
