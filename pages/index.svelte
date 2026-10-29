<script lang="ts">
import type { Props } from "./index.server";
import VideoTile from "../src/lib/VideoTile.svelte";

let { playlists }: Props = $props();

// 再生中の動画。入っている間だけ埋め込みプレイヤーを出す
let playing = $state<Props["playlists"][number]["videos"][number] | null>(null);
let dialog = $state<HTMLDialogElement>();
// 概要欄は最初は数行だけ見せて、「もっと見る」で全文にする
let expanded = $state(false);

const play = (video: Props["playlists"][number]["videos"][number]) => {
	playing = video;
	expanded = false;
	dialog?.showModal();
};

// 閉じたら iframe ごと外して、音を止める
const close = () => {
	dialog?.close();
	playing = null;
};
</script>

{#if playlists.length === 0}
  <p class="empty">Not Found</p>
{:else}
  <!-- プレイリストごとに、最新の動画を並べる -->
  {#each playlists as list (list.id)}
    <h1>{list.name || "Playlist"}</h1>
    <ul class="tiles">
      {#each list.videos as video (video.id)}
        <li>
          <VideoTile url={video.url} thumbnail={video.thumbnail} title={video.title} duration={video.duration} onplay={() => play(video)} />
        </li>
      {/each}
    </ul>
  {/each}
{/if}

<!-- 背景（::backdrop）のクリックは dialog 自身へのクリックになるので、そこで閉じる -->
<!-- biome-ignore lint/a11y/useKeyWithClickEvents: キーボードでは dialog 標準の Esc で閉じられる -->
<dialog
  bind:this={dialog}
  class="player"
  aria-label={playing?.title}
  onclose={() => (playing = null)}
  onclick={(e) => e.target === dialog && close()}
>
  {#if playing}
    <div class="top">
      <button type="button" class="close" aria-label="閉じる" onclick={close}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </div>
    <div class="frame">
      <iframe
        src={playing.embed}
        title={playing.title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"
      ></iframe>
    </div>
    <div class="info">
      <h2 class="heading">{playing.title}</h2>
      {#if playing.description}
        <div class="desc" class:expanded>
          <p class="desc-text">{playing.description}</p>
          <button type="button" class="more" onclick={() => (expanded = !expanded)}>
            {expanded ? "一部を表示" : "もっと見る"}
          </button>
        </div>
      {/if}
      <a class="open" href={playing.url} target="_blank" rel="noopener noreferrer">YouTube で開く</a>
    </div>
  {/if}
</dialog>

<style>
  h1 {
    margin: 0 0 1.25rem;
    font-size: 1.4rem;
  }

  /* 2 つ目以降の見出しは、上に間隔を空ける */
  h1:not(:first-child) {
    margin-top: 2rem;
  }

  .tiles {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    /* 最大 2 列。16rem に満たない幅では 1 列にする */
    grid-template-columns: repeat(auto-fill, minmax(min(100%, max(16rem, calc((100% - 1rem) / 2))), 1fr));
    gap: 1rem;
  }

  /* 実際の YouTube に寄せたダークテーマ（#0f0f0f の面、角丸の動画、白い太字タイトル、丸い濃色ボタン） */
  .player {
    width: min(100vw - 1.5rem, 56rem);
    padding: 0 0 0.25rem;
    border: 1px solid rgb(255 255 255 / 0.18);
    border-radius: 1rem;
    overflow: hidden;
    /* 黒い背景・黒い動画と区別できるよう、面は少し明るいグレーにして縁と影をつける */
    background: #2a2a2e;
    color: #f1f1f1;
    box-shadow: 0 24px 64px rgb(0 0 0 / 0.6);
  }

  /* 画面の高さを超えないようにして、余る分は概要欄の中でスクロールさせる */
  .player[open] {
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - 1.5rem);
  }

  .top,
  .frame {
    flex: none;
  }

  .player::backdrop {
    background: rgb(20 20 28 / 0.55);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  .top {
    display: flex;
    justify-content: flex-end;
    padding: 0.35rem 0.5rem;
  }

  .close {
    display: grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
  }

  .close:hover {
    background: rgb(255 255 255 / 0.1);
  }

  .close svg {
    width: 1.4rem;
    height: 1.4rem;
    fill: none;
    stroke: #f1f1f1;
    stroke-width: 2;
    stroke-linecap: round;
  }

  /* 動画は面の中に余白を取って浮かせる */
  .frame {
    aspect-ratio: 16 / 9;
    margin: 0 0.75rem;
    border-radius: 0.6rem;
    overflow: hidden;
    background: #000;
  }

  iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }

  .info {
    flex: 0 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.85rem 1rem 1rem;
  }

  .heading {
    margin: 0;
    flex: none;
    font: 600 1.1rem/1.45 Roboto, system-ui, sans-serif;
    overflow-wrap: anywhere;
  }

  /* 概要欄。改行はそのまま、折りたたみ中は 3 行まで */
  .desc {
    box-sizing: border-box;
    align-self: stretch;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 0.7rem 0.85rem;
    border-radius: 0.6rem;
    background: rgb(255 255 255 / 0.08);
    font: 400 0.85rem/1.5 system-ui, sans-serif;
  }

  .desc-text {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .desc.expanded .desc-text {
    display: block;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }

  .more {
    flex: none;
    align-self: flex-start;
    margin-top: 0.4rem;
    padding: 0;
    border: 0;
    background: none;
    color: #f1f1f1;
    font: 600 0.8rem system-ui, sans-serif;
    cursor: pointer;
  }

  .open {
    flex: none;
    padding: 0.45rem 0.9rem;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.14);
    color: #f1f1f1;
    font: 500 0.85rem system-ui, sans-serif;
    text-decoration: none;
  }

  .open:hover {
    background: rgb(255 255 255 / 0.2);
  }
</style>
