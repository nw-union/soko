import { okAsync } from "neverthrow";
import { newUserId } from "../../shared/vo.ts";
import type { MemberQueries } from "../api.ts";
import { resolveColor, resolveImage } from "./logic.ts";
import type { ProfileRepositoryPort } from "./port.ts";

/**
 * プロフィール・ログインの Queries (Read Model)
 */
export const newProfileQueries = (
  r: ProfileRepositoryPort,
): Pick<MemberQueries, "getDisplayUser" | "hasPasskey"> => ({
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
});
