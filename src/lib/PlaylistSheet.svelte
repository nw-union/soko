<script lang="ts">
import type { Props } from "../../pages/index.server";
import DurationLabel from "./DurationLabel.svelte";
import NewLabel from "./NewLabel.svelte";
import { swipeToClose } from "./swipe-to-close";
import { splitLinks } from "./url";
import { thumbnailFallback } from "./youtube";

// プレイリストの全動画を縦のリストで見せる、右から出る全画面のシート（iOS のナビゲーションの push と同じ動き）。
// URL は変えず、トップページの上に重ねる。動画を押すと、再生画面がこの上に開き、閉じるとここへ戻る
type Video = Props["playlists"][number]["videos"][number];

let {
	opened = $bindable(false),
	isWatched,
	isNew,
	onplay,
	onexternal,
}: {
	opened?: boolean;
	isWatched: (video: Video) => boolean;
	isNew: (video: Video) => boolean;
	onplay: (video: Video) => void;
	onexternal: (video: Video) => void;
} = $props();

let dialog = $state<HTMLDialogElement>();
let list = $state<Props["playlists"][number] | null>(null);

export function open(next: Props["playlists"][number]) {
	list = next;
	opened = true;
	dialog?.showModal();
}

// 閉じるときは、右へ滑らせて消してから dialog を閉じる（CSS の .closing と同じ長さ）
const CLOSE_MS = 320;
let closing = $state(false);

const close = () => {
	if (!dialog?.open || closing) return;
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
		dialog.close();
		return;
	}
	closing = true;
	setTimeout(() => dialog?.close(), CLOSE_MS);
};

const closed = () => {
	closing = false;
	dragX = 0;
	compact = false;
	list = null; // 次に開くときは、いちばん上から見せる
	opened = false;
};

// Esc でも、すぐに消さずに滑らせて閉じる
const cancel = (e: Event) => {
	e.preventDefault();
	close();
};

// 右へスワイプして閉じる。指に付いてきて、これ以上動かして離したら閉じる（他のシートと同じ長さ）
const SWIPE_CLOSE = 100;
let dragX = $state(0);

const swipe = {
	direction: "right" as const,
	enabled: () => !closing,
	onstart: () => {},
	onmove: (distance: number) => {
		dragX = distance;
	},
	onend: () => {
		if (dragX > SWIPE_CLOSE) close();
		dragX = 0;
	},
};

// このプレイリストの視聴の進み具合。再生画面で見終えて戻ると、その場で増える。
// 切り捨てて、全部見るまでは 100% と出さない
const watchedCount = $derived(list ? list.videos.filter(isWatched).length : 0);
const watchedPercent = $derived(
	list?.videos.length ? Math.floor((watchedCount / list.videos.length) * 100) : 0,
);

// 大きなタイトルが上の帯に隠れたら、帯の中に小さなタイトルを出す（iOS の large title と同じ動き）
let top = $state<HTMLElement>();
let largeTitle = $state<HTMLElement>();
let compact = $state(false);

const scrolled = () => {
	if (!top || !largeTitle) return;
	compact = largeTitle.getBoundingClientRect().bottom < top.getBoundingClientRect().bottom;
};

// 修飾キー付きは、見たことにして、そのまま YouTube へ（VideoTile.svelte と同じ）
const click = (e: MouseEvent, video: Video) => {
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
		onexternal(video);
		return;
	}
	e.preventDefault();
	onplay(video);
};
</script>

<dialog
  bind:this={dialog}
  class="sheet"
  class:dragging={dragX > 0}
  class:closing
  style:translate={dragX > 0 && !closing ? `${dragX}px 0` : undefined}
  use:swipeToClose={swipe}
  aria-label={list?.name || "Playlist"}
  oncancel={cancel}
  onclose={closed}
