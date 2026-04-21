# Product Requirements Document — Dossier

**Version:** 0.2 (pre-implementation)
**Date:** 2026-04-18
**Status:** Draft

---

## 1. Project Summary

Dossier is a self-hosted, encrypted document vault for personal use. It lets a single user (or a small number of users, each with their own isolated vault) securely store, organize, tag, and export sensitive documents. The system is composed of three tiers — storage, compute, and client — with a flexible trust model: the storage backend never holds a plaintext document key, and users who do not trust the storage operator can self-host the compute layer so plaintext data never reaches the storage host's infrastructure. Documents can be watermarked at export time, and ad-hoc or collection-based exports are packaged as downloadable archives.

---

## 2. Goals

- **Secure storage:** Documents are encrypted at rest. The storage backend stores only ciphertext; the plaintext document key is never persisted server-side.
- **Mobile-friendly:** Heavy compute (encryption, watermarking, export) is delegated to a server-side compute layer so the browser only handles UI and key management, not raw crypto work.
- **Flexible trust:** Users who do not trust the storage operator can self-host the compute layer. The storage backend remains zero-knowledge regardless of who operates the compute layer.
- **Organized retrieval:** Documents can be tagged and grouped into named collections (folders) for quick discovery.
- **Controlled sharing:** Export a collection or an ad-hoc selection as a watermarked archive to share with a third party, without exposing the vault itself.
- **Operational simplicity:** Self-hosted, minimal dependencies, easy to back up and restore.

## 2.1 Non-Goals

- Real-time collaboration or sharing between users within the app.
- Full-text search inside document content.
- Mobile-native applications (web UI is sufficient for now).
- Support for formats beyond PDF, JPG, and PNG.

---

## 3. User Persona

**Primary user:** A solo professional (e.g., freelancer, consultant) who needs to maintain a personal archive of sensitive documents — contracts, invoices, IDs, certifications — and occasionally export curated, watermarked dossiers to clients or partners.

**Secondary consideration:** The architecture is multi-user (each account is a fully isolated vault), but the immediate use case is a single operator running the server for personal use. User-to-user sharing is explicitly out of scope.

---

## 4. Core Concepts

### Document

A stored file in one of the supported formats: PDF, JPG, or PNG. Each document is encrypted individually with a Document Encryption Key (DEK). Documents have a name, optional tags, and may belong to one or more collections.

### Tag

A free-form label attached to one or more documents. Tags are user-defined and are the primary mechanism for cross-collection discovery.

### Collection (Folder)

A named, hierarchical grouping of documents. Collections can be nested arbitrarily deep (e.g. `House Project / Contracts / 2024`). A collection may have a default watermark configuration. Documents can belong to multiple collections at any level, and deleting a collection does not delete its documents or its sub-collections.

### Watermark

A text overlay applied to document pages at export time. Watermarks are configured at the collection level and can be overridden at export time. They are never stored in the encrypted document — they are applied on-the-fly during export.

### Export

A downloadable archive (ZIP or TAR.GZ) containing one or more documents, optionally watermarked. Exports can be collection-based or ad-hoc (documents from anywhere in the vault added to a temporary session basket).

---

## 5. Architecture

