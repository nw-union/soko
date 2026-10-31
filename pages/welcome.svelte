<script module lang="ts">
// ログイン前後の画面はタブバー付きの共通レイアウトを使わない
export const layout = false;
</script>

<script lang="ts">
  import { useRouter, useShared } from "@void/svelte";
  import Stage from "../src/lib/Stage.svelte";
  import { authClient, isPasskeyCancelled } from "../src/lib/auth-client";
  import { GUEST_NAME, NAME_MAX } from "../src/lib/profile";

  const router = useRouter();
  const user = useShared().auth.user;
  if (!user) throw new Error("ログインしていません");

  // 仮の名前は出さず、空欄から入力してもらう。パスキーの作成をやめて戻ったときは、保存した名前を出す
  let name = $state(user.name === GUEST_NAME ? "" : user.name);
  let error = $state("");
  let pending = $state(false);

  // 名前を保存してから、この端末でパスキーを作る。パスキーがログインの唯一の手段なので、作るまでアプリには入れない
  // （middleware/01.auth.ts がここへ戻す）
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
        // 本人がパスキーの画面を閉じたときは、何も出さない
        if (isPasskeyCancelled(added.error)) return;
        // 登録から時間が経つと（auth.ts の FRESH_AGE_SECONDS）、パスキーを作れなくなる
        error =
          added.error.code === "SESSION_NOT_FRESH"
            ? "登録から時間が経ったため、パスキーを作れません。招待してくれたメンバーに、新しい招待コードをもらってください"
            : "パスキーを作れませんでした。もう一度お試しください";
        return;
      }
      router.visit("/", { replace: true });
    } finally {
      pending = false;
    }
  }
</script>

<Stage>
  <!-- Profile などの共通レイアウトの .view と同じ。view-transition-name があると、その中の .glass の背景はぼけなくなる。
       これがないとこの画面だけカードの背景がぼけて、透け方が変わってしまう -->
  <div class="view">
  <main class="card glass">
    <h1>ようこそ NWU へ</h1>
    {#if error}
      <p role="alert" class="error">{error}</p>
    {/if}

    <form onsubmit={submit}>
      <label for="name">名前</label>
      <input id="name" bind:value={name} maxlength={NAME_MAX} required autocomplete="nickname" />
      <button type="submit" class="btn" disabled={pending || !name.trim()}>
        {pending ? "設定しています…" : "パスキーを設定して始める"}
      </button>
      <small>次回からは、パスキー（指紋・顔認証など）でログインできます。</small>
    </form>
  </main>
  </div>
</Stage>

<style>
  .view {
    display: grid;
    place-items: center;
    width: 100%;
    view-transition-name: view;
  }

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
    background: rgb(255 255 255 / 0.1);
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
    background: rgb(255 255 255 / 0.12);
    color: #fff;
    font: 600 0.95rem/1 system-ui, sans-serif;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
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
