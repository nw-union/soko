<script lang="ts">
import { onMount } from "svelte";
import DurationLabel from "./DurationLabel.svelte";
import NewLabel from "./NewLabel.svelte";
import { thumbnailFallback, thumbnailTint } from "../client/thumbnail";
// YouTube の動画のカード（ホームの横スライド用）。上にサムネイル、下にタイトル・タグ・動画時間（視聴済みなら ▶ の代わりに緑のチェック）。
// 押すと onplay でアプリ内再生にする。修飾キー付きは onexternal を呼んで、そのまま YouTube へ（JS が動かない場合も YouTube へ）
let {
	url,
	thumbnail,
	title,
	duration,
	tags,
	watched,
	isNew = false,
	onplay,
	onexternal,
}: {
	url: string;
	thumbnail: string;
	title: string;
	duration: string | null;
	tags: string[];
	watched: boolean;
	isNew?: boolean;
	onplay: () => void;
	onexternal: () => void;
} = $props();

// サムネイルの代表色（"r g b"）。取れるまで・取れなかったときは、これまでのガラスのまま
let tint = $state<string | null>(null);
onMount(() => {
	thumbnailTint(thumbnail).then((color) => (tint = color));
});

const click = (e: MouseEvent) => {
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
		onexternal();
		return;
	}
	e.preventDefault();
	onplay();
};
</script>

<a class="tile glass tile-link" class:tinted={tint} style:--tint={tint} href={url} target="_blank" rel="noopener noreferrer" onclick={click}>
  <span class="thumb">
    <img use:thumbnailFallback src={thumbnail} alt="" loading="lazy" decoding="async" />
  </span>
  <span class="title">
    <span class="clamp">{title}</span>
    {#if tags.length > 0}
      <span class="tags">{tags.map((tag) => `#${tag}`).join(" ")}</span>
    {/if}
    {#if isNew || duration || watched}
      <span class="label-row">
        {#if isNew}<NewLabel />{/if}
        <DurationLabel {duration} {watched} />
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
    flex: 1;
    padding: 0.5rem 0.6rem 0.6rem;
    font: 600 0.8rem/1.35 system-ui, sans-serif;
    text-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
  }

  /* サムネイルの代表色を、タイル全体に薄く塗る（暗いガラスの上に重ねる）。
     タイトルの面は透明なので、動画時間などがなくても、タイルの一番下まで同じ色になる */
  .tile.tinted {
    background:
      linear-gradient(rgb(var(--tint) / 0.4), rgb(var(--tint) / 0.4)),
      linear-gradient(135deg, rgb(12 18 18 / 0.55), rgb(12 18 18 / 0.4));
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

  /* タイトルの下に出す、New と動画時間のラベル */
  .label-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.4rem;
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
