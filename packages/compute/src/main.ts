import * as http from "node:http";

import { ComputeRpcs } from "@dossier/shared";
import { NodeContext, NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as HttpLayerRouter from "@effect/platform/HttpLayerRouter";
import * as RpcSerialization from "@effect/rpc/RpcSerialization";
import * as RpcServer from "@effect/rpc/RpcServer";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { AppConfig } from "./Config.js";
import { computeHandlers } from "./handlers/ComputeHandlers.js";
import { ComputeAuthLive } from "./middleware/ComputeAuth.js";
import { UploadRoute } from "./routes/UploadRoute.js";
import { CryptoServiceLive } from "./services/Crypto.js";
import { WatermarkServiceLive } from "./services/Watermark.js";
import { StorageClientLive } from "./StorageClient.js";

const MainLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const { port } = yield* AppConfig;
    yield* Effect.log(`Compute service starting on port ${port}`);

    const NodeHttpClientLayer = NodeHttpClient.layer;

    const StorageClientLayer = StorageClientLive.pipe(Layer.provide(NodeHttpClientLayer));

    const HandlerLayer = Layer.provide(
      computeHandlers,
      Layer.mergeAll(StorageClientLayer, CryptoServiceLive, WatermarkServiceLive, NodeHttpClientLayer),
    );

    const InfraLayers = Layer.mergeAll(ComputeAuthLive, RpcSerialization.layerNdjson);

    const RpcLayer = RpcServer.layerHttpRouter({
      group: ComputeRpcs,
      path: "/rpc",
      protocol: "http",
    }).pipe(Layer.provide(HandlerLayer), Layer.provide(InfraLayers));

    const AppLayer = Layer.mergeAll(RpcLayer, UploadRoute, HttpLayerRouter.cors());

    return HttpLayerRouter.serve(AppLayer).pipe(
      Layer.provide(NodeHttpServer.layer(() => http.createServer(), { port })),
      Layer.provide(NodeContext.layer),
      Layer.provide(StorageClientLayer),
      Layer.provide(CryptoServiceLive),
      Layer.provide(NodeHttpClientLayer),
    );
  }),
);

NodeRuntime.runMain(Layer.launch(MainLayer));