>
  {#if list}
    <!-- 上の帯は内容の上に浮かせる。色は敷かず、内容が帯に潜るところだけ、ぼかして溶かす -->
    <header class="top" bind:this={top}>
      <button type="button" class="back" aria-label="戻る" onclick={close}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <span class="inline-title" class:shown={compact} aria-hidden="true">{list.name || "Playlist"}</span>
    </header>
    <div class="body" onscroll={scrolled}>
      <div class="column">
        <h2 class="large-title" bind:this={largeTitle}>{list.name || "Playlist"}</h2>
        {#if list.description}
          <p class="desc">{#each splitLinks(list.description) as part}{#if part.href}<a href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>{:else}{part.text}{/if}{/each}</p>
        {/if}
        <!-- 視聴の進み具合。一覧の見出しとして、すぐ上に置く -->
        <div class="progress">
          <p class="progress-text">
            <span><strong>{watchedCount}</strong> / {list.videos.length} 本を視聴</span>
            <span>{watchedPercent}%</span>
          </p>
          <span class="progress-track" aria-hidden="true">
            <span class="progress-fill" style:width="{watchedPercent}%"></span>
          </span>
        </div>
        <ul class="items">
          {#each list.videos as video (video.id)}
            <li>
              <a class="item" href={video.url} target="_blank" rel="noopener noreferrer" onclick={(e) => click(e, video)}>
                <span class="thumb">
                  <img use:thumbnailFallback src={video.thumbnail} alt="" loading="lazy" decoding="async" />
                </span>
                <span class="text">
                  <span class="title">{video.title}</span>
                  {#if video.tags.length > 0}
                    <span class="tags">{video.tags.map((tag) => `#${tag}`).join(" ")}</span>
                  {/if}
                  {#if isNew(video) || video.duration || isWatched(video)}
                    <span class="labels">
                      {#if isNew(video)}<NewLabel />{/if}
                      <DurationLabel duration={video.duration} watched={isWatched(video)} />
                    </span>
                  {/if}
                </span>
              </a>
            </li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}
</dialog>

<style>
  .sheet {
    --ease: cubic-bezier(0.32, 0.72, 0, 1);
    /* プロフィールのシートと同じ面の色。奥のトップページの色味（#2c3939）のまま暗くした色 */
    --surface: 26 36 35;
    --label: #f5f5f7;
    --secondary: rgb(235 235 245 / 0.6);
    --bar-height: calc(env(safe-area-inset-top) + 0.5rem + 44px + 0.5rem);
    position: fixed;
    inset: 0;
    box-sizing: border-box;
    width: 100%;
    max-width: none;
    height: 100dvh;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    overflow: hidden;
    background: rgb(var(--surface));
    color: var(--label);
    text-shadow: none;
    transition: translate 260ms var(--ease);
  }

  /* ホーム画面から開いたとき（PWA）も、画面の下端まで覆う（Stage.svelte の .stage と同じ） */
  @media (display-mode: standalone) {
    .sheet {
      bottom: auto;
      height: 100lvh;
    }
  }

  .sheet[open] {
    display: flex;
    flex-direction: column;
    animation: slide-in 480ms var(--ease);
  }

  /* スワイプ中は指に付いてくる */
  .sheet.dragging {
    transition: none;
  }

  .sheet.closing {
    translate: 100% 0;
    transition: translate 320ms var(--ease);
  }

  @keyframes slide-in {
    from {
      translate: 100% 0;
    }
  }

  .sheet::backdrop {
    background: rgb(0 0 0 / 0.5);
    transition: opacity 320ms;
  }

  .sheet.closing::backdrop {
    opacity: 0;
  }

  /* 内容の上に浮かぶ帯。左に戻るボタン、真ん中に、大きなタイトルが隠れたら出る小さなタイトル */
  .top {
    position: absolute;
    z-index: 1;
    inset: 0 0 auto;
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 44px;
    align-items: center;
    gap: 0.5rem;
    padding: calc(env(safe-area-inset-top) + 0.5rem) calc(env(safe-area-inset-right) + 1rem) 0.5rem
      calc(env(safe-area-inset-left) + 1rem);
    pointer-events: none;
  }

  /* 内容が帯に潜るところの効果（iOS の scroll edge effect）。色の面にせず、下へ向かって消す */
  .top::before {
    content: "";
    position: absolute;
    z-index: -1;
    inset: 0 0 -1.25rem;
    background: linear-gradient(rgb(var(--surface) / 0.92), rgb(var(--surface) / 0));
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    mask-image: linear-gradient(#000 55%, transparent);
    -webkit-mask-image: linear-gradient(#000 55%, transparent);
  }

  /* 戻るボタンは、この画面で唯一のガラス。指に合わせて少し沈む */
  .back {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.12);
    backdrop-filter: blur(24px) saturate(1.4);
    -webkit-backdrop-filter: blur(24px) saturate(1.4);
    box-shadow:
      inset 0 0 0 0.5px rgb(255 255 255 / 0.2),
      inset 0 1px 0 rgb(255 255 255 / 0.25);
    cursor: pointer;
    pointer-events: auto;
    transition: scale 160ms var(--ease);
    -webkit-tap-highlight-color: transparent;
  }

  .back:active {
    scale: 0.92;
  }

  .back svg {
    width: 1.35rem;
    height: 1.35rem;
    margin-left: -2px; /* ‹ は重心が右寄りに見えるので、少し左にずらす */
    fill: none;
    stroke: var(--label);
    stroke-width: 2.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .inline-title {
    overflow: hidden;
    font: 600 1rem/1.3 system-ui, sans-serif;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 180ms;
  }

  .inline-title.shown {
    opacity: 1;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: var(--bar-height) calc(env(safe-area-inset-right) + 1rem) calc(env(safe-area-inset-bottom) + 2.5rem)
      calc(env(safe-area-inset-left) + 1rem);
  }

  /* 広い画面では、行が間延びしないよう幅を抑える */
  .column {
    width: min(100%, 48rem);
    margin: 0 auto;
  }

  /* 大きなタイトル。スクロールすると帯の小さなタイトルに替わる */
  .large-title {
    margin: 0.25rem 0 0;
    font: 700 2rem/1.2 system-ui, sans-serif;
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }

  /* プレイリストの説明。改行は YouTube に書かれたまま出す */
  .desc {
    margin: 0.75rem 0 0;
    color: var(--secondary);
    font: 400 0.9rem/1.5 system-ui, sans-serif;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* リンクの色は、再生画面の説明と同じ */
  .desc a {
    color: #64d2ff;
    text-decoration: underline;
  }

  /* 視聴の進み具合。緑は、視聴済みの印（DurationLabel.svelte）と同じ色 */
  .progress {
    margin: 1.25rem 0 0;
  }

  .progress-text {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    margin: 0;
    color: var(--secondary);
    font: 400 0.85rem/1.3 system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
  }

  .progress-text strong {
    color: var(--label);
    font-weight: 600;
  }

  .progress-track {
    display: block;
    height: 0.3rem;
    margin-top: 0.4rem;
    overflow: hidden;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.14);
  }

  .progress-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: #30a14e;
    transition: width 320ms var(--ease);
  }

  /* 動画の一覧。プロフィールのタイルと同じ面で、ひとまとまりの角丸のグループにする（iOS の inset grouped）。
     内容の層なのでガラスは使わない */
  .items {
    --thumb: min(7.5rem, 34vw);
    --row-gap: 0.75rem;
    --row-inset: 0.75rem;
    list-style: none;
    margin: 0.75rem 0 0;
    padding: 0;
    overflow: hidden;
    border-radius: 1.1rem;
    background: rgb(255 255 255 / 0.07);
    border: 1px solid rgb(255 255 255 / 0.08);
  }

  .item {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    padding: 0.65rem var(--row-inset);
    color: inherit;
    text-decoration: none;
    transition: background-color 160ms;
    -webkit-tap-highlight-color: transparent;
  }

  /* 行の区切り。iOS のリストと同じく、文字の頭から右端まで */
  li:not(:last-child) .item::after {
    content: "";
    position: absolute;
    right: 0;
    bottom: 0;
    left: calc(var(--row-inset) + var(--thumb) + var(--row-gap));
    height: 0.5px;
    background: rgb(255 255 255 / 0.14);
  }

  .item:active {
    background: rgb(255 255 255 / 0.1);
  }

  @media (hover: hover) {
    .item:hover {
      background: rgb(255 255 255 / 0.05);
    }
  }

  .back:focus-visible,
  .item:focus-visible {
    outline: 2px solid #fff;
    outline-offset: -2px;
  }

  .thumb {
    flex: none;
    width: var(--thumb);
    aspect-ratio: 16 / 9;
    overflow: hidden;
    border-radius: 0.6rem;
    background: rgb(255 255 255 / 0.08);
  }

  .thumb img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
  }

  .title {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    font: 600 0.95rem/1.3 system-ui, sans-serif;
  }

  .tags {
    max-width: 100%;
    overflow: hidden;
    color: var(--secondary);
    font: 400 0.8rem/1.3 system-ui, sans-serif;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .labels {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }

  /* 「視差効果を減らす」設定のときは、滑らせずにその場に出す */
  @media (prefers-reduced-motion: reduce) {
    .sheet[open] {
      animation: none;
    }

    .sheet,
    .back,
    .inline-title,
    .progress-fill,
    .item {
      transition: none;
    }
  }

  /* 「透明度を下げる」設定のときは、ぼかしをやめて濃い単色にする。
     prefers-reduced-transparency は iPhone の Safari で効かない可能性があるので、
     「コントラストを上げる」（prefers-contrast: more）でも同じ不透明表示にする */
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .top::before {
      inset: 0;
      background: rgb(var(--surface));
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      mask-image: none;
      -webkit-mask-image: none;
    }

    .back {
      background: rgb(70 80 79);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }

  @media (prefers-contrast: more) {
    .progress-track {
      background: rgb(255 255 255 / 0.32);
    }

    .items {
      border-color: rgb(255 255 255 / 0.3);
    }

    li:not(:last-child) .item::after {
      background: rgb(255 255 255 / 0.3);
    }
  }
</style>
