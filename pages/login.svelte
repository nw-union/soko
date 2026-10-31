<script module lang="ts">
// ログイン前後の画面はタブバー付きの共通レイアウトを使わない
export const layout = false;
</script>

<script lang="ts">
  import { useRouter } from "@void/svelte";
  import Stage from "../src/lib/Stage.svelte";
  import { authClient, isPasskeyCancelled } from "../src/lib/auth-client";
  import { GUEST_NAME } from "../src/lib/profile";
  import { registerServiceWorker } from "../src/lib/pwa";
  import { onMount, tick } from "svelte";
  import type { Props } from "./login.server";
  import logo from "../src/assets/logo.png";

  let { hasInvite }: Props = $props();

  const router = useRouter();

  // 登録の欄は、招待リンクでなければ「初めての方」を押すまで閉じておく
  let signUpOpened = $state(false);
  const signUpOpen = $derived(hasInvite || signUpOpened);
  let tokenInput = $state<HTMLInputElement>();

  // 押したボタンは消えるので、次に操作する入力欄へフォーカスを移す
  async function openSignUp() {
    signUpOpened = true;
    await tick();
    tokenInput?.focus();
  }

  let token = $state("");
  // エラーは、それを起こしたボタン・入力欄のすぐ下に出す
  let signInError = $state("");
  let signUpError = $state("");
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
    signInError = "";
    pending = "signin";
    try {
      const result = await authClient.signIn.passkey();
      if (result.error) {
        // 本人がパスキーの画面を閉じたときは、何も出さない
        if (!isPasskeyCancelled(result.error))
          signInError = "パスキーでログインできませんでした。もう一度「パスキーでログイン」を押してください";
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
    signUpError = "";
    pending = "signup";
    try {
      const res = await fetch("/api/invite/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        signUpError = body?.message ?? "招待コードを確認できませんでした。時間をおいて、もう一度お試しください";
        return;
      }
      // メールアドレスとパスワードはユーザー作成に必要なだけの使い捨て。画面にも出さず、保存もしない
      const id = crypto.randomUUID();
      const password = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
      const created = await authClient.signUp.email({ email: `${id}@nwu.invalid`, password, name: GUEST_NAME });
      if (created.error) {
        signUpError = "登録できませんでした。招待コードをもう一度入力してください";
        return;
      }
      router.visit("/welcome", { replace: true });
    } finally {
      pending = null;
    }
  }
</script>

<Stage>
  <!-- Profile などの共通レイアウトの .view と同じ。view-transition-name があると、その中の .glass の背景はぼけなくなる。
       これがないとログイン画面だけカードの背景がぼけて、透け方が変わってしまう -->
  <div class="view">
  <main class="card glass">
    <!-- 見出しはアイコンだけ。読み上げでは alt を読む -->
    <h1><img src={logo} alt="Soko" width="500" height="500" /></h1>

    <section>
      <button type="button" class="btn" onclick={signIn} disabled={pending !== null}>
        {pending === "signin" ? "確認しています…" : "パスキーでログイン"}
      </button>
      {#if signInError}
        <p role="alert" class="error">{signInError}</p>
      {/if}
    </section>

    {#if signUpOpen}
    <p class="or"><span>初めての方</span></p>

    <form onsubmit={signUp}>
      <label for="token">招待コード</label>
      <input
        bind:this={tokenInput}
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
        aria-invalid={signUpError ? true : undefined}
        aria-describedby={signUpError ? "token-error token-help" : "token-help"}
      />
      {#if signUpError}
        <p id="token-error" role="alert" class="error">{signUpError}</p>
      {/if}
      <button type="submit" class="btn" disabled={pending !== null || token.replace(/-/g, "").length !== 16}>
        {pending === "signup" ? "確認しています…" : "登録する"}
      </button>
      <small id="token-help">メンバーから受け取った招待コードを入力すると、名前とパスキーを設定できます。</small>
    </form>
    {:else}
      <button type="button" class="first-time" onclick={openSignUp}>初めての方</button>
    {/if}
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
    box-sizing: border-box; /* 余白（padding）を幅に含める。含めないと画面からはみ出す */
    width: min(calc(100% - 2.5rem), 24rem);
    padding: 1.75rem 1.5rem;
    border-radius: 1.5rem;
    display: grid;
    gap: 1.1rem;
    color: #fff;
  }

  h1 {
    margin: 0;
    line-height: 0;
    text-align: center;
  }

  h1 img {
    width: 3.33rem;
    height: auto;
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
    font: 500 0.85rem/1.2 system-ui, sans-serif;
    opacity: 0.85;
  }

  .or::before,
  .or::after {
    content: "";
    flex: 1;
    height: 1px;
    background: rgb(255 255 255 / 0.3);
  }

  /* 登録の欄を開くリンク。押しやすいよう、高さは 44px 取る */
  .first-time {
    justify-self: center;
    min-height: 44px;
    margin-top: -0.85rem;
    margin-bottom: -0.6rem;
    padding: 0 0.75rem;
    border: 0;
    background: none;
    color: #fff;
    font: 500 0.85rem/1.2 system-ui, sans-serif;
    text-decoration: underline;
    text-underline-offset: 0.2em;
    opacity: 0.85;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  form {
    display: grid;
    gap: 0.7rem;
  }

  label {
    font: 600 0.85rem/1.2 system-ui, sans-serif;
    letter-spacing: 0.04em;
    opacity: 0.85;
  }

  input {
    width: 100%;
    box-sizing: border-box;
    padding: 0.85rem 1rem;
    border: 1px solid rgb(255 255 255 / 0.3);
    border-radius: 0.9rem;
    background: rgb(255 255 255 / 0.1);
    color: #fff;
    font: 600 1.05rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.12em;
    text-align: center;
  }

  input::placeholder {
    color: rgb(255 255 255 / 0.5);
    letter-spacing: 0.06em;
  }

  input[aria-invalid="true"] {
    border-color: rgb(255 150 150 / 0.8);
  }

  input:focus-visible {
    outline: 2px solid rgb(255 255 255 / 0.7);
    outline-offset: 2px;
  }

  small {
    font: 400 0.85rem/1.5 system-ui, sans-serif;
    opacity: 0.85;
  }

  /* ガラスのボタン */
  .btn {
    min-height: 44px;
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

  .btn:active:not(:disabled) {
    background: rgb(255 255 255 / 0.22);
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

  /* 「コントラストを上げる」設定のときは、薄い文字を白にする */
  @media (prefers-contrast: more) {
    .or,
    .first-time,
    label,
    small {
      color: #fff;
      opacity: 1;
    }

    input::placeholder {
      color: rgb(255 255 255 / 0.75);
    }
  }
</style>
