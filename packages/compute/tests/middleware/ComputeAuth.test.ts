import { COMPUTE_SESSION_HEADER } from "@dossier/shared";
import * as Headers from "@effect/platform/Headers";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { extractSessionToken } from "../../src/middleware/ComputeAuth.js";

describe("extractSessionToken", () => {
  it.effect("returns the token when the header is present", () =>
    Effect.gen(function* () {
      const headers = Headers.fromInput({ [COMPUTE_SESSION_HEADER]: "my-token-123" });
      const token = yield* extractSessionToken(headers);
      expect(token).toBe("my-token-123");
    }),
  );

  it.effect("fails with InvalidSessionError when header is absent", () =>
    Effect.gen(function* () {
      const headers = Headers.fromInput({});
      const exit = yield* Effect.exit(extractSessionToken(headers));
      expect(exit._tag).toBe("Failure");
    }),
  );
});
