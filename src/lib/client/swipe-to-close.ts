// シートの本文（縦にスクロールする所）をスワイプして閉じる。
// 下へ閉じるシートは、いちばん上までスクロールした状態のときだけ。右へ閉じるシートは、スクロール位置によらない。
// ここは縦にスクロールするので、pointer イベントだとブラウザにスクロールとして奪われる（pointercancel）。
// touchmove を止めるために passive: false で受ける必要があり、Svelte の ontouchmove（passive）では書けない。
// タッチ専用。マウスでは、上の帯と閉じるボタンを使う
const SWIPE_DECIDE = 6; // 指がこれだけ動いたら、閉じる操作かどうかを決める（px）。手ぶれのタップや長押しを潰さない

// <div use:swipeToClose={{ direction, enabled, onstart, onmove, onend }}> で使う
export const swipeToClose = (
  body: HTMLElement,
  handlers: {
    // 閉じる向き。省略すると下
    direction?: "down" | "right";
    // 閉じる操作を始めてよいか。動き出した時点で聞く
    enabled: () => boolean;
    // 指を置いた位置（閉じる向きの座標）
    onstart: (start: number) => void;
    // 指を置いた位置から、閉じる向きへ動いた長さ（px）
    onmove: (distance: number) => void;
    onend: () => void;
  },
) => {
  const start = (e: TouchEvent) => {
    if (e.touches.length !== 1) return;
    const target = e.target as Element;
    // 入力欄の上では、カーソルの移動や文字の選択を優先する
    if (target.closest?.("input, textarea, select")) return;
    const { clientX: startX, clientY: startY } = e.touches[0];
    let dragging = false;
    let distance = 0;

    const move = (ev: TouchEvent) => {
      const touch = ev.touches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const right = handlers.direction === "right";
      const along = right ? dx : dy;
      const across = Math.abs(right ? dy : dx);
      if (!dragging) {
        if (Math.abs(along) < SWIPE_DECIDE && across < SWIPE_DECIDE) return;
        // 閉じる向きに動いているときだけ、閉じる操作にする（下向きは先頭にいるときだけ）。それ以外はスクロールに任せる
        if (
          along <= across ||
          (!right && body.scrollTop > 0) ||
          !handlers.enabled()
        )
          return finish();
        dragging = true;
        handlers.onstart(right ? startX : startY);
      }
      if (ev.cancelable) ev.preventDefault();
      distance = Math.max(0, along);
      handlers.onmove(distance);
    };

    const end = (ev: TouchEvent) => {
      // 指を動かして離したときは、下のボタンのクリックにしない
      if (distance > SWIPE_DECIDE && ev.cancelable) ev.preventDefault();
      finish();
      if (dragging) handlers.onend();
    };

    // 再生ボタンの絵のように、押している最中に差し替わる要素は DOM から外れて、
    // イベントが本文まで届かなくなる。指を置いた要素で直接受ければ、外れても届く
    const finish = () => {
      target.removeEventListener("touchmove", move as EventListener);
      target.removeEventListener("touchend", end as EventListener);
      target.removeEventListener("touchcancel", end as EventListener);
    };
    target.addEventListener("touchmove", move as EventListener, {
      passive: false,
    });
    target.addEventListener("touchend", end as EventListener, {
      passive: false,
    });
    target.addEventListener("touchcancel", end as EventListener);
  };

  body.addEventListener("touchstart", start, { passive: true });
  return { destroy: () => body.removeEventListener("touchstart", start) };
};
