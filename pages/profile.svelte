<script lang="ts">
import { onMount } from "svelte";
import { useRouter, useShared } from "@void/svelte";
import Avatar from "../src/lib/Avatar.svelte";
import ConfirmDialog from "../src/lib/ConfirmDialog.svelte";
import { authClient, isPasskeyCancelled } from "../src/lib/auth-client";
import { isHexColor } from "../src/lib/color";
import { NAME_MAX } from "../src/lib/profile";
import {
	disablePush,
	enablePush,
	type PushState,
	pushState,
} from "../src/lib/push";

// アプリのページはログイン必須（middleware/01.auth.ts）なので、user は必ずある
const user = useShared().auth.user;
if (!user) throw new Error("ログインしていません");
const router = useRouter();

// 削除・取り消しの前に出す確認ダイアログ
let confirmDialog = $state<ConfirmDialog>();

// パスキーの追加・削除とアカウントの削除は、ログインし直したばかりのセッションでしかできない（auth.ts の FRESH_AGE_SECONDS）。
// その前に、パスキーでログインし直してセッションを新しくする。続けてよければ true
async function reauthenticate(setError: (message: string) => void) {
	const signedIn = await authClient.signIn.passkey();
	if (signedIn.error) {
		if (!isPasskeyCancelled(signedIn.error))
			setError("本人確認ができませんでした。もう一度お試しください");
		return false;
	}
	// 別のアカウントのパスキーが選ばれたときは、そのアカウントで操作しない
	const { data: session } = await authClient.getSession();
	if (session?.user.id !== user.id) {
		setError(
			"別のアカウントのパスキーが選ばれたため、中止しました。画面を読み込み直します",
		);
		setTimeout(() => window.location.reload(), 2500);
		return false;
	}
	return true;
}

const isNotFresh = (error: { code?: string } | null | undefined) =>
	error?.code === "SESSION_NOT_FRESH";

async function signOut() {
	// ログアウトした端末には、このアカウントの通知を送らない
	await disablePush().catch(() => {});
	await authClient.signOut();
	router.visit("/");
}

// ---- 新着動画の通知 ----
// 読み込むまでは null（何も出さない）
let push = $state<PushState | null>(null);
let pushBusy = $state(false);
let pushError = $state("");

async function togglePush(event: Event) {
	const on = (event.currentTarget as HTMLInputElement).checked;
	pushError = "";
	pushBusy = true;
	try {
		push = on ? await enablePush() : await disablePush();
	} catch {
		pushError = on
			? "通知をオンにできませんでした。時間をおいて、もう一度お試しください"
			: "通知をオフにできませんでした。時間をおいて、もう一度お試しください";
		push = await pushState().catch(() => push);
	} finally {
		pushBusy = false;
	}
}

// ---- 名前・イメージカラーの変更 ----
let nameInput = $state(user.name);
let colorInput = $state(user.color);
let profileError = $state("");
let saving = $state(false);
let editing = $state(false);
const colorValid = $derived(isHexColor(colorInput));

function cancelEdit() {
	editing = false;
	profileError = "";
	nameInput = user.name;
	colorInput = user.color;
}

async function saveProfile(event: SubmitEvent) {
	event.preventDefault();
	profileError = "";
	saving = true;
	const { error: err } = await authClient.updateUser({
		name: nameInput.trim(),
		color: colorInput.toLowerCase(),
	});
	saving = false;
	if (err) {
		// 名前と色の形式は、送る前にこの画面で確かめている。それ以外の失敗は、サーバーの英語のメッセージを出さない
		profileError =
			"保存できませんでした。時間をおいて、もう一度「保存」を押してください";
		return;
	}
	// 共有データ（useShared）は取り直さないと変わらないので、ページごと読み込み直す
	window.location.reload();
}

