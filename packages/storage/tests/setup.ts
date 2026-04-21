import { fileURLToPath } from "node:url";

import { UserId } from "@dossier/shared";
import { NodeContext } from "@effect/platform-node";
import { FileSystem } from "@effect/platform/FileSystem";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { SqlClient } from "@effect/sql/SqlClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

const migrationPath = fileURLToPath(new URL("../migrations/001_initial.sql", import.meta.url));

// Base in-memory SQLite layer
const sqlBaseLayer = SqliteClient.layer({ filename: ":memory:" });

// Migration layer: reads SQL file via FileSystem, runs each statement individually.
// sql.unsafe() uses db.prepare() which only handles one statement at a time,
// so we split the file on ';' and run each statement individually.
const migrationLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem;
    const sql = yield* SqlClient;
    const migrationSql = yield* fileSystem.readFileString(migrationPath);
    const statements = migrationSql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    yield* Effect.forEach(statements, (stmt) => sql.unsafe(stmt), { discard: true });
  }),
).pipe(Layer.provide(Layer.merge(sqlBaseLayer, NodeContext.layer)));

// TestSqlLayer: provides SqlClient with migrations applied
export const TestSqlLayer = Layer.merge(sqlBaseLayer, migrationLayer);

// Minimal user fixture — sufficient for FK constraints.
export const TEST_USER = {
  id: "user-fixture-001",
  username: "fixture_user_001",
  password_hash: "fake-argon2-hash",
  totp_secret: "JBSWY3DPEHPK3PXP",
  encrypted_dek: "fake-encrypted-dek",
  dek_iv: "fake-dek-iv",
  kdf_params: JSON.stringify({ memory: 65536, iterations: 3, parallelism: 4, salt: "abc" }),
} as const;

export const TEST_USER_ID = TEST_USER.id as UserId;
