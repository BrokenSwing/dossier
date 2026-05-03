import { CollectionId, InternalError, STORAGE_SESSION_HEADER } from "@dossier/shared";
import * as HttpClient from "@effect/platform/HttpClient";
import * as HttpClientRequest from "@effect/platform/HttpClientRequest";
import * as HttpLayerRouter from "@effect/platform/HttpLayerRouter";
import * as HttpServerResponse from "@effect/platform/HttpServerResponse";
import * as Effect from "effect/Effect";

import { AppConfig } from "../Config.js";
import { extractSessionToken } from "../middleware/ComputeAuth.js";
import { CryptoService } from "../services/Crypto.js";
import { StorageClient } from "../StorageClient.js";

const COMPUTE_DEK_HEADER = "x-dossier-dek" as const;
const DOCUMENT_NAME_HEADER = "x-document-name" as const;
const DOCUMENT_FORMAT_HEADER = "x-document-format" as const;
const DOCUMENT_TAGS_HEADER = "x-document-tags" as const;
const DOCUMENT_COLLECTIONS_HEADER = "x-document-collections" as const;

export const UploadRoute = HttpLayerRouter.add("POST", "/upload", (req) =>
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const client = yield* StorageClient;
    const crypto = yield* CryptoService;

    // --- Authenticate ---
    const sessionTokenResult = yield* Effect.either(extractSessionToken(req.headers));
    if (sessionTokenResult._tag === "Left") return HttpServerResponse.empty({ status: 401 });
    const sessionToken = sessionTokenResult.right;

    // --- Decode DEK ---
    const rawDek = req.headers[COMPUTE_DEK_HEADER] as string | undefined;
    if (!rawDek) return HttpServerResponse.empty({ status: 400 });
    const dekBytes = Buffer.from(rawDek, "base64url");
    if (dekBytes.length !== 32) return HttpServerResponse.empty({ status: 400 });

    // --- Metadata headers ---
    const name = req.headers[DOCUMENT_NAME_HEADER] as string | undefined;
    const format = req.headers[DOCUMENT_FORMAT_HEADER] as string | undefined;
    if (!name || !format || !["pdf", "jpg", "png"].includes(format)) {
      return HttpServerResponse.empty({ status: 400 });
    }

    const tagsRaw = req.headers[DOCUMENT_TAGS_HEADER] as string | undefined;
    const collectionsRaw = req.headers[DOCUMENT_COLLECTIONS_HEADER] as string | undefined;
    const tagNames: string[] = tagsRaw ? (JSON.parse(tagsRaw) as string[]) : [];
    const collectionIds: CollectionId[] = collectionsRaw ? (JSON.parse(collectionsRaw) as CollectionId[]) : [];

    // --- Read body + encrypt ---
    const buf = yield* req.arrayBuffer.pipe(Effect.orElse(() => Effect.succeed(new ArrayBuffer(0))));
    const encrypted = yield* crypto.encrypt(new Uint8Array(buf), dekBytes).pipe(Effect.mapError((e) => new InternalError({ message: e.message })));

    // --- Create metadata ---
    const { documentId, blobKey } = yield* client
      .CreateDocumentMeta(
        { name, format: format as "pdf" | "jpg" | "png", tagNames, collectionIds },
        { headers: { [STORAGE_SESSION_HEADER]: sessionToken } },
      )
      .pipe(Effect.mapError((e) => new InternalError({ message: String(e) })));

    // --- Upload encrypted blob ---
    const httpClient = yield* HttpClient.HttpClient;
    const putResp = yield* httpClient
      .execute(
        HttpClientRequest.put(`${config.storageUrl}/blobs/${blobKey}`).pipe(
          HttpClientRequest.setHeader(STORAGE_SESSION_HEADER, sessionToken),
          HttpClientRequest.bodyUint8Array(encrypted),
        ),
      )
      .pipe(Effect.mapError((e) => new InternalError({ message: `Blob upload failed: ${String(e)}` })));

    if (putResp.status !== 204) return HttpServerResponse.empty({ status: 500 });

    // --- Confirm ---
    yield* client
      .ConfirmBlobUpload({ documentId, encryptedSize: encrypted.length }, { headers: { [STORAGE_SESSION_HEADER]: sessionToken } })
      .pipe(Effect.mapError((e) => new InternalError({ message: String(e) })));

    return HttpServerResponse.text(JSON.stringify({ documentId }), { status: 201, contentType: "application/json" });
  }).pipe(Effect.catchAll(() => Effect.succeed(HttpServerResponse.empty({ status: 500 })))),
);
