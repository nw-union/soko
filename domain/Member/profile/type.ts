import type { HexColor, UserName } from "./vo.ts";

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
