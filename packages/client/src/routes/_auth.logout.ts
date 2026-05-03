import { STORAGE_SESSION_HEADER } from "@dossier/shared";
import * as Effect from "effect/Effect";

import { StorageRpc } from "../lib/rpc.js";
import { sessionAtom } from "../session.js";

export const logoutAtom = StorageRpc.runtime.fn<void>()(
  (_arg, get) =>
    Effect.gen(function* () {
      const session = get(sessionAtom);
      if (session._tag !== "Unlocked") return;
      const client = yield* StorageRpc;
      yield* client("Logout", undefined, { headers: { [STORAGE_SESSION_HEADER]: session.token } });
    }),
);
