import { ComputeAuth, COMPUTE_SESSION_HEADER, InvalidSessionError } from "@dossier/shared";
import * as Headers from "@effect/platform/Headers";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export const extractSessionToken = (headers: Headers.Headers): Effect.Effect<string, InvalidSessionError> => {
  const rawToken = Headers.get(headers, COMPUTE_SESSION_HEADER);
  if (Option.isNone(rawToken)) {
    return Effect.fail(new InvalidSessionError({ message: "Missing session token" }));
  }
  return Effect.succeed(rawToken.value);
};

export const ComputeAuthLive = Layer.succeed(
  ComputeAuth,
  ComputeAuth.of(({ headers }) =>
    extractSessionToken(headers).pipe(Effect.map((sessionToken) => ({ sessionToken }))),
  ),
);
