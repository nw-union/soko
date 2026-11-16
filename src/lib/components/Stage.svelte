<script lang="ts">
import { onMount, type Snippet } from "svelte";
import "../styles/glass.css";
import sokoPng from "../../assets/nwu-soko.png";
import sokoWebp from "../../assets/nwu-soko.webp";
import sokoWidePng from "../../assets/nwu-soko-wide.png";
import sokoWideWebp from "../../assets/nwu-soko-wide.webp";
// 18x24 の極小画像（約 1KB）。?inline で data URI として HTML に埋め込まれ、追加リクエストが要らない
import placeholder from "../../assets/nwu-soko-lqip.png?inline";

let { children }: { children?: Snippet } = $props();
let canvas: HTMLCanvasElement;

// 小さな canvas にランダムなノイズを描き、CSS で画面全体に引き伸ばして
// フィルムグレインとして重ねる（毎フレーム全画面を描くより軽い）。
// 粒の大きさは画面サイズによらず一定（約 1.5px）になるよう、canvas の解像度を画面幅に合わせる。
// スマホ（幅 390px 前後）で 256px 四方だった時の粒感を基準にしている
onMount(() => {
	const cell = 1.5;
	const context = canvas.getContext("2d");
	if (!context) return;
	// 下の関数宣言の中では null チェックの絞り込みが効かないので、型を確定させた変数に入れ直す
	const ctx: CanvasRenderingContext2D = context;
	let image: ImageData;
	let data: Uint32Array;

	function resize() {
		canvas.width = Math.max(1, Math.round(innerWidth / cell));
		canvas.height = Math.max(1, Math.round(innerHeight / cell));
		image = ctx.createImageData(canvas.width, canvas.height);
		data = new Uint32Array(image.data.buffer);
		draw();
	}

	function draw() {
		for (let i = 0; i < data.length; i++) {
			const v = (Math.random() * 255) | 0;
			// ABGR（リトルエンディアン）: 不透明度は固定、明るさだけランダム
			data[i] = (0xff << 24) | (v << 16) | (v << 8) | v;
		}
		ctx.putImageData(image, 0, 0);
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

  /* iOS / iPadOS では、基準の文字サイズを「設定 > 画面表示と明るさ > テキストサイズ」（Dynamic Type）に合わせる。
     文字やタイルの大きさは rem で指定しているので、全体がこれに合わせて拡大・縮小する。
     ログイン画面など、共通レイアウトを使わない画面にも効くよう、どの画面も使うこの背景に置く。
     macOS の Safari では基準が 13px と小さくなるので、タッチ端末（-webkit-touch-callout が使える）だけに限る */
  @supports (font: -apple-system-body) and (-webkit-touch-callout: none) {
    :global(html) {
      /* biome-ignore lint/a11y/useGenericFontNames: システムの文字設定そのものを読むキーワードで、代わりのフォントは書けない */
      font: -apple-system-body;
    }
  }

  .stage {
    background: #2c3939; /* 画像の平均色。極小画像すら表示される前の下地 */
    position: fixed;
    inset: 0;
    overflow: hidden;
    /* 画面遷移のアニメーションの対象から外す（背景は動かさない） */
    view-transition-name: stage;
  }

  /* ホーム画面から開いたとき（PWA）の iOS では、ページの表示領域（innerHeight）が上の安全領域のぶん短くなり、
     文書がそれに収まっていると、固定の要素も画面の下端の手前で切れて黒い帯が出る（956pt の画面で 894pt）。
     文書の高さを画面の高さ（100lvh）まで広げると、下端まで描かれる。
     下地の色は、iOS がステータスバーの裏に滲ませる色にもなるので、黒ではなく画像の平均色にする */
  @media (display-mode: standalone) {
    :global(html) {
      min-height: 100lvh;
    }

    :global(html),
    :global(body) {
      background: #2c3939;
    }

    .stage {
      bottom: auto;
      height: 100lvh;
    }
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
    /* 内容が画面より高いとき（文字を大きくした場合など）は、上を切らずにスクロールさせる */
    align-content: safe center;
    overflow-y: auto;
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
