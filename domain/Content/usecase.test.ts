import { describe, expect, test } from "bun:test";
import { newContentUsecase } from "./usecase.ts";

describe("newContentUsecase", () => {
  test("コマンドと Query をまとめて返す", () => {
    const uc = newContentUsecase({} as never, null, {} as never);
    expect(Object.keys(uc).sort()).toEqual(
      [
        "syncAll",
        "syncNew",
        "createPlaylist",
        "deletePlaylist",
        "watch",
        "unwatch",
        "listPlaylists",
        "getHomeFeed",
        "getBadgeCount",
        "countUnwatchedNew",
      ].sort(),
    );
  });
});
