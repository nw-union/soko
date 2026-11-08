<samp>
<p align="center">
  <img src="public/icons/icon-192.png" alt="soko" width="96" height="96">
</p>

<h1 align="center">Soko</h1>

<!-- Badge -->
<p align="center">
<a href="https://github.com/nw-union/soko/actions/workflows/void-deploy.yml"><img alt="GitHub Actions Workflow Status" src="https://img.shields.io/github/actions/workflow/status/nw-union/soko/void-deploy.yml?style=flat-square&logo=github&label=deploy"></a>
<a href="https://discord.com/channels/805068364476973076/1281497540830822473"><img alt="Discord" src="https://img.shields.io/discord/805068364476973076?style=flat-square"></a>
</p>

<!-- About this Project -->
<p align="center">
NWU の創作を「置く」場所
</p>
<br />

## 🎬 Promotion

[![Soko のプロモーション動画](https://img.youtube.com/vi/t9O2A_r-nzo/maxresdefault.jpg)](https://youtu.be/t9O2A_r-nzo)

<br />

## 🌏 URL

| Name       | URL                      |
| :--------- | :----------------------- |
| Production | https://soko.nw-union.net |
| Local      | http://localhost:5173    |

<br />

## 🎫 Event Storming

![Event Storming](./event_storming.drawio.svg)

<br />

## 🔄 WorkFlows

Web 層（`pages/`・`routes/`・`crons/`・`auth.ts`）は、`schema/service.ts` の WorkFlows だけを呼ぶ。実装は `domain/<Context>/` 以下の `workflow.ts`。コンテキスト（イベストの集約）は Content・Member・Notification の 3 つで、`container()` の `contentWorkFlows`・`memberWorkFlows`・`notificationWorkFlows` から呼ぶ。全 25 本。

### Member / Invite（招待）

| WorkFlow | 内容 |
| :-- | :-- |
| `listInvites` | 自分が発行した招待の一覧と、あと何回発行できるか |
| `issueInvite` | 招待を発行する。上限なら ConflictError。トークンはここで 1 回だけ返す |
| `revokeInvite` | 未使用の招待を取り消す（枠が戻る）。使用済み・他人の招待・存在しない ID は何もしない |
| `startInvite` | 登録の入口。トークンが今使えるか確かめ、正規化したトークンを返す |
| `claimInvite` | 登録（ユーザー作成）の直前に招待を使用済みにする。同時に使っても成功は 1 回だけ |
| `linkInvitedUser` | 登録の直後に、使用済みにした招待へ作られたユーザーを結び付ける |

### Member / Profile（プロフィール）

| WorkFlow | 内容 |
| :-- | :-- |
| `validateProfileUpdate` | プロフィール更新の入力を確かめる。名前は前後の空白を除く |
| `validateSignUp` | 登録の入力を確かめる。メールは使い捨てのものだけ |
| `getDisplayUser` | 画面に出すユーザー（表示に必要な最小限） |
| `hasPasskey` | パスキーを作ったか。未作成なら /welcome から出さない |
| `changeAvatar` | アイコン画像を差し替える。古い画像は消す（消せなくても成功） |
| `removeAvatar` | アイコン画像を外して、頭文字の表示に戻す |
| `cleanupDeletedUser` | 退会後の後始末（画像・未使用の招待・通知の購読・視聴記録） |
| `checkPasskeyDeletion` | パスキーを削除してよいか確かめる。ログインし直した直後でなければ Forbidden、最後の 1 つなら ValidationError |

### Content（動画の同期・ホーム・視聴記録）

| WorkFlow | 内容 |
| :-- | :-- |
| `syncAll` | 全件の同期。全動画を取り直して反映し、紐付けを作り直す。どのプレイリストにもない動画は消す。YouTube から先にすべて取得し、1 つでも失敗したら DB は変えない |
| `syncNew` | 差分の同期。プレイリストに増えた動画だけを足す。更新・並び替え・削除はしない |
| `getHomeFeed` | ホームに並べる動画（New の候補・ランダム・プレイリストごと） |
| `watch` | 視聴を記録する。登録済みの動画だけ。何度送っても 1 件 |
| `unwatch` | 視聴記録を消して未視聴に戻す |
| `getBadgeCount` | アイコンのバッジに出す、未視聴の New の本数 |
| `countUnwatchedNew` | ユーザーごとの未視聴の New の本数（通知のバッジ用） |

### Notification（プッシュ通知）

| WorkFlow | 内容 |
| :-- | :-- |
| `getPublicKey` | 購読用の VAPID 公開鍵を取得。鍵がなければ null |
| `subscribe` | 購読を保存する。1 人 10 件まで（超えたら古いものから削除） |
| `unsubscribe` | 購読を消す（通知オフ・ログアウト時） |
| `notifyNew` | 未通知の動画を通知済みにして、最近のものを全購読者に 1 通で知らせる。差分の同期で動画が増えたとき、ポリシー（`server/policy.ts`）が呼ぶ。全件の同期の cron も取りこぼしを拾うために呼ぶ |

<br/>
<br/>

--

Happy hacking 💛
</samp>

