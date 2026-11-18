// OAuth のスコープ（server/mcp/scope.ts）を、同意画面とプロフィールに出す言葉にする

export const SCOPE_LABELS: Record<string, string> = {
  "videos:read": "動画・プレイリスト・概要欄と、自分の未視聴の本数を読む",
  "watches:write": "自分の視聴記録を付ける・外す",
  "playlists:write":
    "同期するプレイリストを追加する（全員のホームに影響します）",
  "sync:run":
    "新着の取り込みを今すぐ実行する（新着があると全員に通知が届きます）",
  offline_access: "ログインし直さずに使い続ける（最長 30 日）",
};

/** 要求されていても、既定でチェックを外すスコープ（書き込み） */
export const WRITE_SCOPES = new Set([
  "watches:write",
  "playlists:write",
  "sync:run",
]);

/** 画面に出すスコープ（知らないものは出さない） */
export const knownScopes = (scopes: string[]) =>
  scopes.filter((s) => s in SCOPE_LABELS);
