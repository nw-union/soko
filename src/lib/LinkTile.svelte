<script lang="ts">

  // 外部サイトへのリンクになるタイル。左に画像、右にタイトルと補足。
  // YouTube Playlist と Podcast で共通に使う
  let {
    url,
    image,
    title,
    subtitle,
    shape = "square",
  }: {
    url: string;
    image: string;
    title: string;
    subtitle: string;
    // square: Podcast のアートワーク / wide: YouTube のサムネイル（16:9 のまま）
    shape?: "square" | "wide";
  } = $props();
</script>

<a class="tile glass tile-link" href={url} target="_blank" rel="noopener noreferrer">
  <img class={shape} src={image} alt="" loading="lazy" decoding="async" />
  <span class="text">
    <span class="title">{title}</span>
    <span class="subtitle">{subtitle}</span>
  </span>
</a>

<style>
  .tile {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    padding: 0.75rem;
    border-radius: 1.1rem;
    color: #fff;
    text-decoration: none;
  }

  img {
    flex: none;
    border-radius: 0.8rem;
    object-fit: cover;
    background: rgb(0 0 0 / 0.35); /* 画像が届くまでの下地 */
  }

  img.square {
    width: 4.75rem;
    height: 4.75rem;
  }

  img.wide {
    width: 8.4rem;
    aspect-ratio: 16 / 9;
  }

  .text {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 0.25rem;
  }

  .title {
    font: 600 1rem/1.3 system-ui, sans-serif;
    overflow-wrap: anywhere;
    text-shadow: 0 1px 4px rgb(0 0 0 / 0.4);
  }

  .subtitle {
    font: 400 0.8rem/1.3 system-ui, sans-serif;
    opacity: 0.7;
    overflow-wrap: anywhere;
  }
</style>
