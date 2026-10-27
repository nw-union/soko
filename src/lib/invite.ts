// 招待トークンの処理。auth.ts の normalizeToken / hashToken / INVITE_COOKIE と同じにすること
// （auth.ts は拡張子なしの相対 import を解決できないので、向こうは自前で持っている）
export const INVITE_COOKIE = "nwu_invite";
export const TOKEN_LENGTH = 16;
// 1 人が発行できる招待の数の初期値。実際の上限はユーザーごとに user.inviteLimit に持つ（auth.ts の defaultValue と同じにすること）。
// 期限切れで使われなかったもの・取り消したものは数えない
export const DEFAULT_INVITE_LIMIT = 3;
export const INVITE_DAYS = 7;

// 紛らわしい文字（0 O 1 I L）を除いた 31 文字。16 文字で約 80 ビット
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const normalizeToken = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(TOKEN_LENGTH));
  // 256 % 31 の偏りは 16 文字・約 80 ビットでは無視できる
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

// 画面に出す形（XXXX-XXXX-XXXX-XXXX）
export const formatToken = (token: string) => token.match(/.{1,4}/g)?.join("-") ?? "";
