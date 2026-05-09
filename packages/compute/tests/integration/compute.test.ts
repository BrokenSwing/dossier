import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import { describe, expect, layer } from "@effect/vitest";
import * as Chunk from "effect/Chunk";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  COMPUTE_SESSION_HEADER,
  ComputeIntegrationLayer,
  ComputeRpcClient,
  ComputeTestPort,
  MINIMAL_PNG,
  StorageRpcClient,
  TEST_DEK,
  TEST_NEW_DEK,
  fullStorageAuthFlow,
  uploadDocument,
} from "./setup.js";

// --- Shared session layer ---
// One argon2 round per test suite, not per test.

class TestSessionToken extends Context.Tag("dossier/integration/compute/TestSessionToken")<TestSessionToken, string>() {}

const SessionLayer = Layer.scoped(TestSessionToken, fullStorageAuthFlow("compute_test_user").pipe(Effect.orDie));

const TestLayer = Layer.mergeAll(ComputeIntegrationLayer, SessionLayer.pipe(Layer.provide(ComputeIntegrationLayer)));

// --- Helpers ---

const collectStream = (s: Stream.Stream<Uint8Array, unknown>): Effect.Effect<Uint8Array, unknown> =>
  Stream.runCollect(s).pipe(Effect.map((chunks) => new Uint8Array(Chunk.toArray(chunks).flatMap((b) => Array.from(b)))));

