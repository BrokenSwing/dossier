# Dossier

A self-hosted, encrypted document vault. Store, organize, and export your sensitive documents — contracts, invoices, IDs, certificates — with end-to-end encryption and watermarked exports.

## Features

- **Encrypted storage** — documents are encrypted at rest; the storage backend never holds a plaintext key
- **Tagging** — apply free-form tags to documents and filter by one or more tags
- **Collections** — group documents into named folders; a document can belong to multiple collections
- **Watermarking** — define a text watermark per collection, applied at export time
- **Flexible exports** — download a collection or an ad-hoc selection as a ZIP or TAR.GZ archive
- **TOTP 2FA** — required at registration and login

## Architecture

Dossier is composed of three tiers:

- **Storage** — stores encrypted document blobs and metadata (names, tags, collections). Zero-knowledge: never holds a plaintext document key.
- **Compute** — stateless processing layer that handles encryption, watermarking, and export on behalf of the client. Can be self-hosted on a VPS or run locally in the browser.
- **Client** — browser UI. Derives the encryption key from the user's password and holds it in session memory.

Users who do not trust the storage operator can self-host the compute layer so plaintext data never reaches the storage host's infrastructure.

## Status

Pre-implementation. See [`docs/PRD.md`](docs/PRD.md) for the full product specification and [`docs/stories/`](docs/stories/) for user stories.

## Tech stack

To be decided. Candidate: Effect-TS backend, React + TanStack Start frontend, monorepo.
