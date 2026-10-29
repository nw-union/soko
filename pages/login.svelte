<script module lang="ts">
// ログイン前後の画面はタブバー付きの共通レイアウトを使わない
export const layout = false;
</script>

<script lang="ts">
  import { useRouter } from "@void/svelte";
  import Stage from "../src/lib/Stage.svelte";
  import { authClient } from "../src/lib/auth-client";
  import { registerServiceWorker } from "../src/lib/pwa";
  import { onMount } from "svelte";

  const router = useRouter();

  let token = $state("");
  let error = $state("");
  let pending = $state<"signin" | "signup" | null>(null);
  onMount(() => {
    registerServiceWorker();
    const params = new URLSearchParams(window.location.search);
    // 招待リンク（/login?invite=XXXX-...）なら、コードを入れておく
    const invite = params.get("invite");
    if (invite) token = formatToken(invite);
  });

  // 入力中に、大文字・英数字だけにして、4 文字ごとにハイフンを入れる（最大 16 文字）
  function formatToken(raw: string): string {
    const chars = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
    return chars.match(/.{1,4}/g)?.join("-") ?? "";
  }

  function onTokenInput(event: Event & { currentTarget: HTMLInputElement }) {
    token = formatToken(event.currentTarget.value);
    event.currentTarget.value = token;
  }

  async function signIn() {
    error = "";
    pending = "signin";
    try {
      const result = await authClient.signIn.passkey();
      if (result.error) {
        error = "パスキーでログインできませんでした。もう一度お試しください";
        return;
      }
      router.visit("/", { replace: true });
    } finally {
      pending = null;
    }
  }

  // 招待コードを確かめて、ユーザーを作る。ユーザー作成後は /welcome で名前とパスキーを決める
  async function signUp(event: SubmitEvent) {
    event.preventDefault();
    error = "";
    pending = "signup";
    try {
      const res = await fetch("/api/invite/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        error = body?.message ?? "確認できませんでした。もう一度お試しください";
        return;
      }
      // メールアドレスとパスワードはユーザー作成に必要なだけの使い捨て。画面にも出さず、保存もしない
      const id = crypto.randomUUID();
      const password = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const created = await authClient.signUp.email({ email: `${id}@nwu.invalid`, password, name: "ゲスト" });
      if (created.error) {
        error = "登録できませんでした。招待コードをもう一度入力してください";
        return;
      }
      router.visit("/welcome", { replace: true });
    } finally {
      pending = null;
    }
  }
</script>

<Stage>
  <main class="card glass">
    {#if error}
      <p role="alert" class="error">{error}</p>
    {/if}

    <section>
      <button type="button" class="btn primary" onclick={signIn} disabled={pending !== null}>
        {pending === "signin" ? "確認しています…" : "パスキーでログイン"}
      </button>
    </section>

    <p class="or"><span>初めての方</span></p>

    <form onsubmit={signUp}>
      <label for="token">招待コード</label>
      <input
        id="token"
        value={token}
        oninput={onTokenInput}
        placeholder="XXXX-XXXX-XXXX-XXXX"
        inputmode="text"
        autocomplete="off"
        autocapitalize="characters"
        autocorrect="off"
        spellcheck="false"
        maxlength="19"
        required
      />
      <button type="submit" class="btn" disabled={pending !== null || token.replace(/-/g, "").length !== 16}>
        {pending === "signup" ? "確認しています…" : "登録する"}
      </button>
      <small>メンバーから受け取った招待コードを入力すると、名前とパスキーを設定できます。</small>
    </form>
  </main>
</Stage>

<style>
  .card {
    box-sizing: border-box; /* 余白（padding）を幅に含める。含めないと画面からはみ出す */
    width: min(calc(100% - 2.5rem), 24rem);
    padding: 1.75rem 1.5rem;
    border-radius: 1.5rem;
    display: grid;
    gap: 1.1rem;
    color: #fff;
  }

  section {
    display: grid;
    gap: 0.8rem;
  }

  .or {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    margin: 0.2rem 0;
    font: 500 0.78rem/1 system-ui, sans-serif;
    opacity: 0.7;
  }

  .or::before,
  .or::after {
    content: "";
    flex: 1;
    height: 1px;
    background: rgb(255 255 255 / 0.3);
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
    font: 600 1.05rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.12em;
    text-align: center;
  }

  input::placeholder {
    color: rgb(255 255 255 / 0.3);
    letter-spacing: 0.06em;
  }

  input:focus-visible {
    outline: 2px solid rgb(255 255 255 / 0.7);
    outline-offset: 2px;
  }

  small {
    font: 400 0.75rem/1.5 system-ui, sans-serif;
    opacity: 0.65;
  }

  /* ガラスのボタン */
  .btn {
    padding: 0.9rem 1rem;
    border: 1px solid rgb(255 255 255 / 0.3);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.12);
    color: #fff;
    font: 600 0.95rem/1 system-ui, sans-serif;
    cursor: pointer;
    transition: background 160ms, opacity 160ms;
    -webkit-tap-highlight-color: transparent;
  }

  .btn.primary {
    background: rgb(255 255 255 / 0.24);
    box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.45);
  }

  .btn:active:not(:disabled) {
    background: rgb(255 255 255 / 0.3);
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
