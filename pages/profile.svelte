<script lang="ts">
  import { onMount } from "svelte";
  import { useRouter, useShared } from "@void/svelte";
  import Avatar from "../src/lib/Avatar.svelte";
  import { authClient } from "../src/lib/auth-client";

  // アプリのページはログイン必須（middleware/01.auth.ts）なので、user は必ずある
  const user = useShared().auth.user!;
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    router.visit("/");
  }

  type PasskeyItem = { id: string; name?: string | null; createdAt: Date | string };
  let passkeys = $state<PasskeyItem[]>([]);
  let error = $state("");

  async function loadPasskeys() {
    const { data, error: err } = await authClient.passkey.listUserPasskeys();
    if (err) error = err.message ?? "パスキー一覧の取得に失敗しました";
    else passkeys = data ?? [];
  }

  async function addPasskey() {
    error = "";
    const result = await authClient.passkey.addPasskey({ name: `パスキー ${passkeys.length + 1}` });
    if (result?.error) {
      // 同じ端末に同じアカウントのパスキーは 2 つ作れない（その場合のメッセージは英語で返ってくる）
      error = /previously registered/i.test(result.error.message ?? "")
        ? "この端末には、すでにパスキーが登録されています。別の端末や別のパスワードマネージャーで追加してください"
        : "パスキーの追加に失敗しました";
    }
    await loadPasskeys();
  }

  async function deletePasskey(id: string) {
    if (passkeys.length <= 1) {
      error = "最後のパスキーは削除できません（ログインできなくなります）";
      return;
    }
    if (!confirm("このパスキーを削除しますか？")) return;
    error = "";
    const { error: err } = await authClient.passkey.deletePasskey({ id });
    if (err) error = err.message ?? "パスキーの削除に失敗しました";
    await loadPasskeys();
  }

  // ---- 招待コード ----
  type InviteItem = { id: number; createdAt: string; expiresAt: string | null; usedAt: string | null; usedByName: string | null };
  let invites = $state<InviteItem[]>([]);
  let remaining = $state(0);
  let limit = $state(3);
  let inviteError = $state("");
  let issued = $state<string | null>(null);
  let copied = $state(false);

  // SQLite の日時は UTC の "YYYY-MM-DD HH:MM:SS"
  const parseUtc = (value: string) => new Date(`${value.replace(" ", "T")}Z`);
  const isExpired = (invite: InviteItem) => !invite.usedAt && !!invite.expiresAt && parseUtc(invite.expiresAt) <= new Date();

  async function loadInvites() {
    const res = await fetch("/api/invites");
    if (!res.ok) return;
    const data = (await res.json()) as { limit: number; remaining: number; invites: InviteItem[] };
    limit = data.limit;
    remaining = data.remaining;
    invites = data.invites;
  }

  async function issueInvite() {
    inviteError = "";
    copied = false;
    const res = await fetch("/api/invites", { method: "POST" });
    const data = (await res.json().catch(() => null)) as { token?: string; message?: string } | null;
    if (!res.ok || !data?.token) inviteError = data?.message ?? "招待コードを発行できませんでした";
    else issued = data.token;
    await loadInvites();
  }

  // 発行したコードは、その場で 1 回しか見られない。リンクで渡せば入力の手間もない
  const inviteLink = (token: string) => `${window.location.origin}/login?invite=${token}`;

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    copied = true;
  }

  async function revokeInvite(id: number) {
    if (!confirm("この招待を取り消しますか？")) return;
    await fetch(`/api/invites?id=${id}`, { method: "DELETE" });
    await loadInvites();
  }

  onMount(() => {
    loadPasskeys();
    loadInvites();
  });
</script>

<h1>You</h1>

