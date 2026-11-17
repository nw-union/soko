// ワークフロー: プロフィール (ValidateProfileUpdate プロフィールの更新を確かめる・ValidateSignUp 登録を確かめる・画面に出すユーザー)
import {
  collect,
  err,
  ok,
  type Result,
  rslt,
  stepAsync,
} from "@nw-union/nw-utils/lib/rslt";
import {
  mergeValidationError,
  newValidationErrorWithMessage,
  type ValidationError,
} from "../../shared/error.ts";
import type { MemberUsecase } from "../api.ts";
import { convToProfileEvt, resolveColor, resolveImage } from "../converter.ts";
import { NAME_MAX } from "../rule.ts";
import type { ValidatedProfile } from "../type.ts";
import {
  type HexColor,
  newHexColor,
  newUserName,
  type UserName,
} from "../vo.ts";

// 登録時のメールアドレスは, ブラウザ (pages/login.svelte) が作る使い捨ての <UUID>@nwu.invalid だけ
const SIGNUP_EMAIL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@nwu\.invalid$/;

// ----------------------------------------------------------------------------
// Step: バリデーション (Cmd → ドメインの型)
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
  rslt.pipe(
    collect([
      validateName(input.name),
      validateColor(input.color),
      validateNoImage(input.image),
    ]),
    rslt.map(
      ([name, color]): ValidatedProfile => ({
        type: "ValidatedProfile",
        ...(name !== undefined && { name }),
        ...(color !== undefined && { color }),
      }),
    ),
    rslt.mapErr(mergeValidationError),
  );

const validateName = (
  name: unknown,
): Result<UserName | undefined, ValidationError> =>
  name === undefined
    ? ok(undefined)
    : rslt.pipe(
        newUserName(name, "name"),
        rslt.mapErr(() =>
          newValidationErrorWithMessage(
            "name",
            `名前は 1〜${NAME_MAX} 文字で入力してください`,
          ),
        ),
      );

const validateColor = (
  color: unknown,
): Result<HexColor | null | undefined, ValidationError> =>
  color === undefined || color === null
    ? ok(color)
    : rslt.pipe(
        newHexColor(color, "color"),
        rslt.mapErr(() =>
          newValidationErrorWithMessage(
            "color",
            "カラーコードは #rrggbb の形式で入力してください",
          ),
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

// ----------------------------------------------------------------------------
// 実装
// ----------------------------------------------------------------------------
/**
 * プロフィール. better-auth の手前のチェック (validate〜) もここに置く
 */
export const newProfileWorkflow = (): Pick<
  MemberUsecase,
  "validateProfileUpdate" | "validateSignUp" | "getDisplayUser"
> => ({
  /**
   * プロフィールの更新で送られてきた値を確かめる
   */
  validateProfileUpdate: (cmd) =>
    stepAsync(
      // Step 1. バリデーション: Cmd -> ValidatedProfile
      validateProfileInput(cmd),
      // Step 2. イベント発行
      convToProfileEvt,
    ),

  /**
   * 登録で送られてきた値を確かめる
   */
  validateSignUp: ({ email, ...profile }) =>
    stepAsync(
      // Step 1. メールアドレスの確認 (使い捨てのものだけ)
      validateSignupEmail(email),
      // Step 2. バリデーション: Cmd -> ValidatedProfile
      () => validateProfileInput(profile),
      // Step 3. イベント発行
      convToProfileEvt,
    ),

  /**
   * 画面に出すユーザー
   */
  getDisplayUser: async ({ user }) =>
    ok({
      name: user.name,
      color: resolveColor(user.color, user.id),
      image: resolveImage(user.image),
    }),
});
