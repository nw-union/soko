// YouTube の動画 ID（11 文字）と、そこから作る URL。ID は href / src に埋め込むので、検証してから使う。
const YOUTUBE_ID = /^[\w-]{11}$/;

export const isYoutubeId = (value: string) => YOUTUBE_ID.test(value);

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

// hqdefault は 4:3 で上下に黒帯が入っているが、16:9 の枠に cover で入れると黒帯が切れてちょうど収まる
export const thumbnailUrl = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

// アプリ内で再生する埋め込みプレイヤー。nocookie ドメインで、再生後に関連動画を出さない
export const embedUrl = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;

// 秒数を YouTube と同じ表記にする（3:33 / 1:02:03）
export const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
