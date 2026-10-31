// トップページ用の最小限のサービスワーカー。
// - ハッシュ付きの /assets/ は不変なのでキャッシュ優先
// - トップページ（/）のナビゲーションはネットワーク優先で、オフライン時だけキャッシュを使う
// - 新着動画のプッシュ通知を表示し、押されたらその動画を開く（src/lib/push-notify.ts が送る）
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

// 中身は { title, body, url }（src/lib/push-notify.ts の PushPayload）。
// iPhone は、届いたプッシュを毎回通知として表示しないと購読を止めるので、必ず表示する
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    // 壊れた中身でも、通知は出す
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "NWU", {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      // 新着の通知は、たまっても 1 つにまとめる
      tag: "new-videos",
      // まとめたときも、音やバナーで知らせ直す
      renotify: true,
      data: { url: data.url || "/" },
    }),
  );
});

// 通知を押したら、開いているアプリをその動画のページ（/?v=…）に移す。開いていなければ新しく開く
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    event.notification.data?.url || "/",
    self.location.origin,
  );
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window" });
      for (const client of windows) {
        try {
          const focused = await client.focus();
          if (await focused.navigate(url.href)) return;
        } catch {
          // 移せなかったら、新しく開く
        }
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
