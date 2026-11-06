<script lang="ts">
import { useRouter, useShared } from "@void/svelte";
import { onMount } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import type { Props } from "./index.server";
import { syncBadge } from "../src/lib/push";
import { splitLinks } from "../src/lib/url";
import { previewUrl, shortUrl, studioUrl } from "../domain/youtube.ts";
import { thumbnailFallback, thumbnailTintVar } from "../src/lib/youtube";
import Avatar from "../src/lib/Avatar.svelte";
import PlaylistSheet from "../src/lib/PlaylistSheet.svelte";
import ProfileSheet from "../src/lib/ProfileSheet.svelte";
import { swipeToClose } from "../src/lib/swipe-to-close";
import DurationLabel from "../src/lib/DurationLabel.svelte";
import NewLabel from "../src/lib/NewLabel.svelte";
import VideoTile from "../src/lib/VideoTile.svelte";
import {
	isPlayingState,
	type YouTubePlayer,
	youtubePlayer,
} from "../src/lib/youtube-player";

let { newVideos, randomVideos, playlists }: Props = $props();

const router = useRouter();
const user = useShared().auth.user;

// 右上のアイコンから開くプロフィールのシート
let profileSheet = $state<ProfileSheet>();

// 見出しの矢印から開く、プレイリストの全動画のシート。開いている間は、後ろのプレビューと自動送りを止める
let playlistSheet = $state<PlaylistSheet>();
let playlistOpen = $state(false);

// プレイリストの行に並べる動画の数。残りは、行の最後のタイルから開く一覧で見る
const PREVIEW_COUNT = 6;

// 再生中の動画。入っている間だけ埋め込みプレイヤーを出す
type Video = Props["playlists"][number]["videos"][number];
let playing = $state<Video | null>(null);
let dialog = $state<HTMLDialogElement>();

// このページを開いてから変えた視聴状態。サーバーの記録を待たずに、すぐ表示に反映する
const watchedChanges = new SvelteMap<string, boolean>();
const isWatched = (video: Video) =>
	watchedChanges.get(video.youtubeId) ?? video.watched;

// 一番上に並べる動画の数
const SLIDE_COUNT = 3;
// 未視聴の New。プレイリストのタイルには、すべてにラベルを付ける
const unwatchedNew = $derived(newVideos.filter((video) => !isWatched(video)));
const unwatchedNewIds = $derived(
	new Set(unwatchedNew.map((video) => video.youtubeId)),
);
// New に出す動画。未視聴の新しい順。見たら外れて次が入る
const newList = $derived(unwatchedNew.slice(0, SLIDE_COUNT));
const newIds = $derived(new Set(newList.map((video) => video.youtubeId)));

// New を先に並べ、足りない分をランダムに選んだ動画で埋める
const slideList = $derived(
	[
		...newList,
		...randomVideos.filter((video) => !newIds.has(video.youtubeId)),
	].slice(0, SLIDE_COUNT),
);

// 大きく出す動画。下の点で選ぶ。選んだ動画が外れたら先頭に戻る
let selectedNewId = $state<string | null>(null);
const hero = $derived(
	slideList.find((video) => video.youtubeId === selectedNewId) ??
		slideList[0] ??
		null,
);

// 大きな動画は横にスライドして切り替える。スライドした先を選択中にする
let slides = $state<HTMLDivElement>();

// 1 枚ぶんの進み幅。カードの幅にすき間を足した長さで、先頭の 2 枚の位置の差から測る
const slideStep = (el: HTMLElement) => {
	const first = el.children[0] as HTMLElement | undefined;
	const second = el.children[1] as HTMLElement | undefined;
	return first && second ? second.offsetLeft - first.offsetLeft : el.clientWidth;
};

const slideIndex = (el: HTMLElement) =>
	Math.round(el.scrollLeft / slideStep(el));

let lastScrollAt = 0;

const slidesScrolled = () => {
	lastScrollAt = Date.now();
	if (!slides?.clientWidth) return;
	const video = slideList[slideIndex(slides)];
	if (video) selectedNewId = video.youtubeId;
};

// 点の列の左右を押したときに、前後の動画へ 1 本送る（端では止まる。iOS のページコントロールと同じ動き）
const stepSlide = (delta: number) => {
	autoSlideStopped = true;
	const next = slideList[slideList.indexOf(hero) + delta];
	if (next) selectedNewId = next.youtubeId;
};

