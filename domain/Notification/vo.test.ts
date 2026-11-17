import { describe, expect, it } from "bun:test";
import { isPushEndpoint } from "./vo.ts";

const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";

// ----------------------------------------------------------------------------
// isPushEndpoint
// ----------------------------------------------------------------------------
describe("isPushEndpoint", () => {
  it.each([
    ["FCM", ENDPOINT, true],
    ["Apple のサブドメイン", "https://web.push.apple.com/x", true],
    ["http", "http://fcm.googleapis.com/x", false],
    ["似た名前の別のホスト", "https://evilfcm.googleapis.com.example/x", false],
    ["許可していないホスト", "https://example.com/x", false],
  ])("%s", (_, url, expected) => {
    expect(isPushEndpoint(url)).toBe(expected);
  });
});
