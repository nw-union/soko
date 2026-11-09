import { describe, expect, it } from "bun:test";
import type { YoutubeVideoItem } from "../type.ts";
import {
  extractHashtags,
  isDisplayable,
  parseEmbedAspectRatio,
  parseIsoDuration,
  toFetchedVideos,
} from "./youtube.ts";

// ----------------------------------------------------------------------------
// Test Data
// ----------------------------------------------------------------------------
const ytItem = (over: Partial<YoutubeVideoItem> = {}): YoutubeVideoItem => ({
  id: "aaaaaaaaaaa",
  title: "動画",
  description: "",
  publishedAt: "2026-11-01T00:00:00Z",
  liveBroadcastContent: "none",
  duration: "PT1M",
  embedHtml: '<iframe width="480" height="270"></iframe>',
  privacyStatus: "public",
  embeddable: true,
  ...over,
});

// ----------------------------------------------------------------------------
// Validater
// ----------------------------------------------------------------------------
describe("extractHashtags", () => {
  it("行頭か空白の後ろのハッシュタグを, 出た順に拾う", () => {
    expect(extractHashtags("#ゲーム 実況 #Live\n#music")).toEqual([
      "ゲーム",
      "Live",
      "music",
    ]);
  });

  it("URL の # や, 数字だけのものは拾わない", () => {
    expect(extractHashtags("https://youtu.be/x#t=10 #123 #a1")).toEqual(["a1"]);
  });

  it("大文字小文字だけが違うものは, 先に出た方にまとめる", () => {
    expect(extractHashtags("#Game #game #GAME")).toEqual(["Game"]);
  });
});

describe("parseIsoDuration", () => {
  it.each([
    ["PT1H2M3S", 3723],
    ["PT45S", 45],
    ["PT10M", 600],
    ["P0D", null],
    ["PT0S", null],
    ["P1DT1H", null],
  ])("%s → %p", (iso, expected) => {
    expect(parseIsoDuration(iso)).toBe(expected);
  });
});

describe("parseEmbedAspectRatio", () => {
  it.each([
    ['<iframe width="480" height="270">', 1.778],
    ['<iframe width="480" height="480">', 1],
    ['<iframe width="480" height="1500">', null],
    ['<iframe width="0" height="270">', null],
    [undefined, null],
  ])("%s → %p", (html, expected) => {
    expect(parseEmbedAspectRatio(html)).toBe(expected);
  });
});

describe("isDisplayable", () => {
  it("公開・限定公開で, 埋め込みでき, 配信中でない動画は表示する", () => {
    expect(isDisplayable(ytItem())).toBeTrue();
    expect(isDisplayable(ytItem({ privacyStatus: "unlisted" }))).toBeTrue();
  });

  it.each([
    ["非公開", { privacyStatus: "private" }],
    ["埋め込み不可", { embeddable: false }],
    ["ライブ中", { liveBroadcastContent: "live" }],
    ["配信予定", { liveBroadcastContent: "upcoming" }],
  ])("%s の動画は表示しない", (_, over) => {
    expect(isDisplayable(ytItem(over))).toBeFalse();
  });
});

describe("toFetchedVideos", () => {
  it("表示対象だけを, 長さ・縦横比・タグを読んだ形にする", () => {
    // Act:
    const actual = toFetchedVideos([
      ytItem({ id: "x", duration: "PT1H2M3S", description: "説明 #tag" }),
      ytItem({ id: "y", privacyStatus: "private" }),
    ]);

    // Assert:
    expect(actual).toEqual([
      {
        youtubeId: "x",
        title: "動画",
        description: "説明 #tag",
        durationSeconds: 3723,
        aspectRatio: 1.778,
        publishedAt: "2026-11-01T00:00:00Z",
        tags: ["tag"],
      },
    ]);
  });
});
