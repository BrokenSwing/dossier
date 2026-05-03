import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { createArchive } from "../../src/services/Archive.js";

describe("createArchive", () => {
  describe("zip", () => {
    it.effect("produces a valid zip (PK magic bytes)", () =>
      Effect.gen(function* () {
        const result = yield* createArchive(
          [{ name: "hello.txt", content: new TextEncoder().encode("hello") }],
          "zip",
        );
        expect(result[0]).toBe(0x50); // P
        expect(result[1]).toBe(0x4b); // K
      }),
    );

    it.effect("handles multiple entries", () =>
      Effect.gen(function* () {
        const entries = [
          { name: "a.txt", content: new TextEncoder().encode("aaa") },
          { name: "b.txt", content: new TextEncoder().encode("bbb") },
          { name: "c.txt", content: new TextEncoder().encode("ccc") },
        ];
        const result = yield* createArchive(entries, "zip");
        expect(result.length).toBeGreaterThan(0);
      }),
    );

    it.effect("handles empty entries", () =>
      Effect.gen(function* () {
        const result = yield* createArchive([], "zip");
        expect(result.length).toBeGreaterThan(0);
      }),
    );
  });

  describe("tar.gz", () => {
    it.effect("produces a valid gzip (magic bytes 1f 8b)", () =>
      Effect.gen(function* () {
        const result = yield* createArchive(
          [{ name: "hello.txt", content: new TextEncoder().encode("hello") }],
          "tar.gz",
        );
        expect(result[0]).toBe(0x1f);
        expect(result[1]).toBe(0x8b);
      }),
    );

    it.effect("handles multiple entries", () =>
      Effect.gen(function* () {
        const entries = [
          { name: "a.txt", content: new TextEncoder().encode("aaa") },
          { name: "b.txt", content: new TextEncoder().encode("bbb") },
        ];
        const result = yield* createArchive(entries, "tar.gz");
        expect(result.length).toBeGreaterThan(0);
      }),
    );
  });
});
