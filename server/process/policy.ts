// ポリシー（イベストの紫の付箋）: イベントを受けて、次のコマンドを起動する。
// ドメインのコンテキスト同士は互いを知らないので、イベントとコマンドのつなぎはここ（Web 層の手前）で行う。
// 副作用（実際に通知を送る処理）は引数で受け取る。container に依存しないので、bun test で確かめられる
import type { AllSyncedEvt, NewSyncedEvt } from "../../domain/Content/api.ts";

/**
 * 新規追加動画があった場合 → Push 通知する
 *
 * 全件の同期（syncAll）・差分の同期（syncNew）のどちらでも、動画が増えたときだけ通知を起動する。
 * 通知に失敗して未通知のまま残った動画は、次に動画が増えて通知するときに一緒に拾う
 * （通知はまだ通知していない動画をすべて対象にする。投稿から日が経ったものは送らずに通知済みにする）
 */
export const onVideosSynced = async (
  evt: AllSyncedEvt | NewSyncedEvt,
  notify: () => Promise<void>,
): Promise<void> => {
  if (evt.type !== "Synced" || evt.addedVideoIds.length === 0) return;
  await notify();
};
