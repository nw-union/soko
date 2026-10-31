<script lang="ts">
import { useRouter } from "@void/svelte";
import { onMount } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { Props } from "./index.server";
import { splitLinks } from "../src/lib/url";
import { shortUrl, thumbnailFallback } from "../src/lib/youtube";
import VideoTile from "../src/lib/VideoTile.svelte";
import {
	isPlayingState,
	type YouTubePlayer,
	youtubePlayer,
} from "../src/lib/youtube-player";

let { newVideos, randomVideos, playlists }: Props = $props();

const router = useRouter();

// プレイリストの行に、最初に並べる動画の数。残りは「もっと見る」で出す
const PREVIEW_COUNT = 6;
// 「もっと見る」で全部出したプレイリストの ID
let expandedLists = $state<number[]>([]);

// 再生中の動画。入っている間だけ埋め込みプレイヤーを出す
type Video = Props["playlists"][number]["videos"][number];
let playing = $state<Video | null>(null);
let dialog = $state<HTMLDialogElement>();

// このページを開いてから変えた視聴状態。サーバーの記録を待たずに、すぐ表示に反映する
const watchedChanges = new SvelteMap<string, boolean>();
const isWatched = (video: Video) =>
	watchedChanges.get(video.youtubeId) ?? video.watched;

// 一番上に並べる動画の数
const SLIDE_COUNT = 6;
// New に出す動画。未視聴の新しい順。見たら外れて次が入る
const newList = $derived(
	newVideos.filter((video) => !isWatched(video)).slice(0, SLIDE_COUNT),
);
const newIds = $derived(new Set(newList.map((video) => video.youtubeId)));

// New を先に並べ、足りない分をランダムに選んだ動画で埋める
const slideList = $derived(
	[
		...newList,
		...randomVideos.filter((video) => !newIds.has(video.youtubeId)),
	].slice(0, SLIDE_COUNT),
);

// 大きく出す動画。小さなサムネイルで選ぶ。選んだ動画が外れたら先頭に戻る
let selectedNewId = $state<string | null>(null);
const hero = $derived(
	slideList.find((video) => video.youtubeId === selectedNewId) ??
		slideList[0] ??
		null,
);

// 大きな動画は横にスライドして切り替える。スライドした先を選択中にする
let slides = $state<HTMLDivElement>();

const slideIndex = (el: HTMLElement) =>
	Math.round(el.scrollLeft / el.clientWidth);

const slidesScrolled = () => {
	if (!slides?.clientWidth) return;
	const video = slideList[slideIndex(slides)];
	if (video) selectedNewId = video.youtubeId;
};

// 小さなサムネイルを押したときや、見た動画が外れたときは、選択中の動画までスライドする
$effect(() => {
	if (!slides || !hero) return;
	const index = slideList.indexOf(hero);
	if (slideIndex(slides) === index) return;
	slides.scrollTo({
		left: index * slides.clientWidth,
		behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
			? "auto"
			: "smooth",
	});
});

// 時間で次の動画へ送り、最後まで行ったら先頭に戻る。
// 手で切り替えると、そこから数え直す。再生中・指で押さえている間・画面が裏にある間は送らない。
// 「視差効果を減らす」設定のときは、動かさない
const AUTO_SLIDE_MS = 5000;
let holdingSlides = false;

$effect(() => {
	if (!hero || playing) return;
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const next = slideList[(slideList.indexOf(hero) + 1) % slideList.length];
	const timer = setInterval(() => {
		if (!document.hidden && !holdingSlides) selectedNewId = next.youtubeId;
	}, AUTO_SLIDE_MS);
	return () => clearInterval(timer);
});

// 視聴状態を記録する。トップページのデータはキャッシュされるので、タブを移動して戻っても古い状態に戻らないよう消す。
// 記録できなければ表示を元に戻す
const setWatched = async (video: Video, watched: boolean) => {
	if (isWatched(video) === watched) return;
	const id = video.youtubeId;
	watchedChanges.set(id, watched);
	try {
		// YouTube へ移動してページが止まっても、最後まで送る
		const res = watched
			? await fetch("/api/watches", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ youtubeId: id }),
					keepalive: true,
				})
			: await fetch(`/api/watches?youtubeId=${id}`, { method: "DELETE" });
		if (!res.ok) throw new Error(`watches: ${res.status}`);
		router.flush("/");
	} catch {
		watchedChanges.set(id, !watched);
	}
};

const markWatched = (video: Video) => setWatched(video, true);

// 開いている間に一度だけ、再生が始まったら見たことにする。
// 読み込みの後などにも再生中の通知は来るので、毎回記録すると「未視聴にする」がすぐ戻ってしまう
let countedPlay = false;

const play = (video: Video) => {
	playing = video;
	countedPlay = false;
	dialog?.showModal();
};

// 新着の通知から開いたとき（/?v=<YouTube の動画 ID>）は、その動画の再生画面を開く。
// 再読み込みでまた開かないよう、URL からは消しておく
onMount(() => {
	const url = new URL(window.location.href);
	const id = url.searchParams.get("v");
	if (!id) return;
	url.searchParams.delete("v");
	history.replaceState(history.state, "", url);
	const video = playlists
		.flatMap((list) => list.videos)
		.find((v) => v.youtubeId === id);
	if (video) play(video);
});

