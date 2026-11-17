import { defineHandler } from "void";
import { container } from "../../../server/container.ts";
import { avatarResponse } from "../../../server/http/avatar-file.ts";
import { respond } from "../../../server/http/error.ts";

// アイコン画像の配信
export const GET = defineHandler((c) =>
  respond(
    c,
    container().memberUsecase.getAvatarFile({ key: c.req.param("key") }),
    avatarResponse,
  ),
);
