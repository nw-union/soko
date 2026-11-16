#!/usr/bin/env bun
// 招待トークンを発行して、invites テーブルに登録する（管理者用。最初のメンバーを招くときなど）。
// 普通の招待は、メンバーがプロフィール画面から発行する。
//
//   bun scripts/create-invite.mjs [--days 7] [--remote]
//
// --days    トークンの有効日数（既定 7）。0 なら無期限
// --remote  デプロイ済みの本番 DB に登録する（省略するとローカル DB）
//
// 発行したトークンは、この画面に 1 回だけ表示される。DB にはハッシュしか残らないので、後からは確認できない。
// 一覧: bunx void db execute "SELECT id, inviter_user_id, expires_at, used_at FROM invites ORDER BY id DESC"
// 取り消し: bunx void db execute "DELETE FROM invites WHERE id = <id> AND used_at IS NULL"
import { spawnSync } from "node:child_process";
import { formatToken } from "../domain/Member/invite/logic.ts";
import {
	createInviteToken,
	createTokenHash,
	TOKEN_LENGTH,
} from "../domain/Member/invite/vo.ts";

function fail(message) {
	console.error(`エラー: ${message}`);
	process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};

const days = Number(option("days") ?? 7);
const remote = flag("remote");

if (!Number.isInteger(days) || days < 0 || days > 365)
	fail("--days は 0〜365 の整数で指定してください");

// トークンの作り方とハッシュは、アプリ（domain/Member/invite）と同じものを使う
const token = createInviteToken(
	crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH)),
);
const tokenHash = await createTokenHash(token);

const sql =
	"INSERT INTO invites (token_hash, expires_at) VALUES (" +
	[
		`'${tokenHash}'`,
		days > 0 ? `datetime('now', '+${days} days')` : "NULL",
	].join(", ") +
	")";

const result = spawnSync(
	"bunx",
	["void", "db", "execute", ...(remote ? ["--remote"] : []), sql],
	{
		stdio: ["ignore", "inherit", "inherit"],
	},
);
if (result.status !== 0) fail("DB への登録に失敗しました");

const shown = formatToken(token);
console.log(`
招待を作成しました（${remote ? "本番 DB" : "ローカル DB"}）
  有効期限: ${days > 0 ? `${days} 日` : "なし"}

  トークン: ${shown}

このトークンは、もう一度は表示されません。本人にだけ伝えてください。
ログイン画面の「招待コードで登録」に入力すると、名前とパスキーを設定して入れます。`);
