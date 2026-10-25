// PWA 用サービスワーカー。開発中はキャッシュが邪魔になるので本番ビルドでのみ登録する
export function registerServiceWorker() {
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}
