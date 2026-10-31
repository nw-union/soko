// YouTube の動画 ID（11 文字）と、そこから作る URL。ID は href / src に埋め込むので、検証してから使う。
const YOUTUBE_ID = /^[\w-]{11}$/;

export const isYoutubeId = (value: string) => YOUTUBE_ID.test(value);

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

// 共有用の短いリンク
export const shortUrl = (id: string) => `https://youtu.be/${id}`;

// maxresdefault は黒帯のない 16:9（1280×720）。古い動画などでは存在せず 404 になるので、
// そのときは thumbnailFallback が 4:3 の hqdefault に差し替える（16:9 の枠に cover で入れると黒帯が切れてちょうど収まる）
export const thumbnailUrl = (id: string) =>
  `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;

// <img use:thumbnailFallback> で使う。maxresdefault が読めなかったら hqdefault にする。
// ハイドレーション前に読み込みが失敗していた場合も拾う
export const thumbnailFallback = (img: HTMLImageElement) => {
  const fallback = () => {
    if (img.src.includes("/maxresdefault.jpg"))
      img.src = img.src.replace("/maxresdefault.jpg", "/hqdefault.jpg");
  };
  img.addEventListener("error", fallback);
  if (img.complete && img.naturalWidth === 0) fallback();
  return { destroy: () => img.removeEventListener("error", fallback) };
};

// アプリ内で再生する埋め込みプレイヤー。nocookie ドメインで、再生後に関連動画を出さない。
// enablejsapi=1 で、アプリのボタンから再生速度を変えられるようにする
export const embedUrl = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&enablejsapi=1`;

// 秒数を YouTube と同じ表記にする（3:33 / 1:02:03）
export const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
