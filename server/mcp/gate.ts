// /api/mcp の入口の確認（ツールを動かす前）。上から順に:
// Origin → 本文の大きさ → 認証（JWT）→ 退会していないか → 1 人あたりのレート制限。
// HTTP の値を受け取って結果を返すだけにし、Void や DB に依存しない（テストしやすいように）
import type { Logger } from "@nw-union/nw-utils";
import { match } from "@nw-union/nw-utils/lib/match";
import type { ResultAsync } from "@nw-union/nw-utils/lib/rslt";
import type { MemberStatusView } from "../../domain/Member/api.ts";
import type { AppError } from "../../domain/shared/error.ts";
import { logAppError } from "../log/logger.ts";
import { type McpPrincipal, parseBearer } from "./auth.ts";
import { bearerChallenge, MAX_BODY_BYTES } from "./http.ts";
import { type CheckRateLimit, MCP_LIMITS } from "./rate-limit.ts";
import { INTERNAL_MESSAGE } from "./result.ts";

export type GateRequest = {
  // このサーバーの origin（https://soko.nw-union.net など）
  origin: string;
  // リクエストの Origin ヘッダー
  requestOrigin: string | undefined;
  contentLength: string | undefined;
  authorization: string | undefined;
  // クライアントの IP（Cloudflare の cf-connecting-ip）。わからなければ undefined
  ip: string | undefined;
};

export type GateDeps = {
  verify: (token: string) => Promise<McpPrincipal | null>;
  memberStatus: (userId: string) => ResultAsync<MemberStatusView, AppError>;
  checkRateLimit: CheckRateLimit;
  log: Logger;
};

export type GateResult =
  | { type: "Pass"; principal: McpPrincipal }
  | {
      type: "Reject";
      status: 401 | 403 | 413 | 429 | 500;
      body: Record<string, unknown>;
      headers: Record<string, string>;
    };

const reject = (
  status: 401 | 403 | 413 | 429 | 500,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): GateResult => ({ type: "Reject", status, body, headers });

const tooMany = (retryAfter: number) =>
  reject(
    429,
    { message: "Too Many Requests" },
    { "Retry-After": String(retryAfter) },
  );

export const gateMcpRequest = async (
  req: GateRequest,
  deps: GateDeps,
): Promise<GateResult> => {
  // DNS リバインディング・ブラウザからの呼び出しの対策。Origin が付いていたら、自分のものだけ通す
  // （Claude・ChatGPT のサーバーや手元のアプリからのリクエストには、普通 Origin がない）
  if (req.requestOrigin && req.requestOrigin !== req.origin)
    return reject(403, { message: "Forbidden" });
  // 大きすぎる本文は読まない
  if (Number(req.contentLength ?? "0") > MAX_BODY_BYTES)
    return reject(413, { message: "Payload Too Large" });

  // 認証: 署名・期限・発行者・宛先（この /api/mcp）・種類を確かめる
  const token = parseBearer(req.authorization);
  const principal = token ? await deps.verify(token) : null;
  if (!principal) {
    // 失敗は IP ごとに数える（総当たりと、鍵を読む D1 の負担を抑える）
    const limited = await deps.checkRateLimit(
      MCP_LIMITS.authFailure,
      req.ip ?? "unknown",
    );
    if (!limited.allowed) return tooMany(limited.retryAfter);
    if (token) deps.log.info("mcp: アクセストークンを検証できませんでした");
    return reject(
      401,
      { error: "invalid_token" },
      { "WWW-Authenticate": bearerChallenge(req.origin, !!token) },
    );
  }

  // 退会した人のトークンは止める（JWT は DB を引かずに検証するので、期限までは署名が正しい）
  const status = await deps.memberStatus(principal.userId);
  const active = match(status)
    .ok((v): boolean | "error" => v.active)
    .err((e): boolean | "error" => {
      logAppError(deps.log, e);
      return "error";
    })
    .exhaustive();
  if (active === "error") return reject(500, { message: INTERNAL_MESSAGE });
  if (!active) {
    deps.log.info(`mcp: 退会したユーザーのトークン user=${principal.userId}`);
    return reject(
      401,
      { error: "invalid_token" },
      { "WWW-Authenticate": bearerChallenge(req.origin, true) },
    );
  }

  // 1 人あたりのリクエストの回数
  const limited = await deps.checkRateLimit(MCP_LIMITS.user, principal.userId);
  if (!limited.allowed) {
    deps.log.info(`mcp: レート制限 user=${principal.userId}`);
    return tooMany(limited.retryAfter);
  }

  return { type: "Pass", principal };
};
