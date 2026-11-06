import { err, ok, Result } from "neverthrow";
import {
  type ForbiddenError,
  mergeValidationError,
  newForbiddenError,
  newValidationErrorWithMessage,
  type ValidationError,
} from "../../error.ts";
import { isHttpUrl } from "../url.ts";
import {
  AVATAR_MAX_BYTES,
  isAvatarPath,
  isHexColor,
  NAME_MAX,
} from "./rule.ts";
import type { ImageFile, ValidatedProfile } from "./type.ts";
import {
  type HexColor,
  newHexColor,
  newUserName,
  type UserName,
} from "./vo.ts";

/**
 * ログイン (登録) から何秒までのセッションを「新しい」とみなすか.
 * パスキーの追加・削除とアカウントの削除は, この時間内にパスキーでログインし直したセッションでだけ受け付ける
 * (セッションが盗まれても, パスキーを差し替えて乗っ取られないように). 登録直後の /welcome でのパスキー作成もこの時間内に行う
 */
export const FRESH_AGE_SECONDS = 10 * 60;

// 登録時のメールアドレスは, ブラウザ (pages/login.svelte) が作る使い捨ての <UUID>@nwu.invalid だけ
const SIGNUP_EMAIL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@nwu\.invalid$/;

// ----------------------------------------------------------------------------
// Domain Logic (Domain Type -> Domain Type)
// ----------------------------------------------------------------------------
/**
 * パスキーを削除してよいか確かめる
 *
 * - ログインし直したばかりのセッションだけが削除できる (パスキーの追加と同じ)
 * - 最後のパスキーは削除できない (ログインできなくなるため)
 */
export const ensurePasskeyDeletable = (
  sessionCreatedAt: Date,
  passkeyCount: number,
  now: Date,
): Result<void, ForbiddenError | ValidationError> => {
  if (now.getTime() - sessionCreatedAt.getTime() >= FRESH_AGE_SECONDS * 1000)
    return err(newForbiddenError("Session is not fresh", "SESSION_NOT_FRESH"));
  if (passkeyCount <= 1)
    return err(
      newValidationErrorWithMessage(
        "passkey",
        "最後のパスキーは削除できません（ログインできなくなります）",
      ),
    );
  return ok(undefined);
};

/**
 * ユーザー ID から決まる色 (#rrggbb). イメージカラー未設定のユーザーに使う.
 * 画面にカラーコードとして出すので, hsl() ではなく #rrggbb で返す
 */
const fallbackColor = (userId: string): string => {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const [saturation, lightness] = [0.7, 0.55];
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
};

// ----------------------------------------------------------------------------
// Validater (DTO -> Domain Type)
// ----------------------------------------------------------------------------
/**
 * 登録・更新で本人が送ってくる名前とイメージカラーを確かめる. 名前は前後の空白を除く
 *
 * 画像 (image) はここでは設定できない (アイコンのアップロードだけが設定する)
 */
export const validateProfileInput = (input: {
  name?: unknown;
  color?: unknown;
  image?: unknown;
}): Result<ValidatedProfile, ValidationError> =>
  Result.combineWithAllErrors([
    validateName(input.name),
    validateColor(input.color),
    validateNoImage(input.image),
  ]).match(
    ([name, color]) =>
      ok({
        type: "ValidatedProfile",
        ...(name !== undefined && { name }),
        ...(color !== undefined && { color }),
      }),
    (es) => err(mergeValidationError(es)),
  );

const validateName = (
  name: unknown,
): Result<UserName | undefined, ValidationError> =>
  name === undefined
    ? ok(undefined)
    : newUserName(name, "name").mapErr(() =>
        newValidationErrorWithMessage(
          "name",
          `名前は 1〜${NAME_MAX} 文字で入力してください`,
        ),
      );

const validateColor = (
  color: unknown,
): Result<HexColor | null | undefined, ValidationError> =>
  color === undefined || color === null
    ? ok(color)
    : newHexColor(color, "color").mapErr(() =>
        newValidationErrorWithMessage(
          "color",
          "カラーコードは #rrggbb の形式で入力してください",
        ),
      );

const validateNoImage = (image: unknown): Result<undefined, ValidationError> =>
  image === undefined || image === null
    ? ok(undefined)
    : err(newValidationErrorWithMessage("image", "画像は設定できません"));

/**
 * 登録時のメールアドレスを確かめる (ブラウザが作る使い捨てのものだけ)
 */
export const validateSignupEmail = (
  email: unknown,
): Result<void, ValidationError> =>
  typeof email === "string" && SIGNUP_EMAIL.test(email)
    ? ok(undefined)
    : err(newValidationErrorWithMessage("email", "登録できません"));

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
// Converter (Domain Type -> DTO)
// ----------------------------------------------------------------------------
/**
 * 画面に出すイメージカラー. 未設定 (や不正な値) なら, ユーザー ID から決まる色
 */
export const resolveColor = (color: unknown, userId: string): string =>
  isHexColor(color) ? color.toLowerCase() : fallbackColor(userId);

/**
 * 画面に出す画像の URL. このアプリで保存したアイコンのパスか, http(s) の URL だけを使う
 */
export const resolveImage = (image: unknown): string | null =>
  typeof image === "string" && (isAvatarPath(image) || isHttpUrl(image))
    ? image
    : null;
