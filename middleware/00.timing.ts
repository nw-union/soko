import { timing } from "hono/timing";
import { defineMiddleware } from "void";

// 応答に Server-Timing ヘッダーを付ける（DevTools の Network → Timing に、段階ごとの時間が出る）。
// 各段階は startTime / endTime で計る（01.auth.ts の passkey、pages/index.server.ts の feed）。
// total はこのミドルウェアから応答までで、Void の認証（セッションの読み出し）はその前に済んでいるので含まない。
// TTFB − total が、ネットワークとセッションの読み出しの合計になる
export default defineMiddleware(timing({ totalDescription: "app" }));
