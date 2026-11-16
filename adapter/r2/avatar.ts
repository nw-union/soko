import { ResultAsync } from "neverthrow";
import type { storage } from "void/storage";
import type { AvatarStoragePort } from "../../domain/Member/profile/port.ts";
import type { AvatarKey } from "../../domain/Member/profile/vo.ts";
import { newStorageError } from "../../domain/shared/error.ts";

type Storage = typeof storage;

// アイコン画像の R2 のキー
const avatarObjectKey = (key: AvatarKey) => `avatars/${key}`;

export const newAvatarStorage = (s: Storage): AvatarStoragePort => ({
  putAvatar: (key, file) =>
    ResultAsync.fromPromise(
      s.put(avatarObjectKey(key), file.bytes, {
        httpMetadata: { contentType: file.contentType },
      }),
      (e) => newStorageError("アイコン画像を保存できませんでした", e),
    ).map(() => undefined),

  deleteAvatar: (key) =>
    ResultAsync.fromPromise(s.delete(avatarObjectKey(key)), (e) =>
      newStorageError("アイコン画像を削除できませんでした", e),
    ),

  getAvatar: (key) =>
    ResultAsync.fromPromise(s.get(avatarObjectKey(key)), (e) =>
      newStorageError("アイコン画像を読めませんでした", e),
    ).map((object) =>
      object
        ? {
            type: "AvatarFile" as const,
            body: object.body,
            contentType: object.httpMetadata?.contentType ?? null,
            etag: object.httpEtag,
          }
        : null,
    ),
});
