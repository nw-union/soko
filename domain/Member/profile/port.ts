import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../shared/error.ts";
import type { UserId } from "../../shared/vo.ts";
import type { AvatarFile, ImageFile } from "./type.ts";
import type { AvatarKey } from "./vo.ts";

/**
 * ユーザーのリポジトリ (user・passkey テーブルは better-auth が管理している. ここで触るのは user.image とパスキーの数だけ)
 */
export interface ProfileRepositoryPort {
  // ユーザーのパスキーの数 (passkey テーブルは better-auth が管理している)
  countPasskeys(user: UserId): ResultAsync<number, AppError>;

  // user.image. ユーザーがいなければ null
  readImage(user: UserId): ResultAsync<string | null, AppError>;

  // user.image を差し替え, updatedAt を now にする
  updateImage(
    user: UserId,
    image: string | null,
    now: Date,
  ): ResultAsync<void, AppError>;

  // 退会したユーザーのデータを消す: 発行した未使用の招待, 通知の購読, 視聴記録.
  // 使用済みの招待の記録は残す. パスキー・セッションは better-auth が user に連動して消す
  deleteUserData(user: UserId): ResultAsync<void, AppError>;
}

/**
 * アイコン画像のストレージ
 */
export interface AvatarStoragePort {
  putAvatar(key: AvatarKey, file: ImageFile): ResultAsync<void, AppError>;
  deleteAvatar(key: AvatarKey): ResultAsync<void, AppError>;
  // 保存されている画像. なければ null
  getAvatar(key: AvatarKey): ResultAsync<AvatarFile | null, AppError>;
}