// 修飾キー付きは、見たことにして、そのまま YouTube へ
const heroClick = (e: MouseEvent, video: Video) => {
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) {
		markWatched(video);
		return;
	}
	e.preventDefault();
	play(video);
};

// 閉じるときは、画面の下へ滑らせて消してから dialog を閉じる（CSS の .closing と同じ長さ）。
// 閉じたら iframe ごと外して、音を止める
const CLOSE_MS = 320;
let closing = $state(false);

const close = () => {
	if (!dialog?.open || closing) return;
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
		dialog.close();
		return;
	}
	closing = true;
	setTimeout(() => dialog?.close(), CLOSE_MS);
};

const closed = () => {
	playing = null;
	closing = false;
	dragY = 0;
	openMenu = null;
};

// Esc でも、すぐに消さずに滑らせて閉じる。メニューが開いていれば、まずそれを閉じる
const cancel = (e: Event) => {
	e.preventDefault();
	if (openMenu) openMenu = null;
	else close();
};

// 開いているメニュー。再生速度の選択と、「…」（視聴済み・未視聴の切り替えと、リンクのコピー）
const COPY_LABEL = "YouTube リンクをコピー";
let openMenu = $state<"speed" | "more" | null>(null);
let copyLabel = $state(COPY_LABEL);

const toggleMenu = (menu: "speed" | "more") => {
	copyLabel = COPY_LABEL;
	openMenu = openMenu === menu ? null : menu;
};

const toggleWatched = () => {
	if (playing) setWatched(playing, !isWatched(playing));
	openMenu = null;
};

// コピーできたかを少しだけ見せてから閉じる
const copyLink = async () => {
	if (!playing) return;
	try {
		await navigator.clipboard.writeText(shortUrl(playing.youtubeId));
		copyLabel = "コピーしました";
	} catch {
		copyLabel = "コピーできませんでした";
	}
	setTimeout(() => (openMenu = null), 900);
};

// 再生・一時停止と再生速度。プレイヤーの準備ができたら、その動画で選べる速度を YouTube から受け取る
let player = $state<YouTubePlayer | null>(null);
let moving = $state(false);
// メニューに出す再生速度。動画で選べない速度（ライブなど）は出さない
const RATE_CHOICES = [0.5, 1, 1.5, 2];
let rates = $state<number[]>([]);
let rate = $state(1);

const playerHandlers = {
	onready: (p: YouTubePlayer) => {
		player = p;
		moving = isPlayingState(p.getPlayerState());
		rates = p
			.getAvailablePlaybackRates()
			.filter((r) => RATE_CHOICES.includes(r));
		rate = p.getPlaybackRate();
	},
	onstatechange: (state: number) => {
		moving = isPlayingState(state);
		// 再生が始まったら、見たことにする。アプリのボタンでも YouTube 側のボタンでも、ここに来る
		if (state === 1 && playing && !countedPlay) {
			countedPlay = true;
			markWatched(playing);
		}
	},
	onratechange: (r: number) => {
		rate = r;
	},
};

// 動画が替わったら（閉じたら）、前のプレイヤーの状態を捨てる
$effect(() => {
	if (playing) return () => {
		player = null;
		moving = false;
		rates = [];
		rate = 1;
		clearTimeout(holdTimer);
		boosting = false;
	};
});

const changeRate = (r: number) => {
	player?.setPlaybackRate(r);
	openMenu = null;
};

// 速度ボタンは、タップでメニューを開き、長押ししている間だけ 2 倍速にする
const HOLD_MS = 300; // これ以上押し続けたら長押しとみなす
const BOOST_RATE = 2;
let boosting = $state(false);
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let rateBeforeBoost = 1;
let skipClick = false;

