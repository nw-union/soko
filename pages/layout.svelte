<script lang="ts">
import Stage from "../src/lib/Stage.svelte";
import TabBar from "../src/lib/TabBar.svelte";
import { registerServiceWorker } from "../src/lib/pwa";
import { resyncPush } from "../src/lib/push";
import { onMount } from "svelte";
import { useShared } from "@void/svelte";
// 見出し用フォント（自前配信。Google Fonts への通信はなく、サービスワーカーでキャッシュされる）
import "@fontsource-variable/orbitron";

let { children } = $props();

const shared = useShared();

onMount(() => {
	registerServiceWorker();
	// 通知を許可済みの端末は、購読をサーバーに送り直す（ログイン中だけ）
	if (shared.auth.user) resyncPush().catch(() => {});
});
</script>

<!--
  アプリのページの共通の枠。ページを移動してもこのレイアウトは作り直されないので、
  背景（ノイズの動きを含む）とタブバーは途切れずに残り、中身だけが入れ替わる。
-->
<Stage>
  <div class="shell">
    <main class="view">
      {@render children()}
    </main>
    <TabBar />
  </div>
</Stage>

<style>
  /* 内容の量に関わらず常に画面いっぱい。タブバーは画面下に固定される */
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
    /* スクロールバーが出ても、左右の余白が変わらず真ん中がずれないようにする */
    scrollbar-gutter: stable both-edges;
    /* 下は浮かぶタブバーの高さぶん空け、スクロールした中身がガラスの下を通るようにする。
       左右は、広い画面では（画面の幅 − 最大値）の半分を余白にして中身を中央に置く */
    padding-top: calc(env(safe-area-inset-top) + 2rem);
    padding-bottom: 7rem;
    padding-left: max(calc(env(safe-area-inset-left) + var(--gutter)), calc((100% - var(--content-max)) / 2));
    padding-right: max(calc(env(safe-area-inset-right) + var(--gutter)), calc((100% - var(--content-max)) / 2));
    /* 中身だけを画面遷移のアニメーション（クロスフェード）の対象にする */
    view-transition-name: view;
  }

  /* アプリのページの見出し（h1）は Orbitron。英数字のみのサブセットで、日本語は通常のフォントになる */
  :global(h1) {
    font-family: "Orbitron Variable", system-ui, sans-serif;
    font-weight: 600;
    letter-spacing: 0.06em;
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
