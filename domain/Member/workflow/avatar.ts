// ワークフロー: アイコン画像 (ChangeAvatar アイコン画像を差し替える・RemoveAvatar アイコン画像を外す・アイコン画像のファイル)
import {
  err,
  ok,
  type Result,
  type ResultAsync,
  rslt,
  sequence,
  stepAsync,
  throughAsync,
} from "@nw-union/nw-utils/lib/rslt";
import {
  type AppError,
  newNotFoundError,
  newValidationErrorWithMessage,
  type ValidationError,
} from "../../shared/error.ts";
import type { ClockPort, RandomPort } from "../../shared/port.ts";
import { newUserId } from "../../shared/vo.ts";
import type { MemberUsecase } from "../api.ts";
import type { AvatarStoragePort, ProfileRepositoryPort } from "../port.ts";
import { AVATAR_MAX_BYTES } from "../rule.ts";
import type { ImageFile } from "../type.ts";
import {
  createAvatarKey,
  newAvatarKey,
  parseAvatarPath,
  toAvatarPath,
} from "../vo.ts";

const NOT_FOUND = "アイコン画像が見つかりません";

// ----------------------------------------------------------------------------
// 依存
// ----------------------------------------------------------------------------
type AvatarRepository = Pick<
  ProfileRepositoryPort,
  "readImage" | "updateImage"
>;

// ----------------------------------------------------------------------------
// Step: バリデーション (Cmd → ドメインの型)
// ----------------------------------------------------------------------------
/**
 * アップロードされた画像を確かめる
 *
 * ブラウザが送る Content-Type は信用せず, ファイル先頭のマジックナンバーで形式を判定する
 *
 * @param bytes - ファイルの中身. ファイルが送られてこなければ null
 */
export const validateImageFile = (
  bytes: Uint8Array | null,
): Result<ImageFile, ValidationError> => {
  if (!bytes)
    return err(newValidationErrorWithMessage("file", "画像を選んでください"));
  if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES)
    return err(
      newValidationErrorWithMessage(
        "file",
        `画像は ${AVATAR_MAX_BYTES / 1024 / 1024}MB 以下にしてください`,
      ),
    );
  const format = detectFormat(bytes);
  if (!format)
    return err(
      newValidationErrorWithMessage(
        "file",
        "JPEG、PNG、WebP の画像を選んでください",
      ),
    );
  return ok({ type: "ImageFile", ...format, bytes });
};

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0): boolean =>
  sig.every((b, i) => bytes[offset + i] === b);

const detectFormat = (
  bytes: Uint8Array,
): Pick<ImageFile, "ext" | "contentType"> | null => {
  if (startsWith(bytes, [0xff, 0xd8, 0xff]))
    return { ext: "jpg", contentType: "image/jpeg" };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { ext: "png", contentType: "image/png" };
  // "RIFF" ???? "WEBP"
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  )
    return { ext: "webp", contentType: "image/webp" };
  return null;
};

// ----------------------------------------------------------------------------
// 実装
// ----------------------------------------------------------------------------
/**
 * このアプリで保存したアイコン画像なら, ストレージから消す. 失敗しても成功として扱う
 * (退会の後始末 (workflow/account.ts) でも使う)
 */
export const removeOldAvatar =
  (s: Pick<AvatarStoragePort, "deleteAvatar">) =>
  async (image: unknown): ResultAsync<void, AppError> => {
    const key = parseAvatarPath(image);
    if (key) await s.deleteAvatar(key);
    return ok();
  };

/**
 * アイコン画像
 */
export const newAvatarWorkflow = (
  r: AvatarRepository,
  s: AvatarStoragePort,
  clock: ClockPort,
  random: RandomPort,
): Pick<MemberUsecase, "changeAvatar" | "removeAvatar" | "getAvatarFile"> => ({
  /**
   * アイコン画像を差し替える
   */
  changeAvatar: ({ userId, file }) =>
    stepAsync(
      // Step 1. バリデーション: [string, Uint8Array | null] -> [UserId, ImageFile]
      sequence([newUserId(userId), validateImageFile(file)]),
      // Step 2. ストレージに保存: [UserId, ImageFile] -> [UserId, AvatarKey]
      ([user, f]) => {
        const key = createAvatarKey(random.bytes(16), f.ext);
        return stepAsync(s.putAvatar(key, f), () => [user, key] as const);
      },
      // Step 3. DB 保存 (古い画像を覚えておく): [UserId, AvatarKey] -> [string, string | null]
      ([user, key]) =>
        stepAsync(
          r.readImage(user),
          throughAsync(() =>
            r.updateImage(user, toAvatarPath(key), clock.now()),
          ),
          (old) => [toAvatarPath(key), old] as const,
        ),
      // Step 4. 古い画像を消す (失敗しても差し替えは成功させる)
      throughAsync(([, old]) => removeOldAvatar(s)(old)),
      // Step 5. イベント発行
      ([image]) => ({ image }),
    ),

  /**
   * アイコン画像を外す
   */
  removeAvatar: ({ userId }) =>
    stepAsync(
      // Step 1. バリデーション: string -> UserId
      newUserId(userId),
      // Step 2. DB 保存 (古い画像を覚えておく): UserId -> string | null
      (user) =>
        stepAsync(
          r.readImage(user),
          throughAsync(() => r.updateImage(user, null, clock.now())),
        ),
      // Step 3. 古い画像を消す (失敗しても外すのは成功させる)
      removeOldAvatar(s),
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
