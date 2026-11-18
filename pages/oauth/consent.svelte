<script module lang="ts">
// ログイン前後の画面と同じく、タブバー付きの共通レイアウトを使わない
export const layout = false;
</script>

<script lang="ts">
  import Stage from "../../src/lib/components/Stage.svelte";
  import { authClient, isPasskeyCancelled } from "../../src/lib/client/auth-client";
  import { knownScopes, SCOPE_LABELS, WRITE_SCOPES } from "../../src/lib/client/oauth-scopes";
  import type { Props } from "./consent.server";

  let { clientName, clientUri, known, redirectHost, scopes, fresh }: Props = $props();

  // 出すのは知っているスコープだけ。書き込みは、要求されていても既定でチェックを外す（必要な人だけが付ける）
  const shown = knownScopes(scopes);
  let checked = $state<Record<string, boolean>>(
    Object.fromEntries(shown.map((s) => [s, !WRITE_SCOPES.has(s)])),
  );
  const selected = $derived(shown.filter((s) => checked[s]));
  const canAccept = $derived(selected.includes("videos:read"));

  let error = $state("");
  let pending = $state<"accept" | "deny" | "reauth" | null>(null);

  // 許可・拒否の後は、サーバーが返した続き（アプリへのリダイレクト）へ better-auth のクライアントが移動する
  async function decide(accept: boolean) {
    error = "";
    pending = accept ? "accept" : "deny";
    try {
      const res = await authClient.$fetch("/oauth2/consent", {
        method: "POST",
        body: { accept, ...(accept ? { scope: selected.join(" ") } : {}) },
      });
      if (res.error) {
        error =
          res.error.code === "SESSION_NOT_FRESH"
            ? "時間が経ったため許可できません。もう一度パスキーで本人確認してください"
            : "処理できませんでした。アプリからもう一度接続し直してください";
        if (res.error.code === "SESSION_NOT_FRESH") fresh = false;
      }
    } finally {
      pending = null;
    }
  }

  // ログインし直す。サーバーは認可を続きから進め、この画面を新しい署名で開き直す
  async function reauthenticate() {
    error = "";
    pending = "reauth";
    try {
      const result = await authClient.signIn.passkey();
      if (result.error && !isPasskeyCancelled(result.error))
        error = "本人確認ができませんでした。もう一度お試しください";
    } finally {
      pending = null;
    }
  }
</script>

<Stage>
  <div class="view">
  <main class="card glass">
    <h1>アプリの接続</h1>

    {#if !known}
      <p role="alert" class="error">このアプリは登録されていません。アプリからもう一度接続し直してください。</p>
    {:else}
      <p class="lead">
        <strong>「{clientName ?? "名前のないアプリ"}」</strong>を名乗るアプリが、あなたとして soko を使う許可を求めています。
      </p>
      <dl class="meta">
        {#if clientUri}
          <dt>アプリの URL</dt><dd>{clientUri}</dd>
        {/if}
        <dt>許可の送り先</dt><dd>{redirectHost ?? "不明"}</dd>
      </dl>
      <small>名前はアプリが自分で名乗ったものです。自分で接続を始めたアプリでなければ、許可しないでください。</small>

      <fieldset>
        <legend>許可すること</legend>
        {#each shown as scope (scope)}
          <label class="scope">
            <input
              type="checkbox"
              bind:checked={checked[scope]}
              disabled={scope === "videos:read" || scope === "offline_access"}
            />
            <span>{SCOPE_LABELS[scope]}</span>
          </label>
        {/each}
      </fieldset>
      <small>動画の情報は、このアプリの事業者（AI のサービスなど）に送られます。</small>

      {#if error}
        <p role="alert" class="error">{error}</p>
      {/if}

      {#if fresh}
        <div class="actions">
          <button type="button" class="btn primary" onclick={() => decide(true)} disabled={pending !== null || !canAccept}>
            {pending === "accept" ? "許可しています…" : "許可する"}
          </button>
          <button type="button" class="btn" onclick={() => decide(false)} disabled={pending !== null}>
            {pending === "deny" ? "断っています…" : "許可しない"}
          </button>
        </div>
      {:else}
        <small>許可する前に、パスキーで本人確認をしてください。</small>
        <div class="actions">
          <button type="button" class="btn primary" onclick={reauthenticate} disabled={pending !== null}>
            {pending === "reauth" ? "確認しています…" : "パスキーで本人確認"}
          </button>
          <button type="button" class="btn" onclick={() => decide(false)} disabled={pending !== null}>
            許可しない
          </button>
        </div>
      {/if}
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
    box-sizing: border-box;
    width: min(calc(100% - 2.5rem), 26rem);
    padding: 1.75rem 1.5rem;
    border-radius: 1.5rem;
    display: grid;
    gap: 1rem;
    color: #fff;
  }

  h1 {
    margin: 0;
    font-size: 1.4rem;
  }

  .lead {
    margin: 0;
    font: 400 0.95rem/1.6 system-ui, sans-serif;
    overflow-wrap: anywhere;
  }

  .meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.3rem 0.8rem;
    margin: 0;
    font: 400 0.8rem/1.5 system-ui, sans-serif;
  }

  .meta dt {
    opacity: 0.8;
  }

  .meta dd {
    margin: 0;
    font-weight: 600;
    overflow-wrap: anywhere;
  }

  fieldset {
    display: grid;
    gap: 0.5rem;
    margin: 0;
    padding: 0.8rem 0.9rem;
    border: 1px solid rgb(255 255 255 / 0.3);
    border-radius: 0.9rem;
  }

  legend {
    padding: 0 0.3rem;
    font: 600 0.72rem/1 system-ui, sans-serif;
    letter-spacing: 0.04em;
  }

  .scope {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    min-height: 44px;
    font: 400 0.9rem/1.5 system-ui, sans-serif;
  }

  .scope input {
    margin-top: 0.25rem;
    width: 1.1rem;
    height: 1.1rem;
    flex: none;
  }

  small {
    font: 400 0.75rem/1.5 system-ui, sans-serif;
    color: rgb(255 255 255 / 0.85);
  }

  .actions {
    display: grid;
    gap: 0.6rem;
  }

  .btn {
    min-height: 44px;
    padding: 0.9rem 1rem;
    border: 1px solid rgb(255 255 255 / 0.3);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.12);
    color: #fff;
    font: 600 0.95rem/1 system-ui, sans-serif;
    cursor: pointer;
  }

  .btn.primary {
    background: rgb(255 255 255 / 0.24);
  }

  .btn:active:not(:disabled) {
    background: rgb(255 255 255 / 0.3);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  @media (prefers-contrast: more) {
    small,
    .meta dt {
      color: #fff;
      opacity: 1;
    }

    fieldset,
    .btn {
      border-color: #fff;
    }
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
