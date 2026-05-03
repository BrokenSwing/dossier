import * as nodeStream from "node:stream";

import archiver from "archiver";

import type { ExportFormat } from "@dossier/shared";
import { ArchiveFailedError } from "@dossier/shared";
import * as Effect from "effect/Effect";

export const createArchive = (
  entries: ReadonlyArray<{ readonly name: string; readonly content: Uint8Array }>,
  format: ExportFormat,
): Effect.Effect<Uint8Array, ArchiveFailedError> =>
  Effect.async((resolve) => {
    const arc = archiver(format === "zip" ? "zip" : "tar", { gzip: format === "tar.gz" });
    const passThrough = new nodeStream.PassThrough();
    const chunks: Buffer[] = [];

    passThrough.on("data", (chunk: Buffer) => chunks.push(chunk));
    passThrough.on("end", () => resolve(Effect.succeed(new Uint8Array(Buffer.concat(chunks)))));
    passThrough.on("error", (err: Error) => resolve(Effect.fail(new ArchiveFailedError({ message: err.message }))));
    arc.on("error", (err: Error) => resolve(Effect.fail(new ArchiveFailedError({ message: err.message }))));

    arc.pipe(passThrough);

    for (const entry of entries) {
      arc.append(Buffer.from(entry.content), { name: entry.name });
    }

    void arc.finalize();
  });
