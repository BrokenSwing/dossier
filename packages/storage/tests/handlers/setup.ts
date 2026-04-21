import { StorageAuth, InternalError } from "@dossier/shared";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { BlobStore } from "../../src/services/BlobStore.js";
import { TestSqlLayer, TEST_USER_ID } from "../setup.js";

/**
 * Fake StorageAuth middleware that always authenticates as TEST_USER_ID.
 * Bypasses JWT validation for handler tests.
 */
export const FakeStorageAuthLayer = Layer.succeed(
  StorageAuth,
  StorageAuth.of((_options) => Effect.succeed({ userId: TEST_USER_ID })),
);

/**
 * In-memory BlobStore for handler tests.
 */
export const FakeBlobStoreLayer = Layer.sync(BlobStore, () => {
  const store = new Map<string, Uint8Array>();
  return BlobStore.of({
    write: (key, data) =>
      Effect.sync(() => {
        store.set(key, data);
      }),
    readStream: (key) => {
      const data = store.get(key);
      if (!data) return Stream.fail(new InternalError({ message: `Blob not found: ${key}` }));
      return Stream.succeed(data);
    },
    delete: (key) =>
      Effect.sync(() => {
        store.delete(key);
      }),
  });
});

/**
 * Base layer for handler tests that don't need BlobStore.
 */
export const BaseHandlerLayer = Layer.mergeAll(FakeStorageAuthLayer, TestSqlLayer);

/**
 * Full layer for document handler tests (includes BlobStore).
 */
export const FullHandlerLayer = Layer.mergeAll(FakeStorageAuthLayer, FakeBlobStoreLayer, TestSqlLayer);
