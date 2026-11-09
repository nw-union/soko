// ポリシー（イベストの紫の付箋）: イベントを受けて、次のコマンドを起動する。
// ドメインのコンテキスト同士は互いを知らないので、イベントとコマンドのつなぎはここ（Web 層の手前）で行う。
// 副作用（実際に通知を送る処理）は引数で受け取る。container に依存しないので、bun test で確かめられる
import type { NewSyncedEvt } from "../domain/Content/api.ts";

/**
 * 新規追加動画があった場合 → Push 通知する
 *
 * 差分の同期（syncNew）で動画が増えたときだけ通知を起動する。
 * 通知に失敗して未通知のまま残った動画は、全件の同期（8 時間ごと）が拾う
 */
export const onNewSynced = async (
  evt: NewSyncedEvt,
  notify: () => Promise<void>,
): Promise<void> => {
  if (evt.type !== "Synced" || evt.added === 0) return;
  await notify();
};
