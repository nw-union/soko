import { defineHandler } from "void";
import { container } from "../../../server/container.ts";
import { avatarResponse } from "../../../server/http/avatar-file.ts";
import { errorResponse } from "../../../server/http/error.ts";

// アイコン画像の配信
export const GET = defineHandler((c) =>
  container()
    .memberQueries.getAvatarFile({ key: c.req.param("key") })
    .match(avatarResponse, (e) => errorResponse(c, e)),
);