// ---- パスキー ----
type PasskeyItem = {
	id: string;
	name?: string | null;
	createdAt: Date | string;
};
let passkeys = $state<PasskeyItem[]>([]);
let passkeysLoaded = $state(false);
let passkeyError = $state("");
let passkeyNotice = $state("");

async function loadPasskeys() {
	const { data, error: err } = await authClient.passkey.listUserPasskeys();
	if (err)
		passkeyError =
			"パスキーの一覧を読み込めませんでした。ページを再読み込みしてください";
	else passkeys = data ?? [];
	passkeysLoaded = true;
}

async function addPasskey() {
	passkeyError = "";
	passkeyNotice = "";
	const result = await authClient.passkey.addPasskey({
		name: `パスキー ${passkeys.length + 1}`,
	});
	// ログインから時間が経っているときは、パスキーの画面を出す前に断られる。先に本人確認をする。
	// 本人確認と追加でパスキーの画面を 1 回のタップで続けて出すと、ブラウザによっては 2 回目が拒まれるので、追加はもう一度押してもらう
	if (isNotFresh(result?.error)) {
		if (await reauthenticate((message) => (passkeyError = message)))
			passkeyNotice =
				"本人確認ができました。もう一度「パスキーを追加」を押してください";
		return;
	}
	// 本人がパスキーの画面を閉じたときは、何も出さない
	if (result?.error && !isPasskeyCancelled(result.error)) {
		// 同じ端末に同じアカウントのパスキーは 2 つ作れない（その場合のメッセージは英語で返ってくる）
		passkeyError = /previously registered/i.test(result.error.message ?? "")
			? "この端末には、すでにパスキーが登録されています。別の端末や別のパスワードマネージャーで追加してください"
			: "パスキーを追加できませんでした。もう一度「パスキーを追加」を押してください";
	}
	await loadPasskeys();
}

async function deletePasskey(id: string) {
	if (passkeys.length <= 1) {
		passkeyError =
			"最後のパスキーは削除できません。先に別のパスキーを追加してください";
		return;
	}
	const ok = await confirmDialog?.ask({
		title: "パスキーを削除しますか？",
		message: "このパスキーでは、ログインできなくなります。",
		confirmLabel: "削除",
	});
	if (!ok) return;
	passkeyError = "";
	passkeyNotice = "";
	let { error: err } = await authClient.passkey.deletePasskey({ id });
	// ログインから時間が経っているときは、本人確認をしてから削除し直す
	if (isNotFresh(err)) {
		if (!(await reauthenticate((message) => (passkeyError = message))))
			return;
		({ error: err } = await authClient.passkey.deletePasskey({ id }));
	}
	if (err)
		passkeyError =
			"パスキーを削除できませんでした。時間をおいて、もう一度お試しください";
	await loadPasskeys();
}

// ---- 招待コード ----
type InviteItem = {
	id: number;
	createdAt: string;
	expiresAt: string | null;
	usedAt: string | null;
	usedByName: string | null;
};
let invites = $state<InviteItem[]>([]);
let invitesLoaded = $state(false);
let remaining = $state(0);
let limit = $state(3);
let inviteError = $state("");
let issued = $state<string | null>(null);
// コピー・共有の結果。読み上げにも伝わるよう role="status" に出す
let copyStatus = $state("");
// iPhone などでは、リンクを共有シートで渡せる
let canShare = $state(false);

// SQLite の日時は UTC の "YYYY-MM-DD HH:MM:SS"
const parseUtc = (value: string) => new Date(`${value.replace(" ", "T")}Z`);
const isExpired = (invite: InviteItem) =>
	!invite.usedAt &&
	!!invite.expiresAt &&
	parseUtc(invite.expiresAt) <= new Date();

async function loadInvites() {
	const res = await fetch("/api/invites").catch(() => null);
	invitesLoaded = true;
	if (!res?.ok) {
		inviteError =
			"招待コードの一覧を読み込めませんでした。ページを再読み込みしてください";
		return;
	}
	const data = (await res.json()) as {
		limit: number;
		remaining: number;
		invites: InviteItem[];
	};
	limit = data.limit;
	remaining = data.remaining;
	invites = data.invites;
}

