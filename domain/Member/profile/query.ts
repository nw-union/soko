import { err, ok, rslt, stepAsync } from "@nw-union/nw-utils/lib/rslt";
import { newNotFoundError } from "../../shared/error.ts";
import { newUserId } from "../../shared/vo.ts";
import type { MemberUsecase } from "../api.ts";
import { resolveColor, resolveImage } from "./logic.ts";
import type { AvatarStoragePort, ProfileRepositoryPort } from "./port.ts";
import { newAvatarKey } from "./vo.ts";

const NOT_FOUND = "アイコン画像が見つかりません";

/**
 * プロフィール・ログインのユースケースのうち, Query (Read Model)
 */
export const newProfileQueries = (
  r: ProfileRepositoryPort,
  s: AvatarStoragePort,
): Pick<MemberUsecase, "getDisplayUser" | "hasPasskey" | "getAvatarFile"> => ({
  /**
   * 画面に出すユーザー
   */
  getDisplayUser: async ({ user }) =>
    ok({
      name: user.name,
      color: resolveColor(user.color, user.id),
      image: resolveImage(user.image),
    }),

  /**
   * パスキーを作ったか
   */
  hasPasskey: ({ userId }) =>
    stepAsync(
      // Step 1. バリデーション: string -> UserId
      newUserId(userId),
      // Step 2. 数える
      r.countPasskeys,
      // Step 3. View に組み立てる
      (count) => ({ hasPasskey: count > 0 }),
    ),

  /**
   * アイコン画像のファイル. キーの形が違っても, 画像がなくても, 同じ NotFoundError
   */
  getAvatarFile: ({ key }) =>
    stepAsync(
      // Step 1. バリデーション: unknown -> AvatarKey
      rslt.pipe(
        newAvatarKey(key),
        rslt.mapErr(() => newNotFoundError(NOT_FOUND)),
      ),
      // Step 2. 取得
      s.getAvatar,
      // Step 3. View に組み立てる
      (file) =>
        file
          ? ok({
              body: file.body,
              contentType: file.contentType,
              etag: file.etag,
            })
          : err(newNotFoundError(NOT_FOUND)),
    ),
});
