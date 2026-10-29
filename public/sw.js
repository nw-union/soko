// トップページ用の最小限のサービスワーカー。
// - ハッシュ付きの /assets/ は不変なのでキャッシュ優先
// - トップページ（/）のナビゲーションはネットワーク優先で、オフライン時だけキャッシュを使う
// API・認証・その他のページには一切関与しない
const CACHE = "nwu-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === "navigate" && url.pathname === "/") {
    event.respondWith(networkFirst(request));
  }
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    // ログイン中のレスポンスは no-store で返ってくる。ユーザー情報を含みうるので保存しない
    const noStore = (response.headers.get("cache-control") ?? "").includes(
      "no-store",
    );
    if (response.ok && !noStore) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw error;
  }
}
