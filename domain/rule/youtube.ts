// YouTube の動画 ID と、そこから作る URL。サーバーとブラウザの両方から使うので、何にも依存させない（valibot も使わない）。
// ID は href / src に埋め込むので、検証してから使う
const YOUTUBE_ID = /^[\w-]{11}$/;

export const isYoutubeId = (value: string) => YOUTUBE_ID.test(value);

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

// YouTube Studio の動画の編集ページ
export const studioUrl = (id: string) =>
  `https://studio.youtube.com/video/${id}/edit`;

// 共有用の短いリンク
export const shortUrl = (id: string) => `https://youtu.be/${id}`;

// maxresdefault は黒帯のない 16:9（1280×720）。古い動画などでは存在せず 404 になるので、
// そのときは src/lib/client/thumbnail.ts の thumbnailFallback が 4:3 の hqdefault に差し替える（16:9 の枠に cover で入れると黒帯が切れてちょうど収まる）
export const thumbnailUrl = (id: string) =>
  `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;

// アプリ内で再生する埋め込みプレイヤー。nocookie ドメインで、再生後に関連動画を出さない。
// enablejsapi=1 で、アプリのボタンから再生速度を変えられるようにする
export const embedUrl = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1&enablejsapi=1`;

// トップの大きな動画で、ミュートのまま繰り返し流すプレビュー用の埋め込み。
// controls=0 で操作部を隠し、loop は playlist に同じ動画を指定しないと効かない。
// enablejsapi=1 は、再生が始まったことを知るため（src/lib/client/youtube-player.ts）
export const previewUrl = (id: string) =>
  `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=0&loop=1&playlist=${id}&playsinline=1&rel=0&modestbranding=1&disablekb=1&iv_load_policy=3&fs=0&enablejsapi=1`;

// 秒数を YouTube と同じ表記にする（3:33 / 1:02:03）
export const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
