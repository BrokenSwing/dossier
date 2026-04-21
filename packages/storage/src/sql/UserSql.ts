import { SqlClient } from "@effect/sql/SqlClient"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { InternalError, UserId } from "@dossier/shared"

export interface UserRow {
  id: string
  username: string
  password_hash: string
  totp_secret: string
  totp_confirmed: number
  encrypted_dek: string
  dek_iv: string
  kdf_params: string
}

export interface SessionRow {
  id: string
  user_id: string
  expires_at: string
}

const mapSqlError = (op: string) => (e: unknown) =>
  new InternalError({ message: `${op} failed: ${String(e)}` })

export const findByUsername = (username: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient
    const rows = yield* sql<UserRow>`
      SELECT id, username, password_hash, totp_secret, totp_confirmed,
             encrypted_dek, dek_iv, kdf_params
      FROM users
      WHERE username = ${username} COLLATE NOCASE
      LIMIT 1`.pipe(Effect.mapError(mapSqlError("findByUsername")))
    const first = rows[0]
    return Option.fromNullable(first)
  })

export const findById = (userId: UserId) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient
    const rows = yield* sql<UserRow>`
      SELECT id, username, password_hash, totp_secret, totp_confirmed,
             encrypted_dek, dek_iv, kdf_params
      FROM users
      WHERE id = ${userId}
      LIMIT 1`.pipe(Effect.mapError(mapSqlError("findById")))
    const first = rows[0]
    return Option.fromNullable(first)
  })

export const insertUser = (row: {
  id: string
  username: string
  password_hash: string
  totp_secret: string
  encrypted_dek: string
  dek_iv: string
  kdf_params: string
}) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient
    yield* sql`
      INSERT INTO users (id, username, password_hash, totp_secret, totp_confirmed,
                         encrypted_dek, dek_iv, kdf_params)
      VALUES (${row.id}, ${row.username}, ${row.password_hash}, ${row.totp_secret}, 0,
              ${row.encrypted_dek}, ${row.dek_iv}, ${row.kdf_params})
    `.pipe(Effect.mapError(mapSqlError("insertUser")))
  })

export const setTotpConfirmed = (userId: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient
    yield* sql`
      UPDATE users SET totp_confirmed = 1 WHERE id = ${userId}
    `.pipe(Effect.mapError(mapSqlError("setTotpConfirmed")))
  })

export const insertSession = (row: {
  id: string
  user_id: string
  expires_at: string
}) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient
    yield* sql`
      INSERT INTO sessions (id, user_id, expires_at)
      VALUES (${row.id}, ${row.user_id}, ${row.expires_at})
    `.pipe(Effect.mapError(mapSqlError("insertSession")))
  })

export const updateUser = (userId: string, patch: {
  password_hash: string
  kdf_params: string
  encrypted_dek: string
  dek_iv: string
}) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient
    yield* sql`
      UPDATE users
      SET password_hash = ${patch.password_hash},
          kdf_params    = ${patch.kdf_params},
          encrypted_dek = ${patch.encrypted_dek},
          dek_iv        = ${patch.dek_iv}
      WHERE id = ${userId}
    `.pipe(Effect.mapError(mapSqlError("updateUser")))
  })

export const revokeAllSessions = (userId: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient
    yield* sql`
      UPDATE sessions
      SET revoked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
      WHERE user_id = ${userId}
    `.pipe(Effect.mapError(mapSqlError("revokeAllSessions")))
  })

export const updateEncryptedDek = (userId: string, encryptedDek: string, dekIv: string) =>
  Effect.gen(function*() {
    const sql = yield* SqlClient
    yield* sql`
      UPDATE users SET encrypted_dek = ${encryptedDek}, dek_iv = ${dekIv}
      WHERE id = ${userId}
    `.pipe(Effect.mapError(mapSqlError("updateEncryptedDek")))
  })