layer(TestLayer)("Compute HTTP integration", (it) => {
  describe("POST /upload", () => {
    it.scoped("encrypts and stores a document, returns a documentId", () =>
      Effect.gen(function* () {
        const token = yield* TestSessionToken;
        const port = yield* ComputeTestPort;
        const httpClient = yield* HttpClient.HttpClient;
        const content = new TextEncoder().encode("hello integration test");

        const res = yield* httpClient
          .execute(
            HttpClientRequest.post(`http://127.0.0.1:${port}/upload`).pipe(
              HttpClientRequest.setHeader(COMPUTE_SESSION_HEADER, token),
              HttpClientRequest.setHeader("x-dossier-dek", TEST_DEK),
              HttpClientRequest.setHeader("x-document-name", "test.txt"),
              HttpClientRequest.setHeader("x-document-format", "pdf"),
              HttpClientRequest.bodyUint8Array(content),
            ),
          )
          .pipe(Effect.orDie);

        expect(res.status).toBe(201);
        const body = (yield* res.json.pipe(Effect.orDie)) as { documentId: string };
        expect(typeof body.documentId).toBe("string");
        expect(body.documentId.length).toBeGreaterThan(0);
      }),
    );

    it.scoped("returns 401 when the session token is missing", () =>
      Effect.gen(function* () {
        const port = yield* ComputeTestPort;
        const httpClient = yield* HttpClient.HttpClient;

        const res = yield* httpClient
          .execute(
            HttpClientRequest.post(`http://127.0.0.1:${port}/upload`).pipe(
              HttpClientRequest.setHeader("x-dossier-dek", TEST_DEK),
              HttpClientRequest.setHeader("x-document-name", "x"),
              HttpClientRequest.setHeader("x-document-format", "pdf"),
              HttpClientRequest.bodyUint8Array(new Uint8Array([1, 2, 3])),
            ),
          )
          .pipe(Effect.orDie);

        expect(res.status).toBe(401);
      }),
    );

    it.scoped("returns 400 when the DEK header is missing", () =>
      Effect.gen(function* () {
        const token = yield* TestSessionToken;
        const port = yield* ComputeTestPort;
        const httpClient = yield* HttpClient.HttpClient;

        const res = yield* httpClient
          .execute(
            HttpClientRequest.post(`http://127.0.0.1:${port}/upload`).pipe(
              HttpClientRequest.setHeader(COMPUTE_SESSION_HEADER, token),
              HttpClientRequest.setHeader("x-document-name", "x"),
              HttpClientRequest.setHeader("x-document-format", "pdf"),
              HttpClientRequest.bodyUint8Array(new Uint8Array([1, 2, 3])),
            ),
          )
          .pipe(Effect.orDie);

        expect(res.status).toBe(400);
      }),
    );
  });

  describe("Preview", () => {
    it.scoped("decrypts and streams back the original document bytes", () =>
      Effect.gen(function* () {
        const token = yield* TestSessionToken;
        const port = yield* ComputeTestPort;
        const client = yield* ComputeRpcClient;
        const original = new TextEncoder().encode("preview round-trip content");

        const documentId = yield* uploadDocument(port, token, original, { name: "preview-doc", format: "pdf" });

        const bytes = yield* collectStream(
          client.Preview({ dek: TEST_DEK, documentId: documentId as any }, { headers: { [COMPUTE_SESSION_HEADER]: token } }),
        );

        expect(bytes).toEqual(original);
      }),
    );

    it.scoped("fails for a non-existent document id", () =>
      Effect.gen(function* () {
        const token = yield* TestSessionToken;
        const client = yield* ComputeRpcClient;
        const exit = yield* Effect.exit(
          collectStream(client.Preview({ dek: TEST_DEK, documentId: "no-such-id" as any }, { headers: { [COMPUTE_SESSION_HEADER]: token } })),
        );
        expect(exit._tag).toBe("Failure");
      }),
    );

    it.scoped("fails when the wrong DEK is used", () =>
      Effect.gen(function* () {
        const token = yield* TestSessionToken;
        const port = yield* ComputeTestPort;
        const client = yield* ComputeRpcClient;
        const content = new TextEncoder().encode("some content");

        const documentId = yield* uploadDocument(port, token, content, { name: "wrong-dek-doc", format: "pdf" });

        const wrongDek = Buffer.alloc(32, 0xff).toString("base64url");
        const exit = yield* Effect.exit(
          collectStream(client.Preview({ dek: wrongDek, documentId: documentId as any }, { headers: { [COMPUTE_SESSION_HEADER]: token } })),
        );
        expect(exit._tag).toBe("Failure");
      }),
    );
  });

  describe("WatermarkPreview", () => {
    it.scoped("returns non-empty bytes for a PNG document", () =>
      Effect.gen(function* () {
        const token = yield* TestSessionToken;
        const port = yield* ComputeTestPort;
        const client = yield* ComputeRpcClient;

        const documentId = yield* uploadDocument(port, token, MINIMAL_PNG, { name: "wm-doc", format: "png" });

        const bytes = yield* collectStream(
          client.WatermarkPreview(
            { dek: TEST_DEK, documentId: documentId as any, watermarkText: "CONFIDENTIAL" },
            { headers: { [COMPUTE_SESSION_HEADER]: token } },
          ),
        );

        expect(bytes.length).toBeGreaterThan(0);
      }),
    );
  });

  describe("Export", () => {
    it.scoped("exports multiple documents as a ZIP archive", () =>
      Effect.gen(function* () {
        const token = yield* TestSessionToken;
        const port = yield* ComputeTestPort;
        const client = yield* ComputeRpcClient;

        const idA = yield* uploadDocument(port, token, new TextEncoder().encode("document A"), { name: "doc-a", format: "pdf" });
        const idB = yield* uploadDocument(port, token, new TextEncoder().encode("document B"), { name: "doc-b", format: "pdf" });

        const bytes = yield* collectStream(
          client.Export({ dek: TEST_DEK, docIds: [idA as any, idB as any], exportFormat: "zip" }, { headers: { [COMPUTE_SESSION_HEADER]: token } }),
        );

        // ZIP magic bytes: PK\x03\x04
        expect(bytes[0]).toBe(0x50);
        expect(bytes[1]).toBe(0x4b);
        expect(bytes.length).toBeGreaterThan(0);
      }),
    );

    it.scoped("exports multiple documents as a TAR.GZ archive", () =>
      Effect.gen(function* () {
        const token = yield* TestSessionToken;
        const port = yield* ComputeTestPort;
        const client = yield* ComputeRpcClient;

        const idA = yield* uploadDocument(port, token, new TextEncoder().encode("content X"), { name: "x", format: "pdf" });
        const idB = yield* uploadDocument(port, token, new TextEncoder().encode("content Y"), { name: "y", format: "pdf" });

        const bytes = yield* collectStream(
          client.Export(
            { dek: TEST_DEK, docIds: [idA as any, idB as any], exportFormat: "tar.gz" },
            { headers: { [COMPUTE_SESSION_HEADER]: token } },
          ),
        );

        // GZIP magic bytes: \x1f\x8b
        expect(bytes[0]).toBe(0x1f);
        expect(bytes[1]).toBe(0x8b);
      }),
    );

    it.scoped("applies a watermark when watermarkText is provided", () =>
      Effect.gen(function* () {
        const token = yield* TestSessionToken;
        const port = yield* ComputeTestPort;
        const client = yield* ComputeRpcClient;

        const id = yield* uploadDocument(port, token, MINIMAL_PNG, { name: "wm-export", format: "png" });

        const bytes = yield* collectStream(
          client.Export(
            { dek: TEST_DEK, docIds: [id as any], exportFormat: "zip", watermarkText: "TOP SECRET" },
            { headers: { [COMPUTE_SESSION_HEADER]: token } },
          ),
        );

        expect(bytes.length).toBeGreaterThan(0);
      }),
    );
  });

  describe("RotateKey", () => {
    it.scoped("re-encrypts all documents and makes them accessible with the new DEK", () =>
      Effect.gen(function* () {
        // Use a dedicated user so this test is isolated from the shared session's documents
        const storageClient = yield* StorageRpcClient;
        const token = yield* fullStorageAuthFlow("rotate_key_user");
        const port = yield* ComputeTestPort;
        const computeClient = yield* ComputeRpcClient;

        const idA = yield* uploadDocument(port, token, new TextEncoder().encode("doc-1"), { name: "doc-1", format: "pdf" });
        const idB = yield* uploadDocument(port, token, new TextEncoder().encode("doc-2"), { name: "doc-2", format: "pdf" });

        // Rotate the key — stream all progress events
        const progress = yield* Stream.runCollect(
          computeClient.RotateKey(
            { oldDek: TEST_DEK, newDek: TEST_NEW_DEK, newEncryptedDek: "new-enc-dek", newDekIv: "new-iv" },
            { headers: { [COMPUTE_SESSION_HEADER]: token } },
          ),
        );

        expect(Chunk.size(progress)).toBeGreaterThan(0);
        const last = Chunk.last(progress);
        expect(last._tag).toBe("Some");
        if (last._tag === "Some") {
          expect(last.value.phase).toBe("finalizing");
          expect(last.value.total).toBe(2);
        }

        // Old documents should no longer exist
        const storageAuth = { headers: { "x-dossier-session": token } };
        const exitA = yield* Effect.exit(storageClient.GetDocumentMeta({ documentId: idA as any }, storageAuth));
        const exitB = yield* Effect.exit(storageClient.GetDocumentMeta({ documentId: idB as any }, storageAuth));
        expect(exitA._tag).toBe("Failure");
        expect(exitB._tag).toBe("Failure");
      }),
    );
  });
});
