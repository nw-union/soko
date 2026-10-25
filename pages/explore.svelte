<script lang="ts">
  import type { Props } from "./explore.server";
  import LinkTile from "../src/lib/LinkTile.svelte";
  import { linkIcon } from "../src/lib/link-icons";

  let { links, playlists, podcasts }: Props = $props();
</script>

<!-- 中身は DB（social_links / playlists / podcasts）から。1 件もない項目は、見出しごと出さない -->
{#if links.length > 0}
  <h1 class="section-title">SNS &amp; Service</h1>
  <ul class="links">
    {#each links as link (link.id)}
      <li>
        <a class="link glass" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={link.label} title={link.label}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={linkIcon(link.icon)} fill-rule="evenodd" /></svg>
        </a>
      </li>
    {/each}
  </ul>
{/if}

{#if playlists.length > 0}
  <h1 class="section-title">YouTube Playlist</h1>
  <ul class="playlists">
    {#each playlists as playlist (playlist.id)}
      <li>
        <LinkTile url={playlist.url} image={playlist.thumbnail} title={playlist.title} subtitle={playlist.author} shape="wide" />
      </li>
    {/each}
  </ul>
{/if}

{#if podcasts.length > 0}
  <h1 class="section-title">Podcast</h1>
  <ul class="podcasts">
    {#each podcasts as podcast (podcast.id)}
      <li>
        <LinkTile url={podcast.url} image={podcast.artwork} title={podcast.title} subtitle={podcast.author} />
      </li>
    {/each}
  </ul>
{/if}

{#if links.length + playlists.length + podcasts.length === 0}
  <p class="empty">Not Found</p>
{/if}

<style>
  .empty {
    opacity: 0.7;
  }

  /* 見出し（h1）。大きさと下の間隔は Profile ページの見出しと同じ。2 つ目以降は、上に間隔を空ける */
  .section-title {
    margin: 2rem 0 1.25rem;
    font-size: 1.4rem;
  }

  .section-title:first-child {
    margin-top: 0;
  }

  .playlists,
  .podcasts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    /* 最大 2 列。16rem に満たない幅では 1 列にする */
    grid-template-columns: repeat(auto-fill, minmax(min(100%, max(16rem, calc((100% - 1rem) / 2))), 1fr));
    gap: 1rem;
  }

  /* 5 つが 1 行に収まる大きさまで。狭い画面ではアイコンも一緒に縮む */
  .links {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 3.9rem));
    gap: 0.7rem;
  }

  /* 角丸の四角。ガラスの見た目は Profile のタイルと同じ（共通の .glass） */
  .link {
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 1;
    border-radius: 1.1rem;
    color: #fff;
    transition: transform 160ms, background 160ms, border-color 160ms, box-shadow 160ms;
    -webkit-tap-highlight-color: transparent;
  }

  /* 普段のアイコンは少し落ち着いた白。ホバーで真っ白になる */
  .link svg {
    width: 46%;
    height: 46%;
    fill: currentColor;
    opacity: 0.72;
    transition: opacity 160ms, transform 160ms, filter 160ms;
  }

  .link:active {
    transform: scale(0.94);
  }

  @media (hover: hover) {
    .link:hover {
      transform: translateY(-2px);
      background: linear-gradient(135deg, rgb(255 255 255 / 0.3), rgb(255 255 255 / 0.14));
      border-color: rgb(255 255 255 / 0.6);
      box-shadow:
        inset 0 1px 0 rgb(255 255 255 / 0.6),
        0 12px 28px rgb(0 0 0 / 0.38);
    }

    .link:hover svg {
      opacity: 1;
      transform: scale(1.1);
      filter: drop-shadow(0 0 6px rgb(255 255 255 / 0.65));
    }
  }
</style>
