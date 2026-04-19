# Dossier — Tech Stack

## Monorepo

**Tool:** pnpm workspaces (no Turborepo — 3 packages is manageable without it)

```
dossier/
├── packages/
│   ├── storage/      # Storage backend
│   ├── compute/      # Compute service
│   ├── client/       # Vite + React SPA
│   └── shared/       # Shared types, schemas, and RPC definitions
├── pnpm-workspace.yaml
└── package.json
```

### `shared` package

Contains **@effect/rpc router definitions** for both the storage API and the compute API. These are consumed as:

- **Server-side:** router handler implementations (storage service, compute service)
- **Client-side:** typed RPC clients (browser → compute, compute → storage)

This gives fully type-safe inter-tier contracts from a single source of truth, with built-in streaming support and no HTTP boilerplate. Also contains domain types (`Document`, `Collection`, `Tag`, etc.) and Effect schemas.

---

## Storage service (`packages/storage`)

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Framework | Effect-TS + @effect/platform-node | Typed errors, DI, streaming; user preference |
| Transport | @effect/rpc + @effect/platform-node HttpServer | RPC router served over HTTP; simpler than HttpApi with no method/status mapping. **Exception:** blob upload uses `PUT /blobs/:blobKey` (raw binary body) — @effect/rpc only streams responses, large binary uploads cannot be streamed through JSON payloads. |
| Database | SQLite + @effect/sql-sqlite-node | Zero-config, single file, trivial backup; integrates natively with Effect |
| Blob storage | Local filesystem | Simplest for self-hosted; abstracted behind an Effect service interface (S3-compatible adapter possible later) |
| Validation | Effect Schema (built into `effect`) | Native to Effect; validates incoming requests with typed errors |
| Auth tokens | JWT (jsonwebtoken) | Stateless session tokens issued after login + TOTP; compute presents these to storage |
| TOTP | otplib | Mature, well-tested TOTP library |
| KDF (Argon2id) | argon2 (native Node bindings) | Used at registration to validate KDF params; actual derivation is client-side |
| Password hashing | argon2 (same package) | Login password check (separate from KEK derivation) |

**What storage holds:**

- Encrypted document blobs (binary files on filesystem)
- Encrypted DEK per user (in DB)
- KDF params (in DB — sent to client at login so it can derive the KEK)
- Metadata: document names, tags, collections, watermark config (all unencrypted, in DB)
- User accounts + TOTP secrets

Storage is zero-knowledge with respect to document content: it never sees the DEK in plaintext.

---

## Compute service (`packages/compute`)

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Framework | Effect-TS + @effect/platform-node | Consistency with storage; Effect streams are ideal for large export pipelines |
| Transport | @effect/rpc + @effect/platform-node HttpServer | Same pattern as storage; implements the compute RPC router from `shared`. **Exception:** file ingestion uses `POST /upload` (multipart: file bytes + metadata; `x-dossier-session` + `x-dossier-dek` headers) — browser uses this for progress reporting and binary streaming. |
| Storage client | @effect/rpc client | Consumes the storage RPC router from `shared` to call the storage service |
| PDF watermark | pdf-lib | Pure TypeScript, works in Node.js; can add text overlays to existing PDFs |
| Image watermark (JPG/PNG) | sharp | High-performance native image processing; SVG text composite for watermark overlay |
| Archive creation | archiver | Streaming ZIP and TAR.GZ; never buffers entire archive in memory |
| Document encryption | Node.js built-in `crypto` (AES-256-GCM) | No extra deps; AES-256-GCM provides authenticated encryption |
| Validation | Effect Schema | Consistent with storage |

**Compute is stateless:** receives `{ dek, sessionToken, ...params }` per request, holds the DEK in memory only for the duration of the operation, never persists it anywhere.

---

