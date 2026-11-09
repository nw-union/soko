<!-- New のラベル。動画時間のラベル（DurationLabel.svelte）と同じ形で、全体を黄色くする -->
<span class="new">
  <!-- 黄色の地に、白いきらめき -->
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" /><path d="M12 4.5c.7 4.4 3.1 6.8 7.5 7.5-4.4.7-6.8 3.1-7.5 7.5-.7-4.4-3.1-6.8-7.5-7.5 4.4-.7 6.8-3.1 7.5-7.5z" /></svg>
  New
</span>

<style>
  .new {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.2rem 0.55rem 0.2rem 0.4rem;
    border-radius: 999px;
    /* 元の黄色の地に白い文字（コントラストは低め） */
    background: #ffd60a;
    color: #fff;
    font: 600 0.7rem/1.2 system-ui, sans-serif;
  }

  svg {
    flex: none;
    width: 0.8rem;
    height: 0.8rem;
  }

  circle {
    fill: none;
  }

  path {
    fill: #fff;
  }
</style>
