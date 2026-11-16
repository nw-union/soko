// 同期の計画（全件の同期・差分の同期で, 何を足し, 何を消すか）
import type {
  FetchedVideo,
  Link,
  Playlist,
  PlaylistInfo,
  StaleLinks,
  StoredVideoId,
} from "../type.ts";

// ----------------------------------------------------------------------------
// Domain Logic (全件の同期)
// ----------------------------------------------------------------------------
/**
 * 名前・説明を YouTube に合わせるプレイリスト.
 * YouTube を正として上書きする. YouTube から返ってこなかったもの (削除・非公開など) は, 今の値を残す
 */
export const playlistsToRename = (
  lists: readonly Playlist[],
  infos: ReadonlyMap<string, PlaylistInfo>,
): { id: number; info: PlaylistInfo }[] =>
  lists.flatMap((list) => {
    const info = infos.get(list.playlistId);
    if (!info) return [];
    if (info.title === list.name && info.description === list.description)
      return [];
    return [{ id: list.id, info }];
  });

/**
 * 紐付けを作り直す計画. 表示対象として取得できた動画だけを, プレイリストの順に結ぶ.
 * 同じ動画が 1 つのプレイリストに 2 回あっても, 最初の 1 回だけにする (並びは詰める)
 *
 * @param idsByList - プレイリスト (DB の ID) ごとの, YouTube 上の順の動画 ID
 * @param stored - 保存されている動画 (取り込んだ後)
 * @param fetchedIds - 表示対象として取得できた動画の YouTube ID
 * @param current - 今の紐付け
 * @returns stale: プレイリストから外れた (または表示対象でなくなった) 動画. links: あるべき紐付け
 */
export const planFullLinks = (
  lists: readonly Playlist[],
  idsByList: ReadonlyMap<number, readonly string[]>,
  stored: readonly StoredVideoId[],
  fetchedIds: ReadonlySet<string>,
  current: readonly Link[],
): { stale: StaleLinks[]; links: Link[] } => {
  const rowId = new Map(stored.map((row) => [row.youtubeId, row.id]));
  const stale: StaleLinks[] = [];
  const links: Link[] = [];
  for (const list of lists) {
    const wanted = new Map<number, number>(); // videoId → position
    for (const youtubeId of idsByList.get(list.id) ?? []) {
      const videoId = rowId.get(youtubeId);
      if (
        videoId !== undefined &&
        fetchedIds.has(youtubeId) &&
        !wanted.has(videoId)
      )
        wanted.set(videoId, wanted.size);
    }
    const staleIds = current
      .filter(
        (link) => link.playlistId === list.id && !wanted.has(link.videoId),
      )
      .map((link) => link.videoId);
    if (staleIds.length > 0)
      stale.push({ playlistId: list.id, videoIds: staleIds });
    for (const [videoId, position] of wanted)
      links.push({ playlistId: list.id, videoId, position });
  }
  return { stale, links };
};

/**
 * どのプレイリストにも入っていない動画を消してよいか.
 * 取得結果が空のときは, API の異常で全部消すことのないよう消さない
 */
export const canRemoveOrphans = (fetched: readonly FetchedVideo[]): boolean =>
  fetched.length > 0;

// ----------------------------------------------------------------------------
// Domain Logic (差分の同期)
// ----------------------------------------------------------------------------
/**
 * DB にない動画の YouTube ID (重複なし). 詳細を引くのはこれだけ
 */
export const unknownVideoIds = (
  idsByList: ReadonlyMap<number, readonly string[]>,
  stored: readonly StoredVideoId[],
): string[] => {
  const known = new Set(stored.map((row) => row.youtubeId));
  return [...new Set([...idsByList.values()].flat())].filter(
    (youtubeId) => !known.has(youtubeId),
  );
};

/**
 * 足りない紐付け. 新しい動画のほか, 既にある動画が別のプレイリストに入ったときも.
 * 既にある紐付けの並び替えはしない (全件の同期が直す). 並びは YouTube 上の位置のまま
 *
 * @param stored - 保存されている動画 (取り込んだ後)
 * @param current - 今の紐付け
 */
export const planNewLinks = (
  lists: readonly Playlist[],
  idsByList: ReadonlyMap<number, readonly string[]>,
  stored: readonly StoredVideoId[],
  current: readonly Pick<Link, "playlistId" | "videoId">[],
): Link[] => {
  const rowId = new Map(stored.map((row) => [row.youtubeId, row.id]));
  const linked = new Set(current.map((l) => `${l.playlistId}:${l.videoId}`));
  const links: Link[] = [];
  for (const list of lists) {
    (idsByList.get(list.id) ?? []).forEach((youtubeId, position) => {
      const videoId = rowId.get(youtubeId);
      const key = `${list.id}:${videoId}`;
      if (videoId === undefined || linked.has(key)) return;
      linked.add(key);
      links.push({ playlistId: list.id, videoId, position });
    });
  }
  return links;
};