async function issueInvite() {
	inviteError = "";
	copyStatus = "";
	const res = await fetch("/api/invites", { method: "POST" }).catch(
		() => null,
	);
	const data = (await res?.json().catch(() => null)) as {
		token?: string;
		message?: string;
	} | null;
	if (res?.ok && data?.token) issued = data.token;
	// 上限に達したとき（409）は、サーバーの日本語のメッセージをそのまま出す
	else if (res?.status === 409 && data?.message)
		inviteError = `${data.message}。未使用の招待を取り消すと、枠が戻ります`;
	else
		inviteError =
			"招待コードを発行できませんでした。時間をおいて、もう一度お試しください";
	await loadInvites();
}

// 発行したコードは、その場で 1 回しか見られない。リンクで渡せば入力の手間もない
const inviteLink = (token: string) =>
	`${window.location.origin}/login?invite=${token}`;

async function copy(text: string, done: string) {
	try {
		await navigator.clipboard.writeText(text);
		copyStatus = done;
	} catch {
		copyStatus = "コピーできませんでした。コードを長押しして選択してください";
	}
}

async function share(token: string) {
	try {
		await navigator.share({
			title: "NWU への招待",
			text: "NWU への招待リンクです（有効期限 7 日）",
			url: inviteLink(token),
		});
	} catch {
		// 共有シートを閉じただけのときも、ここに来る。何も出さない
	}
}

async function revokeInvite(id: number) {
	const ok = await confirmDialog?.ask({
		title: "招待を取り消しますか？",
		message: "このコードは使えなくなり、発行できる回数が 1 回戻ります。",
		confirmLabel: "取り消す",
	});
	if (!ok) return;
	inviteError = "";
	const res = await fetch(`/api/invites?id=${id}`, { method: "DELETE" }).catch(
		() => null,
	);
	if (!res?.ok)
		inviteError =
			"招待を取り消せませんでした。時間をおいて、もう一度お試しください";
	await loadInvites();
}

// ---- アカウントの削除 ----
let accountError = $state("");
let deleting = $state(false);

async function deleteAccount() {
	accountError = "";
	const ok = await confirmDialog?.ask({
		title: "アカウントを削除しますか？",
		message:
			"プロフィール、パスキー、未使用の招待コードが削除され、元に戻せません。続けると、本人確認のためにパスキーを使います。",
		confirmLabel: "削除",
	});
	if (!ok) return;
	deleting = true;
	try {
		// 取り消せない操作なので、セッションが新しくても、直前にパスキーで本人確認し直す
		if (!(await reauthenticate((message) => (accountError = message))))
			return;
		const { error: err } = await authClient.deleteUser();
		if (err) {
			accountError =
				"アカウントを削除できませんでした。時間をおいて、もう一度お試しください";
			return;
		}
		window.location.href = "/login";
	} finally {
		deleting = false;
	}
}

onMount(() => {
	canShare = typeof navigator.share === "function";
	loadPasskeys();
	loadInvites();
	pushState()
		.then((state) => (push = state))
		.catch(() => (push = "unsupported"));
});
</script>

