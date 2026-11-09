<script lang="ts">
import Stage from "../src/lib/components/Stage.svelte";
import { registerServiceWorker } from "../src/lib/client/pwa";
import { resyncPush, syncBadge } from "../src/lib/client/push";
import { onMount } from "svelte";
import { useShared } from "@void/svelte";

let { children } = $props();

const shared = useShared();

onMount(() => {
	registerServiceWorker();
	// 通知を許可済みの端末は、購読をサーバーに送り直す（ログイン中だけ）
	if (shared.auth.user) resyncPush().catch(() => {});

	// アプリのアイコンのバッジを、開いたときと、裏から戻ったときに合わせ直す
	const refreshBadge = () => {
		if (shared.auth.user && !document.hidden) syncBadge().catch(() => {});
	};
	refreshBadge();
	document.addEventListener("visibilitychange", refreshBadge);
	return () => document.removeEventListener("visibilitychange", refreshBadge);
});
</script>

<!--
  アプリのページの共通の枠。ページを移動してもこのレイアウトは作り直されないので、
  背景（ノイズの動きを含む）は途切れずに残り、中身だけが入れ替わる。
-->
<Stage>
  <div class="shell">
    <main class="view">
      {@render children()}
    </main>
  </div>
</Stage>

<style>
  /* 内容の量に関わらず常に画面いっぱい */
  .shell {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-rows: 1fr;
  }

  .view {
    /* 内容の横幅の最大値。これより広い画面では、内容を真ん中に寄せる（背景は画面いっぱいのまま） */
    --content-max: 800px;
    --gutter: 1.25rem; /* 狭い画面での左右の余白 */
    overflow-y: auto;
    overscroll-behavior-y: contain;
    /* スクロールバーが出ても、左右の余白が変わらず真ん中がずれないようにする */
    scrollbar-gutter: stable both-edges;
    /* 左右は、広い画面では（画面の幅 − 最大値）の半分を余白にして中身を中央に置く */
    padding-top: calc(env(safe-area-inset-top) + 2rem);
    padding-bottom: calc(env(safe-area-inset-bottom) + 3rem);
    padding-left: max(calc(env(safe-area-inset-left) + var(--gutter)), calc((100% - var(--content-max)) / 2));
    padding-right: max(calc(env(safe-area-inset-right) + var(--gutter)), calc((100% - var(--content-max)) / 2));
    /* 中身だけを画面遷移のアニメーション（クロスフェード）の対象にする */
    view-transition-name: view;
  }

  /* アニメーションは短く。待たされている感じを出さない */
  :global(::view-transition-old(view)),
  :global(::view-transition-new(view)) {
    animation-duration: 120ms;
  }

  /* 「視差効果を減らす」設定のときは、画面遷移のクロスフェードもしない */
  @media (prefers-reduced-motion: reduce) {
    :global(::view-transition-old(view)),
    :global(::view-transition-new(view)) {
      animation: none;
    }
  }
</style>
