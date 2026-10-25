<script lang="ts">
  // 丸いアイコン。枠の色がユーザーのイメージカラー。
  // image（URL）があればその画像、なければ（読み込みに失敗したときも）名前の頭文字を入れる
  let {
    name,
    color,
    image = null,
    size = 3,
  }: { name: string; color: string; image?: string | null; size?: number } = $props();

  // サロゲートペアの絵文字なども 1 文字として扱う
  const initial = $derived([...name.trim()][0]?.toUpperCase() ?? "?");

  // 画像が読み込めなかった URL。別の URL に変わったら、また試す
  let failed = $state<string | null>(null);
  const src = $derived(image && image !== failed ? image : null);
</script>

<span class="avatar" style="--ring: {color}; --size: {size}rem" aria-hidden="true">
  {#if src}
    <img {src} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror={() => (failed = src)} />
  {:else}
    {initial}
  {/if}
</span>

<style>
  .avatar {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    border: calc(var(--size) * 0.035) solid var(--ring);
    background: rgb(0 0 0 / 0.45);
    color: #fff;
    font: 600 calc(var(--size) * 0.42) / 1 system-ui, sans-serif;
    text-shadow: none;
    box-shadow: 0 0 calc(var(--size) * 0.4) color-mix(in srgb, var(--ring) 45%, transparent);
    overflow: hidden;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
</style>
