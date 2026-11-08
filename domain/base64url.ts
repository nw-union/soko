// base64url (パディングなし) とバイト列の変換
// ブラウザ (src/lib/push.ts) からも使うので、何にも依存させない

export const base64urlToBytes = (value: string) => {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};

export const bytesToBase64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
