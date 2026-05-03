import { StorageRpcs } from "@dossier/shared";
import * as RpcClient from "@effect/rpc/RpcClient";
import type { RpcClientError } from "@effect/rpc/RpcClientError";
import * as RpcSerialization from "@effect/rpc/RpcSerialization";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AppConfig } from "./Config.js";

export class StorageClient extends Context.Tag("@dossier/compute/StorageClient")<
  StorageClient,
  RpcClient.FromGroup<typeof StorageRpcs, RpcClientError>
>() {}

// Exposes the storage base URL as a plain service so handlers can make raw HTTP requests
// (e.g. PUT /blobs/:key) without re-reading AppConfig per request.
export class StorageUrl extends Context.Tag("@dossier/compute/StorageUrl")<StorageUrl, string>() {}

export const StorageClientLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const { storageUrl } = yield* AppConfig;

    const ProtocolLayer = RpcClient.layerProtocolHttp({ url: `${storageUrl}/rpc` }).pipe(Layer.provide(RpcSerialization.layerNdjson));

    return Layer.mergeAll(
      Layer.scoped(StorageClient, RpcClient.make(StorageRpcs)).pipe(Layer.provide(ProtocolLayer)),
      Layer.succeed(StorageUrl, storageUrl),
    );
  }),
);
