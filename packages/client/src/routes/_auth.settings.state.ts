import { STORAGE_SESSION_HEADER } from "@dossier/shared";
import * as Effect from "effect/Effect";

import {
  CryptoError,
  deriveAuthKey,
  deriveKek,
  deriveMasterKey,
  generateKdfParams,
  wrapDek,
} from "../lib/crypto.js";
import { StorageRpc } from "../lib/rpc.js";
import { sessionAtom, type UnlockedSession } from "../session.js";

export interface ChangePasswordForm {
  readonly oldPassword: string;
  readonly newPassword: string;
  readonly confirmPassword: string;
}

export const initialChangePasswordForm: ChangePasswordForm = {
  oldPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export const setOldPassword = (form: ChangePasswordForm, oldPassword: string): ChangePasswordForm => ({ ...form, oldPassword });
export const setNewPassword = (form: ChangePasswordForm, newPassword: string): ChangePasswordForm => ({ ...form, newPassword });
export const setConfirmPassword = (form: ChangePasswordForm, confirmPassword: string): ChangePasswordForm => ({ ...form, confirmPassword });

export const isChangePasswordFormValid = (form: ChangePasswordForm): boolean =>
  form.oldPassword.length > 0 &&
  form.newPassword.length > 0 &&
  form.newPassword === form.confirmPassword;

export const changePasswordAtom = StorageRpc.runtime.fn<ChangePasswordForm>()(
  ({ oldPassword, newPassword }, get) => {
    const session = get(sessionAtom) as UnlockedSession;
    return Effect.gen(function* () {
      // Derive old auth key to prove identity
      const oldMasterKey = yield* deriveMasterKey(oldPassword, session.kdfParams).pipe(
        Effect.mapError(() => new CryptoError({ message: "Failed to derive key from old password." })),
      );
      const oldAuthKey = yield* deriveAuthKey(oldMasterKey);

      // Derive new keys from new password + fresh KDF params
      const newKdfParams = generateKdfParams();
      const newMasterKey = yield* deriveMasterKey(newPassword, newKdfParams).pipe(
        Effect.mapError(() => new CryptoError({ message: "Failed to derive key from new password." })),
      );
      const newKek = yield* deriveKek(newMasterKey);
      const newAuthKey = yield* deriveAuthKey(newMasterKey);
      const { encryptedDek: newEncryptedDek, dekIv: newDekIv } = yield* wrapDek(session.dek, newKek);

      const client = yield* StorageRpc;
      yield* client(
        "ChangePassword",
        { oldAuthKey, newAuthKey, newKdfParams, newEncryptedDek, newDekIv },
        { headers: { [STORAGE_SESSION_HEADER]: session.token } },
      );
    });
  },
);
