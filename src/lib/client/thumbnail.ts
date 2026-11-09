// YouTube のサムネイルをブラウザで扱う処理（img・canvas を使う）。ID や URL の組み立ては domain/rule/youtube.ts

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
