<script lang="ts">
// 取り消せない操作の前に出す確認ダイアログ。ブラウザ標準の confirm() は「OK」になってしまうので、
// 押すと何が起きるかをボタン名に書けるよう自前で出す（HIG: ボタン名は結果を表す動詞にする）。
// bind:this で受け取り、const ok = await dialog.ask({ ... }) のように使う
let dialog = $state<HTMLDialogElement>();
let title = $state("");
let message = $state("");
let confirmLabel = $state("");
let resolve: ((ok: boolean) => void) | null = null;

export function ask(options: {
	title: string;
	message: string;
	confirmLabel: string;
}): Promise<boolean> {
	title = options.title;
	message = options.message;
	confirmLabel = options.confirmLabel;
	dialog?.showModal();
	return new Promise((r) => {
		resolve = r;
	});
}

// Esc や背景のタップで閉じたときも「キャンセル」として返す
const finish = (ok: boolean) => {
	resolve?.(ok);
	resolve = null;
	if (dialog?.open) dialog.close();
};
</script>

<!-- biome-ignore lint/a11y/useKeyWithClickEvents: キーボードでは dialog 標準の Esc で閉じられる -->
<dialog
  bind:this={dialog}
  class="confirm"
  aria-labelledby="confirm-title"
  aria-describedby="confirm-message"
  onclose={() => finish(false)}
  onclick={(e) => e.target === dialog && finish(false)}
>
  <h2 id="confirm-title">{title}</h2>
  <p id="confirm-message">{message}</p>
  <!-- キャンセルを左（先）、実行を右に置く。誤って Return で実行しないよう、最初の選択はキャンセル -->
  <div class="actions">
    <button type="button" class="cancel" autofocus onclick={() => finish(false)}>キャンセル</button>
    <button type="button" class="destructive" onclick={() => finish(true)}>{confirmLabel}</button>
  </div>
</dialog>

<style>
  .confirm {
    box-sizing: border-box;
    width: min(100vw - 2.5rem, 20rem);
    padding: 1.25rem 1.25rem 1rem;
    border: 1px solid rgb(255 255 255 / 0.18);
    border-radius: 1.25rem;
    background: #2a2a2e;
    color: #fff;
    box-shadow: 0 24px 64px rgb(0 0 0 / 0.6);
    text-align: center;
  }

  .confirm::backdrop {
    background: rgb(20 20 28 / 0.55);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }

  h2 {
    margin: 0 0 0.5rem;
    font: 600 1.05rem/1.35 system-ui, sans-serif;
  }

  p {
    margin: 0 0 1.1rem;
    font: 400 0.9rem/1.5 system-ui, sans-serif;
    color: rgb(255 255 255 / 0.85);
  }

  .actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
  }

  button {
    min-height: 44px;
    padding: 0 1rem;
    border: 0;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.14);
    color: #fff;
    font: 600 0.95rem/1.2 system-ui, sans-serif;
    cursor: pointer;
  }

  button:active {
    background: rgb(255 255 255 / 0.24);
  }

  /* 削除など、取り消せない操作は赤 */
  .destructive {
    color: #ff8a8a;
  }

  @media (prefers-reduced-transparency: reduce) {
    .confirm::backdrop {
      background: rgb(20 20 28 / 0.88);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }
  }

  @media (prefers-contrast: more) {
    p {
      color: #fff;
    }
  }
</style>
