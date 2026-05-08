import { NodeRuntime } from "@effect/platform-node";
import * as Layer from "effect/Layer";

import { StorageServerLayer } from "./ServerLayer.js";

NodeRuntime.runMain(Layer.launch(StorageServerLayer));
