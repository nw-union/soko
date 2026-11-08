import { defineHandler } from "void";
import { avatarResponse } from "../../../server/avatar-file.ts";

// アイコン画像の配信
export const GET = defineHandler(
  async (c) => (await avatarResponse(c.req.param("key"))) ?? c.notFound(),
);
