// URL の判定。ブラウザからも使うので、valibot などに依存させない

/**
 * http(s) の URL か. DB に入っている URL は href / src にそのまま埋め込むので, それ以外 (javascript: など) は使わない
 */
export const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
};
