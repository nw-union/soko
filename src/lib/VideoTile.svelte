<script lang="ts">
// YouTube の動画のタイル（ホーム用）。左にサムネイル（右下に動画時間）、右にタイトル。
// 押すと onplay でアプリ内再生にする。修飾キー付きや JS が動かない場合は、そのまま YouTube へ
let {
	url,
	thumbnail,
	title,
	duration,
	onplay,
}: {
	url: string;
	thumbnail: string;
	title: string;
	duration: string | null;
	onplay: () => void;
} = $props();

const click = (e: MouseEvent) => {
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
	e.preventDefault();
	onplay();
};
</script>

<a class="tile glass tile-link" href={url} target="_blank" rel="noopener noreferrer" onclick={click}>
  <span class="thumb">
    <img src={thumbnail} alt="" loading="lazy" decoding="async" />
    {#if duration}
      <span class="duration">{duration}</span>
    {/if}
  </span>
  <span class="title"><span class="clamp">{title}</span></span>
</a>

<style>
  /* 左にサムネイル、右にタイトル（Explore の YouTube Playlist と同じ並び） */
  .tile {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.9rem;
    height: 100%;
    padding: 0.75rem;
    border-radius: 1.1rem;
    color: #fff;
    text-decoration: none;
  }

  .thumb {
    position: relative;
    display: block;
    flex: none;
    width: 8.4rem;
    aspect-ratio: 16 / 9;
    border-radius: 0.8rem;
    overflow: hidden;
    background: rgb(0 0 0 / 0.35); /* 画像が届くまでの下地 */
  }

  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* YouTube と同じ、右下の黒い角丸のバッジ */
  .duration {
    position: absolute;
    right: 0.35rem;
    bottom: 0.35rem;
    padding: 0.1rem 0.4rem;
    border-radius: 0.3rem;
    background: rgb(0 0 0 / 0.8);
    font: 500 0.75rem/1.4 system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
  }

  .title {
    flex: 1;
    min-width: 0;
    font: 600 1rem/1.3 system-ui, sans-serif;
    text-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
  }

  /* 3 行までで省略する */
  .clamp {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