// 点を押したときや、見た動画が外れたときは、選択中の動画までスライドする
$effect(() => {
	if (!slides || !hero) return;
	const index = slideList.indexOf(hero);
	if (slideIndex(slides) === index) return;
	slides.scrollTo({
		left: index * slideStep(slides),
		behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
			? "auto"
			: "smooth",
	});
});

// 大きな動画は、選んでいる 1 本だけミュートで流す（サムネイルの上に重ね、再生が始まったら現す）。
// 「視差効果を減らす」設定のときは流さない。再生画面を開いている間は外して、音と通信を止める
let previewOn = $state(false);
let previewReadyId = $state<string | null>(null);
// プレビューを流す動画。スライドの最中は途中の動画に次々切り替わるので、スクロールが止まって落ち着いてから決める
// （動いている最中に作った iframe は、読み込みや再生開始が途中で潰れて、流れないことがある）
let previewId = $state<string | null>(null);

onMount(() => {
	previewOn = !matchMedia("(prefers-reduced-motion: reduce)").matches;
});

// 選ぶ動画が替わったら、前の動画の「再生中」を捨てる（黒い枠だけが見えないように）
$effect(() => {
	const id = hero?.youtubeId ?? null;
	previewReadyId = null;
	previewId = null;
	if (!id) return;
	let timer: ReturnType<typeof setTimeout>;
	const settle = () => {
		if (holdingSlides || Date.now() - lastScrollAt < 250) {
			timer = setTimeout(settle, 120);
			return;
		}
		previewId = id;
	};
	timer = setTimeout(settle, 120);
	return () => clearTimeout(timer);
});

// シートを開くとプレビューは外れ、閉じると作り直されるので、再生が始まるまで隠す
$effect(() => {
	if (playlistOpen) previewReadyId = null;
});

const previewHandlers = {
	onready: (p: YouTubePlayer) => {
		p.mute();
		p.playVideo();
		// 始まらなかったときは、少し待って何度かやり直す
		let tries = 0;
		const retry = setInterval(() => {
			const state = p.getPlayerState();
			if (state === 1 || ++tries > 5) return clearInterval(retry);
			p.playVideo();
		}, 1000);
	},
	// 再生中（1）のときだけ動画を見せる。一時停止・終わり・読み込み中は、YouTube が出す再生ボタンや終了画面ごと隠して、サムネイルに戻す
	onstatechange: (state: number) => {
		previewReadyId = state === 1 ? previewId : null;
	},
	onratechange: () => {},
};

// 時間で次の動画へ送り、最後まで行ったら先頭に戻る。
// 一度でも手で触る（スライドを押さえる・点の列を押す）と、それ以降は自動で送らない。再生中・画面が裏にある間も送らない。
// 「視差効果を減らす」設定のときは、動かさない
const AUTO_SLIDE_MS = 15000;
// 一度でも自分で触ったら、その後は自動で送らない（読んでいる途中で変わらないように）
let autoSlideStopped = $state(false);
let holdingSlides = false;

