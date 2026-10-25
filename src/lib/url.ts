// DB に入っている URL は href / src にそのまま埋め込むので、http(s) 以外（javascript: など）は使わない
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
