import { secureHeaders } from "hono/secure-headers";
import { defineMiddleware } from "void";

// すべての応答に付けるセキュリティヘッダー。01.auth.ts のリダイレクトにも付くよう、最初に動かす。
// CSP は本番だけ。開発サーバー（Vite）はインラインのスクリプトや HMR の接続を使うので、付けると動かなくなる
export default defineMiddleware(
  secureHeaders({
    contentSecurityPolicy: import.meta.env.PROD
      ? {
          defaultSrc: ["'self'"],
          // YouTube の IFrame Player API（src/lib/youtube-player.ts）は www.youtube.com からスクリプトを読む
          scriptSrc: ["'self'", "https://www.youtube.com"],
          // Svelte が style 属性（--ring など）を使う
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https://i.ytimg.com"],
          fontSrc: ["'self'", "data:"],
          frameSrc: ["https://www.youtube-nocookie.com"],
          connectSrc: ["'self'"],
          workerSrc: ["'self'"],
          manifestSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        }
      : undefined,
    xFrameOptions: "DENY",
    // no-referrer（既定）だと、YouTube の埋め込みプレイヤーが再生できない
    referrerPolicy: "strict-origin-when-cross-origin",
    // 独自ドメインの他のサブドメインには影響させない
    strictTransportSecurity: "max-age=15552000",
    permissionsPolicy: { camera: [], microphone: [], geolocation: [] },
  }),
);