<div class="grid">
  <!-- アイコン・名前・メールアドレス -->
  <section class="tile glass wide profile">
    <Avatar name={user.name} color={user.color} image={user.image} size={4.5} />
    <div class="who">
      <p class="name">{user.name}</p>
      {#if !user.email.endsWith("@nwu.invalid")}
        <p class="email">{user.email}</p>
      {/if}
      <p class="code">{user.color}</p>
    </div>
  </section>

  <!-- パスキーは追加・削除できる -->
  <section class="tile glass wide">
    <h2>パスキー</h2>
    {#if error}
      <p role="alert" class="error">{error}</p>
    {/if}
    <ul class="passkeys">
      {#each passkeys as passkey (passkey.id)}
        <li>
          <span class="pk-name">{passkey.name ?? "(名前なし)"}</span>
          <small>{new Date(passkey.createdAt).toLocaleDateString("ja-JP")}</small>
          <button type="button" class="btn small" onclick={() => deletePasskey(passkey.id)}>削除</button>
        </li>
      {/each}
    </ul>
    <button type="button" class="btn" onclick={addPasskey}>パスキーを追加</button>
  </section>

  <!-- 招待コード。1 人 limit 回まで -->
  <section class="tile glass wide">
    <h2>招待コード（あと {remaining} / {limit} 回）</h2>
    {#if inviteError}
      <p role="alert" class="error">{inviteError}</p>
    {/if}
    {#if issued}
      <div class="issued">
        <p class="token">{issued}</p>
        <p class="note">このコードは今しか表示されません。ログイン画面の「初めての方」で入力するよう伝えてください（有効期限 7 日）。</p>
        <div class="row">
          <button type="button" class="btn small" onclick={() => copy(issued!)}>コードをコピー</button>
          <button type="button" class="btn small" onclick={() => copy(inviteLink(issued!))}>リンクをコピー</button>
          {#if copied}<small>コピーしました</small>{/if}
        </div>
      </div>
    {/if}
    <ul class="passkeys">
      {#each invites as invite (invite.id)}
        <li>
          <span class="pk-name">
            {#if invite.usedAt}{invite.usedByName ?? "使用済み"} が登録
            {:else if isExpired(invite)}期限切れ
            {:else}未使用{/if}
          </span>
          <small>{parseUtc(invite.createdAt).toLocaleDateString("ja-JP")}</small>
          {#if !invite.usedAt}
            <button type="button" class="btn small" onclick={() => revokeInvite(invite.id)}>取り消し</button>
          {/if}
        </li>
      {/each}
    </ul>
    <button type="button" class="btn" onclick={issueInvite} disabled={remaining <= 0}>招待コードを発行</button>
  </section>

  <button type="button" class="tile glass wide btn logout" onclick={signOut}>ログアウト</button>
</div>

<style>
  h1 {
    margin: 0 0 1.25rem;
    font-size: 1.4rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.9rem;
  }

  .wide {
    grid-column: 1 / -1;
  }

  .tile {
    margin: 0;
    padding: 1rem 1.1rem;
    border-radius: 1.1rem;
    min-width: 0;
  }

  h2 {
    margin: 0 0 0.45rem;
    font: 600 0.72rem/1 system-ui, sans-serif;
    letter-spacing: 0.04em;
    opacity: 0.7;
  }

  .profile {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .who {
    min-width: 0;
  }

  .name {
    margin: 0;
    font: 700 1.25rem/1.25 system-ui, sans-serif;
    overflow-wrap: anywhere;
  }

  .email {
    margin: 0.2rem 0 0;
    font: 400 0.85rem/1.3 system-ui, sans-serif;
    opacity: 0.75;
    overflow-wrap: anywhere;
  }

  /* イメージカラーのカラーコード */
  .code {
    margin: 0.2rem 0 0;
    font: 500 0.8rem/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
    opacity: 0.6;
  }

  .passkeys {
    list-style: none;
    margin: 0 0 0.8rem;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }

  .passkeys li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.2rem;
    border-bottom: 1px solid rgb(255 255 255 / 0.12);
  }

  .pk-name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    font-weight: 600;
  }

  .passkeys small {
    opacity: 0.65;
  }

  /* ガラスのボタン */
  .btn {
    padding: 0.55rem 1rem;
    border: 1px solid rgb(255 255 255 / 0.3);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.12);
    color: #fff;
    font: 600 0.9rem/1 system-ui, sans-serif;
    cursor: pointer;
  }

  .btn.small {
    padding: 0.35rem 0.75rem;
    font-size: 0.78rem;
  }

  .btn:active {
    background: rgb(255 255 255 / 0.22);
  }

  .logout {
    padding: 0.9rem;
    color: #ff9a9a;
    border-radius: 1.1rem;
    /* 背景の絵柄と重なっても読めるよう、少し暗くする */
    background: rgb(20 20 20 / 0.5);
  }

  .note {
    margin: 0 0 0.6rem;
    font: 400 0.8rem/1.5 system-ui, sans-serif;
    opacity: 0.75;
  }

  .issued {
    margin-bottom: 0.8rem;
  }

  .token {
    margin: 0 0 0.4rem;
    font: 700 1.15rem/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.1em;
    overflow-wrap: anywhere;
  }

  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .btn:disabled {
    opacity: 0.5;
  }

  .error {
    margin: 0 0 0.6rem;
    color: #ffb3b3;
    font-size: 0.85rem;
  }
</style>
