// 新着動画のプッシュ通知の購読（ブラウザ用）。購読はサービスワーカー（public/sw.js）に結びつく。
// iPhone・iPad は、ホーム画面に追加したアプリの中でだけ通知を使える（Safari のタブでは PushManager がない）
import { base64urlToBytes } from "../../domain/base64url.ts";

export type PushState =
  // この端末・ブラウザでは使えない、またはサーバーに鍵がない
  | "unsupported"
  // iPhone・iPad で、ホーム画面に追加していない
  | "needs-install"
  // 通知を拒否されている（端末の設定でしか戻せない）
  | "denied"
  | "off"
  | "on";

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  // iPadOS の Safari は Mac として名乗る
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const supported = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

// 本番では layout で登録済み。開発中は登録されていないので、通知を試すときだけここで登録する
const registration = async () =>
  (await navigator.serviceWorker.getRegistration()) ??
  (await navigator.serviceWorker.register("/sw.js"));

const currentSubscription = async () =>
  (await registration()).pushManager.getSubscription();

const save = (subscription: PushSubscription) =>
  fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });

export async function pushState(): Promise<PushState> {
  if (!supported())
    return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  const res = await fetch("/api/push").catch(() => null);
  const data = (await res?.json().catch(() => null)) as {
    publicKey: string | null;
  } | null;
  if (!data?.publicKey) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "off";
  return (await currentSubscription()) ? "on" : "off";
}

// 通知をオンにする。許可を求めるダイアログは、ボタンを押した直後に出さないと iPhone では出ないので、
// 最初の await より前に呼ぶ
export async function enablePush(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "off";
  const res = await fetch("/api/push");
  const { publicKey } = (await res.json()) as { publicKey: string | null };
  if (!publicKey) return "unsupported";
  const reg = await registration();
  const subscription =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64urlToBytes(publicKey),
    }));
  const saved = await save(subscription);
  if (!saved.ok) throw new Error(`購読を保存できませんでした: ${saved.status}`);
  syncBadge().catch(() => {});
  return "on";
}

// 通知をオフにする。端末の購読をやめ、サーバーからも消す
export async function disablePush(): Promise<PushState> {
  if (!supported()) return "unsupported";
  const subscription = await currentSubscription();
  if (subscription) {
    await fetch(
      `/api/push?endpoint=${encodeURIComponent(subscription.endpoint)}`,
      { method: "DELETE" },
    );
    await subscription.unsubscribe();
  }
  await clearBadge();
  return "off";
}

// アプリを開いたときに、端末の購読をサーバーに送り直す。
// プッシュサービス側で購読が変わっても（Safari には pushsubscriptionchange がない）、これで追いつく
export async function resyncPush() {
  if (!supported() || Notification.permission !== "granted") return;
  const subscription = await currentSubscription();
  if (subscription) await save(subscription);
}

// アプリのアイコンのバッジを消す。通知をオフにしたときと、ログイン画面を開いたときに呼ぶ
export async function clearBadge() {
  if ("clearAppBadge" in navigator)
    await navigator.clearAppBadge().catch(() => {});
}

// アプリのアイコンのバッジを、未視聴の New の本数に合わせる。ホーム画面に追加したアプリで、通知がオンのときだけ出す。
// プッシュは通知の表示が必須で、バッジだけを裏で更新できない。他の端末で見た分などは、アプリを開いたときにここで追いつく
export async function syncBadge() {
  if (!("setAppBadge" in navigator) || !isStandalone()) return;
  const subscribed =
    supported() &&
    Notification.permission === "granted" &&
    (await currentSubscription());
  if (!subscribed) return clearBadge();
  const res = await fetch("/api/badge");
  if (!res.ok) return;
  const { count } = (await res.json()) as { count: number };
  await navigator.setAppBadge(count);
}
