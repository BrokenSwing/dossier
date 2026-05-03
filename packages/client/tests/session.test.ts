import { KdfParams } from "@dossier/shared";
import * as Registry from "@effect-atom/atom/Registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SessionState, buildUnlockedSession, lockSession, sessionAtom, unlockSession } from "../src/session.js";

const TEST_KDF_PARAMS = new KdfParams({ memory: 64, iterations: 1, parallelism: 1, salt: "aa".repeat(32) });
const TEST_DEK = new Uint8Array(32).fill(7);

const makeSession = () => buildUnlockedSession("token-123", TEST_DEK, "alice", "enc-dek", "dek-iv", TEST_KDF_PARAMS);

describe("sessionAtom", () => {
  let registry: Registry.Registry;

  beforeEach(() => {
    localStorage.clear();
    registry = Registry.make();
  });

  afterEach(() => {
    localStorage.clear();
    registry.dispose();
  });

  it("starts LoggedOut when localStorage is empty", () => {
    expect(registry.get(sessionAtom)._tag).toBe("LoggedOut");
  });

  it("login: sets Unlocked state and persists token+kdf to localStorage", () => {
    const session = makeSession();
    registry.set(sessionAtom, session);

    const state = registry.get(sessionAtom);
    expect(state._tag).toBe("Unlocked");
    if (state._tag === "Unlocked") {
      expect(state.token).toBe("token-123");
      expect(state.username).toBe("alice");
      expect(state.dek).toBe(TEST_DEK);
    }
    expect(localStorage.getItem("dossier-session")).not.toBeNull();
  });

  it("logout: sets LoggedOut and removes localStorage entry", () => {
    registry.set(sessionAtom, makeSession());
    registry.set(sessionAtom, SessionState.LoggedOut());

    expect(registry.get(sessionAtom)._tag).toBe("LoggedOut");
    expect(localStorage.getItem("dossier-session")).toBeNull();
  });

  it("restores Locked state from localStorage on fresh registry", () => {
    // Simulate a previous login
    registry.set(sessionAtom, makeSession());
    expect(localStorage.getItem("dossier-session")).not.toBeNull();

    // New registry (simulates page refresh)
    const registry2 = Registry.make();
    const state = registry2.get(sessionAtom);
    expect(state._tag).toBe("Locked");
    if (state._tag === "Locked") {
      expect(state.token).toBe("token-123");
      expect(state.username).toBe("alice");
    }
    registry2.dispose();
  });

  it("restored Locked state has no DEK", () => {
    registry.set(sessionAtom, makeSession());
    const registry2 = Registry.make();
    const state = registry2.get(sessionAtom);
    expect(state._tag).toBe("Locked");
    expect("dek" in state).toBe(false);
    registry2.dispose();
  });

  it("unlockSession: produces Unlocked from Locked with given DEK", () => {
    registry.set(sessionAtom, makeSession());
    const registry2 = Registry.make();
    const locked = registry2.get(sessionAtom);
    expect(locked._tag).toBe("Locked");
    if (locked._tag === "Locked") {
      const unlocked = unlockSession(locked, TEST_DEK);
      expect(unlocked._tag).toBe("Unlocked");
      expect(unlocked.dek).toBe(TEST_DEK);
      expect(unlocked.token).toBe(locked.token);
    }
    registry2.dispose();
  });

  it("lockSession: drops DEK from Unlocked state", () => {
    const session = makeSession();
    const locked = lockSession(session);
    expect(locked._tag).toBe("Locked");
    expect("dek" in locked).toBe(false);
    expect(locked.token).toBe(session.token);
  });

  it("DEK is never written to localStorage", () => {
    registry.set(sessionAtom, makeSession());
    const raw = localStorage.getItem("dossier-session") ?? "";
    const parsed = JSON.parse(raw);
    expect(Object.keys(parsed)).toEqual(expect.arrayContaining(["token", "username", "encryptedDek", "dekIv", "kdfParams"]));
    expect(parsed).not.toHaveProperty("dek");
  });
});