The system has three tiers. TLS is assumed on all inter-tier communication.

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                 │
│  ┌──────────────┐       ┌──────────────────────────┐    │
│  │   UI layer   │◄─────►│  Compute (local mode)    │    │
│  │  display     │       │  JS/WASM, runs in-browser│    │
│  └──────────────┘       └────────────┬─────────────┘    │
└───────────────────────────────────── │ ─────────────────┘
                      (server mode)    │  DEK never leaves browser in local mode
          ┌────────────────────────────▼────────────────────────┐
          │  Compute service                                     │
          │  Stateless. Receives DEK from browser per-request.  │
          │  Acts as the user's agent against storage.          │
          │  DEK held in RAM only for the duration of a request.│
          └────────────────────────────┬────────────────────────┘
                                       │  session token + encrypted blobs
          ┌────────────────────────────▼────────────────────────┐
          │  Storage backend                                     │
          │  - Encrypted document blobs                         │
          │  - Encrypted DEK (wrapped with user's KEK)          │
          │  - Metadata unencrypted: names, tags, collections   │
          │  - No knowledge of compute deployment mode          │
          └─────────────────────────────────────────────────────┘
```

### Tier responsibilities

**Browser (UI layer)**

- Derives the KEK from the user's password.
- Decrypts the DEK and holds it in session memory.
- Renders the UI; delegates all document operations to compute.
- In local mode, also runs the compute logic (JS/WASM) — the DEK never leaves the browser.

**Compute service**

- Exposes high-level operations: upload, preview, export, key rotation.
- Receives the DEK and session token from the browser per-request.
- Talks to storage on behalf of the user using the session token.
- Streams results back to the browser (critical for large exports).
- Never persists the DEK; holds it in RAM only during a request.
- Can be server-hosted (VPS) or run locally in the browser — same codebase, different deployment.

**Storage backend**

- Authenticated blob store + metadata database.
- Stores encrypted document blobs and the encrypted DEK.
- Stores document metadata (name, tags, collection memberships) unencrypted.
- Has no knowledge of whether compute is server-hosted or browser-hosted.
- Never receives or holds a plaintext DEK.

### Trust model

| Who operates compute                   | Who operates storage | What storage operator sees |
| -------------------------------------- | -------------------- | -------------------------- |
| Same as storage (self-hosted together) | Self                 | Ciphertext only            |
| User (self-hosted separately)          | Third party          | Ciphertext only            |
| Third party                            | Third party          | Ciphertext only            |
| Browser (local mode)                   | Anyone               | Ciphertext only            |

In all cases, the storage backend is zero-knowledge with respect to document content.

### Compute API (high-level operations)

| Operation                                 | Compute does                                           |
| ----------------------------------------- | ------------------------------------------------------ |
| `upload(dek, file, metadata)`             | Encrypt file → PUT blob to storage; write metadata     |
| `preview(dek, doc_id)`                    | GET blob from storage → decrypt → stream to browser    |
| `export(dek, doc_ids, watermark, format)` | GET blobs → decrypt → apply watermark → stream archive |
| `rotate_key(old_dek, new_dek)`            | GET all blobs → re-encrypt → PUT all blobs             |

---

## 6. Security Model

### 6.1 Envelope Encryption

```
User password
    └─► PBKDF (e.g. Argon2id) ─► KEK (Key Encryption Key)  [never stored]
                                        │
                                        ▼
                              Encrypted DEK  ◄──────────────── DEK (Document Encryption Key)
                              (stored on server)                    │
                                                                    ▼
                                                          Encrypted Document
                                                          (stored on server)
```

- **KEK**: Derived client-side from the user's password using a strong KDF. Never sent to or stored by the server.
- **DEK**: Generated once at registration. Used to encrypt all documents. Stored on the server only in encrypted form (wrapped with the KEK).
- **Session**: After login, the client decrypts the DEK with the KEK and holds it in memory for the duration of the session. On lock or logout, it is cleared.

### 6.2 Password Change

When a user changes their password, a new KEK is derived from the new password. The DEK is re-encrypted with the new KEK. **No documents are re-encrypted.** The encrypted documents on the server are untouched.

### 6.3 Emergency Key Rotation

In case of a suspected DEK compromise, a new DEK is generated. Every document is downloaded, decrypted with the old DEK, re-encrypted with the new DEK, and re-uploaded. The new DEK is then wrapped with the current KEK. This is a heavy operation and is treated as an emergency procedure.

### 6.4 TOTP (Two-Factor Authentication)

TOTP is required at registration and login as a second factor. It adds a layer of protection even if the password is compromised.

---

## 7. Open Questions / TBDs

| #     | Question                                                                                                 | Notes                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OQ-1  | Should folders be usable as saved export lists, or is the ad-hoc basket always ephemeral?                | Currently: basket is session-only; folders may serve as persistent "export templates" — TBD                                                                          |
| OQ-2  | What KDF parameters should be used for KEK derivation?                                                   | Argon2id recommended; params TBD during implementation                                                                                                               |
| OQ-3  | Should watermarks support images (e.g. a logo) in addition to text?                                      | Out of scope for v1, revisit later                                                                                                                                   |
| OQ-4  | What is the maximum supported document size?                                                             | TBD — depends on hosting constraints                                                                                                                                 |
| OQ-5  | Should the export basket be optionally saved as a collection?                                            | Possible future feature                                                                                                                                              |
| OQ-6  | Multi-device session handling: how are DEK sessions coordinated?                                         | Each device derives KEK independently on login; no coordination needed                                                                                               |
| OQ-7  | How does the browser configure which compute endpoint to use?                                            | Likely set once at setup time (e.g. stored in localStorage)                                                                                                          |
| OQ-8  | Should local mode (compute in browser) be the default, with server compute as opt-in?                    | TBD — affects onboarding flow                                                                                                                                        |
| OQ-9  | Watermark inheritance: does a sub-collection inherit its parent's watermark when it has none configured? | **Resolved:** No inheritance. The watermark of the exported collection is used. One watermark per export.                                                            |
| OQ-10 | Export depth: when exporting a collection, are documents in sub-collections included?                    | **Resolved:** Yes, recursively. The export modal offers a choice: flatten all files into a single directory, or preserve the nested folder structure in the archive. |
