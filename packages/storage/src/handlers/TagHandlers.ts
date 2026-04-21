import { StorageTagRpcs, StorageAuth, AuthContext, NotFoundError } from "@dossier/shared";
import * as Effect from "effect/Effect";

import * as TagSql from "../sql/TagSql.js";

export const tagHandlers = StorageTagRpcs.middleware(StorageAuth).toLayer({
  ListTags: () =>
    Effect.gen(function* () {
      const { userId } = yield* AuthContext;
      return yield* TagSql.listTagsWithCount(userId);
    }),
  DeleteTag: ({ tagId }) =>
    Effect.gen(function* () {
      const { userId } = yield* AuthContext;
      const count = yield* TagSql.deleteTag(tagId, userId);
      if (count === 0) {
        return yield* new NotFoundError({ message: "Tag not found" });
      }
    }),
});
