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
    SAMPLE_VIDEOS.map(async ({ id: youtubeId, durationSeconds }) => ({
      youtubeId,
      title: await fetchTitle(youtubeId),
      durationSeconds,
    })),
  );
  await db.insert(schema.videos).values(rows);
});
