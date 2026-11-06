// DB に入っている URL は href / src にそのまま埋め込むので、http(s) 以外（javascript: など）は使わない
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

// 文章中の URL。日本語が続いても URL に含めないよう、ASCII の文字だけを見る
const URL_IN_TEXT = /https?:\/\/[\w\-.~:/?#[\]@!$&'()*+,;=%]+/g;
// URL のすぐ後ろの句読点や閉じかっこは、URL に含めない
const URL_TRAILING = /[.,;:!?'*)\]]+$/;

// 文章を、そのままの文字列と URL の部分に分ける。画面ではリンクにして表示する
export function splitLinks(text: string): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const url = match[0].replace(URL_TRAILING, "");
    if (!isHttpUrl(url)) continue;
    if (match.index > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: url, href: url });
    last = match.index + url.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
