<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import "./glass.css";
  import sokoPng from "../assets/nwu-soko.png";
  import sokoWebp from "../assets/nwu-soko.webp";
  import sokoWidePng from "../assets/nwu-soko-wide.png";
  import sokoWideWebp from "../assets/nwu-soko-wide.webp";
  // 18x24 の極小画像（約 1KB）。?inline で data URI として HTML に埋め込まれ、追加リクエストが要らない
  import placeholder from "../assets/nwu-soko-lqip.png?inline";

  let { children }: { children?: Snippet } = $props();
  let canvas: HTMLCanvasElement;

  // 小さな canvas にランダムなノイズを描き、CSS で画面全体に引き伸ばして
  // フィルムグレインとして重ねる（毎フレーム全画面を描くより軽い）。
  // 粒の大きさは画面サイズによらず一定（約 1.5px）になるよう、canvas の解像度を画面幅に合わせる。
  // スマホ（幅 390px 前後）で 256px 四方だった時の粒感を基準にしている
  onMount(() => {
    const cell = 1.5;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let image: ImageData;
    let data: Uint32Array;

    function resize() {
      canvas.width = Math.max(1, Math.round(innerWidth / cell));
      canvas.height = Math.max(1, Math.round(innerHeight / cell));
      image = ctx!.createImageData(canvas.width, canvas.height);
      data = new Uint32Array(image.data.buffer);
      draw();
    }

    function draw() {
      for (let i = 0; i < data.length; i++) {
        const v = (Math.random() * 255) | 0;
        // ABGR（リトルエンディアン）: 不透明度は固定、明るさだけランダム
        data[i] = (0xff << 24) | (v << 16) | (v << 8) | v;
      }
      ctx!.putImageData(image, 0, 0);
    }

    resize();
    addEventListener("resize", resize);
    // 動きを抑えたい設定のユーザーには静止したノイズだけ見せる
    if (matchMedia("(prefers-reduced-motion: reduce)").matches)
      return () => removeEventListener("resize", resize);

    let raf = 0;
    let last = 0;
    function loop(now: number) {
      // 約 10fps。フィルムっぽいカクついた揺らぎにする
      if (now - last > 100) {
        draw();
        last = now;
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
    };
  });
</script>

<div class="stage">
  <!-- 本画像が届くまでの間、ぼかした縮小版を見せる -->
  <div class="placeholder" style:background-image={`url(${placeholder})`}></div>
  <!--
    画面が横長（PC など）なら wide 版、縦長（スマホなど）なら縦長版を使う。
    それぞれ webp に対応したブラウザには webp、それ以外には jpg を配信する。
    <source> は上から順に評価され、最初に合致したものが使われる。
  -->
  <picture>
    <source srcset={sokoWideWebp} type="image/webp" media="(min-aspect-ratio: 1/1)" />
    <source srcset={sokoWidePng} media="(min-aspect-ratio: 1/1)" />
    <source srcset={sokoWebp} type="image/webp" />
    <img class="art" src={sokoPng} alt="" fetchpriority="high" decoding="async" />
  </picture>
  <canvas class="grain" bind:this={canvas}></canvas>
  <div class="scanlines"></div>
  <div class="vignette"></div>
  <!-- 背景の上に重ねる内容 -->
  <div class="content">{@render children?.()}</div>
</div>

<style>
  :global(body) {
    margin: 0;
    background: #000;
  }

  .stage {
    background: #2c3939; /* 画像の平均色。極小画像すら表示される前の下地 */
    position: fixed;
    inset: 0;
    overflow: hidden;
    /* 画面遷移のアニメーションの対象から外す（背景は動かさない） */
    view-transition-name: stage;
  }

  picture,
  .placeholder,
  .art,
  .grain,
  .scanlines,
  .vignette,
  .content {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .placeholder {
    background-size: cover;
    background-position: center;
    filter: blur(24px);
    transform: scale(1.1); /* ぼかしで端が透けないように少し拡大 */
  }

  .art {
    object-fit: cover;
    /* 明るい画像でも文字が読めるよう、全体を少し暗くする */
    filter: brightness(0.7) contrast(1.03) saturate(1.03);
    animation: flicker 6s steps(1) infinite;
  }

  .content {
    display: grid;
    place-items: center;
    align-content: center;
    gap: 1rem;
    color: #fff;
    text-shadow: 0 2px 12px rgb(0 0 0 / 0.6);
    /* iPhone のノッチ・ホームバーに内容が潜り込まないようにする */
    padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom)
      env(safe-area-inset-left);
    box-sizing: border-box;
  }

  .grain {
    image-rendering: pixelated;
    mix-blend-mode: overlay;
    opacity: 0.18;
    pointer-events: none;
  }

  .scanlines {
    background: repeating-linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0) 0,
      rgba(0, 0, 0, 0) 2px,
      rgba(0, 0, 0, 0.07) 3px
    );
    pointer-events: none;
  }

  .vignette {
    background: radial-gradient(ellipse at center, transparent 55%, rgba(0, 0, 0, 0.55) 100%);
    pointer-events: none;
  }

  /* たまに明るさがわずかにチラつく */
  @keyframes flicker {
    0%, 92%, 96%, 100% { opacity: 1; }
    94% { opacity: 0.97; }
    98% { opacity: 0.985; }
  }

  @media (prefers-reduced-motion: reduce) {
    .art { animation: none; }
  }
</style>
