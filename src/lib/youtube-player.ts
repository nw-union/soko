// YouTube IFrame Player API で、埋め込みプレイヤーを外から操作する（再生・一時停止、スキップ、再生速度の変更）。
// 埋め込み URL に enablejsapi=1 が付いている必要がある。
// https://developers.google.com/youtube/iframe_api_reference

// 使う分だけの型。公式の型パッケージは入れていない
export type YouTubePlayer = {
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number;
  getCurrentTime(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getPlaybackRate(): number;
  setPlaybackRate(rate: number): void;
  getAvailablePlaybackRates(): number[];
};

type YouTubeApi = {
  Player: new (
    element: HTMLIFrameElement,
    options: {
      host?: string;
      events: {
        onReady?: (e: { target: YouTubePlayer }) => void;
        onStateChange?: (e: { target: YouTubePlayer; data: number }) => void;
        onPlaybackRateChange?: (e: { target: YouTubePlayer; data: number }) => void;
      };
    },
  ) => YouTubePlayer;
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// API のスクリプトは、最初に動画を開いたときに一度だけ読み込む
let api: Promise<YouTubeApi> | undefined;

const loadApi = () => {
  api ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.append(script);
  });
  return api;
};

// getPlayerState・onStateChange の値のうち、動画が動いている状態（再生中・読み込み中）か
export const isPlayingState = (state: number) => state === 1 || state === 3;

// <iframe use:youtubePlayer={{ onready, onstatechange, onratechange }}> で使う。
// 準備ができたらプレイヤーを渡し、再生の状態や速度が変わるたびに知らせる。iframe が外れたら以降は何もしない
export const youtubePlayer = (
  iframe: HTMLIFrameElement,
  handlers: {
    onready: (player: YouTubePlayer) => void;
    onstatechange: (state: number) => void;
    onratechange: (rate: number) => void;
  },
) => {
  let alive = true;
  loadApi().then((YT) => {
    if (!alive) return;
    new YT.Player(iframe, {
      // API は既定で www.youtube.com からのメッセージしか受け取らない。
      // youtube-nocookie の埋め込みだと onReady が来ず操作できないので、iframe の送り元を教える
      host: new URL(iframe.src).origin,
      events: {
        onReady: (e) => alive && handlers.onready(e.target),
        onStateChange: (e) => alive && handlers.onstatechange(e.data),
        onPlaybackRateChange: (e) => alive && handlers.onratechange(e.data),
      },
    });
  });
  return {
    destroy: () => {
      alive = false;
    },
  };
};
