// ポリシー（イベストの紫の付箋）: イベントを受けて、次のコマンドを起動する。
// ドメインのコンテキスト同士は互いを知らないので、イベントとコマンドのつなぎはここ（Web 層の手前）で行う。
// 副作用（実際に通知を送る処理・データを消す処理）は引数で受け取る。container に依存しないので、bun test で確かめられる
import { match } from "@nw-union/nw-utils/lib/match";
import type { ResultAsync } from "@nw-union/nw-utils/lib/rslt";
import type { NewSyncedEvt } from "../../domain/Content/api.ts";
import type { MemberDeletedEvt } from "../../domain/Member/api.ts";
import type { AppError } from "../../domain/shared/error.ts";

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

/**
 * メンバーが退会した → 各集約に, そのメンバーのデータを消させる
 *
 * 後始末 (メンバー: アイコン画像と未使用の招待, 通知: 購読, コンテンツ: 視聴記録) は互いに関係ないので,
 * 1 つが失敗しても残りは続ける. 1 文ずつ消すので途中で失敗することがあるが, どれも何度呼んでも同じなので, やり直せる
 *
 * @returns 失敗した後始末のエラー (空なら, すべて消せた)
 */
export const onMemberDeleted = async (
  evt: MemberDeletedEvt,
  cleanups: readonly ((evt: MemberDeletedEvt) => ResultAsync<void, AppError>)[],
): Promise<AppError[]> => {
  const failures: AppError[] = [];
  for (const cleanup of cleanups) {
    match(await cleanup(evt))
      .ok(() => {})
      .err((e) => {
        failures.push(e);
      })
      .exhaustive();
  }
  return failures;
};
