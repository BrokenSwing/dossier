import { STORAGE_SESSION_HEADER } from "@dossier/shared";
import * as Effect from "effect/Effect";

import { CryptoError, deriveAuthKey, deriveKek, deriveMasterKey, unwrapDek } from "../lib/crypto.js";
import { StorageRpc } from "../lib/rpc.js";
import { buildUnlockedSession, type LockedSession, sessionAtom, unlockSession } from "../session.js";

export const loginAtom = StorageRpc.runtime.fn<{ username: string; password: string; totpCode: string }>()(({ username, password, totpCode }, _get) =>
  Effect.gen(function* () {
    const client = yield* StorageRpc;
    const { kdfParams } = yield* client("GetKdfParams", { username });
    const masterKey = yield* deriveMasterKey(password, kdfParams);
    const kek = yield* deriveKek(masterKey);
    const authKey = yield* deriveAuthKey(masterKey);
    const { sessionToken, encryptedDek, dekIv } = yield* client("Login", { username, authKey, totpCode });
    const dek = yield* unwrapDek(encryptedDek, dekIv, kek).pipe(Effect.mapError(() => new CryptoError({ message: "Incorrect password." })));
    return buildUnlockedSession(sessionToken, dek, username, encryptedDek, dekIv, kdfParams);
  }),
);

export const unlockAtom = StorageRpc.runtime.fn<{ password: string }>()(({ password }, get) =>
  Effect.gen(function* () {
    const raw = get(sessionAtom);
    const session = yield* raw._tag === "Locked"
      ? Effect.succeed(raw as LockedSession)
      : Effect.fail(new CryptoError({ message: "No locked session." }));
    const masterKey = yield* deriveMasterKey(password, session.kdfParams);
    const kek = yield* deriveKek(masterKey);
    const dek = yield* unwrapDek(session.encryptedDek, session.dekIv, kek).pipe(
      Effect.mapError(() => new CryptoError({ message: "Incorrect password." })),
    );
    const client = yield* StorageRpc;
    yield* client("ValidateSession", undefined, {
      headers: { [STORAGE_SESSION_HEADER]: session.token },
    });
    return unlockSession(session, dek);
  }),
);
