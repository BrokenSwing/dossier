# Integration tests

Integration tests spin up a real storage server (SQLite in-memory, temp blob dir) and exercise it via the same RPC client the production client uses. They live in `tests/integration/`.

## How it works

`setup.ts` exports `StorageIntegrationLayer`, a self-contained Effect layer that:

1. Finds a free TCP port.
2. Creates a temp directory for blobs.
3. Builds `StorageServerLayer` with test config (in-memory DB, temp blob dir, fixed JWT secret).
4. Tears everything down when the test suite scope closes.

It also exposes two context tags:

- `TestPort` — the port the server is listening on (needed for raw HTTP calls like blob upload).
- `StorageRpcClient` — a ready-to-use RPC client pointed at the test server.

## Writing a new test file

```ts
import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { StorageIntegrationLayer, StorageRpcClient, fullAuthFlow } from "./setup.js";

layer(StorageIntegrationLayer)("My feature", (it) => {
  it.scoped("does something", () =>
    Effect.gen(function* () {
      const client = yield* StorageRpcClient;
      const token = yield* fullAuthFlow("my_test_user");
      const auth = { headers: { [STORAGE_SESSION_HEADER]: token } };

      const result = yield* client.SomeRpc({ ... }, auth);
      expect(result.field).toBe("expected");
    }),
  );
});
```

`layer()` builds `StorageIntegrationLayer` once for the whole describe block (in `beforeAll`) and tears it down in `afterAll`. Each `it.scoped` test gets its own Effect scope.

## Sharing a session across tests

Running a full auth flow (argon2 key derivation) on every test is slow. Hoist it into a layer:

```ts
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

class TestToken extends Context.Tag("my/TestToken")<TestToken, string>() {}

const SessionLayer = Layer.scoped(TestToken, fullAuthFlow("shared_user").pipe(Effect.orDie));

const MyTestLayer = Layer.mergeAll(StorageIntegrationLayer, SessionLayer.pipe(Layer.provide(StorageIntegrationLayer)));

layer(MyTestLayer)("My feature", (it) => {
  it.scoped("uses the shared session", () =>
    Effect.gen(function* () {
      const token = yield* TestToken;
      // ...
    }),
  );
});
```

## Raw HTTP calls (e.g. blob upload)

Some endpoints are not RPCs. Use `TestPort` to build the URL:

```ts
import { TestPort } from "./setup.js";

it.scoped("uploads a blob", () =>
  Effect.gen(function* () {
    const port = yield* TestPort;
    const res = yield* Effect.promise(() =>
      fetch(`http://127.0.0.1:${port}/blobs/${blobKey}`, {
        method: "PUT",
        headers: { [STORAGE_SESSION_HEADER]: token },
        body: payload,
      }),
    );
    expect(res.status).toBe(204);
  }),
);
```

## User isolation

Each test file (or describe block) should use a distinct username so tests don't share database state. The DB is in-memory and shared for the lifetime of the layer, so name collisions between tests will cause failures.

## Running the tests

```sh
pnpm test
```

Integration tests run alongside unit tests. The server starts and stops automatically.
