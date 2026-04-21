import { describe, expect, it, layer } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { UserId } from "@dossier/shared"
import { TEST_USER, TEST_USER_ID, TestSqlLayer } from "../setup.js"
import * as UserSql from "../../src/sql/UserSql.js"

const UserSeedLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* UserSql.insertUser(TEST_USER)
    yield* UserSql.setTotpConfirmed(TEST_USER.id)
  }),
).pipe(Layer.provide(TestSqlLayer))

const UserTestLayer = Layer.merge(TestSqlLayer, UserSeedLayer)

layer(UserTestLayer)("UserSql", (it) => {
  describe("findByUsername", () => {
    it.effect("returns Some for an existing user", () =>
      Effect.gen(function* () {
        const result = yield* UserSql.findByUsername(TEST_USER.username)
        expect(Option.isSome(result)).toBe(true)
        if (Option.isSome(result)) {
          expect(result.value.id).toBe(TEST_USER.id)
          expect(result.value.username).toBe(TEST_USER.username)
        }
      }),
    )

    it.effect("lookup is case-insensitive", () =>
      Effect.gen(function* () {
        const result = yield* UserSql.findByUsername(TEST_USER.username.toUpperCase())
        expect(Option.isSome(result)).toBe(true)
      }),
    )

    it.effect("returns None for an unknown username", () =>
      Effect.gen(function* () {
        const result = yield* UserSql.findByUsername("nobody_here")
        expect(Option.isNone(result)).toBe(true)
      }),
    )
  })

  describe("findById", () => {
    it.effect("returns Some for an existing user", () =>
      Effect.gen(function* () {
        const result = yield* UserSql.findById(TEST_USER_ID)
        expect(Option.isSome(result)).toBe(true)
      }),
    )

    it.effect("returns None for an unknown id", () =>
      Effect.gen(function* () {
        const result = yield* UserSql.findById("no-such-id" as UserId)
        expect(Option.isNone(result)).toBe(true)
      }),
    )
  })

  describe("setTotpConfirmed", () => {
    it.effect("marks totp_confirmed = 1", () =>
      Effect.gen(function* () {
        const user = yield* UserSql.findById(TEST_USER_ID)
        expect(Option.isSome(user)).toBe(true)
        if (Option.isSome(user)) {
          expect(user.value.totp_confirmed).toBe(1)
        }
      }),
    )
  })

  describe("insertSession / revokeAllSessions", () => {
    it.effect("inserts a session and revokes it", () =>
      Effect.gen(function* () {
        yield* UserSql.insertSession({
          id: "sess-revoke-test",
          user_id: TEST_USER.id,
          expires_at: "2099-01-01T00:00:00Z",
        })
        yield* UserSql.revokeAllSessions(TEST_USER.id)
      }),
    )
  })

  describe("updateEncryptedDek", () => {
    it.effect("updates dek fields without error", () =>
      Effect.gen(function* () {
        yield* UserSql.updateEncryptedDek(TEST_USER.id, "new-dek", "new-iv")
        const user = yield* UserSql.findById(TEST_USER_ID)
        expect(Option.isSome(user)).toBe(true)
        if (Option.isSome(user)) {
          expect(user.value.encrypted_dek).toBe("new-dek")
          expect(user.value.dek_iv).toBe("new-iv")
        }
      }),
    )
  })
})