<div class="grid">
  <!-- アイコン・名前・イメージカラー -->
  <section class="tile glass wide profile" class:editing aria-label="プロフィール">
    {#if !editing}
      <Avatar name={user.name} color={user.color} image={user.image} size={4.5} />
      <div class="who">
        <p class="name">{user.name}</p>
        <p class="code">{user.color}</p>
      </div>
      <button type="button" class="edit-btn" onclick={() => (editing = true)} aria-label="プロフィールを編集" title="編集">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="m14.5 7.5 3 3" /></svg>
      </button>
    {:else}
      <form class="edit" onsubmit={saveProfile}>
        <label>
          <span>名前</span>
          <input type="text" bind:value={nameInput} maxlength={NAME_MAX} autocomplete="nickname" required />
        </label>
        <label>
          <span>カラーコード</span>
          <div class="color-row">
            <input type="color" value={colorValid ? colorInput : "#000000"} oninput={(e) => (colorInput = e.currentTarget.value)} aria-label="色を選ぶ" />
            <input
              type="text"
              bind:value={colorInput}
              placeholder="#rrggbb"
              maxlength="7"
              spellcheck="false"
              autocapitalize="off"
              aria-invalid={!colorValid}
              aria-describedby={colorValid ? undefined : "color-error"}
            />
          </div>
        </label>
        <!-- 入力中に形式を確かめ、「保存」が押せない理由をその場で出す -->
        {#if !colorValid}
          <p id="color-error" class="field-error">「#ff8800」のように、# と 6 桁の英数字（0〜9、a〜f）で入力してください</p>
        {/if}
        <div class="row">
          <button type="button" class="btn" onclick={cancelEdit}>キャンセル</button>
          <button type="submit" class="btn primary" disabled={saving || !colorValid || !nameInput.trim()}>
            {saving ? "保存しています…" : "保存"}
          </button>
        </div>
        {#if profileError}
          <p role="alert" class="error">{profileError}</p>
        {/if}
      </form>
    {/if}
  </section>

  <!-- 新着動画の通知。使えない端末では出さない。iPhone はホーム画面に追加したアプリでだけ使える -->
  {#if push && push !== "unsupported"}
    <section class="tile glass wide" aria-labelledby="push-title">
      <h2 id="push-title">通知</h2>
      {#if push === "needs-install"}
        <p class="note last">ホーム画面に追加したアプリから、新着動画の通知を受け取れます。Safari の共有ボタンから「ホーム画面に追加」を選んでください。</p>
      {:else if push === "denied"}
        <p class="note last">通知が許可されていません。端末の「設定」で、NWU の通知を許可してください。</p>
      {:else}
        <label class="switch-row">
          <span class="item-name">新着動画の通知</span>
          <input type="checkbox" role="switch" class="switch" checked={push === "on"} aria-checked={push === "on"} disabled={pushBusy} onchange={togglePush} />
        </label>
      {/if}
      {#if pushError}
        <p role="alert" class="error">{pushError}</p>
      {/if}
    </section>
  {/if}

  <!-- パスキーは追加・削除できる -->
  <section class="tile glass wide" aria-labelledby="passkeys-title">
    <h2 id="passkeys-title">パスキー</h2>
    {#if !passkeysLoaded}
      <p class="status">読み込んでいます…</p>
    {:else}
      <ul class="items">
        {#each passkeys as passkey (passkey.id)}
          <li>
            <span class="item-name">{passkey.name ?? "(名前なし)"}</span>
            <small>{new Date(passkey.createdAt).toLocaleDateString("ja-JP")}</small>
            <button type="button" class="btn small" onclick={() => deletePasskey(passkey.id)} aria-label="{passkey.name ?? 'パスキー'} を削除">削除</button>
          </li>
        {/each}
      </ul>
    {/if}
    <button type="button" class="btn" onclick={addPasskey}>パスキーを追加</button>
    {#if passkeyNotice}
      <p class="copied" role="status">{passkeyNotice}</p>
    {/if}
    {#if passkeyError}
      <p role="alert" class="error">{passkeyError}</p>
    {/if}
  </section>

  <!-- 招待コード。1 人 limit 回まで -->
  <section class="tile glass wide" aria-labelledby="invites-title">
    <h2 id="invites-title">招待コード（あと {remaining} / {limit} 回）</h2>
    {#if issued}
      {@const code = issued}
      <div class="issued">
        <p class="token">{code}</p>
        <p class="note">このコードは今しか表示されません。ログイン画面の「初めての方」で入力するよう伝えてください（有効期限 7 日）。</p>
        <div class="row">
          {#if canShare}
            <button type="button" class="btn small" onclick={() => share(code)}>リンクを共有</button>
          {/if}
          <button type="button" class="btn small" onclick={() => copy(code, "コードをコピーしました")}>コードをコピー</button>
          <button type="button" class="btn small" onclick={() => copy(inviteLink(code), "リンクをコピーしました")}>リンクをコピー</button>
        </div>
        <p class="copied" role="status">{copyStatus}</p>
      </div>
    {/if}
    {#if !invitesLoaded}
      <p class="status">読み込んでいます…</p>
    {:else}
      <ul class="items">
        {#each invites as invite (invite.id)}
          <li>
            <span class="item-name">
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
    {/if}
    <button type="button" class="btn" onclick={issueInvite} disabled={remaining <= 0}>招待コードを発行</button>
    {#if inviteError}
      <p role="alert" class="error">{inviteError}</p>
    {/if}
  </section>

  <!-- 普段使う操作と分けるため、間隔を空けて一番下に置く -->
  <div class="wide account">
    <button type="button" class="tile glass btn logout" onclick={signOut}>ログアウト</button>
    <button type="button" class="delete-account" onclick={deleteAccount} disabled={deleting}>
      {deleting ? "削除しています…" : "アカウントを削除"}
    </button>
    {#if accountError}
      <p role="alert" class="error">{accountError}</p>
    {/if}
  </div>
</div>

<ConfirmDialog bind:this={confirmDialog} />

<style>
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

  /* セクションの見出し。本文より小さく薄くならないようにする */
  h2 {
    margin: 0 0 0.5rem;
    font: 600 0.9rem/1.3 system-ui, sans-serif;
    letter-spacing: 0.02em;
    opacity: 0.85;
  }

  .profile {
    position: relative;
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

  /* イメージカラーのカラーコード */
  .code {
    margin: 0.2rem 0 0;
    font: 500 0.8rem/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
    opacity: 0.8;
  }

  .status {
    margin: 0 0 0.8rem;
    font: 400 0.85rem/1.5 system-ui, sans-serif;
    opacity: 0.8;
  }

  .items {
    list-style: none;
    margin: 0 0 0.8rem;
    padding: 0;
    display: grid;
    gap: 0.25rem;
  }

  .items li {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.25rem 0.2rem;
    border-bottom: 1px solid rgb(255 255 255 / 0.12);
  }

  .item-name {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    font-weight: 600;
  }

  .items small {
    opacity: 0.8;
  }

  /* ガラスのボタン。タップできる高さは 44pt 以上（HIG） */
  .btn {
    min-height: 44px;
    padding: 0.55rem 1rem;
    border: 1px solid rgb(255 255 255 / 0.3);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.12);
    color: #fff;
    font: 600 0.9rem/1.2 system-ui, sans-serif;
    cursor: pointer;
  }

  .btn.primary {
    background: rgb(255 255 255 / 0.24);
  }

  .btn.small {
    min-width: 44px;
    padding: 0.35rem 0.85rem;
    font-size: 0.85rem;
  }

  .btn:active:not(:disabled) {
    background: rgb(255 255 255 / 0.22);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  /* ログアウトとアカウント削除。上のセクションから間隔を空ける */
  .account {
    display: grid;
    gap: 0.4rem;
    margin-top: 1rem;
  }

  .logout {
    padding: 0.9rem;
    color: #ff9a9a;
    border-radius: 1.1rem;
    /* 背景の絵柄と重なっても読めるよう、少し暗くする */
    background: rgb(20 20 20 / 0.5);
  }

  .delete-account {
    justify-self: center;
    min-height: 44px;
    padding: 0 1rem;
    border: 0;
    background: none;
    color: #ff9a9a;
    font: 500 0.85rem/1.2 system-ui, sans-serif;
    text-shadow: 0 1px 6px rgb(0 0 0 / 0.6);
    cursor: pointer;
  }

  .delete-account:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .note {
    margin: 0 0 0.6rem;
    font: 400 0.85rem/1.5 system-ui, sans-serif;
    opacity: 0.85;
  }

  .note.last {
    margin-bottom: 0;
  }

  .issued {
    margin-bottom: 0.8rem;
  }

  /* 通知のオン・オフ。行全体を押せるようにし、高さは 44pt 以上（HIG） */
  .switch-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-height: 44px;
    cursor: pointer;
  }

  /* iOS のスイッチの形。チェックボックスの見た目を置き換える */
  .switch {
    appearance: none;
    position: relative;
    flex: none;
    width: 51px;
    height: 31px;
    margin: 0;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.22);
    cursor: pointer;
    transition: background 0.2s;
  }

  .switch::before {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 27px;
    height: 27px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 2px 4px rgb(0 0 0 / 0.25);
    transition: translate 0.2s;
  }

  .switch:checked {
    background: #34c759;
  }

  .switch:checked::before {
    translate: 20px 0;
  }

  .switch:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .switch:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .switch,
    .switch::before {
      transition: none;
    }
  }

  .token {
    margin: 0 0 0.4rem;
    font: 700 1.15rem/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0.1em;
    overflow-wrap: anywhere;
    user-select: all; /* コピーできなかったとき、長押しで全体を選べるように */
  }

  .copied {
    min-height: 1.3em;
    margin: 0.4rem 0 0;
    font: 500 0.85rem/1.5 system-ui, sans-serif;
  }

  .row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .profile.editing {
    display: block;
  }

  /* 右上の鉛筆ボタン */
  .edit-btn {
    position: absolute;
    top: 0.5rem;
    right: 0.5rem;
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 1px solid rgb(255 255 255 / 0.3);
    border-radius: 999px;
    background: rgb(255 255 255 / 0.12);
    color: #fff;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .edit-btn:active {
    background: rgb(255 255 255 / 0.22);
  }

  .edit-btn svg {
    width: 1.2rem;
    height: 1.2rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .edit {
    display: grid;
    gap: 0.8rem;
  }

  .edit label {
    display: grid;
    gap: 0.35rem;
  }

  .edit label > span {
    font: 600 0.85rem/1.2 system-ui, sans-serif;
    opacity: 0.85;
  }

  .edit input[type="text"] {
    min-width: 0;
    min-height: 44px;
    box-sizing: border-box;
    padding: 0.55rem 0.8rem;
    border: 1px solid rgb(255 255 255 / 0.3);
    border-radius: 0.7rem;
    background: rgb(255 255 255 / 0.1);
    color: #fff;
    font: 500 1rem/1.2 system-ui, sans-serif;
  }

  .edit input[aria-invalid="true"] {
    border-color: #ff9a9a;
  }

  .color-row {
    display: flex;
    gap: 0.6rem;
  }

  .color-row input[type="text"] {
    flex: 1;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .color-row input[type="color"] {
    width: 44px;
    min-height: 44px;
    padding: 0;
    border: 1px solid rgb(255 255 255 / 0.3);
    border-radius: 0.7rem;
    background: none;
    cursor: pointer;
  }

  .field-error {
    margin: -0.4rem 0 0;
    color: #ffb3b3;
    font: 400 0.85rem/1.5 system-ui, sans-serif;
  }

  .error {
    margin: 0.6rem 0 0;
    color: #ffb3b3;
    font: 500 0.85rem/1.5 system-ui, sans-serif;
  }

  /* 「コントラストを上げる」設定のときは、薄い文字を白にする */
  @media (prefers-contrast: more) {
    h2,
    .code,
    .status,
    .items small,
    .note,
    .edit label > span {
      opacity: 1;
    }
  }
</style>
