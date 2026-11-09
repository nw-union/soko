// 招待トークンを入れる短命の Cookie。/api/invite/start で入れ、sign-up でユーザーを作るときに auth.ts が読んで消す
export const INVITE_COOKIE = "nwu_invite";
export const INVITE_COOKIE_MAX_AGE = 15 * 60;

export const readInviteCookie = (
  request: Request | undefined,
): string | null => {
  const header = request?.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === INVITE_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
};
