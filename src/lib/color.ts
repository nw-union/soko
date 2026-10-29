// イメージカラー（#rrggbb）の検証と、未設定のときの自動色。
// 値は style 属性に埋め込むので、必ずこの検証を通ったものだけを使うこと。
const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

// ユーザー ID から決まる色（#rrggbb）。イメージカラー未設定のユーザーに使う。
// 画面にカラーコードとして出すので、hsl() ではなく #rrggbb で返す
export function fallbackColor(userId: string): string {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  const [saturation, lightness] = [0.7, 0.55];
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function resolveColor(color: unknown, userId: string): string {
  return isHexColor(color) ? color.toLowerCase() : fallbackColor(userId);
}
