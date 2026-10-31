<script lang="ts">
import { thumbnailFallback } from "./youtube";
// YouTube の動画のカード（ホームの横スライド用）。上にサムネイル、下にタイトル・タグ・動画時間（視聴済みなら ▶ の代わりに緑のチェック）。
// 押すと onplay でアプリ内再生にする。修飾キー付きは onexternal を呼んで、そのまま YouTube へ（JS が動かない場合も YouTube へ）
let {
	url,
	thumbnail,
	title,
	duration,
	tags,
	watched,
	onplay,
	onexternal,
}: {
	url: string;
	thumbnail: string;
	title: string;
	duration: string | null;
	tags: string[];
	watched: boolean;
	onplay: () => void;
	onexternal: () => void;
} = $props();

const click = (e: MouseEvent) => {
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
		onexternal();
		return;
	}
	e.preventDefault();
	onplay();
};
</script>

<a class="tile glass tile-link" href={url} target="_blank" rel="noopener noreferrer" onclick={click}>
  <span class="thumb">
    <img use:thumbnailFallback src={thumbnail} alt="" loading="lazy" decoding="async" />
  </span>
  <span class="title">
    <span class="clamp">{title}</span>
    {#if tags.length > 0}
      <span class="tags">{tags.map((tag) => `#${tag}`).join(" ")}</span>
    {/if}
    <!-- ライブなど長さのない動画でも、視聴済みならチェックだけ出す -->
    {#if duration || watched}
      <span class="duration">
        {#if watched}
          <svg class="check" viewBox="0 0 24 24" role="img" aria-label="Watched"><circle cx="12" cy="12" r="12" /><path d="M6.5 12.5l3.8 3.8 7.2-8" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        {/if}
        {duration ?? ""}
      </span>
    {/if}
  </span>
</a>

<style>
  .tile {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    width: 10.5rem;
    height: 100%;
    border-radius: 1rem;
    overflow: hidden;
    color: #fff;
    text-decoration: none;
  }

  .thumb {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    background: rgb(0 0 0 / 0.35); /* 画像が届くまでの下地 */
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .title {
    padding: 0.5rem 0.6rem 0.6rem;
    font: 600 0.8rem/1.35 system-ui, sans-serif;
    text-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
  }

  /* タイトルの下のタグ。1 行に収まらない分は省略する */
  .tags {
    display: block;
    margin-top: 0.25rem;
    font: 500 0.7rem/1.4 system-ui, sans-serif;
    color: rgb(255 255 255 / 0.78);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* タイトルの下に出す、再生ボタン風の丸いボタン（▶ と動画時間） */
  .duration {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin-top: 0.4rem;
    padding: 0.2rem 0.55rem 0.2rem 0.4rem;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.2);
    font: 600 0.7rem/1.2 system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
  }

  .duration svg {
    width: 0.9rem;
    height: 0.9rem;
    fill: #fff;
  }

  /* 視聴済みの印。緑の丸に白いチェック。▶ より面積が大きく見えるので少し小さくする。暗い背景に馴染む、少し落ち着いた緑 */
  .duration .check {
    width: 0.8rem;
    height: 0.8rem;
  }

  .check circle {
    fill: #30a14e;
  }

  .check path {
    fill: none;
    stroke: #fff;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* 2 行までで省略する */
  .clamp {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  /* 「コントラストを上げる」設定のときは、薄い文字を白にする */
  @media (prefers-contrast: more) {
    .tags {
      color: #fff;
    }
  }
</style>
