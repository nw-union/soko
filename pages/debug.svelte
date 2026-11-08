<script lang="ts">
  import { useRouter } from "@void/svelte";
  import type { Props } from "./debug.server";

  let { playlists }: Props = $props();

  const router = useRouter();

  type Target = "sync-all" | "sync-new";

  const buttons: { target: Target; label: string; note: string }[] = [
    {
      target: "sync-all",
      label: "syncAll を実行",
      note: "全件の同期. 完了後に新着を通知する",
    },
    {
      target: "sync-new",
      label: "syncNew を実行",
      note: "差分の同期. 動画が増えたら新着を通知する",
    },
  ];

  let pending = $state<Target | null>(null);
  let result = $state<{ target: Target; ok: boolean; body: string } | null>(null);

  async function run(target: Target) {
    pending = target;
    result = null;
    try {
      const res = await fetch(`/api/debug/${target}`, { method: "POST" });
      const json = await res.json().catch(() => null);
      result = { target, ok: res.ok, body: JSON.stringify(json, null, 2) };
    } catch (e) {
      result = { target, ok: false, body: String(e) };
    } finally {
      pending = null;
    }
  }

  // ---- プレイリストの管理 ----
  let newId = $state("");
  let playlistError = $state("");
  let busy = $state(false);

  async function call(url: string, method: string, body?: unknown) {
    busy = true;
    playlistError = "";
    try {
      const res = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        playlistError = json?.message ?? `失敗しました (${res.status})`;
        return false;
      }
      router.refresh();
      return true;
    } catch (e) {
      playlistError = String(e);
      return false;
    } finally {
      busy = false;
    }
  }

  async function add() {
    if (await call("/api/debug/playlists", "POST", { playlistId: newId.trim() }))
      newId = "";
  }

  async function remove(id: number, playlistId: string) {
    if (!confirm(`プレイリスト ${playlistId} を削除しますか?`)) return;
    await call(`/api/debug/playlists/${id}`, "DELETE");
  }
</script>

<h1>Debug</h1>

<h2>プレイリスト</h2>
<p class="note">
  同期の対象. 削除したプレイリストにしか入っていない動画は、次の全件の同期で消える
</p>

<ul>
  {#each playlists as list (list.id)}
    <li>
      <code>{list.playlistId}</code>
      {#if list.name}<span>{list.name}</span>{/if}
      <button type="button" disabled={busy} onclick={() => remove(list.id, list.playlistId)}>
        削除
      </button>
    </li>
  {:else}
    <li><span>登録されていません</span></li>
  {/each}
  <li>
    <input bind:value={newId} disabled={busy} placeholder="プレイリスト ID (PL…)" aria-label="追加するプレイリスト ID" />
    <button type="button" disabled={busy || newId.trim() === ""} onclick={add}>追加</button>
  </li>
</ul>
{#if playlistError}<p class="error" role="alert">{playlistError}</p>{/if}

<h2>同期</h2>

<ul>
  {#each buttons as b (b.target)}
    <li>
      <button type="button" disabled={pending !== null} onclick={() => run(b.target)}>
        {pending === b.target ? "実行中…" : b.label}
      </button>
      <span>{b.note}</span>
    </li>
  {/each}
</ul>

{#if result}
  <h2>{result.target}: {result.ok ? "成功" : "失敗"}</h2>
  <pre>{result.body}</pre>
{/if}

<style>
  ul {
    list-style: none;
    padding: 0;
    display: grid;
    gap: 0.75rem;
  }
  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }
  span,
  .note {
    opacity: 0.7;
    font-size: 0.875rem;
  }
  .error {
    color: #ff8a8a;
  }
  pre {
    overflow-x: auto;
    padding: 0.75rem;
    border-radius: 0.5rem;
    background: rgb(0 0 0 / 0.3);
  }
</style>
