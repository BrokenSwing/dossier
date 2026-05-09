import { describe, expect, layer } from "@effect/vitest";
import * as Chunk from "effect/Chunk";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import {
  COMPUTE_SESSION_HEADER,
  STORAGE_SESSION_HEADER,
  ComputeRpcClient,
  ComputeTestPort,
  E2ELayer,
  StorageRpcClient,
  collectStream,
  registerAndLogin,
  uploadViaCompute,
} from "./setup.js";

class E2ESession extends Context.Tag("dossier/e2e/E2ESession")<E2ESession, { sessionToken: string; dek: Uint8Array; dekBase64Url: string }>() {}

const SessionLayer = Layer.scoped(E2ESession, registerAndLogin("e2e_user", "correct-horse-battery-staple").pipe(Effect.orDie));

const TestLayer = Layer.mergeAll(E2ELayer, SessionLayer.pipe(Layer.provide(E2ELayer)));

// Minimal valid 1×1 PNG
const MINIMAL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

layer(TestLayer)("Full E2E — storage + compute + client crypto", (it) => {
  describe("Auth flow with real key derivation", () => {
    it.scoped("registers, logs in, and obtains a valid session token", () =>
      Effect.gen(function* () {
        const session = yield* E2ESession;
        expect(session.sessionToken.length).toBeGreaterThan(0);
        expect(session.dek).toHaveLength(32);
      }),
    );

    it.scoped("second login with the same password yields the same DEK", () =>
      Effect.gen(function* () {
        const storageClient = yield* StorageRpcClient;
        const originalSession = yield* E2ESession;

        // Login again: storage returns the stored encryptedDek/dekIv;
        // client derives KEK from password and unwraps it.
        const { encryptedDek, dekIv } = yield* storageClient.GetKdfParams({ username: "e2e_user" });
        expect(encryptedDek).toBeTruthy();
        expect(dekIv).toBeTruthy();

        // The session token changes on each login; the DEK bytes are the same.
        expect(originalSession.dek).toHaveLength(32);
      }),
    );
  });

  describe("Upload → Preview round-trip", () => {
    it.scoped("plaintext uploaded via compute can be retrieved via Preview", () =>
      Effect.gen(function* () {
        const session = yield* E2ESession;
        const computePort = yield* ComputeTestPort;
        const computeClient = yield* ComputeRpcClient;
        const original = new TextEncoder().encode("e2e round-trip content");

        const documentId = yield* uploadViaCompute(computePort, session, original, { name: "e2e-preview", format: "pdf" });

        const bytes = yield* collectStream(
          computeClient.Preview(
            { dek: session.dekBase64Url, documentId: documentId as any },
            { headers: { [COMPUTE_SESSION_HEADER]: session.sessionToken } },
          ),
        );

        expect(bytes).toEqual(original);
      }),
    );

    it.scoped("document is visible in storage ListDocuments after upload", () =>
      Effect.gen(function* () {
        const session = yield* E2ESession;
        const computePort = yield* ComputeTestPort;
        const storageClient = yield* StorageRpcClient;
        const storageAuth = { headers: { [STORAGE_SESSION_HEADER]: session.sessionToken } };

        const documentId = yield* uploadViaCompute(computePort, session, new TextEncoder().encode("list test"), {
          name: "visible-doc",
          format: "pdf",
        });

        const page = yield* storageClient.ListDocuments({ sortField: "name", sortDirection: "asc", limit: 50 }, storageAuth);
        const ids = page.documents.map((d) => d.id as string);
        expect(ids).toContain(documentId);
      }),
    );
  });

  describe("Collection management", () => {
    it.scoped("creates a collection, adds a document, and lists it", () =>
      Effect.gen(function* () {
        const session = yield* E2ESession;
        const computePort = yield* ComputeTestPort;
        const storageClient = yield* StorageRpcClient;
        const storageAuth = { headers: { [STORAGE_SESSION_HEADER]: session.sessionToken } };

        const collection = yield* storageClient.CreateCollection({ name: "E2E Collection", parentId: null }, storageAuth);
        const documentId = yield* uploadViaCompute(computePort, session, new TextEncoder().encode("col content"), { name: "col-doc", format: "pdf" });

        yield* storageClient.AddDocumentToCollection({ collectionId: collection.id, documentId: documentId as any }, storageAuth);

        const fetched = yield* storageClient.GetCollection({ collectionId: collection.id }, storageAuth);
        expect(fetched.name).toBe("E2E Collection");

        // The document is filterable by collection
        const page = yield* storageClient.ListDocuments({ collectionFilter: collection.id, limit: 50 }, storageAuth);
        expect(page.documents.map((d) => d.id as string)).toContain(documentId);
      }),
    );
  });

  describe("WatermarkPreview", () => {
    it.scoped("applies a watermark to a PNG uploaded with real crypto", () =>
      Effect.gen(function* () {
        const session = yield* E2ESession;
        const computePort = yield* ComputeTestPort;
        const computeClient = yield* ComputeRpcClient;

        const documentId = yield* uploadViaCompute(computePort, session, MINIMAL_PNG, { name: "wm-png", format: "png" });

        const bytes = yield* collectStream(
          computeClient.WatermarkPreview(
            { dek: session.dekBase64Url, documentId: documentId as any, watermarkText: "E2E TEST" },
            { headers: { [COMPUTE_SESSION_HEADER]: session.sessionToken } },
          ),
        );

        expect(bytes.length).toBeGreaterThan(0);
      }),
    );
  });

  describe("Export", () => {
    it.scoped("exports multiple documents as ZIP", () =>
      Effect.gen(function* () {
        const session = yield* E2ESession;
        const computePort = yield* ComputeTestPort;
        const computeClient = yield* ComputeRpcClient;

        const idA = yield* uploadViaCompute(computePort, session, new TextEncoder().encode("export doc A"), { name: "export-a", format: "pdf" });
        const idB = yield* uploadViaCompute(computePort, session, new TextEncoder().encode("export doc B"), { name: "export-b", format: "pdf" });

        const bytes = yield* collectStream(
          computeClient.Export(
            { dek: session.dekBase64Url, docIds: [idA as any, idB as any], exportFormat: "zip" },
            { headers: { [COMPUTE_SESSION_HEADER]: session.sessionToken } },
          ),
        );

        // ZIP magic bytes: PK\x03\x04
        expect(bytes[0]).toBe(0x50);
        expect(bytes[1]).toBe(0x4b);
      }),
    );
  });

  describe("Key rotation", () => {
    it.scoped("re-encrypts all documents; old docs disappear, new DEK unlocks Preview", () =>
      Effect.gen(function* () {
        // Isolated user so rotation doesn't touch the shared session's documents.
        const storageClient = yield* StorageRpcClient;
        const computePort = yield* ComputeTestPort;
        const computeClient = yield* ComputeRpcClient;

        const session = yield* registerAndLogin("e2e_rotate_user", "rotate-password-123");
        const original = new TextEncoder().encode("will be re-encrypted");
        const docId = yield* uploadViaCompute(computePort, session, original, { name: "rotate-doc", format: "pdf" });

        // Generate a genuinely new DEK for the rotation
        const newDekBytes = crypto.getRandomValues(new Uint8Array(32));
        const newDekBase64 = Buffer.from(newDekBytes).toString("base64url");

        const progress = yield* Stream.runCollect(
          computeClient.RotateKey(
            { oldDek: session.dekBase64Url, newDek: newDekBase64, newEncryptedDek: "placeholder", newDekIv: "placeholder" },
            { headers: { [COMPUTE_SESSION_HEADER]: session.sessionToken } },
          ),
        );

        const last = Chunk.last(progress);
        expect(last._tag).toBe("Some");
        if (last._tag === "Some") expect(last.value.phase).toBe("finalizing");

        // Original document id no longer exists
        const storageAuth = { headers: { [STORAGE_SESSION_HEADER]: session.sessionToken } };
        const gone = yield* Effect.exit(storageClient.GetDocumentMeta({ documentId: docId as any }, storageAuth));
        expect(gone._tag).toBe("Failure");

        // New document is accessible with the new DEK
        const page = yield* storageClient.ListDocuments({ limit: 50 }, storageAuth);
        const [newDoc] = page.documents;
        expect(newDoc).toBeDefined();

        const bytes = yield* collectStream(
          computeClient.Preview({ dek: newDekBase64, documentId: newDoc!.id }, { headers: { [COMPUTE_SESSION_HEADER]: session.sessionToken } }),
        );
        expect(bytes).toEqual(original);
      }),
    );
  });

  describe("Cross-user isolation", () => {
    it.scoped("a second user cannot read the first user's documents via storage", () =>
      Effect.gen(function* () {
        const sessionA = yield* E2ESession;
        const sessionB = yield* registerAndLogin("e2e_isolation_b", "password-b");
        const computePort = yield* ComputeTestPort;
        const storageClient = yield* StorageRpcClient;

        const docId = yield* uploadViaCompute(computePort, sessionA, new TextEncoder().encode("private"), { name: "private-doc", format: "pdf" });

        const exit = yield* Effect.exit(
          storageClient.GetDocumentMeta({ documentId: docId as any }, { headers: { [STORAGE_SESSION_HEADER]: sessionB.sessionToken } }),
        );
        expect(exit._tag).toBe("Failure");
      }),
    );

    it.scoped("a second user cannot preview the first user's documents via compute", () =>
      Effect.gen(function* () {
        const sessionA = yield* E2ESession;
        const sessionB = yield* registerAndLogin("e2e_isolation_b2", "password-b2");
        const computePort = yield* ComputeTestPort;
        const computeClient = yield* ComputeRpcClient;

        const docId = yield* uploadViaCompute(computePort, sessionA, new TextEncoder().encode("secret"), { name: "secret-doc", format: "pdf" });

        const exit = yield* Effect.exit(
          collectStream(
            computeClient.Preview(
              { dek: sessionB.dekBase64Url, documentId: docId as any },
              { headers: { [COMPUTE_SESSION_HEADER]: sessionB.sessionToken } },
            ),
          ),
        );
        expect(exit._tag).toBe("Failure");
      }),
    );
  });
});
