import { defineSeed } from "void/seed";

// サンプルの動画。差し替えて使う（title は YouTube の oEmbed から取得し、失敗したら ID を使う。長さは秒）
const SAMPLE_VIDEOS = [
  { id: "dQw4w9WgXcQ", durationSeconds: 213 },
  { id: "9bZkp7q19f0", durationSeconds: 252 },
  { id: "kJQP7kiw5Fk", durationSeconds: 282 },
];

async function fetchTitle(youtubeId: string): Promise<string> {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${youtubeId}`)}`;
    const res = await fetch(url);
    if (res.ok) return ((await res.json()) as { title: string }).title;
  } catch {}
  return youtubeId;
}

export default defineSeed<typeof import("./schema")>(async ({ db, schema }) => {
  const rows = await Promise.all(
    SAMPLE_VIDEOS.map(async ({ id: youtubeId, durationSeconds }, position) => ({
      youtubeId,
      title: await fetchTitle(youtubeId),
      durationSeconds,
      position,
    })),
  );
  await db.insert(schema.videos).values(rows);

  // Explore ページのサンプル。自分のものに差し替えて使う
  await db.insert(schema.socialLinks).values([
    { label: "Discord", url: "https://discord.com/", icon: "discord", position: 0 },
    { label: "YouTube", url: "https://www.youtube.com/", icon: "youtube", position: 1 },
    { label: "note", url: "https://note.com/", icon: "note", position: 2 },
    { label: "GitHub", url: "https://github.com/", icon: "github", position: 3 },
    { label: "BASE", url: "https://thebase.in/", icon: "base", position: 4 },
  ]);
  await db.insert(schema.playlists).values({
    title: "Popular Music Videos",
    author: "Music",
    url: "https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI",
    thumbnail: "https://i.ytimg.com/vi/fOT0BUpITw8/mqdefault.jpg",
    position: 0,
  });
  await db.insert(schema.podcasts).values({
    title: "Rebuild",
    author: "Tatsuhiko Miyagawa",
    url: "https://podcasts.apple.com/jp/podcast/rebuild/id603013428",
    artwork:
      "https://is1-ssl.mzstatic.com/image/thumb/Podcasts125/v4/d6/20/fe/d620fea4-8f14-8402-1041-0388a31720e6/mza_1949949944137970976.jpg/300x300bb.jpg",
    position: 0,
  });
});
