import * as Effect from "effect/Effect";

import { deriveAuthKey, deriveKek, deriveMasterKey, generateDek, generateKdfParams, wrapDek } from "../lib/crypto.js";
import { StorageRpc } from "../lib/rpc.js";

export const registerAtom = StorageRpc.runtime.fn<{ username: string; password: string }>()(
  ({ username, password }, _get) =>
    Effect.gen(function* () {
      const kdfParams = generateKdfParams();
      const masterKey = yield* deriveMasterKey(password, kdfParams);
      const kek = yield* deriveKek(masterKey);
      const authKey = yield* deriveAuthKey(masterKey);
      const dek = generateDek();
      const { encryptedDek, dekIv } = yield* wrapDek(dek, kek);
      const client = yield* StorageRpc;
      const { totpUri } = yield* client("Register", { username, authKey, kdfParams, encryptedDek, dekIv });
      return { totpUri, username };
    }),
);

export const confirmTotpAtom = StorageRpc.mutation("ConfirmTotp");
