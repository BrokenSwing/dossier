import { COMPUTE_SESSION_HEADER, STORAGE_SESSION_HEADER } from "@dossier/shared";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { describe, expect } from "vitest";

import { UploadError, uploadBlob, uploadDocument } from "../../src/lib/rpc.js";

// Build a fake HttpClient that returns a fixed Response and captures the last request.
const makeFakeHttpClient = (response: Response) =>
  Effect.gen(function* () {
    const captured = yield* Ref.make<HttpClientRequest.HttpClientRequest | null>(null);
    const client = HttpClient.make((req) => Effect.flatMap(Ref.set(captured, req), () => Effect.succeed(HttpClientResponse.fromWeb(req, response))));
    return { layer: Layer.succeed(HttpClient.HttpClient, client), captured };
  });

// ---- uploadBlob ----

describe("uploadBlob", () => {
  it.effect("sends PUT to /blobs/:blobKey with correct headers and body", () =>
    Effect.gen(function* () {
      const { layer, captured } = yield* makeFakeHttpClient(new Response(null, { status: 204 }));
      const data = new Uint8Array([1, 2, 3, 4]);

      yield* uploadBlob("test-key-123", data, "tok").pipe(Effect.provide(layer));

      const req = yield* Ref.get(captured);
      expect(req).not.toBeNull();
      expect(req!.method).toBe("PUT");
      expect(req!.url).toContain("/blobs/test-key-123");
      expect(req!.headers[STORAGE_SESSION_HEADER]).toBe("tok");
    }),
  );

  it.effect("succeeds on 204", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeFakeHttpClient(new Response(null, { status: 204 }));
      const result = yield* uploadBlob("key", new Uint8Array([0]), "tok").pipe(Effect.provide(layer));
      expect(result).toBeUndefined();
    }),
  );

  it.effect("fails with UploadError on non-204", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeFakeHttpClient(new Response(null, { status: 500 }));
      const result = yield* Effect.either(uploadBlob("key", new Uint8Array([0]), "tok").pipe(Effect.provide(layer)));
      expect(result._tag).toBe("Left");
      if (result._tag == "Left") {
        expect(result.left).toBeInstanceOf(UploadError);
      }
    }),
  );
});

// ---- uploadDocument ----

describe("uploadDocument", () => {
  it.effect("sends POST to /upload with required headers", () =>
    Effect.gen(function* () {
      const { layer, captured } = yield* makeFakeHttpClient(
        new Response(JSON.stringify({ documentId: "doc-1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );

      yield* uploadDocument({
        file: new Uint8Array([10, 20]),
        name: "report.pdf",
        format: "pdf",
        dekBase64Url: "dek-base64",
        sessionToken: "tok",
      }).pipe(Effect.provide(layer));

      const req = yield* Ref.get(captured);
      expect(req).not.toBeNull();
      expect(req!.method).toBe("POST");
      expect(req!.url).toContain("/upload");
      expect(req!.headers[COMPUTE_SESSION_HEADER]).toBe("tok");
      expect(req!.headers["x-dossier-dek"]).toBe("dek-base64");
      expect(req!.headers["x-document-name"]).toBe("report.pdf");
      expect(req!.headers["x-document-format"]).toBe("pdf");
    }),
  );

  it.effect("returns the documentId from the response", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeFakeHttpClient(
        new Response(JSON.stringify({ documentId: "doc-abc" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );

      const documentId = yield* uploadDocument({
        file: new Uint8Array([1]),
        name: "test.jpg",
        format: "jpg",
        dekBase64Url: "dek",
        sessionToken: "tok",
      }).pipe(Effect.provide(layer));

      expect(documentId).toBe("doc-abc");
    }),
  );

  it.effect("includes x-document-tags header when tagNames are provided", () =>
    Effect.gen(function* () {
      const { layer, captured } = yield* makeFakeHttpClient(
        new Response(JSON.stringify({ documentId: "doc-1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );

      yield* uploadDocument({
        file: new Uint8Array([1]),
        name: "file.png",
        format: "png",
        dekBase64Url: "dek",
        sessionToken: "tok",
        tagNames: ["invoices", "2024"],
      }).pipe(Effect.provide(layer));

      const req = yield* Ref.get(captured);
      expect(req!.headers["x-document-tags"]).toBe('["invoices","2024"]');
    }),
  );

  it.effect("omits x-document-tags header when tagNames is empty", () =>
    Effect.gen(function* () {
      const { layer, captured } = yield* makeFakeHttpClient(
        new Response(JSON.stringify({ documentId: "doc-1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );

      yield* uploadDocument({
        file: new Uint8Array([1]),
        name: "file.png",
        format: "png",
        dekBase64Url: "dek",
        sessionToken: "tok",
        tagNames: [],
      }).pipe(Effect.provide(layer));

      const req = yield* Ref.get(captured);
      expect(req!.headers["x-document-tags"]).toBeUndefined();
    }),
  );

  it.effect("fails with UploadError on non-2xx response", () =>
    Effect.gen(function* () {
      const { layer } = yield* makeFakeHttpClient(new Response(null, { status: 401 }));
      const result = yield* Effect.either(
        uploadDocument({
          file: new Uint8Array([1]),
          name: "file.pdf",
          format: "pdf",
          dekBase64Url: "dek",
          sessionToken: "bad-tok",
        }).pipe(Effect.provide(layer)),
      );
      expect(result._tag).toBe("Left");
      if (result._tag == "Left") {
        expect(result.left).toBeInstanceOf(UploadError);
      }
    }),
  );
});