const holdStart = (e: PointerEvent) => {
	if (e.button !== 0) return;
	skipClick = false;
	// 指がボタンの外へ出ても、離したことがわかるようにする
	(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	holdTimer = setTimeout(() => {
		if (!player || !rates.includes(BOOST_RATE)) return;
		rateBeforeBoost = rate;
		boosting = true;
		openMenu = null;
		player.setPlaybackRate(BOOST_RATE);
	}, HOLD_MS);
};

const holdEnd = () => {
	clearTimeout(holdTimer);
	if (!boosting) return;
	boosting = false;
	// 長押しの後に来るクリックで、メニューを開かないようにする
	skipClick = true;
	player?.setPlaybackRate(rateBeforeBoost);
};

const speedClick = () => {
	if (skipClick) skipClick = false;
	else toggleMenu("speed");
};

const togglePlay = () => {
	if (moving) player?.pauseVideo();
	else player?.playVideo();
};

// タイトルなどの所は、タップで再生・一時停止、長押ししている間だけ 2 倍速にする
const summaryClick = () => {
	if (skipClick) skipClick = false;
	else togglePlay();
};

const SKIP_SECONDS = 10;

const skip = (seconds: number) => {
	if (player)
		player.seekTo(Math.max(0, player.getCurrentTime() + seconds), true);
};

// YouTube 側の設定で 1.25 倍などにされても、そのまま表示できるようにする
const rateLabel = (r: number) => `${RATE_CHOICES.includes(r) ? r.toFixed(1) : r}×`;

// 上の帯（つまみのある所）を下へスワイプして閉じる。iOS の全画面シートと同じ操作。
// 動画の上は iframe がタッチを受け取るので、帯だけで受ける
const SWIPE_CLOSE = 100; // これ以上下げて離したら閉じる（px）
let dragY = $state(0);
let dragStart: number | null = null;

const dragDown = (e: PointerEvent) => {
	// 閉じるボタンは、普通のクリックとして扱う
	if ((e.target as Element).closest("button")) return;
	dragStart = e.clientY;
	(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
};

const dragMove = (e: PointerEvent) => {
	if (dragStart !== null) dragY = Math.max(0, e.clientY - dragStart);
};

const dragEnd = () => {
	if (dragStart === null) return;
	dragStart = null;
	if (dragY > SWIPE_CLOSE) close();
	dragY = 0;
};
</script>

<!-- ページの見出し。見た目には出さず、読み上げの見出しナビゲーションの起点にする -->
<h1 class="visually-hidden">ホーム</h1>

{#if playlists.length === 0}
  <div class="empty">
    <p class="empty-title">まだ動画がありません</p>
    <p class="empty-text">プレイリストに動画が追加されると、ここに表示されます。</p>
  </div>
{:else}
  <!-- 一番上に、まだ見ていない動画（足りない分はランダムに選んだ動画）をサムネイルで大きく。下の小さなサムネイルで、大きく出す動画を選ぶ -->
  {#if hero}
    <div
      class="hero-slides"
      class:joined={slideList.length > 1}
      bind:this={slides}
      onscroll={slidesScrolled}
      onpointerdown={() => (holdingSlides = true)}
      onpointerup={() => (holdingSlides = false)}
      onpointercancel={() => (holdingSlides = false)}
    >
      {#each slideList as video, i (video.youtubeId)}
        <a class="hero" href={video.url} target="_blank" rel="noopener noreferrer" onclick={(e) => heroClick(e, video)}>
          <span class="hero-thumb">
            <img use:thumbnailFallback src={video.thumbnail} alt="" decoding="async" loading={i === 0 ? "eager" : "lazy"} fetchpriority={i === 0 ? "high" : "auto"} />
            <span class="play">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </span>
          <span class="hero-title">
            {#if newIds.has(video.youtubeId)}<span class="hero-label">New</span>{/if}
            <span class="hero-title-text">{video.title}</span>
          </span>
        </a>
      {/each}
    </div>
    {#if slideList.length > 1}
      <div class="new-thumbs">
        {#each slideList as video (video.youtubeId)}
          <button
            type="button"
            class="new-thumb"
            class:selected={video.youtubeId === hero.youtubeId}
            aria-label={video.title}
            aria-pressed={video.youtubeId === hero.youtubeId}
            onclick={() => (selectedNewId = video.youtubeId)}
          >
            <img use:thumbnailFallback src={video.thumbnail} alt="" loading="lazy" decoding="async" />
          </button>
        {/each}
      </div>
    {/if}
  {/if}

  <!-- プレイリストごとに、動画を横向きに並べる -->
  {#each playlists as list (list.id)}
    <h2 class="section list-heading" id="list-{list.id}">
      <span>{list.name || "Playlist"}</span>
      <span class="count">{list.videos.length}<span class="visually-hidden"> 本</span></span>
    </h2>
    <ul class="row" aria-labelledby="list-{list.id}">
      {#each expandedLists.includes(list.id) ? list.videos : list.videos.slice(0, PREVIEW_COUNT) as video (video.id)}
        <li>
          <VideoTile url={video.url} thumbnail={video.thumbnail} title={video.title} duration={video.duration} tags={video.tags} watched={isWatched(video)} onplay={() => play(video)} onexternal={() => markWatched(video)} />
        </li>
      {/each}
      {#if list.videos.length > PREVIEW_COUNT && !expandedLists.includes(list.id)}
        <li>
          <button type="button" class="more-tile glass tile-link" onclick={() => (expandedLists = [...expandedLists, list.id])}>
            <span class="more-label">もっと見る</span>
            <span class="more-count">あと {list.videos.length - PREVIEW_COUNT} 本</span>
          </button>
        </li>
      {/if}
    </ul>
  {/each}
{/if}

<!--
  動画を開くと、画面全体を覆う再生画面を下からせり上げる（iOS の全画面シート、Apple TV アプリの詳細画面の作り）。
  後ろにはサムネイルを大きくぼかして敷き、動画の色が画面に滲んでいるように見せる
-->
<dialog
  bind:this={dialog}
  class="player"
  aria-label={playing?.title}
  class:dragging={dragY > 0}
  class:closing
  style:translate={dragY > 0 && !closing ? `0 ${dragY}px` : undefined}
  oncancel={cancel}
  onclose={closed}
>
  {#if playing}
    <div class="ambient" style:background-image={`url(${playing.thumbnail})`} aria-hidden="true"></div>
    <div
      class="top"
      onpointerdown={dragDown}
      onpointermove={dragMove}
      onpointerup={dragEnd}
      onpointercancel={dragEnd}
    >
      <span class="grabber" aria-hidden="true"></span>
      <button type="button" class="close" aria-label="閉じる" onclick={close}>
        <svg class="x" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
      </button>
    </div>
    <div class="body">
      <div class="content">
        <div class="frame">
          <iframe
            use:youtubePlayer={playerHandlers}
            src={playing.embed}
            title={playing.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"
          ></iframe>
        </div>
        <div class="info">
          <!-- キーボードでは、下の再生ボタンと速度ボタンで同じ操作ができる -->
          <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
          <div
            class="summary"
            onclick={summaryClick}
            onpointerdown={holdStart}
            onpointerup={holdEnd}
            onpointercancel={holdEnd}
            oncontextmenu={(e) => e.preventDefault()}
          >
          {#if playing.publishedAt}
            <p class="meta">{playing.publishedAt}</p>
          {/if}
          <h2 class="heading">{playing.title}</h2>
          {#if isWatched(playing) || playing.tags.length > 0}
            <p class="status">
              {#if isWatched(playing)}
                <span class="watched">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" /><path d="M6.5 12.5l3.8 3.8 7.2-8" /></svg>
                  watched
                </span>
                {#if playing.tags.length > 0}<span aria-hidden="true">・</span>{/if}
              {/if}
              {playing.tags.map((tag) => `#${tag}`).join(" ")}
            </p>
          {/if}
          </div>
          <!-- メニューの外（動画の上も含む）を押したら閉じる -->
          {#if openMenu}
            <button type="button" class="menu-scrim" aria-label="メニューを閉じる" onclick={() => (openMenu = null)}></button>
          {/if}
          <div class="controls">
            <button type="button" class="control main" disabled={!player} onclick={togglePlay}>
              {#if moving}
                <svg class="solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
                <span>一時停止</span>
              {:else}
                <svg class="solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                <span>再生</span>
              {/if}
            </button>
            <button type="button" class="control skip" aria-label="{SKIP_SECONDS}秒戻る" disabled={!player} onclick={() => skip(-SKIP_SECONDS)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 12a8 8 0 1 0 2.6-5.9M6 2.5v4h4" />
                <text x="12" y="15.6" text-anchor="middle">{SKIP_SECONDS}</text>
              </svg>
            </button>
            <button type="button" class="control skip" aria-label="{SKIP_SECONDS}秒進む" disabled={!player} onclick={() => skip(SKIP_SECONDS)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M20 12a8 8 0 1 1-2.6-5.9M18 2.5v4h-4" />
                <text x="12" y="15.6" text-anchor="middle">{SKIP_SECONDS}</text>
              </svg>
            </button>
            <div class="more speed">
              <button
                type="button"
                class="control"
                class:boosting
                aria-label="再生速度 {rateLabel(rate)}"
                aria-haspopup="menu"
                aria-expanded={openMenu === "speed"}
                disabled={!player}
                onclick={speedClick}
                onpointerdown={holdStart}
                onpointerup={holdEnd}
                onpointercancel={holdEnd}
                oncontextmenu={(e) => e.preventDefault()}
              >
                <span>{rateLabel(boosting ? BOOST_RATE : rate)}</span>
                <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4" /></svg>
              </button>
              {#if openMenu === "speed"}
                <div class="menu" role="menu" aria-label="再生速度">
                  {#each rates as r (r)}
                    <button type="button" class="menu-item" role="menuitemradio" aria-checked={r === rate} onclick={() => changeRate(r)}>
                      {rateLabel(r)}
                      {#if r === rate}
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/if}
            </div>
          </div>
          <div class="actions">
            <a class="open" href={playing.url} target="_blank" rel="noopener noreferrer" onclick={() => playing && markWatched(playing)}>
              <svg class="yt" viewBox="0 0 28 20" aria-hidden="true">
                <path class="yt-bg" d="M27.4 3.1A3.5 3.5 0 0 0 24.9.6C22.7 0 14 0 14 0S5.3 0 3.1.6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9a3.5 3.5 0 0 0 2.5 2.5C5.3 20 14 20 14 20s8.7 0 10.9-.6a3.5 3.5 0 0 0 2.5-2.5C28 14.7 28 10 28 10s0-4.7-.6-6.9z" />
                <path class="yt-play" d="M11.2 14.3 18.4 10l-7.2-4.3z" />
              </svg>
              YouTube で開く
            </a>
            <div class="more">
              <button type="button" class="control skip" aria-label="その他" aria-haspopup="menu" aria-expanded={openMenu === "more"} onclick={() => toggleMenu("more")}>
                <svg class="solid" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="18.5" r="2" /></svg>
              </button>
              {#if openMenu === "more"}
                <div class="menu" role="menu">
                  <button type="button" class="menu-item" role="menuitem" onclick={toggleWatched}>
                    {isWatched(playing) ? "未視聴にする" : "視聴済みにする"}
                  </button>
                  <button type="button" class="menu-item" role="menuitem" onclick={copyLink}>{copyLabel}</button>
                </div>
              {/if}
            </div>
          </div>
          {#if playing.description}
            <p class="desc">{#each splitLinks(playing.description) as part}{#if part.href}<a href={part.href} target="_blank" rel="noopener noreferrer">{part.text}</a>{:else}{part.text}{/if}{/each}</p>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</dialog>

<style>
  /* 各行の見出し。見た目はアプリ共通の h1 と同じ（Orbitron） */
  .section {
    margin: 2rem 0 0.325rem;
    font: 600 1.25rem/1.3 "Orbitron Variable", system-ui, sans-serif;
    letter-spacing: 0.06em;
  }

  /* New のすぐ下の見出しは、他の見出しの間隔の 1.5 倍あける */
  .hero-slides + .section,
  .new-thumbs + .section {
    margin-top: 3rem;
  }

  /* プレイリストの見出し。名前の右に動画数を並べる */
  .list-heading {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  /* 動画数のバッジ。iOS の通知バッジの形で、1〜2 桁は正円、3 桁は横に伸ばす。色は控えめな塗りにして見出しより目立たせない */
  .count {
    flex: none;
    box-sizing: border-box;
    display: inline-grid;
    place-items: center;
    min-width: 1.5rem;
    height: 1.5rem;
    padding: 0 0.25rem;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.16);
    box-shadow: inset 0 0.5px 0 rgb(255 255 255 / 0.3);
    font: 600 0.8rem/1 system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
  }

  /* 「コントラストを上げる」設定のときは、塗りを濃くする */
  @media (prefers-contrast: more) {
    .count {
      background: rgb(255 255 255 / 0.32);
    }
  }

  /* 見た目には出さず、読み上げだけに残す */
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  /* 動画がないときの案内 */
  .empty {
    margin-top: 4rem;
    text-align: center;
  }

  .empty-title {
    margin: 0 0 0.4rem;
    font: 600 1.1rem/1.4 system-ui, sans-serif;
  }

  .empty-text {
    margin: 0;
    font: 400 0.9rem/1.5 system-ui, sans-serif;
    color: rgb(255 255 255 / 0.78);
  }

  /* 一番上の見出しは、上の余白（ページ側にある）を重ねない */
  .visually-hidden + .section {
    margin-top: 0;
  }

  /* 一番上の大きな動画を並べる枠。横にスライドして、1 本ずつ吸い付いて止まる。スクロールバーは出さない */
  .hero-slides {
    display: flex;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    margin-top: 0.5rem;
    border-radius: 1.4rem;
    /* サムネイルの下のタイトルの面。小さなサムネイルの面と揃える */
    background: rgb(0 0 0 / 0.38);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.4);
  }

  .hero-slides::-webkit-scrollbar {
    display: none;
  }

  /* 大きな動画。サムネイルを大きく出し、その下にタイトルを置く */
  .hero {
    position: relative;
    flex: 0 0 100%;
    display: block;
    overflow: hidden;
    color: #fff;
    text-decoration: none;
    scroll-snap-align: start;
    scroll-snap-stop: always;
    -webkit-tap-highlight-color: transparent;
  }

  .hero:active img {
    opacity: 0.85;
  }

  .hero-thumb {
    position: relative;
    display: block;
    aspect-ratio: 16 / 9;
    background: rgb(0 0 0 / 0.35); /* 画像が届くまでの下地 */
  }

  /* サムネイルの下のタイトル。ラベルに続けて 1 行で出し、長ければ省略する */
  .hero-title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.55rem 0.6rem;
    font: 600 0.95rem/1.3 system-ui, sans-serif;
  }

  .hero-title-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* New のラベル。タイトルより先に目に入るよう、黄色く塗る */
  .hero-label {
    flex: none;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    background: #ffd60a;
    color: #111;
    font: 600 0.7rem/1.2 system-ui, sans-serif;
  }

  .hero img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* 小さなサムネイルが続くときは、下の角を丸めず、一枚のカードに見せる */
  .hero-slides.joined {
    border-radius: 1.4rem 1.4rem 0 0;
    box-shadow: none;
  }

  .hero-slides.joined .hero-title {
    padding-bottom: 0.1rem;
  }

  /* 大きな動画の下に並べる、小さなサムネイル。本数が少なくても大きさは変えない。
     背景の画像に紛れないよう、薄く暗い面に載せる */
  .new-thumbs {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 0.35rem;
    padding: 0 0.6rem;
    border-radius: 0 0 1.4rem 1.4rem;
    background: rgb(0 0 0 / 0.38);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    box-shadow: 0 12px 32px rgb(0 0 0 / 0.4);
  }

  .new-thumb {
    display: block;
    width: 100%;
    padding: 7px 0;
    border: 0;
    background: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .new-thumb img {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    object-fit: cover;
    border-radius: 0.4rem;
    background: rgb(0 0 0 / 0.35); /* 画像が届くまでの下地 */
    opacity: 0.75;
    transition: opacity 160ms;
  }

  /* 大きく出している動画は、明るくして白い枠で示す */
  .new-thumb.selected img {
    opacity: 1;
    outline: 2px solid #fff;
  }

  /* スマホでは、大きな動画を画面の端から端まで出す。角は丸めず、文字とサムネイルはページの余白に揃える */
  @media (max-width: 639px) {
    .hero-slides,
    .hero-slides.joined,
    .new-thumbs {
      margin-inline: calc(var(--gutter) * -1);
      border-radius: 0;
    }

    .hero-slides {
      box-shadow: none;
    }

    .hero-title {
      padding-inline: var(--gutter);
    }

    .new-thumbs {
      padding-inline: var(--gutter);
      box-shadow: none;
    }
  }

  /* 画像の真ん中に置く、透明なガラス玉の再生ボタン。背景を軽くぼかして、画像が透けて見えるようにする */
  .play {
    position: absolute;
    top: 50%;
    left: 50%;
    display: grid;
    place-items: center;
    width: 4rem;
    height: 4rem;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    /* 左上から光が当たり、右下へ抜けていくように見せる */
    background:
      radial-gradient(circle at 30% 22%, rgb(255 255 255 / 0.2), transparent 50%),
      radial-gradient(circle at 72% 84%, rgb(255 255 255 / 0.08), transparent 45%);
    backdrop-filter: blur(4px) saturate(160%) brightness(0.92);
    -webkit-backdrop-filter: blur(4px) saturate(160%) brightness(0.92);
    /* 内側の縁の光と影で、玉の厚みを出す */
    box-shadow:
      inset 0 1px 1px rgb(255 255 255 / 0.55),
      inset 0 -1px 1px rgb(255 255 255 / 0.2),
      inset 0 0 12px rgb(255 255 255 / 0.12),
      0 8px 24px rgb(0 0 0 / 0.35);
    pointer-events: none;
  }

  /* 光の当たる左上と右下だけが強く光る、細い縁 */
  .play::before {
    content: "";
    position: absolute;
    inset: 0;
    padding: 1px;
    border-radius: inherit;
    background: linear-gradient(
      135deg,
      rgb(255 255 255 / 0.85),
      rgb(255 255 255 / 0.15) 40%,
      rgb(255 255 255 / 0.1) 60%,
      rgb(255 255 255 / 0.55)
    );
    -webkit-mask:
      linear-gradient(#000 0 0) content-box,
      linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask:
      linear-gradient(#000 0 0) content-box exclude,
      linear-gradient(#000 0 0);
  }

  .play svg {
    width: 2.2rem;
    height: 2.2rem;
    /* ▶ は重心が左寄りに見えるので、少し右にずらして丸の真ん中に見せる */
    margin-left: 0.2rem;
    fill: #fff;
    /* ガラスが透明なぶん、明るい画像の上でも記号が読めるように影を付ける */
    filter: drop-shadow(0 1px 4px rgb(0 0 0 / 0.55));
  }

  /* 「透明度を下げる」設定のときは、ガラスをやめて暗い丸にする */
  @media (prefers-reduced-transparency: reduce) {
    .play {
      background: rgb(20 28 28 / 0.92);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }

  /* 横にスライドする行。カードは左端に吸い付いて止まり、行は画面の端まで流れる */
  .row {
    list-style: none;
    margin: 0 calc(var(--gutter) * -1);
    padding: 0.25rem var(--gutter) 0.75rem;
    display: flex;
    align-items: stretch;
    gap: 0.45rem;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scroll-padding-inline: var(--gutter);
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }

  .row::-webkit-scrollbar {
    display: none;
  }

  .row li {
    flex: none;
    scroll-snap-align: start;
  }

  /* 行の最後の「もっと見る」。動画のタイルと同じ幅で、高さは行に合わせる */
  .more-tile {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    width: 7rem;
    height: 100%;
    padding: 0;
    border-radius: 1rem;
    color: #fff;
    font: inherit;
    cursor: pointer;
  }

  .more-label {
    font: 600 0.9rem/1.3 system-ui, sans-serif;
  }

  .more-count {
    font: 500 0.75rem/1.3 system-ui, sans-serif;
    color: rgb(255 255 255 / 0.78);
  }

  /* 再生画面。画面全体を覆う黒い面で、下からせり上がって開き、下へ滑って閉じる。
     動きは iOS のシートと同じ、出だしが速くゆっくり止まるカーブ */
  .player {
    --ease: cubic-bezier(0.32, 0.72, 0, 1);
    --label: #f5f5f7;
    --secondary: rgb(235 235 245 / 0.6);
    position: fixed;
    inset: 0;
    box-sizing: border-box;
    width: 100%;
    max-width: none;
    height: 100dvh;
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    overflow: hidden;
    background: #000;
    color: var(--label);
    transition: translate 260ms var(--ease);
  }

  .player[open] {
    display: flex;
    flex-direction: column;
    animation: rise 480ms var(--ease);
  }

  /* スワイプ中は指に付いてくる */
  .player.dragging {
    transition: none;
  }

  .player.closing {
    translate: 0 100%;
    transition: translate 320ms var(--ease);
  }

  @keyframes rise {
    from {
      translate: 0 100%;
    }
  }

  /* 下へ引いたときに見える後ろの画面は、暗く沈める */
  .player::backdrop {
    background: rgb(0 0 0 / 0.5);
    transition: opacity 320ms;
  }

  .player.closing::backdrop {
    opacity: 0;
  }

  /* サムネイルを大きくぼかした光。上ほど濃く、下へ向かって黒に溶かす */
  .ambient {
    position: absolute;
    inset: 0 0 auto;
    height: min(80dvh, 48rem);
    background-size: cover;
    background-position: center;
    filter: blur(64px) saturate(1.6);
    opacity: 0.55;
    scale: 1.3;
    mask-image: linear-gradient(#000 30%, transparent);
    -webkit-mask-image: linear-gradient(#000 30%, transparent);
    pointer-events: none;
  }

  /* 上の帯。下へスワイプして閉じられ、真ん中に iOS のシートと同じつまみを出す */
  .top {
    position: relative;
    flex: none;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    padding: calc(env(safe-area-inset-top) + 0.5rem) calc(env(safe-area-inset-right) + 0.5rem) 0.5rem
      calc(env(safe-area-inset-left) + 0.5rem);
    touch-action: none;
    cursor: grab;
  }

  .grabber {
    position: absolute;
    top: calc(env(safe-area-inset-top) + 0.4rem);
    left: 50%;
    width: 2.25rem;
    height: 0.3rem;
    translate: -50% 0;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.3);
  }

  /* 閉じるボタンは、見た目は小さなガラスの丸、押せる範囲は 44pt（HIG） */
  .close {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .x {
    box-sizing: border-box;
    width: 32px;
    height: 32px;
    padding: 8px;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.14);
    backdrop-filter: blur(20px) saturate(140%);
    -webkit-backdrop-filter: blur(20px) saturate(140%);
    fill: none;
    stroke: var(--label);
    stroke-width: 2.5;
    stroke-linecap: round;
    transition: background 160ms;
  }

  .close:hover .x {
    background: rgb(255 255 255 / 0.22);
  }

  .close:active .x {
    background: rgb(255 255 255 / 0.3);
  }

  /* 帯より下はまとめてスクロールする */
  .body {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding-bottom: calc(env(safe-area-inset-bottom) + 2.5rem);
  }

  /* 動画とその下の説明の幅。広い画面では、動画が画面の高さに収まる大きさまでにする */
  .content {
    box-sizing: border-box;
    width: min(100%, 64rem, calc((100dvh - 9rem) * 16 / 9 + 3rem));
    margin: 0 auto;
  }

  /* スマホでは動画を画面の端から端まで。広い画面では角を丸めて浮かせる */
  .frame {
    aspect-ratio: 16 / 9;
    overflow: hidden;
    background: #000;
  }

  iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }

  .info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 1.25rem calc(env(safe-area-inset-right) + 1.25rem) 0 calc(env(safe-area-inset-left) + 1.25rem);
  }

  /* 日付・タイトル・タグの所。縦のスクロールは残し、長押しで文字の選択や長押しメニューが出ないようにする */
  .summary {
    align-self: stretch;
    cursor: pointer;
    touch-action: pan-y;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }

  /* 投稿日。タイトルの上に小さく */
  .meta {
    margin: 0 0 0.35rem;
    font: 600 0.8rem/1.4 system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    color: var(--secondary);
  }

  .heading {
    margin: 0;
    font: 700 1.5rem/1.25 system-ui, sans-serif;
    letter-spacing: -0.015em;
    overflow-wrap: anywhere;
  }

  /* タイトルの下の行。視聴済みの印とタグを並べる。タグが長ければ折り返す */
  .status {
    margin: 0.5rem 0 0;
    font: 500 0.85rem/1.4 system-ui, sans-serif;
    color: var(--secondary);
    overflow-wrap: anywhere;
  }

  .watched {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    vertical-align: bottom;
    font-weight: 600;
  }

  .watched svg {
    flex: none;
    width: 0.85rem;
    height: 0.85rem;
  }

  /* 緑の丸に白いチェック。暗い背景に馴染む、少し落ち着いた緑 */
  .watched circle {
    fill: #30a14e;
  }

  .watched path {
    fill: none;
    stroke: #fff;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* 再生・一時停止、10 秒戻る・進む、再生速度のボタン。「YouTube で開く」の上に、半透明のグレーで横に並べる。
     下の行と共通の 5 列に載せ、ボタンの端を揃える。再生は 2 列ぶん（4:2:2:2） */
  .controls {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.45rem;
    align-self: stretch;
    margin-top: 1.25rem;
  }

  .control {
    position: relative;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.3rem;
    min-height: 44px;
    padding: 0 0.6rem;
    border: 0;
    border-radius: 12px;
    background: rgb(118 118 128 / 0.24);
    color: var(--label);
    font: 600 0.875rem system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background 160ms,
      transform 160ms;
    -webkit-tap-highlight-color: transparent;
  }

  .control:hover {
    background: rgb(118 118 128 / 0.34);
  }

  .control:active {
    transform: scale(0.97);
  }

  .control:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .control svg {
    flex: none;
    width: 1.2rem;
    height: 1.2rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* 10 秒戻る・進むは記号だけの小さなボタン。矢印の輪の中に秒数を入れる */
  .control.skip {
    padding: 0;
  }

  .control.main {
    grid-column: span 2;
  }

  .control.skip svg {
    width: 1.6rem;
    height: 1.6rem;
    stroke-width: 1.6;
  }

  .skip text {
    fill: currentColor;
    stroke: none;
    font: 700 8px system-ui, sans-serif;
  }

  /* 再生・一時停止の記号は塗りつぶす */
  .control .solid {
    fill: currentColor;
    stroke: none;
  }

  .control .chevron {
    width: 1rem;
    height: 1rem;
    margin-left: -0.1rem;
    opacity: 0.6;
  }

  /* 「YouTube で開く」と「…」の行。「YouTube で開く」は 4 列ぶん（8:2） */
  .actions {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    align-items: center;
    gap: 0.45rem;
    align-self: stretch;
    margin-top: 0.6rem;
  }

  .more {
    position: relative;
  }

  .more .control {
    width: 100%;
  }

  /* 列の幅に収まるよう、左右の余白はなくす。長押しで文字の選択や長押しメニューが出ないようにする */
  .more.speed .control {
    padding: 0;
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  /* 長押しで 2 倍速になっている間は、明るくして効いていることを見せる */
  .more.speed .control.boosting {
    background: rgb(255 255 255 / 0.32);
  }

  /* 「…」と再生速度のメニュー。iOS の長押しメニューと同じ、濃いガラスの角丸の面をボタンの上に出す */
  .menu {
    position: absolute;
    z-index: 2;
    right: 0;
    bottom: calc(100% + 0.4rem);
    width: max-content;
    min-width: 9rem;
    max-height: 60dvh;
    border-radius: 14px;
    overflow-y: auto;
    background: rgb(44 44 46 / 0.86);
    backdrop-filter: blur(24px) saturate(160%);
    -webkit-backdrop-filter: blur(24px) saturate(160%);
    box-shadow: 0 12px 36px rgb(0 0 0 / 0.5);
  }

  .menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
    width: 100%;
    min-height: 44px;
    padding: 0 1rem;
    border: 0;
    background: none;
    color: var(--label);
    font: 400 0.95rem system-ui, sans-serif;
    text-align: left;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .menu-item + .menu-item {
    border-top: 0.5px solid rgb(255 255 255 / 0.16);
  }

  .menu-item:hover,
  .menu-item:active {
    background: rgb(255 255 255 / 0.1);
  }

  /* 選択中の再生速度のチェック */
  .menu-item svg {
    flex: none;
    width: 1.1rem;
    height: 1.1rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* メニューの外を押したら閉じるための、透明な面 */
  .menu-scrim {
    position: fixed;
    z-index: 1;
    inset: 0;
    padding: 0;
    border: 0;
    background: none;
    cursor: default;
  }

  /* 主ボタン。Apple TV アプリの「再生」と同じ、白地に黒い文字の大きなボタン */
  .open {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    grid-column: span 4;
    min-height: 50px;
    padding: 0 1.75rem;
    border-radius: 14px;
    background: var(--label);
    color: #000;
    font: 600 1rem system-ui, sans-serif;
    text-decoration: none;
    transition:
      background 160ms,
      transform 160ms;
    -webkit-tap-highlight-color: transparent;
  }

  /* YouTube のロゴ（赤い角丸の四角に白い三角）。縦横比は 28:20 */
  .open .yt {
    width: 1.6rem;
    height: auto;
  }

  .yt-bg {
    fill: #ff0000;
  }

  .yt-play {
    fill: #fff;
  }

  .open:hover {
    background: #fff;
  }

  .open:active {
    transform: scale(0.97);
  }

  /* 概要欄。一段明るい角丸の面に入れて、タイトルまわりと切り分ける（iOS の設定画面のグループと同じ作り）。
     改行はそのまま全文を出す */
  .desc {
    align-self: stretch;
    margin: 1.5rem 0 0;
    padding: 0.9rem 1rem;
    border-radius: 14px;
    background: rgb(118 118 128 / 0.18);
    font: 400 0.95rem/1.6 system-ui, sans-serif;
    color: rgb(235 235 245 / 0.8);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .desc a {
    color: #64d2ff;
    text-decoration: underline;
  }

  @media (min-width: 640px) {
    .content {
      padding: 0.5rem 1.5rem 0;
    }

    .frame {
      border-radius: 14px;
      box-shadow: 0 30px 80px rgb(0 0 0 / 0.6);
    }

    .info {
      padding-inline: 0;
    }

    .heading {
      font-size: 2rem;
    }

    .controls,
    .actions {
      align-self: flex-start;
      width: 24rem;
    }
  }

  /* 「視差効果を減らす」設定のときは、せり上げずにその場に出す */
  @media (prefers-reduced-motion: reduce) {
    .player[open] {
      animation: none;
    }

    .player,
    .control,
    .open {
      transition: none;
    }
  }

  /* 「透明度を下げる」設定のときは、ぼかしをやめて濃い単色にする */
  @media (prefers-reduced-transparency: reduce) {
    .play {
      background: rgb(0 0 0 / 0.8);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }

    .ambient {
      display: none;
    }

    .menu {
      background: rgb(44 44 46);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }

    .hero-slides,
    .new-thumbs {
      background: rgb(20 28 28 / 0.92);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }

    .x {
      background: rgb(58 58 60);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }

  /* 「コントラストを上げる」設定のときは、薄い文字を白にする */
  @media (prefers-contrast: more) {
    .more-count,
    .empty-text,
    .meta,
    .status,
    .desc {
      color: #fff;
    }
  }
</style>
