<script lang="ts">
// 動画時間のラベル。再生ボタン風の丸い形で、▶ と動画時間を出す。
// 視聴済みなら、その左に緑のチェックだけを単独で添える（未視聴は何も付けない）。
// ライブなど長さのない動画でも、視聴済みならチェックだけ出す
let { duration, watched }: { duration: string | null; watched: boolean } = $props();
</script>

{#if duration || watched}
  <span class="wrap">
    {#if watched}
      <svg class="check" viewBox="0 0 24 24" role="img" aria-label="視聴済み"><circle cx="12" cy="12" r="12" /><path d="M6.5 12.5l3.8 3.8 7.2-8" /></svg>
    {/if}
    {#if duration}
      <span class="duration">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        {duration}
      </span>
    {/if}
  </span>
{/if}

<style>
  .wrap {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
  }

  .duration {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.2rem 0.55rem 0.2rem 0.4rem;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.2);
    color: #fff;
    font: 600 0.7rem/1.2 system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
  }

  .duration svg {
    width: 0.9rem;
    height: 0.9rem;
    fill: #fff;
  }

  /* 視聴済みの印。緑の丸に白いチェック。ラベルの外に単独で置く。暗い背景に馴染む、少し落ち着いた緑 */
  .check {
    width: 1rem;
    height: 1rem;
    flex: none;
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
</style>
