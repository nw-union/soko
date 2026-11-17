import type { UserId } from "../shared/vo.ts";
import type { HexColor, InviteToken, TokenHash, UserName } from "./vo.ts";

// ----------------------------------------------------------------------------
// 招待
// ----------------------------------------------------------------------------
/**
 * 発行する招待 (まだ保存していない)
 *
 * token は発行した本人に見せるためだけに持つ. 保存するのは tokenHash だけ
 */
export interface NewInvite {
  readonly type: "NewInvite";
  readonly token: InviteToken;
  readonly tokenHash: TokenHash;
  readonly inviterUserId: UserId;
  readonly expiresAt: Date;
}

/**
 * 発行済みの招待 (一覧に出すもの)
 *
 * 日時は SQLite の "YYYY-MM-DD HH:MM:SS" (UTC) のまま持つ
 */
export interface IssuedInvite {
  readonly type: "IssuedInvite";
  readonly id: number;
  readonly createdAt: string;
  // 空なら無期限
  readonly expiresAt: string | null;
  // 空なら未使用
  readonly usedAt: string | null;
  // 使ったユーザーの名前. 未使用やユーザー削除済みなら空
  readonly usedByName: string | null;
}

/**
 * 招待の利用状況 (発行上限の判断に使う)
 */
export interface InviteUsage {
  readonly type: "InviteUsage";
  // user.inviteLimit. 値がなければ null (初期値を使う)
  readonly limit: number | null;
  // 数える招待の数 (InviteRepositoryPort の「数える招待」を参照)
  readonly used: number;
}

// ----------------------------------------------------------------------------
// プロフィール・アイコン画像
// ----------------------------------------------------------------------------
/**
 * 検証済みの画像ファイル
 */
export interface ImageFile {
  readonly type: "ImageFile";
  readonly ext: "jpg" | "png" | "webp";
  readonly contentType: "image/jpeg" | "image/png" | "image/webp";
  readonly bytes: Uint8Array;
}

/**
 * 保存されているアイコン画像 (配信するもの)
 */
export interface AvatarFile {
  readonly type: "AvatarFile";
  readonly body: ReadableStream;
  // 保存したときの Content-Type. わからなければ null
  readonly contentType: string | null;
  readonly etag: string;
}

/**
 * 検証済みのプロフィールの入力 (登録・更新で本人が送ってくるもの)
 *
 * 送られてこなかった項目は undefined のまま (変更しない). color の null はイメージカラーを外す
 */
export interface ValidatedProfile {
  readonly type: "ValidatedProfile";
  readonly name?: UserName;
  readonly color?: HexColor | null;
}
