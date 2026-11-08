<script lang="ts">
import { useShared } from "@void/svelte";
import Avatar from "./Avatar.svelte";
import ConfirmDialog from "./ConfirmDialog.svelte";
import { authClient, isPasskeyCancelled } from "./auth-client";
import {
	AVATAR_SIZE,
	isHexColor,
	NAME_MAX,
} from "../../domain/Member/profile/rule.ts";
import {
	disablePush,
	enablePush,
	type PushState,
	pushState,
} from "./push";
import { swipeToClose } from "./swipe-to-close";

// アプリのページはログイン必須（middleware/01.auth.ts）なので、user は必ずある
const user = useShared().auth.user;
if (!user) throw new Error("ログインしていません");

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
	window.location.href = "/login";
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

// ---- アイコン画像 ----
let avatarBusy = $state(false);
let avatarError = $state("");

// 中央を正方形に切り抜いて AVATAR_SIZE に縮小し、WebP にする（iPhone の大きな写真でも小さく、形式も揃う）
async function toSquare(file: File): Promise<Blob> {
	const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
	const side = Math.min(bitmap.width, bitmap.height);
	const size = Math.min(side, AVATAR_SIZE);
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) throw new Error("canvas");
	ctx.drawImage(
		bitmap,
		(bitmap.width - side) / 2,
		(bitmap.height - side) / 2,
		side,
		side,
		0,
		0,
		size,
		size,
	);
	bitmap.close();
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, "image/webp", 0.85),
	);
	if (!blob) throw new Error("toBlob");
	return blob;
}

async function pickAvatar(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	input.value = ""; // 同じ画像をもう一度選べるように
	if (!file) return;
	avatarError = "";
	avatarBusy = true;
	try {
		let blob: Blob;
		try {
			blob = await toSquare(file);
		} catch {
			avatarError = "この画像は読み込めませんでした。JPEG や PNG の画像を選んでください";
			return;
		}
		const body = new FormData();
		body.set("file", blob, "avatar");
		const res = await fetch("/api/avatar", { method: "POST", body }).catch(() => null);
		if (!res?.ok) {
			const data = (await res?.json().catch(() => null)) as { message?: string } | null;
			avatarError =
				res && res.status < 500 && data?.message
					? data.message
					: "画像をアップロードできませんでした。時間をおいて、もう一度お試しください";
			return;
		}
		window.location.reload();
	} finally {
		avatarBusy = false;
	}
}

async function removeAvatar() {
	const ok = await confirmDialog?.ask({
		title: "アイコン画像を削除しますか？",
		message: "名前の頭文字のアイコンに戻ります。",
		confirmLabel: "削除",
	});
	if (!ok) return;
	avatarError = "";
	avatarBusy = true;
	const res = await fetch("/api/avatar", { method: "DELETE" }).catch(() => null);
	if (res?.ok) {
		window.location.reload();
		return;
	}
	avatarBusy = false;
	avatarError = "画像を削除できませんでした。時間をおいて、もう一度お試しください";
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
		inviteError = `${data.message}。未使用の招待を無効にすると、枠が戻ります`;
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
			title: "Soko への招待",
			text: "Soko への招待リンクです（有効期限 7 日）",
			url: inviteLink(token),
		});
	} catch {
		// 共有シートを閉じただけのときも、ここに来る。何も出さない
	}
}

async function revokeInvite(id: number) {
	const ok = await confirmDialog?.ask({
		title: "招待を無効にしますか？",
		message: "このコードは使えなくなり、発行できる回数が 1 回戻ります。",
		confirmLabel: "招待を無効にする",
	});
	if (!ok) return;
	inviteError = "";
	const res = await fetch(`/api/invites?id=${id}`, { method: "DELETE" }).catch(
		() => null,
	);
	if (!res?.ok)
		inviteError =
			"招待を無効にできませんでした。時間をおいて、もう一度お試しください";
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


// ---- 下からせり上がるシート ----
// 再生画面（pages/index.svelte）と同じ作り。開いたときに一度だけ、パスキー・招待・通知の状態を読み込む
let dialog = $state<HTMLDialogElement>();
let loaded = false;

export function open() {
	dialog?.showModal();
	if (loaded) return;
	loaded = true;
	canShare = typeof navigator.share === "function";
	loadPasskeys();
	loadInvites();
	pushState()
		.then((state) => (push = state))
		.catch(() => (push = "unsupported"));
}

// 閉じるときは、画面の下へ滑らせて消してから dialog を閉じる（CSS の .closing と同じ長さ）
const CLOSE_MS = 320;
let closing = $state(false);

// 編集中に名前か色を変えているか（アイコン画像は選んだ時点で保存されるので対象外）
const dirty = $derived(
	editing &&
		(nameInput !== user.name ||
			colorInput.toLowerCase() !== user.color.toLowerCase()),
);

let confirming = false;

const close = async () => {
	if (!dialog?.open || closing || confirming) return;
	// 保存していない変更があるときだけ、捨てていいか確かめる
	if (dirty) {
		confirming = true;
		const discard = await confirmDialog?.ask({
			title: "変更を破棄しますか？",
			message: "保存していない変更は失われます",
			confirmLabel: "変更を破棄",
			cancelLabel: "編集を続ける",
		});
		confirming = false;
		if (!discard) return;
	}
	if (!dialog?.open || closing) return;
	if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
		dialog.close();
		return;
	}
	closing = true;
	setTimeout(() => dialog?.close(), CLOSE_MS);
};