$effect(() => {
	if (!hero || playing || playlistOpen || autoSlideStopped) return;
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
		syncBadge().catch(() => {});
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
	played = false;
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
	played = false;
	previewReadyId = null; // プレビューは作り直されるので、再生が始まるまで隠す
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

// メニューの出入り。iOS のメニューと同じく、押したボタンの所からバネのように膨らみ、閉じるときは素早く戻る
const prefersReducedMotion = () =>
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const menuIn = (_: Element) =>
	prefersReducedMotion()
		? { duration: 0 }
		: {
				duration: 420,
				// 少しだけ行き過ぎてから落ち着く（最大で 1.04 倍くらい）
				easing: (t: number) => 1 - Math.exp(-7 * t) * Math.cos(6 * t),
				css: (t: number) =>
					`opacity: ${Math.min(1, t * 2.5)}; transform: scale(${0.35 + 0.65 * t});`,
			};
const menuOut = (_: Element) =>
	prefersReducedMotion()
		? { duration: 0 }
		: {
				duration: 160,
				css: (t: number) => `opacity: ${t}; transform: scale(${0.6 + 0.4 * t});`,
			};

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
		// サムネイルは、再生が実際に始まる（1）のを待たず、押した直後の読み込み中（3）でも外す。
		// タップはサムネイルを素通りして iframe に届くので、アプリ側で押した瞬間は拾えない。YouTube の通知が一番早い合図になる
		if (isPlayingState(state)) played = true;
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

// 最初の再生が始まるまでは、プレイヤーの上にサムネイルを重ねて見せる。
// iPhone は、アプリのボタンからの自動再生を許さず、YouTube の画面を直接タップしないと始まらない。
// そのため、サムネイルはタップを通す（pointer-events: none）見せかけの面にして、タップは下のプレイヤーに届ける
let played = $state(false);

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

// 上の帯（つまみのある所）を下へスワイプして閉じる。iOS の全画面シートと同じ操作
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

// タイトルやボタンの所（.body）でも、いちばん上までスクロールした状態で下へスワイプしたら閉じる。
// 動画の上は iframe がタッチを受け取るので、ここには来ない
const bodySwipe = {
	// メニューを開いている間と、長押しの 2 倍速の最中は閉じない
	enabled: () => !openMenu && !closing && !boosting,
	onstart: (startY: number) => {
		dragStart = startY;
		clearTimeout(holdTimer); // 長押しの 2 倍速を始めない
	},
	onmove: (distance: number) => {
		dragY = distance;
	},
	onend: dragEnd,
};
</script>

<!-- ページの見出し。見た目には出さず、読み上げの見出しナビゲーションの起点にする -->
<h1 class="visually-hidden">ホーム</h1>

<!-- 画面の上端の帯。内容がステータスバーや右上のアイコンの下を通るとき、ぼかして暗くフェードさせて、操作部品と内容を切り分ける -->
<div class="edge" aria-hidden="true"></div>

<!-- 右上にユーザーのアイコン（枠はユーザーカラー）。押すとプロフィールが下から出る -->
{#if user}
  <button type="button" class="me" aria-label="プロフィール" aria-haspopup="dialog" onclick={() => profileSheet?.open()}>
    <Avatar name={user.name} color={user.color} image={user.image} size={2.5} />
  </button>
  <ProfileSheet bind:this={profileSheet} />
{/if}

<PlaylistSheet
  bind:this={playlistSheet}
  bind:opened={playlistOpen}
  {isWatched}
  isNew={(video) => unwatchedNewIds.has(video.youtubeId)}
  onplay={play}
  onexternal={markWatched}
/>

{#if playlists.length === 0}
  <div class="empty">
    <p class="empty-title">まだ動画がありません</p>
    <p class="empty-text">プレイリストに動画が追加されると、ここに表示されます。</p>
  </div>
{:else}
  <!-- 一番上に、まだ見ていない動画（足りない分はランダムに選んだ動画）をサムネイルで大きく。下の点で、大きく出す動画を選ぶ -->
  {#if hero}
    <div
      class="hero-slides"
      bind:this={slides}
      onscroll={slidesScrolled}
      onpointerdown={() => {
        holdingSlides = true;
        autoSlideStopped = true;
      }}
      onpointerup={() => (holdingSlides = false)}
      onpointercancel={() => (holdingSlides = false)}
    >
      {#each slideList as video, i (video.youtubeId)}
        <a class="hero" href={video.url} target="_blank" rel="noopener noreferrer" onclick={(e) => heroClick(e, video)}>
          <span class="hero-thumb">
            <img use:thumbnailFallback src={video.thumbnail} alt="" decoding="async" loading={i === 0 ? "eager" : "lazy"} fetchpriority={i === 0 ? "high" : "auto"} />
            {#if previewOn && !playing && !playlistOpen && video.youtubeId === previewId}
              <iframe
                class="preview"
                class:ready={previewReadyId === video.youtubeId}
                use:youtubePlayer={previewHandlers}
                src={previewUrl(video.youtubeId)}
                title="動画のプレビュー"
                aria-hidden="true"
                tabindex="-1"
                allow="autoplay; encrypted-media"
                referrerpolicy="strict-origin-when-cross-origin"
              ></iframe>
            {/if}
            <!-- iframe はタッチやクリックを奪うので、上に透明な面を敷いて、カードのリンクとスライドの操作を保つ -->
            <span class="hero-shield" aria-hidden="true"></span>
          </span>
          <span class="hero-title" use:thumbnailTintVar={video.thumbnail}>
            <span class="hero-text">
              <span class="hero-title-text">{video.title}</span>
              {#if video.tags.length > 0}
                <span class="hero-meta hero-tags">{video.tags.map((tag) => `#${tag}`).join(" ")}</span>
              {/if}
              {#if unwatchedNewIds.has(video.youtubeId) || video.duration || isWatched(video)}
                <span class="hero-meta hero-labels">
                  {#if unwatchedNewIds.has(video.youtubeId)}<NewLabel />{/if}
                  <DurationLabel duration={video.duration} watched={isWatched(video)} />
                </span>
              {/if}
            </span>
          </span>
        </a>
      {/each}
    </div>
    {#if slideList.length > 1}
      <!-- 何本目を出しているかの点。小さな点を個別に押すのではなく、列全体（高さ 44px）の左半分・右半分で前後に送る -->
      <div class="dots">
        {#each slideList as video (video.youtubeId)}
          <span class="dot" class:selected={video.youtubeId === hero.youtubeId} aria-hidden="true"></span>
        {/each}
        <button type="button" class="dots-step prev" aria-label="前の動画" disabled={slideList.indexOf(hero) === 0} onclick={() => stepSlide(-1)}></button>
        <button type="button" class="dots-step next" aria-label="次の動画" disabled={slideList.indexOf(hero) === slideList.length - 1} onclick={() => stepSlide(1)}></button>
      </div>
    {/if}
  {/if}

  <!-- プレイリストごとに、動画を横向きに並べる -->
  {#each playlists as list (list.id)}
    <h2 class="section list-heading" id="list-{list.id}">
      <!-- 名前・本数・矢印の全体が、全動画のシートを開くボタン -->
      <button type="button" class="list-open" aria-haspopup="dialog" onclick={() => playlistSheet?.open(list)}>
        <span>{list.name || "Playlist"}</span>
        <span class="count">{list.videos.length}<span class="visually-hidden"> 本</span></span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
      </button>
    </h2>
    <ul class="row" aria-labelledby="list-{list.id}">
      {#each list.videos.slice(0, PREVIEW_COUNT) as video (video.id)}
        <li>
          <VideoTile url={video.url} thumbnail={video.thumbnail} title={video.title} duration={video.duration} tags={video.tags} watched={isWatched(video)} isNew={unwatchedNewIds.has(video.youtubeId)} onplay={() => play(video)} onexternal={() => markWatched(video)} />
        </li>
      {/each}
      {#if list.videos.length > PREVIEW_COUNT}
        <li>
          <!-- 押せる範囲は行の高さいっぱい。見た目は丸に矢印だけで、見出しの矢印と同じ所へ行く -->
          <button type="button" class="more-tile" aria-label="{list.name || 'Playlist'}の動画をすべて見る" aria-haspopup="dialog" onclick={() => playlistSheet?.open(list)}>
            <span class="more-circle">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
            </span>
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
    <div class="body" use:swipeToClose={bodySwipe}>
      <div class="content" style:--ratio={playing.aspectRatio}>
        <div class="frame">
          <iframe
            use:youtubePlayer={playerHandlers}
            class:hidden={!played}
            src={playing.embed}
            title={playing.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"
          ></iframe>
          {#if !played}
            <span class="poster" aria-hidden="true">
              <img use:thumbnailFallback src={playing.thumbnail} alt="" decoding="async" />
              <button type="button" class="poster-play" tabindex="-1" disabled={!player} onclick={togglePlay}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              </button>
            </span>
          {/if}
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
                  視聴済み
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
                <div class="menu" role="menu" aria-label="再生速度" in:menuIn out:menuOut>
                  {#each rates as r (r)}
                    <button type="button" class="menu-item" role="menuitemradio" aria-checked={r === rate} onclick={() => changeRate(r)}>
                      <span class="menu-icon">
                        {#if r === rate}
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                        {/if}
                      </span>
                      {rateLabel(r)}
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
                <svg class="solid" viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="18.5" cy="12" r="2" /></svg>
              </button>
              {#if openMenu === "more"}
                <div class="menu" role="menu" aria-label="その他" in:menuIn out:menuOut>
                  <button type="button" class="menu-item" role="menuitem" onclick={toggleWatched}>
                    <span class="menu-icon">
                      {#if isWatched(playing)}
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /><path d="M4 4l16 16" /></svg>
                      {:else}
                        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" /><path d="M7.8 12.5l3 3 5.4-6" /></svg>
                      {/if}
                    </span>
                    {isWatched(playing) ? "未視聴にする" : "視聴済みにする"}
                  </button>
                  <button type="button" class="menu-item" role="menuitem" onclick={copyLink}>
                    <span class="menu-icon">
                      {#if copyLabel === "コピーしました"}
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                      {:else}
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" /><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" /></svg>
                      {/if}
                    </span>
                    {copyLabel}
                  </button>
                  <a class="menu-item" role="menuitem" href={studioUrl(playing.youtubeId)} target="_blank" rel="noopener noreferrer" onclick={() => (openMenu = null)}>
                    <span class="menu-icon">
                      <svg class="studio" viewBox="0 0 24 24" aria-hidden="true"><path fill-rule="evenodd" d="M12 1L21.53 6.5V17.5L12 23L2.47 17.5V6.5ZM12 3.8L19.1 7.9V16.1L12 20.2L4.9 16.1V7.9ZM12 4.8L18.24 8.4V15.6L12 19.2L5.76 15.6V8.4ZM10 8.8V15.2L15.6 12Z" /></svg>
                    </span>
                    YouTube Studio を開く
                  </a>
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
  /* 右上のユーザーアイコン。スクロールしても動かず、トップページの一番手前に出す。
     再生画面とプロフィールのシートは dialog（最前面の層）なので、開くとその下に隠れる。押せる範囲は 44pt（HIG） */
  .me {
    position: fixed;
    z-index: 100;
    /* 画面の上端（安全領域の下）から大きなサムネイルまでの余白（layout.svelte の padding-top 2rem + .hero-slides の margin-top 3rem = 5rem）の真ん中に、アイコン（44px）の中心を置く */
    top: calc(env(safe-area-inset-top) + 2.5rem - 22px);
    right: calc(env(safe-area-inset-right) + 0.75rem);
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .me:active {
    opacity: 0.7;
  }

  /* 画面上端のスクロールエッジ。ぼかしは下に向かって弱くなり、暗い影も同じようにフェードする。
     触れないよう pointer-events は切る。アイコン（z-index 100）より下 */
  .edge {
    position: fixed;
    z-index: 50;
    top: 0;
    left: 0;
    right: 0;
    height: calc(env(safe-area-inset-top) + 3.5rem);
    pointer-events: none;
    background: linear-gradient(rgb(0 0 0 / 0.5), rgb(0 0 0 / 0));
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    mask-image: linear-gradient(#000 35%, transparent);
    -webkit-mask-image: linear-gradient(#000 35%, transparent);
  }

  /* 各行の見出し（プレイリスト名） */
  .section {
    margin: 2rem 0 0.325rem;
    font: 700 1.25rem/1.3 system-ui, sans-serif;
  }

  /* New のすぐ下の見出しは、他の見出しの間隔の 1.5 倍あける */
  .hero-slides + .section,
  .dots + .section {
    margin-top: 3rem;
  }

  /* プレイリストの見出し。名前の右に動画数を並べる */
  .list-heading {
    display: flex;
    align-items: center;
    gap: 0.55rem;
  }

  /* 見出しの全体が、全動画のシートを開くボタン。上下に広げて押しやすくし（44pt 以上）、その分は負の余白で打ち消して、見出しの間隔は変えない */
  .list-open {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    min-width: 0;
    min-height: 44px;
    margin: -0.5rem 0;
    padding: 0;
    border: 0;
    background: none;
    color: #fff;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: opacity 160ms;
    -webkit-tap-highlight-color: transparent;
  }

  .list-open:active {
    opacity: 0.6;
  }

  .list-open svg {
    flex: none;
    width: 1.25rem;
    height: 1.25rem;
    margin-left: -0.15rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
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

  /* 一番上の大きな動画を並べる枠。横にスライドして、1 本ずつ吸い付いて止まる。スクロールバーは出さない */
  .hero-slides {
    display: flex;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    /* 右上に固定したアイコンの下から始める（スクロール前に重ならない） */
    margin-top: 3rem;
    /* 枠・背景・角丸は、枠の中身ではなくカード 1 枚ずつに付ける。カードの間は少し空ける */
    gap: 0.6rem;
  }

  .hero-slides::-webkit-scrollbar {
    display: none;
  }

  /* 大きな動画。サムネイルを大きく出し、その下にタイトルを置く */
  .hero {
    position: relative;
    flex: 0 0 100%;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 1.4rem;
    /* タイトルの面の下地。下のタイルと同じ暗いガラスと枠 */
    background: linear-gradient(135deg, rgb(12 18 18 / 0.78), rgb(12 18 18 / 0.68));
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgb(255 255 255 / 0.18);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.4);
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
    flex: none;
    display: block;
    aspect-ratio: 16 / 9;
    background: rgb(0 0 0 / 0.35); /* 画像が届くまでの下地 */
  }

  /* サムネイルの上に重ねるプレビュー。再生が始まるまでは透明で、サムネイルが見えている */
  .preview {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    opacity: 0;
    transition: opacity 400ms;
  }

  .preview.ready {
    opacity: 1;
  }

  .hero-shield {
    position: absolute;
    inset: 0;
  }

  /* サムネイルの下の情報。タイトルとラベルを出す。
     面は下のタイルと同じく、サムネイルの代表色を透かして塗る（色が取れるまでは下地のまま）。
     スライドごとに中身の量が違っても、下端まで同じ色にする */
  .hero-title {
    flex: 1;
    background: rgb(var(--tint) / 0.4);
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.85rem;
  }

  .hero-text {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.2rem;
  }

  /* タイトルは 1 行。長ければ省略する */
  .hero-title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 700 0.9rem/1.35 system-ui, sans-serif;
  }

  .hero-meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    font: 400 0.85rem/1.35 system-ui, sans-serif;
    font-variant-numeric: tabular-nums;
    color: rgb(255 255 255 / 0.72);
  }

  /* タグは 1 行に収まらない分を省略する */
  .hero-tags {
    display: block;
    /* 下のタイル（VideoTile.svelte の .tags）と同じ大きさと色 */
    font: 500 0.7rem/1.4 system-ui, sans-serif;
    color: rgb(255 255 255 / 0.78);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* New と動画時間のラベルの行 */
  .hero-labels {
    margin-top: 0.2rem;
  }

  .hero img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  /* スマホでは、左右の余白を他の場所よりかなり狭くして、大きな動画を広く出す（画面の端には付けない） */
  @media (max-width: 639px) {
    .hero-slides {
      margin-inline: calc(var(--gutter) * -1);
      padding-inline: 0.4rem;
      scroll-padding-inline: 0.4rem;
    }
  }

  /* 動画の下の点。背景の画像の上でも見えるよう、薄い影を付ける。
     列全体を高さ 44px の押せる面にして、左半分で前へ、右半分で次へ送る */
  .dots {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0.5rem;
    min-height: 44px;
    margin-top: 0.1rem;
  }

  .dot {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.4);
    box-shadow: 0 0 3px rgb(0 0 0 / 0.6);
    transition: background 200ms;
  }

  .dot.selected {
    background: #fff;
  }

  .dots-step {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 50%;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .dots-step.prev {
    left: 0;
  }

  .dots-step.next {
    right: 0;
  }

  .dots-step:disabled {
    cursor: default;
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

  /* 行の最後の、全動画の一覧を開くボタン。見た目は丸に矢印だけ。押せる範囲は行の高さいっぱいにする */
  .more-tile {
    display: grid;
    place-items: center;
    width: 4rem;
    height: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: #fff;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .more-circle {
    display: grid;
    place-items: center;
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
    /* 暗いガラス（.glass）ではなく、背景が透けて見える薄いガラス。上の縁を明るくして厚みを出す */
    background: linear-gradient(135deg, rgb(255 255 255 / 0.16), rgb(255 255 255 / 0.05));
    backdrop-filter: blur(16px) saturate(1.4);
    -webkit-backdrop-filter: blur(16px) saturate(1.4);
    box-shadow:
      inset 0 0 0 0.5px rgb(255 255 255 / 0.3),
      inset 0 1px 0 rgb(255 255 255 / 0.45);
    transition: scale 160ms;
  }

  .more-tile:active .more-circle {
    scale: 0.92;
  }

  .more-circle svg {
    width: 1.4rem;
    height: 1.4rem;
    margin-left: 0.1rem; /* › は重心が左寄りに見えるので、少し右にずらす */
    fill: none;
    stroke: currentColor;
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* 再生画面。画面全体を覆う黒い面で、下からせり上がって開き、下へ滑って閉じる。
     動きは iOS のシートと同じ、出だしが速くゆっくり止まるカーブ */
  .player {
    --ease: cubic-bezier(0.32, 0.72, 0, 1);
    --label: #f5f5f7;
    --secondary: rgb(235 235 245 / 0.6);
    /* 上に残す隙間。ステータスバーの分だけ空け、奥のトップページを暗くして見せる */
    --gap: env(safe-area-inset-top);
    position: fixed;
    inset: var(--gap) 0 0;
    box-sizing: border-box;
    width: 100%;
    max-width: none;
    height: calc(100dvh - var(--gap));
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 1.4rem 1.4rem 0 0;
    overflow: hidden;
    background: #000;
    color: var(--label);
    transition: translate 260ms var(--ease);
  }

  /* ホーム画面から開いたとき（PWA）も、画面の下端まで覆う（Stage.svelte の .stage と同じ） */
  @media (display-mode: standalone) {
    .player {
      bottom: auto;
      height: calc(100lvh - var(--gap));
    }
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
    padding: 0.5rem calc(env(safe-area-inset-right) + 0.5rem) 0.5rem
      calc(env(safe-area-inset-left) + 0.5rem);
    touch-action: none;
    cursor: grab;
  }

  .grabber {
    position: absolute;
    top: 0.4rem;
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
    width: min(100%, 64rem, calc((100dvh - 9rem) * var(--ratio, 1.778) + 3rem));
    margin: 0 auto;
  }

  /* スマホでは動画を画面の端から端まで。広い画面では角を丸めて浮かせる */
  .frame {
    position: relative;
    /* 動画の縦横比に合わせる。スクエアの動画でも左右に黒い帯が出ない */
    aspect-ratio: var(--ratio, 1.778);
    overflow: hidden;
    /* 透明のまま。サムネイルの上下の余白からは、後ろのぼかした背景が見える */
  }

  /* 再生ボタンを押すまで出す、サムネイル。枠いっぱいに広げ、真ん中に再生の印を置く */
  .poster {
    position: absolute;
    inset: 0;
    display: block;
    /* タップは下のプレイヤーに通す（iPhone で再生を始めるため） */
    pointer-events: none;
  }

  /* 動画の縦横比で確保した枠の中に、サムネイルを横幅いっぱいで置く。
     縦横比が違うときは、上下に余白（黒）が出るか、はみ出た上下が切れる。左右は切らない */
  .poster img {
    position: absolute;
    top: 50%;
    left: 0;
    display: block;
    width: 100%;
    height: auto;
    translate: 0 -50%;
  }

  .poster-play {
    position: absolute;
    top: 50%;
    left: 50%;
    display: grid;
    place-items: center;
    width: 4rem;
    height: 4rem;
    translate: -50% -50%;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: rgb(0 0 0 / 0.55);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.35);
    /* Chrome は、透明にした別オリジンの iframe へのクリックを YouTube が受け付けない。
       そのため、再生ボタンは本物のボタンにして、API（playVideo）で再生する */
    pointer-events: auto;
    cursor: pointer;
  }

  /* iOS は、iframe を直接タップしないと再生を始められないので、従来どおりタップを下に通す */
  @supports (-webkit-touch-callout: none) {
    .poster-play {
      pointer-events: none;
    }
  }

  .poster-play svg {
    width: 2rem;
    height: 2rem;
    margin-left: 0.2rem; /* ▶ は重心が左寄りに見えるので、少し右にずらす */
    fill: #fff;
  }

  /* サムネイルを出している間は、プレイヤーの黒い下地が余白から透けないよう隠す（タップは通る） */
  iframe.hidden {
    opacity: 0;
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

  /* 主ボタン。Apple TV アプリの「再生」と同じ、白地に黒い文字。他のボタンより一回り大きい */
  .control.main {
    grid-column: span 2;
    min-height: 50px;
    border-radius: 14px;
    background: var(--label);
    color: #000;
    font-size: 1rem;
  }

  .control.main:hover {
    background: #fff;
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

  /* 「…」と再生速度のメニュー。iOS 26 のメニューと同じ、大きな角丸のガラスの面を、押したボタンに重ねて膨らませる。
     白いボタンの真上でも文字が読めるよう、裏を暗くしてから色を載せる（白の上で約 6:1） */
  .menu {
    position: absolute;
    z-index: 2;
    right: 0;
    bottom: 0;
    box-sizing: border-box;
    width: max-content;
    min-width: 14rem;
    max-width: calc(100vw - 2.5rem);
    max-height: 60dvh;
    padding: 0.5rem;
    border-radius: 1.75rem;
    overflow-y: auto;
    overscroll-behavior: contain;
    transform-origin: bottom right;
    background: linear-gradient(160deg, rgb(50 50 55 / 0.86), rgb(34 34 38 / 0.9));
    backdrop-filter: blur(28px) saturate(170%) brightness(0.65);
    -webkit-backdrop-filter: blur(28px) saturate(170%) brightness(0.65);
    /* 縁に光が乗った細いハイライトと、面を浮かせる影 */
    box-shadow:
      inset 0 0.5px 0 rgb(255 255 255 / 0.42),
      inset 0 0 0 0.5px rgb(255 255 255 / 0.12),
      inset 0 0 18px rgb(255 255 255 / 0.05),
      0 2px 8px rgb(0 0 0 / 0.25),
      0 18px 50px rgb(0 0 0 / 0.45);
  }

  /* 再生速度は文字が短いので、幅を詰める */
  .more.speed .menu {
    min-width: 9.5rem;
  }

  /* 行は区切り線なしで並べ、押した行だけ丸い面で光らせる。角丸は外側の面と同心にする（1.75rem - 余白 0.5rem） */
  .menu-item {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 0.7rem;
    width: 100%;
    min-height: 44px;
    padding: 0.5rem 0.85rem 0.5rem 0.7rem;
    border: 0;
    border-radius: 1.25rem;
    background: none;
    color: var(--label);
    font: 400 1rem system-ui, sans-serif;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition: background 120ms;
    -webkit-user-select: none;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }

  @media (hover: hover) {
    .menu-item:hover {
      background: rgb(255 255 255 / 0.12);
    }
  }

  .menu-item:active {
    background: rgb(255 255 255 / 0.2);
  }

  .menu-item:focus-visible {
    outline: 2px solid var(--label);
    outline-offset: -2px;
  }

  /* 行の先頭の記号の列。チェックがない行でも幅を取り、文字の頭を揃える */
  .menu-icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 1.4rem;
    height: 1.4rem;
  }

  .menu-icon svg {
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  /* YouTube Studio のロゴ（六角形に再生マーク）。線ではなく白の塗りで描く */
  .menu-icon .studio {
    fill: #fff;
    stroke: none;
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

  /* 「YouTube で開く」。外のアプリに出る副ボタンなので、他のボタンと同じ灰色の面にする */
  .open {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.4rem;
    grid-column: span 4;
    min-height: 44px;
    padding: 0 1rem;
    border-radius: 12px;
    background: rgb(118 118 128 / 0.24);
    color: var(--label);
    font: 600 0.9375rem system-ui, sans-serif;
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
    background: rgb(118 118 128 / 0.34);
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
    .preview {
      transition: none;
    }

    .dot {
      transition: none;
    }

    .player[open] {
      animation: none;
    }

    .list-open,
    .more-circle,
    .player,
    .control,
    .menu-item,
    .open {
      transition: none;
    }
  }

  /* 「透明度を下げる」設定のときは、ぼかしをやめて濃い単色にする。
     prefers-reduced-transparency は iPhone の Safari で効かない可能性があるので、
     「コントラストを上げる」（prefers-contrast: more）でも同じ不透明表示にする */
  @media (prefers-reduced-transparency: reduce), (prefers-contrast: more) {
    .more-circle {
      background: rgb(58 58 60);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }

    .ambient {
      display: none;
    }

    .edge {
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }

    .menu {
      background: rgb(44 44 46);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }

    .hero {
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
    .hero-meta,
    .empty-text,
    .meta,
    .status,
    .desc {
      color: #fff;
    }

    .menu {
      background: rgb(28 28 30);
      box-shadow:
        inset 0 0 0 1px rgb(255 255 255 / 0.6),
        0 18px 50px rgb(0 0 0 / 0.45);
    }
  }
</style>
