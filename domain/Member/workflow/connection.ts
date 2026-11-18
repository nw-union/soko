// ワークフロー: 外部のアプリ (RevokeConnectedApp 外部のアプリへの許可を取り消す・接続中のアプリの一覧)
// 外部のアプリは MCP のクライアント (Claude・ChatGPT など). 許可は better-auth の oauth-provider が OAuth で発行する
import { sequence, stepAsync } from "@nw-union/nw-utils/lib/rslt";
import { newUserId } from "../../shared/vo.ts";
import type { MemberUsecase } from "../api.ts";
import { convToConnectedAppDto } from "../converter.ts";
import type { ConnectionRepositoryPort } from "../port.ts";
import { newOAuthClientId } from "../vo.ts";

// ----------------------------------------------------------------------------
// 依存
// ----------------------------------------------------------------------------
type ConnectionRepository = Pick<
  ConnectionRepositoryPort,
  "listConnectedApps" | "deleteGrant"
>;

// ----------------------------------------------------------------------------
// 実装
// ----------------------------------------------------------------------------
export const newConnectionWorkflow = (
  r: ConnectionRepository,
): Pick<MemberUsecase, "revokeConnectedApp" | "listConnectedApps"> => ({
  /**
   * 外部のアプリへの許可を取り消す
   */
  revokeConnectedApp: ({ userId, clientId }) =>
    stepAsync(
      // Step 1. バリデーション: [string, unknown] -> [UserId, OAuthClientId]
      sequence([newUserId(userId), newOAuthClientId(clientId)]),
      // Step 2. DB 削除 (同意・トークン)
      ([user, client]) => r.deleteGrant(user, client),
    ),

  /**
   * 接続中のアプリの一覧
   */
  listConnectedApps: ({ userId }) =>
    stepAsync(
      // Step 1. バリデーション: string -> UserId
      newUserId(userId),
      // Step 2. DB 取得
      r.listConnectedApps,
      // Step 3. View に組み立てる
      (apps) => ({ apps: apps.map(convToConnectedAppDto) }),
    ),
});