const closed = () => {
	closing = false;
	dragY = 0;
	if (editing) cancelEdit();
};

const cancel = (e: Event) => {
	e.preventDefault();
	close();
};

// 上の帯を下へスワイプして閉じる
const SWIPE_CLOSE = 100;
let dragY = $state(0);
let dragStart: number | null = null;

const dragDown = (e: PointerEvent) => {
	if ((e.target as Element).closest("button")) return;
	dragStart = e.clientY;
	(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
};

const dragMove = (e: PointerEvent) => {
	if (dragStart !== null) dragY = Math.max(0, e.clientY - dragStart);
};

const dragEnd = () => {
	if (dragStart === null) return;
	dragStart = null;
	if (dragY > SWIPE_CLOSE) close();
	dragY = 0;
};

// 本文でも、いちばん上までスクロールした状態で下へスワイプしたら閉じる
const bodySwipe = {
	enabled: () => !closing && !confirming,
	onstart: (startY: number) => {
		dragStart = startY;
	},
	onmove: (distance: number) => {
		dragY = distance;
	},
	onend: dragEnd,
};
</script>

<dialog
  bind:this={dialog}
  class="sheet"
  aria-label="プロフィール"
  class:dragging={dragY > 0}
  class:closing
  style:translate={dragY > 0 && !closing ? `0 ${dragY}px` : undefined}
  oncancel={cancel}
  onclose={closed}
>
<div
  class="top"
  onpointerdown={dragDown}
  onpointermove={dragMove}
  onpointerup={dragEnd}
  onpointercancel={dragEnd}
>
  <span class="grabber" aria-hidden="true"></span>
  <button type="button" class="close" aria-label="閉じる" onclick={close}>
    <svg class="x" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>
  </button>
</div>
<div class="body" use:swipeToClose={bodySwipe}>
<div class="grid">
  <!-- アイコン・名前・イメージカラー -->
  <section class="tile wide profile" class:editing aria-label="プロフィール">
    {#if !editing}
      <Avatar name={user.name} color={user.color} image={user.image} size={4.5} />
      <div class="who">
        <p class="name">{user.name}</p>
        <p class="code"><span class="swatch" style:background={user.color} aria-hidden="true"></span>イメージカラー</p>
      </div>
      <button type="button" class="edit-btn" onclick={() => (editing = true)} aria-label="プロフィールを編集" title="編集">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="m14.5 7.5 3 3" /></svg>
      </button>
    {:else}
      <form class="edit" onsubmit={saveProfile}>
        <div class="avatar-edit">
          <Avatar name={user.name} color={user.color} image={user.image} size={4.5} />
          <div class="avatar-actions">
            <label class="btn small" class:disabled={avatarBusy}>
              {avatarBusy ? "送信しています…" : "画像を選ぶ"}
              <input type="file" accept="image/*" class="file" disabled={avatarBusy} onchange={pickAvatar} />
            </label>
            {#if user.image}
              <button type="button" class="btn small" disabled={avatarBusy} onclick={removeAvatar}>画像を削除</button>
            {/if}
          </div>
        </div>
        {#if avatarError}
          <p role="alert" class="error avatar-error">{avatarError}</p>
        {/if}
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
    <section class="tile wide" aria-labelledby="push-title">
      <h2 id="push-title">通知</h2>
      {#if push === "needs-install"}
        <p class="note last">ホーム画面に追加したアプリから、新着動画の通知を受け取れます。Safari の共有ボタンから「ホーム画面に追加」を選んでください。</p>
      {:else if push === "denied"}
        <p class="note last">通知が許可されていません。端末の「設定」で、Soko の通知を許可してください。</p>
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
  <section class="tile wide" aria-labelledby="passkeys-title">
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
  <section class="tile wide" aria-labelledby="invites-title">
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
              <button type="button" class="btn small" onclick={() => revokeInvite(invite.id)}>無効にする</button>
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
    <button type="button" class="tile btn logout" onclick={signOut}>ログアウト</button>
    <button type="button" class="delete-account" onclick={deleteAccount} disabled={deleting}>
      {deleting ? "削除しています…" : "アカウントを削除"}
    </button>
    {#if accountError}
      <p role="alert" class="error">{accountError}</p>
    {/if}
  </div>
</div>
</div>
</dialog>

<ConfirmDialog bind:this={confirmDialog} />

<style>
  .sheet {
    --ease: cubic-bezier(0.32, 0.72, 0, 1);
    /* 上に残す隙間。ステータスバーの分だけ空け、奥のトップページを暗くして見せる */
    --gap: env(safe-area-inset-top);
    position: fixed;
    inset: var(--gap) 0 0;
    box-sizing: border-box;
    width: 100%;
    max-width: none;
    height: calc(100dvh - var(--gap));
    max-height: none;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 1.4rem 1.4rem 0 0;
    overflow: hidden;
    /* 手前に出る面なので、奥のトップページの色味（#2c3939）のまま暗くした色にする。黒まで落とさない */
    background: #1a2423;
    color: #f5f5f7;
    transition: translate 260ms var(--ease);
  }

  /* ホーム画面から開いたとき（PWA）も、画面の下端まで覆う（Stage.svelte の .stage と同じ） */
  @media (display-mode: standalone) {
    .sheet {
      bottom: auto;
      height: calc(100lvh - var(--gap));
    }
  }

  .sheet[open] {
    display: flex;
    flex-direction: column;
    animation: rise 480ms var(--ease);
  }

  .sheet.dragging {
    transition: none;
  }

  .sheet.closing {
    translate: 0 100%;
    transition: translate 320ms var(--ease);
  }

  @keyframes rise {
    from {
      translate: 0 100%;
    }
  }

  .sheet::backdrop {
    background: rgb(0 0 0 / 0.5);
  }

  .top {
    position: relative;
    flex: none;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    padding: 0.5rem calc(env(safe-area-inset-right) + 0.5rem) 0.5rem
      calc(env(safe-area-inset-left) + 0.5rem);
    touch-action: none;
    cursor: grab;
  }

  .grabber {
    position: absolute;
    top: 0.4rem;
    left: 50%;
    width: 2.25rem;
    height: 0.3rem;
    translate: -50% 0;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.3);
  }

  .close {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }

  .x {
    box-sizing: border-box;
    width: 32px;
    height: 32px;
    padding: 8px;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.14);
    fill: none;
    stroke: #f5f5f7;
    stroke-width: 2.5;
    stroke-linecap: round;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.5rem calc(env(safe-area-inset-right) + 1.25rem) calc(env(safe-area-inset-bottom) + 2.5rem)
      calc(env(safe-area-inset-left) + 1.25rem);
  }

  .grid {
    width: min(100%, 800px);
    margin: 0 auto;
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
    /* 背景より一段明るくして、階層を見せる */
    background: rgb(255 255 255 / 0.07);
    border: 1px solid rgb(255 255 255 / 0.08);
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
  .swatch {
    flex: none;
    width: 0.8rem;
    height: 0.8rem;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.5);
  }

  .code {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 0.2rem 0 0;
    font: 500 0.8rem/1.3 system-ui, sans-serif;
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

  .logout:active:not(:disabled) {
    background: rgb(255 255 255 / 0.14);
  }

  .logout {
    padding: 0.9rem;
    color: #ff9a9a;
    border-radius: 1.1rem;
    background: rgb(255 255 255 / 0.07);
    border-color: rgb(255 255 255 / 0.08);
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

  .avatar-edit {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .avatar-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  /* label を btn の見た目にしているので、中身を中央に寄せる。ファイル選択の本体は見えなくする（キーボードでは操作できる） */
  label.btn {
    position: relative;
    display: inline-grid;
    place-items: center;
  }

  label.btn.disabled {
    opacity: 0.5;
  }

  label.btn:has(.file:focus-visible) {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }

  .file {
    position: absolute;
    inset: 0;
    width: 100%;
    opacity: 0;
    cursor: pointer;
  }

  .avatar-error {
    margin-top: -0.4rem;
  }

  .error {
    margin: 0.6rem 0 0;
    color: #ffb3b3;
    font: 500 0.85rem/1.5 system-ui, sans-serif;
  }

  /* 「コントラストを上げる」設定のときは、薄い文字を白にする */
  @media (prefers-contrast: more) {
    .tile,
    .logout {
      border-color: rgb(255 255 255 / 0.4);
    }

    h2,
    .code,
    .status,
    .items small,
    .note,
    .edit label > span {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet[open] {
      animation: none;
    }

    .sheet {
      transition: none;
    }
  }
</style>
