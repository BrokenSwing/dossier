# Epic: AUTH — Authentication & Security

---

## S-AUTH-1: Register account

**As a** new user,
**I want to** create an account with a password and TOTP,
**so that** I have a secure, encrypted vault.

### Acceptance criteria

- User provides a username and password.
- Client derives a KEK from the password using a strong KDF (e.g. Argon2id).
- Client generates a fresh random DEK.
- Client encrypts the DEK with the KEK.
- Client sends `{ username, kdf_params, encrypted_dek, totp_setup_request }` to the server — the plaintext DEK and KEK are never sent.
- Server returns a TOTP provisioning URI (e.g. `otpauth://`).
- User scans the QR code and confirms with a TOTP code to activate the account.
- Account is created only after TOTP confirmation succeeds.

---

## S-AUTH-2: Login

**As a** registered user,
**I want to** log in with my password and a TOTP code,
**so that** I can access my vault for the session.

### Acceptance criteria

- User enters username and password.
- Server returns the stored `encrypted_dek` and `kdf_params` for the user.
- Client derives the KEK from the password using the stored KDF params.
- Client decrypts the DEK with the KEK.
- User enters a TOTP code; server validates it.
- On success, the decrypted DEK is held in client memory for the session.
- On failure (wrong password or invalid TOTP), access is denied and the DEK is not made available.

---

## S-AUTH-3: Session management — lock and logout

**As a** logged-in user,
**I want to** lock my session or log out,
**so that** the DEK is cleared from memory and my vault is protected.

### Acceptance criteria

- **Lock:** Clears the DEK from client memory. The session token is preserved. User must re-enter their password (and optionally TOTP, TBD) to unlock and re-derive the DEK.
- **Logout:** Clears the DEK from client memory and invalidates the session token on the server.
- After lock or logout, no document operations are possible until re-authentication.
- An inactivity timeout (duration TBD) automatically locks the session.

---

## S-AUTH-4: Change password

**As a** logged-in user,
**I want to** change my password,
**so that** I can rotate my credentials without affecting my documents.

### Acceptance criteria

- User provides their current password and a new password.
- Client verifies the current password can successfully decrypt the DEK.
- Client derives a new KEK from the new password.
- Client re-encrypts the existing DEK with the new KEK.
- Client sends the new `encrypted_dek` and updated `kdf_params` to the server.
- Server replaces the stored encrypted DEK.
- **No documents are re-encrypted.** The underlying DEK is unchanged.
- The operation requires the current session to be authenticated.

---

## S-AUTH-5: Emergency key rotation

**As a** user who suspects their DEK has been compromised,
**I want to** rotate my document encryption key,
**so that** the compromised key can no longer decrypt my documents.

### Acceptance criteria

- User initiates key rotation (treated as an admin/power-user operation).
- Client generates a new random DEK.
- For every document in the vault:
  - Client downloads and decrypts the document with the old DEK.
  - Client re-encrypts the document with the new DEK.
  - Client uploads the newly encrypted document to replace the old one.
- Client encrypts the new DEK with the current KEK.
- Client sends the new `encrypted_dek` to the server.
- On completion, the old DEK is cleared from memory and replaced by the new DEK.
- The operation is atomic from the user's perspective: if it is interrupted, a resume or retry mechanism is available (TBD).
- The operation requires the current session to be authenticated.
