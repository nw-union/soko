// YouTube の動画 ID（11 文字）と、そこから作る URL。ID は href / src に埋め込むので、検証してから使う。
const YOUTUBE_ID = /^[\w-]{11}$/;

export const isYoutubeId = (value: string) => YOUTUBE_ID.test(value);

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

// YouTube Studio の動画の編集ページ
export const studioUrl = (id: string) =>
  `https://studio.youtube.com/video/${id}/edit`;

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

// トップの大きな動画で、ミュートのまま繰り返し流すプレビュー用の埋め込み。
// controls=0 で操作部を隠し、loop は playlist に同じ動画を指定しないと効かない。
// enablejsapi=1 は、再生が始まったことを知るため（youtube-player.ts）
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

// サムネイルの代表色。小さい 16:9 の画像（mqdefault）を 8×8 に縮めて平均を取る。
// 鮮やかな画素ほど重く数えるので、灰色の多い画像でも色味が出る。
// i.ytimg.com は CORS を許可しているので、canvas で読める。読めなかったときは null
const tints = new Map<string, Promise<string | null>>();

export const thumbnailTint = (thumbnail: string): Promise<string | null> => {
  const small = thumbnail.replace(/\/[a-z]+default\.jpg$/, "/mqdefault.jpg");
  let hit = tints.get(small);
  if (!hit) {
    hit = new Promise<string | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onerror = () => resolve(null);
      img.onload = () => {
        try {
          const size = 8;
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = size;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolve(null);
          ctx.drawImage(img, 0, 0, size, size);
          const { data } = ctx.getImageData(0, 0, size, size);
          let r = 0;
          let g = 0;
          let b = 0;
          let total = 0;
          for (let i = 0; i < data.length; i += 4) {
            const max = Math.max(data[i], data[i + 1], data[i + 2]);
            const min = Math.min(data[i], data[i + 1], data[i + 2]);
            const weight = 0.1 + (max - min) / 255;
            r += data[i] * weight;
            g += data[i + 1] * weight;
            b += data[i + 2] * weight;
            total += weight;
          }
          resolve(
            `${Math.round(r / total)} ${Math.round(g / total)} ${Math.round(b / total)}`,
          );
        } catch {
          resolve(null);
        }
      };
      img.src = small;
    });
    tints.set(small, hit);
  }
  return hit;
};

// <el use:thumbnailTintVar={サムネイルの URL}> で使う。代表色を CSS 変数 --tint（"r g b"）に入れる
export const thumbnailTintVar = (el: HTMLElement, thumbnail: string) => {
  thumbnailTint(thumbnail).then((color) => {
    if (color) el.style.setProperty("--tint", color);
  });
};
