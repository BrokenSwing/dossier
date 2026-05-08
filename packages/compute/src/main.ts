import { NodeRuntime } from "@effect/platform-node";
import * as Layer from "effect/Layer";

import { ComputeServerLayer } from "./ComputeServerLayer.js";

NodeRuntime.runMain(Layer.launch(ComputeServerLayer));
