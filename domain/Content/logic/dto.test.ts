import { describe, expect, it } from "bun:test";
import type { StoredVideo } from "../type.ts";
import { convToVideoItemDto, formatPublishedAt } from "./dto.ts";

// ----------------------------------------------------------------------------
// Test Data
// ----------------------------------------------------------------------------
const video = (id: number, over: Partial<StoredVideo> = {}): StoredVideo => ({
  type: "StoredVideo",
  id,
  youtubeId: `video${String(id).padStart(6, "0")}`,
  title: `動画 ${id}`,
  description: null,
  durationSeconds: null,
  aspectRatio: null,
  publishedAt: "2026-09-01T00:00:00Z",
  tags: [],
  ...over,
});

// ----------------------------------------------------------------------------
// Converter
// ----------------------------------------------------------------------------
describe("formatPublishedAt", () => {
  it("日本時間の日付にする (UTC では前の日でも)", () => {
    expect(formatPublishedAt("2026-10-28T15:00:00Z")).toBe("2026.10.29");
  });

  it.each([
    ["ない", null],
    ["読めない", "x"],
  ])("%s場合, null にする", (_, iso) => {
    expect(formatPublishedAt(iso)).toBeNull();
  });
});

describe("convToVideoItemDto", () => {
  it("長さ・縦横比・概要欄がない動画は, 既定の値にする", () => {
    // Act:
    const actual = convToVideoItemDto(video(1), false);

    // Assert:
    expect(actual).toMatchObject({
      duration: null,
      aspectRatio: 16 / 9,
      description: "",
    });
  });

  it("長さと URL を組み立てる", () => {
    // Act:
    const actual = convToVideoItemDto(
      video(1, { youtubeId: "dQw4w9WgXcQ", durationSeconds: 3723 }),
      true,
    );

    // Assert:
    expect(actual).toMatchObject({
      duration: "1:02:03",
      watched: true,
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
    });
  });
});
