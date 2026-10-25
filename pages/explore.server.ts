import { defineHandler, defineHead, type InferProps } from "void";
import { asc, db } from "void/db";
import { playlists, podcasts, socialLinks } from "@schema";
import { isHttpUrl } from "../src/lib/url";

export type Props = InferProps<typeof loader>;

export const loader = defineHandler(async () => {
  // ログイン必須は middleware/01.auth.ts が保証する。表示順は position、同じなら登録順
  const [links, lists, shows] = await Promise.all([
    db.select().from(socialLinks).orderBy(asc(socialLinks.position), asc(socialLinks.id)),
    db.select().from(playlists).orderBy(asc(playlists.position), asc(playlists.id)),
    db.select().from(podcasts).orderBy(asc(podcasts.position), asc(podcasts.id)),
  ]);

  // href / src に埋め込む URL は http(s) のものだけ通す（javascript: などは表示しない）
  return {
    links: links.filter((row) => isHttpUrl(row.url)),
    playlists: lists.filter((row) => isHttpUrl(row.url) && isHttpUrl(row.thumbnail)),
    podcasts: shows.filter((row) => isHttpUrl(row.url) && isHttpUrl(row.artwork)),
  };
});

export const head = defineHead(() => ({ title: "Explore | NWU" }));