## Client (`packages/client`)

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Build tool | Vite | Fast, simple SPA setup |
| Framework | React 19 | User requirement |
| Routing | TanStack Router | Type-safe routing; file-based routes work well for SPAs |
| State management | @effect-atom/atom + @effect-atom/atom-react | Effect-native reactive atoms; replaces external state/query libraries |
| Styling | Tailwind CSS + shadcn/ui | Utility-first; shadcn gives accessible components without locking into a component library |
| RPC client | @effect/rpc client | Typed client generated from RPC router definitions in `shared` |
| Key derivation (Argon2id) | hash-wasm | WASM-based Argon2id runs entirely in the browser; no native deps |
| Document encryption | Web Crypto API (AES-256-GCM) | Browser-native; no deps |
| PDF preview | pdfjs-dist (PDF.js) | Mozilla's library; renders PDFs in-browser |
| TOTP QR code display | qrcode | Renders the otpauth URI as a QR code for TOTP setup |

**KEK derivation happens entirely in the browser** using hash-wasm (Argon2id). The decrypted DEK is held in a React context / memory only — never written to `localStorage` or `sessionStorage`.

---

## Encryption scheme

### Key hierarchy

```
password (user) ──Argon2id(kdfParams)──▶ masterKey (in browser memory only)
                                               │
                          ┌────────────────────┴────────────────────┐
                     HKDF("kek")                               HKDF("auth")
                          │                                          │
                         KEK (256-bit)                          authKey (hex)
                          │                                          │
                    AES-256-GCM wrap                    argon2id hash stored in DB ◀── storage sees this only
                          │
                          ▼
               encrypted DEK  ◀── stored in DB (storage)
                          │
                    AES-256-GCM
                          │
                          ▼
             encrypted document blob  ◀── stored on filesystem (storage)
```

Storage receives `authKey` (not the password) during registration and login. It cannot reverse `authKey` to `masterKey`, and it cannot derive `KEK`. The zero-knowledge property holds even if the storage operator is malicious.

### Algorithms

| Operation | Algorithm | Notes |
|-----------|-----------|-------|
| KDF | Argon2id | Client-generated kdfParams (memory, iterations, parallelism, salt); stored in DB and returned to client at login so it can reproduce masterKey |
| Auth key split | HKDF | masterKey split into KEK (`info="kek"`) and authKey (`info="auth"`) |
| Auth verification | argon2id | Storage stores `argon2id(authKey)`; never sees password or masterKey |
| DEK wrapping | AES-256-GCM | KEK wraps DEK; IV stored in DB alongside encrypted DEK |
| Document encryption | AES-256-GCM | Compute generates a random 96-bit IV per document; IV prepended to ciphertext blob |

### Trust model

- **Storage** is zero-knowledge: never sees the password, masterKey, KEK, DEK, or document plaintext.
- **Compute** is ephemeral: receives DEK per-request, processes the document, discards the DEK.
- **Client** runs Argon2id and HKDF entirely in the browser (hash-wasm); holds masterKey and KEK in memory only — never written to storage or transmitted.
- Users who do not trust the storage operator can self-host compute (local compute mode — deferred, not in initial implementation).

---

## Local development

Each service runs independently. From the monorepo root:

```sh
# Install all dependencies
pnpm install

# Run storage service (default port TBD)
pnpm --filter storage dev

# Run compute service (default port TBD)
pnpm --filter compute dev

# Run client dev server (default port TBD)
pnpm --filter client dev
```

Ports and inter-service URLs will be configured via environment variables (`.env` files per package).

---

## Deferred decisions

| Topic | Status |
|-------|--------|
| Local compute mode (browser implementations) | Browser implementations of image processing, archive, and crypto services deferred. Interface design must account for browser portability from the start — two implementations per service (Node.js + browser), swapped via Effect's DI. Blocked by: `sharp` has no browser WASM equivalent (candidate: native Canvas API or a WASM image lib); `archiver` is Node-only (candidate: `fflate`); Node.js `crypto` must be abstracted over Web Crypto API. `pdf-lib` already browser-compatible. |
| Argon2id KDF parameter values | TBD at implementation (OQ-2 in PRD) |
| Max document size | TBD (OQ-4 in PRD) |
| S3-compatible blob storage adapter | Possible future addition; blob service is abstracted |
| Turborepo / build caching | Not needed now; revisit when build times become a concern |
