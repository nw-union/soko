// Converter: ドメインの型 (type.ts) → DTO (api.ts) の変換. 画面に出す形にする
import { isHttpUrl } from "../../lib/url.ts";
import type { ConnectedAppDto, InviteDto, ValidateProfileEvt } from "./api.ts";
import { isAvatarPath, isHexColor } from "./rule.ts";
import type { ConnectedApp, IssuedInvite, ValidatedProfile } from "./type.ts";
import type { InviteToken } from "./vo.ts";

// ----------------------------------------------------------------------------
// 招待
// ----------------------------------------------------------------------------
/**
 * 画面に出す形にする (XXXX-XXXX-XXXX-XXXX)
 */
export const formatToken = (token: InviteToken): string =>
  token.match(/.{1,4}/g)?.join("-") ?? "";

/**
 * 発行済みの招待を, 画面に出す形にする
 */
export const convToInviteDto = ({
  id,
  createdAt,
  expiresAt,
  usedAt,
  usedByName,
}: IssuedInvite): InviteDto => ({
  id,
  createdAt,
  expiresAt,
  usedAt,
  usedByName,
});

// ----------------------------------------------------------------------------
// プロフィール
// ----------------------------------------------------------------------------
/**
 * 確かめたプロフィールの入力を, イベントの形にする. 送られてこなかった項目は含めない
 */
export const convToProfileEvt = (p: ValidatedProfile): ValidateProfileEvt => ({
  ...(p.name !== undefined && { name: p.name as string }),
  ...(p.color !== undefined && { color: p.color as string | null }),
});

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

// ----------------------------------------------------------------------------
// 外部のアプリ
// ----------------------------------------------------------------------------
/**
 * 接続中のアプリを, 画面に出す形にする. URL は http(s) のものだけ (リンクにするため)
 */
export const convToConnectedAppDto = (a: ConnectedApp): ConnectedAppDto => ({
  clientId: a.clientId,
  name: a.name,
  uri: a.uri !== null && isHttpUrl(a.uri) ? a.uri : null,
  scopes: a.scopes,
  consentedAt: a.consentedAt.toISOString(),
  lastUsedAt: a.lastUsedAt?.toISOString() ?? null,
});
