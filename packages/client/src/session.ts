import { KdfParams } from "@dossier/shared";
import * as Atom from "@effect-atom/atom/Atom";
import * as Data from "effect/Data";
import * as Schema from "effect/Schema";

// --- Types ---

export type SessionState = Data.TaggedEnum<{
  LoggedOut: {};
  Locked: {
    readonly token: string;
    readonly username: string;
    readonly encryptedDek: string;
    readonly dekIv: string;
    readonly kdfParams: KdfParams;
  };
  Unlocked: {
    readonly token: string;
    readonly username: string;
    readonly encryptedDek: string;
    readonly dekIv: string;
    readonly kdfParams: KdfParams;
    readonly dek: Uint8Array;
  };
}>;

export const SessionState = Data.taggedEnum<SessionState>();
export type LoggedOut = Data.TaggedEnum.Value<SessionState, "LoggedOut">;
export type LockedSession = Data.TaggedEnum.Value<SessionState, "Locked">;
export type UnlockedSession = Data.TaggedEnum.Value<SessionState, "Unlocked">;

// --- JWT expiry check (client-side decode, no signature verification) ---

export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1] ?? ""));
    return typeof payload.exp === "number" && Date.now() / 1000 >= payload.exp;
  } catch {
    return false;
  }
}

// --- localStorage persistence ---

const STORAGE_KEY = "dossier-session";

const PersistedSession = Schema.Struct({
  token: Schema.String,
  username: Schema.String,
  encryptedDek: Schema.String,
  dekIv: Schema.String,
  kdfParams: KdfParams,
});

const encodeSession = Schema.encodeSync(Schema.parseJson(PersistedSession));
const decodeSession = Schema.decodeUnknownOption(Schema.parseJson(PersistedSession));

function loadFromStorage(): SessionState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return SessionState.LoggedOut();
    const decoded = decodeSession(raw);
    if (decoded._tag === "None") return SessionState.LoggedOut();
    if (isTokenExpired(decoded.value.token)) {
      localStorage.removeItem(STORAGE_KEY);
      return SessionState.LoggedOut();
    }
    return SessionState.Locked(decoded.value);
  } catch {
    return SessionState.LoggedOut();
  }
}

function syncToStorage(state: SessionState): void {
  if (state._tag === "LoggedOut") {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(
      STORAGE_KEY,
      encodeSession({
        token: state.token,
        username: state.username,
        encryptedDek: state.encryptedDek,
        dekIv: state.dekIv,
        kdfParams: state.kdfParams,
      }),
    );
  }
}

// --- Session atom ---
// Read: initial value from localStorage (Locked or LoggedOut), DEK never persisted.
// Write: syncs persisted fields to localStorage; DEK stays in memory only.

export const sessionAtom: Atom.Writable<SessionState> = Atom.writable<SessionState, SessionState>(
  (_get) => loadFromStorage(),
  (ctx, newState) => {
    syncToStorage(newState);
    ctx.setSelf(newState);
  },
).pipe(Atom.keepAlive);

// --- Transition helpers ---

export const buildUnlockedSession = (
  token: string,
  dek: Uint8Array,
  username: string,
  encryptedDek: string,
  dekIv: string,
  kdfParams: KdfParams,
): UnlockedSession => SessionState.Unlocked({ token, dek, username, encryptedDek, dekIv, kdfParams });

export const unlockSession = (locked: LockedSession, dek: Uint8Array): UnlockedSession => SessionState.Unlocked({ ...locked, dek });

export const lockSession = (unlocked: UnlockedSession): LockedSession => {
  const { dek: _dek, ...rest } = unlocked;
  return SessionState.Locked(rest);
};
