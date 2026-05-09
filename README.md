# Dossier

A self-hosted, encrypted document vault. Store, organize, and export your sensitive documents — contracts, invoices, IDs, certificates — with end-to-end encryption and watermarked exports.

## Features

- **End-to-end encryption** — documents are encrypted in the browser before upload; the storage backend never holds a plaintext key or document
- **TOTP 2FA** — required at registration and every login
- **Tagging** — apply free-form tags to documents and filter by one or more tags
- **Collections** — group documents into named folders; a document can belong to multiple collections
- **Watermarking** — define a text watermark per collection, applied at export time (PDF and image formats)
- **Flexible exports** — download a selection as a ZIP or TAR.GZ archive, with optional watermark
- **Key rotation** — re-encrypt all documents under a new password without re-uploading originals

## Architecture

Dossier is split into three independent tiers:

```
Browser (client)
  │  derives encryption key from password (Argon2id + HKDF)
  │  holds DEK in session memory only
  ▼
Compute service
  │  encrypts uploads, decrypts previews, applies watermarks, builds archives
  │  stateless — receives the DEK per-request, never stores it
  ▼
Storage service
  │  stores encrypted blobs and unencrypted metadata (names, tags, collections)
  │  zero-knowledge: never holds a plaintext document key
```

**Compute modes**

The compute layer can run in two modes — the same code path, different deployment:

- **Server-hosted** — runs on a VPS alongside storage. Good for trusted setups.
- **Local (planned)** — compiled to WASM, runs entirely in the browser. No plaintext data ever leaves the device.

Users who don't trust the storage operator can self-host the compute layer so their plaintext documents never reach the storage host's infrastructure.

## Tech stack

| Layer | Tech |
|---|---|
| Storage | Effect-TS, Node.js, SQLite (better-sqlite3), Argon2id, JWT |
| Compute | Effect-TS, Node.js, pdf-lib, sharp, archiver |
| Client | React 19, TanStack Router, Effect-TS, hash-wasm (Argon2id), Web Crypto API |
| Shared | Effect-TS Schema (RPC contracts, domain types) |
| Monorepo | pnpm workspaces |

## Project structure

```
packages/
  shared/   — RPC definitions and domain types shared by all packages
  storage/  — Storage HTTP service
  compute/  — Compute HTTP service
  client/   — React browser application
  e2e/      — End-to-end integration tests
docs/
  PRD.md          — Product requirements
  stories/        — User stories (AUTH, DOCUMENTS, TAGGING, COLLECTIONS, WATERMARK, EXPORT)
```

## Getting started

### Prerequisites

- Node.js ≥ 24
- pnpm ≥ 9

### Install

```sh
pnpm install
```

### Configure

Copy the example env files and adjust as needed:

```sh
cp packages/storage/.env.example packages/storage/.env
cp packages/compute/.env.example packages/compute/.env
cp packages/client/.env.example packages/client/.env
```

Key variables:

| File | Variable | Description |
|---|---|---|
| `storage/.env` | `JWT_SECRET` | Secret used to sign session tokens — change in production |
| `storage/.env` | `DB_PATH` | Path to the SQLite database file |
| `storage/.env` | `BLOB_DIR` | Directory where encrypted blobs are stored |
| `compute/.env` | `STORAGE_URL` | URL of the running storage service |
| `client/.env` | `VITE_STORAGE_URL` | Storage service URL (visible to the browser) |
| `client/.env` | `VITE_COMPUTE_URL` | Compute service URL (visible to the browser) |

### Run in development

```sh
pnpm dev
```

This builds the shared package and starts storage, compute, and the client dev server concurrently.

### Run tests

```sh
# Build service packages first (required by integration and e2e tests)
pnpm build:services

# Run all tests across all packages
pnpm test
```

## CI

Two GitHub Actions workflows run on every push to `master` and on every pull request:

- **Test** — builds all service packages, then runs typecheck and the full test suite (unit, integration, and E2E)
- **Style** — format check and lint

See [`.github/workflows/`](.github/workflows/) for details.

## Documentation

- [`docs/PRD.md`](docs/PRD.md) — full product specification, security model, and open questions
- [`docs/stories/`](docs/stories/) — user stories broken down by area
- [`packages/storage/tests/integration/INTEGRATION_TESTS.md`](packages/storage/tests/integration/INTEGRATION_TESTS.md) — guide to writing storage integration tests
