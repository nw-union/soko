<script module lang="ts">
  // ログイン前後の画面はタブバー付きの共通レイアウトを使わない
  export const layout = false;
</script>

<script lang="ts">
  import { useRouter, useShared } from "@void/svelte";
  import Stage from "../src/lib/Stage.svelte";
  import { authClient } from "../src/lib/auth-client";

  const router = useRouter();
  const user = useShared().auth.user!;

  let name = $state(user.name);
  let error = $state("");
  let pending = $state(false);

  // 名前を保存してから、この端末でパスキーを作る。パスキーはあとからプロフィールでも作れる
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    pending = true;
    try {
      const saved = await authClient.updateUser({ name: name.trim() });
      if (saved.error) {
        error = "名前を保存できませんでした。もう一度お試しください";
        return;
      }
      const added = await authClient.passkey.addPasskey({ name: "最初のパスキー" });
      if (added?.error) {
        error = "パスキーを作れませんでした。もう一度お試しください（あとで設定することもできます）";
        return;
      }
      router.visit("/", { replace: true });
    } finally {
      pending = false;
    }
  }

  async function later() {
    const saved = await authClient.updateUser({ name: name.trim() });
    if (saved.error) error = "名前を保存できませんでした。もう一度お試しください";
    else router.visit("/", { replace: true });
  }
</script>

<Stage>
  <main class="card glass">
    <h1>ようこそ</h1>
    {#if error}
      <p role="alert" class="error">{error}</p>
    {/if}

    <form onsubmit={submit}>
      <label for="name">名前</label>
      <input id="name" bind:value={name} maxlength="100" required autocomplete="nickname" />
      <button class="btn primary" disabled={pending || !name.trim()}>
        {pending ? "設定しています…" : "パスキーを設定して始める"}
      </button>
      <small>次回からは、パスキー（指紋・顔認証など）でログインできます。</small>
    </form>

    <button type="button" class="link" onclick={later} disabled={pending || !name.trim()}>
      パスキーはあとで設定する
    </button>
  </main>
</Stage>

<style>
  .card {
    box-sizing: border-box;
    width: min(calc(100% - 2.5rem), 24rem);
    padding: 1.75rem 1.5rem;
    border-radius: 1.5rem;
    display: grid;
    gap: 1.1rem;
    color: #fff;
  }

  h1 {
    margin: 0;
    font-size: 1.4rem;
  }

  form {
    display: grid;
    gap: 0.7rem;
  }

  label {
    font: 600 0.72rem/1 system-ui, sans-serif;
    letter-spacing: 0.04em;
    opacity: 0.75;
  }

  input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.85rem 1rem;
    border: 1px solid rgb(255 255 255 / 0.3);
    border-radius: 0.9rem;
    background: rgb(0 0 0 / 0.35);
    color: #fff;
    font: 600 1rem/1 system-ui, sans-serif;
  }

  input:focus-visible {
    outline: 2px solid rgb(255 255 255 / 0.7);
    outline-offset: 2px;
  }

  small {
    font: 400 0.75rem/1.5 system-ui, sans-serif;
    opacity: 0.65;
  }

  a {
    color: #fff;
  }

  .btn {
    padding: 0.9rem 1rem;
    border: 1px solid rgb(255 255 255 / 0.3);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.24);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.45);
    color: #fff;
    font: 600 0.95rem/1 system-ui, sans-serif;
    cursor: pointer;
  }

  .btn:disabled,
  .link:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .link {
    padding: 0.2rem;
    border: 0;
    background: none;
    color: #fff;
    font: 400 0.78rem/1.4 system-ui, sans-serif;
    text-decoration: underline;
    opacity: 0.7;
    cursor: pointer;
  }

  .error {
    margin: 0;
    padding: 0.7rem 0.9rem;
    border-radius: 0.8rem;
    background: rgb(160 20 20 / 0.45);
    border: 1px solid rgb(255 150 150 / 0.4);
    font: 500 0.85rem/1.5 system-ui, sans-serif;
  }
</style>
