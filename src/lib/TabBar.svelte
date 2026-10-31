<script lang="ts">
import { Link, useRouter } from "@void/svelte";

const router = useRouter();

// アイコンの下に、名前（label）を小さく出す（HIG: タブにはラベルを付ける）
const tabs = [
	{
		href: "/",
		label: "Soko",
		// ダンボール箱: 外形、上面のふた、中央の折り目、ガムテープ
		icons: [
			"M12 3 3.5 7.6v8.8L12 21l8.5-4.6V7.6z",
			"M3.5 7.6 12 12.2l8.5-4.6",
			"M12 12.2V21",
			"M7.7 5.3l8.5 4.6",
		],
	},
	{
		href: "/profile",
		label: "Profile",
		// ユーザー: 頭と肩
		icons: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4 20a8 8 0 0 1 16 0"],
	},
];

// /profile の配下なども選択中にする
const isActive = (href: string) =>
	href === "/" ? router.path === "/" : router.path.startsWith(href);

// 選択中のタブの位置。ガラスの「つや玉」がこの位置へ滑って移動する
const activeIndex = $derived(
	Math.max(
		0,
		tabs.findIndex((tab) => isActive(tab.href)),
	),
);
</script>

<nav class="tabbar" aria-label="メインメニュー" style="--count: {tabs.length}; --i: {activeIndex}">
  <span class="bubble" aria-hidden="true"></span>
  {#each tabs as tab (tab.href)}
    <!--
      prefetch="mount": タブバーが表示された時点で各画面を先読みする。
      cacheFor: 30 秒は新鮮として即表示、5 分までは古いものを即表示しつつ裏で更新する。
    -->
    <Link
      href={tab.href}
      prefetch="mount"
      cacheFor={["30s", "5m"]}
      viewTransition
      class="tab {isActive(tab.href) ? 'active' : ''}"
      aria-current={isActive(tab.href) ? "page" : undefined}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {#each tab.icons as d (d)}<path {d} />{/each}
      </svg>
      <span class="label">{tab.label}</span>
    </Link>
  {/each}
</nav>

<style>
  /* リキッドグラス: 画面の左下に浮かぶカプセル。背後の画像がぼけて透けて見える */
  .tabbar {
    --pad: 0.3rem;
    position: absolute;
    left: calc(env(safe-area-inset-left) + 1.25rem);
    bottom: calc(env(safe-area-inset-bottom) + 0.9rem);
    display: grid;
    grid-template-columns: repeat(var(--count), 1fr);
    width: min(calc(100% - 2.5rem), calc(var(--count) * 5.5rem));
    padding: var(--pad);
    border-radius: 999px;
    isolation: isolate;
    background: linear-gradient(135deg, rgb(255 255 255 / 0.2), rgb(255 255 255 / 0.05));
    border: 1px solid rgb(255 255 255 / 0.28);
    backdrop-filter: blur(18px) saturate(180%) brightness(1.08);
    -webkit-backdrop-filter: blur(18px) saturate(180%) brightness(1.08);
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.55), /* 上端のハイライト */
      inset 0 -1px 0 rgb(255 255 255 / 0.12),
      inset 0 0 22px rgb(255 255 255 / 0.08),
      0 10px 30px rgb(0 0 0 / 0.35);
    /* 画面遷移のアニメーションの対象から外し、移動中もタブバーは動かさない */
    view-transition-name: tabbar;
  }

  /* ホーム画面から開いたとき（PWA）は、画面の下端ぎりぎりまで寄せる。カプセルの角が画面の丸い角で欠けない 2px を残す。
     ホームバーのない端末（余白が 0）では、端に貼り付かないように今のままにする */
  @media (display-mode: standalone) {
    .tabbar {
      bottom: max(2px, calc(0.9rem - env(safe-area-inset-bottom) * 10));
    }
  }

  /* 選択中を示す、もう一段明るいガラスの玉。タブの間を液体のように滑る */
  .bubble {
    position: absolute;
    z-index: -1;
    top: var(--pad);
    bottom: var(--pad);
    left: var(--pad);
    width: calc((100% - 2 * var(--pad)) / var(--count));
    border-radius: 999px;
    background: linear-gradient(180deg, rgb(255 255 255 / 0.34), rgb(255 255 255 / 0.12));
    box-shadow:
      inset 0 1px 0 rgb(255 255 255 / 0.7),
      inset 0 -6px 12px rgb(255 255 255 / 0.1),
      0 2px 10px rgb(0 0 0 / 0.25);
    transform: translateX(calc(var(--i) * 100%));
    transition: transform 420ms cubic-bezier(0.34, 1.45, 0.5, 1); /* 少し行き過ぎて戻る */
  }

  .tabbar :global(.tab) {
    display: grid;
    place-items: center;
    gap: 0.1rem;
    padding: 0.2rem 0 0.14rem;
    border-radius: 999px;
    color: rgb(255 255 255 / 0.75);
    text-decoration: none;
    transition: color 200ms;
    -webkit-tap-highlight-color: transparent;
  }

  .tabbar :global(.tab.active) {
    color: #fff;
  }

  svg {
    width: 1.6rem;
    height: 1.6rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
    filter: drop-shadow(0 1px 4px rgb(0 0 0 / 0.35));
  }

  /* iOS のタブバーのラベルと同じく、10pt 前後の小さな文字 */
  .label {
    font: 500 0.625rem/1.2 system-ui, sans-serif;
    text-shadow: 0 1px 4px rgb(0 0 0 / 0.35);
  }

  /* backdrop-filter が使えない環境では、読めるように濃いめの単色にする */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .tabbar {
      background: rgb(30 40 40 / 0.85);
    }
  }

  /* 「透明度を下げる」設定のときも同様 */
  @media (prefers-reduced-transparency: reduce) {
    .tabbar {
      background: rgb(30 40 40 / 0.92);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .bubble {
      transition: none;
    }
  }
</style>
