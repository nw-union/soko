<script lang="ts">
import { onMount, type Snippet } from "svelte";
import "../styles/glass.css";
import sokoJpg from "../../assets/nwu-soko.jpg";
import sokoWebp from "../../assets/nwu-soko.webp";
import sokoWideJpg from "../../assets/nwu-soko-wide.jpg";
import sokoWideWebp from "../../assets/nwu-soko-wide.webp";
// 18x24 の極小画像（約 1KB）。?inline で data URI として HTML に埋め込まれ、追加リクエストが要らない
import placeholder from "../../assets/nwu-soko-lqip.png?inline";

let { children }: { children?: Snippet } = $props();
let canvas: HTMLCanvasElement;

// 小さな canvas にランダムなノイズを描き、CSS で引き伸ばしてフィルムグレインとして重ねる。
// 粒の大きさは画面サイズによらず一定（CELL = 1.5px。CSS の --cell と合わせる）。
// スマホ（幅 390px 前後）で 256px 四方だった時の粒感を基準にしている。
//
// ノイズは毎フレーム描き直さず、画面より MARGIN セルぶん大きく 1 回だけ描き、
// CSS のアニメーション（@keyframes grain）で、セル単位でずらして揺らす。
// ずらしたノイズは画素ごとに別の乱数が来るので、描き直したのと見分けがつかない。
// transform のアニメーションはコンポジタで動くので、待機中にメインスレッドを使わない
// （requestAnimationFrame で描き直していたときは、待機中も 1 秒あたり約 130ms 動いていた）。
// 裏に回ったタブではブラウザが止め、「視差効果を減らす」では CSS で止める（静止したノイズ 1 枚になる）
const CELL = 1.5;
const MARGIN = 64; // @keyframes grain のずらす量（最大 63 セル）より大きくする

onMount(() => {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	// 画面が広がって足りなくなったときだけ描き直す
	// （スマホでアドレスバーが出入りして高さが少し変わるたびに描き直さない）
	function resize() {
		const w = Math.ceil(innerWidth / CELL) + MARGIN;
		const h = Math.ceil(innerHeight / CELL) + MARGIN;
		if (!ctx || (w <= canvas.width && h <= canvas.height)) return;
		canvas.width = Math.max(w, canvas.width);
		canvas.height = Math.max(h, canvas.height);
		canvas.style.width = `${canvas.width * CELL}px`;
		canvas.style.height = `${canvas.height * CELL}px`;
		const image = ctx.createImageData(canvas.width, canvas.height);
		const data = new Uint32Array(image.data.buffer);
		for (let i = 0; i < data.length; i++) {
			const v = (Math.random() * 255) | 0;
			// ABGR（リトルエンディアン）: 不透明度は固定、明るさだけランダム
			data[i] = (0xff << 24) | (v << 16) | (v << 8) | v;
		}
		ctx.putImageData(image, 0, 0);
	}

	// 初期値（300x150）より小さい画面でも描くよう、最初は 0 にしてから合わせる
	canvas.width = 0;
	canvas.height = 0;
	resize();
	addEventListener("resize", resize);
	return () => removeEventListener("resize", resize);
});
</script>

<div class="stage">
  <!-- 本画像が届くまでの間、ぼかした縮小版を見せる -->
  <div class="placeholder" style:background-image={`url(${placeholder})`}></div>
  <!--
    画面が横長（PC など）なら wide 版、縦長（スマホなど）なら縦長版を使う。
    それぞれ webp に対応したブラウザには webp、それ以外には jpg を配信する。
    上にノイズと走査線を重ねるので、画質は落として（webp は品質 75、jpg は 80）、1 枚 200KB 前後にしている。
    <source> は上から順に評価され、最初に合致したものが使われる。
  -->
  <picture>
    <source srcset={sokoWideWebp} type="image/webp" media="(min-aspect-ratio: 1/1)" />
    <source srcset={sokoWideJpg} media="(min-aspect-ratio: 1/1)" />
    <source srcset={sokoWebp} type="image/webp" />
    <img class="art" src={sokoJpg} alt="" fetchpriority="high" decoding="async" />
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
    --cell: 1.5px; /* script の CELL と合わせる */
    position: absolute;
    top: 0;
    left: 0;
    /* 幅と高さは script で canvas の画素数 × --cell にする */
    image-rendering: pixelated;
    /* 約 12fps でノイズをずらして、フィルムっぽいカクついた揺らぎにする（16 コマ ÷ 12fps） */
    animation: grain 1.333s steps(1, end) infinite;
    will-change: transform;
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

  /* ノイズをセル単位でずらす（最大 63 セル。script の MARGIN より小さくする）。
     となりのコマと大きく離して、続けて見ても動いて見えないようにする */
  @keyframes grain {
    0% { transform: translate(calc(0 * var(--cell)), calc(0 * var(--cell))); }
    6.25% { transform: translate(calc(-37 * var(--cell)), calc(-12 * var(--cell))); }
    12.5% { transform: translate(calc(-8 * var(--cell)), calc(-51 * var(--cell))); }
    18.75% { transform: translate(calc(-55 * var(--cell)), calc(-29 * var(--cell))); }
    25% { transform: translate(calc(-21 * var(--cell)), calc(-4 * var(--cell))); }
    31.25% { transform: translate(calc(-46 * var(--cell)), calc(-58 * var(--cell))); }
    37.5% { transform: translate(calc(-3 * var(--cell)), calc(-33 * var(--cell))); }
    43.75% { transform: translate(calc(-60 * var(--cell)), calc(-17 * var(--cell))); }
    50% { transform: translate(calc(-29 * var(--cell)), calc(-45 * var(--cell))); }
    56.25% { transform: translate(calc(-13 * var(--cell)), calc(-23 * var(--cell))); }
    62.5% { transform: translate(calc(-50 * var(--cell)), calc(-7 * var(--cell))); }
    68.75% { transform: translate(calc(-34 * var(--cell)), calc(-62 * var(--cell))); }
    75% { transform: translate(calc(-6 * var(--cell)), calc(-15 * var(--cell))); }
    81.25% { transform: translate(calc(-42 * var(--cell)), calc(-38 * var(--cell))); }
    87.5% { transform: translate(calc(-24 * var(--cell)), calc(-55 * var(--cell))); }
    93.75% { transform: translate(calc(-58 * var(--cell)), calc(-48 * var(--cell))); }
  }

  /* たまに明るさがわずかにチラつく */
  @keyframes flicker {
    0%, 92%, 96%, 100% { opacity: 1; }
    94% { opacity: 0.97; }
    98% { opacity: 0.985; }
  }

  @media (prefers-reduced-motion: reduce) {
    .art,
    .grain { animation: none; }
  }
</style>
