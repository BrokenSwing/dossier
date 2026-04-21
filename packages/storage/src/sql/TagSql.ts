import { InternalError, TagId, Tag, UserId } from "@dossier/shared";
import { SqlClient } from "@effect/sql/SqlClient";
import * as Effect from "effect/Effect";

const mapSqlError = (op: string) => (e: unknown) => new InternalError({ message: `${op} failed: ${String(e)}` });

export const listTagsWithCount = (userId: UserId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    const rows = yield* sql<{ id: string; name: string; document_count: number }>`
      SELECT t.id, t.name, COUNT(dt.document_id) AS document_count
      FROM tags t
      LEFT JOIN document_tags dt ON dt.tag_id = t.id
      WHERE t.user_id = ${userId}
      GROUP BY t.id
      ORDER BY t.name COLLATE NOCASE
    `.pipe(Effect.mapError(mapSqlError("listTagsWithCount")));
    return rows.map((r) => new Tag({ id: r.id as TagId, name: r.name, documentCount: r.document_count }));
  });

export const deleteTag = (tagId: TagId, userId: UserId) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient;
    // Verify ownership (tags belong to user)
    const tagRows = yield* sql<{ id: string }>`
      SELECT id FROM tags WHERE id = ${tagId} AND user_id = ${userId} LIMIT 1
    `.pipe(Effect.mapError(mapSqlError("deleteTag check")));
    if (!tagRows[0]) return 0 as const;

    yield* sql`
      DELETE FROM tags WHERE id = ${tagId} AND user_id = ${userId}
    `.pipe(Effect.mapError(mapSqlError("deleteTag")));
    return 1 as const;
  });
