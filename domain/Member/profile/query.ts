import { errAsync, okAsync } from "neverthrow";
import { newNotFoundError } from "../../shared/error.ts";
import { newUserId } from "../../shared/vo.ts";
import type { MemberQueries } from "../api.ts";
import { resolveColor, resolveImage } from "./logic.ts";
import type { AvatarStoragePort, ProfileRepositoryPort } from "./port.ts";
import { newAvatarKey } from "./vo.ts";

const NOT_FOUND = "アイコン画像が見つかりません";

/**
 * プロフィール・ログインの Queries (Read Model)
 */
export const newProfileQueries = (
  r: ProfileRepositoryPort,
  s: AvatarStoragePort,
): Pick<MemberQueries, "getDisplayUser" | "hasPasskey" | "getAvatarFile"> => ({
  /**
   * 画面に出すユーザー
   */
  getDisplayUser: ({ user }) =>
    okAsync({
      name: user.name,
      color: resolveColor(user.color, user.id),
      image: resolveImage(user.image),
    }),

  /**
   * パスキーを作ったか
   */
  hasPasskey: ({ userId }) =>
    okAsync(userId)
      // Step 1. バリデーション: string -> UserId
      .andThen((id) => newUserId(id))
      // Step 2. 数える
      .andThen(r.countPasskeys)
      // Step 3. View に組み立てる
      .map((count) => ({ hasPasskey: count > 0 })),

  /**
   * アイコン画像のファイル. キーの形が違っても, 画像がなくても, 同じ NotFoundError
   */
  getAvatarFile: ({ key }) =>
    okAsync(key)
      // Step 1. バリデーション: unknown -> AvatarKey
      .andThen((k) => newAvatarKey(k).mapErr(() => newNotFoundError(NOT_FOUND)))
      // Step 2. 取得
      .andThen(s.getAvatar)
      // Step 3. View に組み立てる
      .andThen((file) =>
        file
          ? okAsync({
              body: file.body,
              contentType: file.contentType,
              etag: file.etag,
            })
          : errAsync(newNotFoundError(NOT_FOUND)),
      ),
});
