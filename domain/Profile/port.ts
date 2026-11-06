import type { ResultAsync } from "neverthrow";
import type { AppError } from "../../error.ts";
import type { UserId } from "../vo.ts";
import type { ImageFile } from "./type.ts";
import type { AvatarKey } from "./vo.ts";

/**
 * ユーザーのリポジトリ (user テーブルは better-auth が管理している. ここで触るのは image だけ)
 */
export interface ProfileRepositoryPort {
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
}
