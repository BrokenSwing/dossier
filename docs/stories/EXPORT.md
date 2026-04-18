# Epic: EXPORT

---

## S-EXP-1: Export a collection as an archive

**As a** logged-in user,
**I want to** download all documents in a collection (including sub-collections) as a single archive,
**so that** I can share the full dossier with a third party.

### Acceptance criteria
- User initiates export from the collection view.
- All documents in the collection are included, recursively across all sub-collections.
- The export modal offers a structure choice:
  - **Flatten** — all files in a single directory, regardless of their sub-collection depth.
  - **Preserve structure** — sub-collections become directories in the archive, mirroring the folder hierarchy.
- The watermark of the exported collection is applied to all documents (if configured or overridden at export time via S-WM-3). No watermark is inherited from parent collections.
- One watermark is applied per export — sub-collection watermark configurations are ignored during export.
- The archive is packaged in the chosen format (ZIP or TAR.GZ, see S-EXP-4) and streamed directly to the browser — never stored on the server.
- Export progress is visible for large collections.

---

## S-EXP-2: Include or exclude specific documents from a collection export

**As a** logged-in user,
**I want to** choose which documents to include when exporting a collection,
**so that** I can exclude irrelevant or sensitive files from a particular export without removing them from the collection.

### Acceptance criteria
- Before confirming the export, user sees the full recursive document tree grouped by sub-collection.
- All documents are selected by default.
- User can deselect individual documents or an entire sub-collection at once.
- The export proceeds only with the selected subset.
- The selection is not persisted — it applies only to this export.

---

## S-EXP-3: Ad-hoc export basket

**As a** logged-in user,
**I want to** add documents from anywhere in my vault to a temporary basket and download them as an archive,
**so that** I can create one-off exports without building a dedicated collection.

### Acceptance criteria
- User can add any document to the export basket from any view (document list, tag view, collection view).
- The basket is visible as a persistent element (e.g. a sidebar or floating cart) while documents are in it.
- User can review and remove documents from the basket before exporting.
- User can apply a watermark to the basket export (same override flow as S-WM-3).
- Exporting the basket produces an archive of the selected documents.
- The basket is session-scoped: it is cleared on lock or logout.
- The basket is not persisted between sessions.

---

## S-EXP-4: Choose archive format

**As a** logged-in user,
**I want to** choose between ZIP and TAR.GZ when exporting,
**so that** I can produce a format suitable for the recipient's platform.

### Acceptance criteria
- In the export flow (both collection and basket), user can select the archive format: ZIP or TAR.GZ.
- The selection defaults to ZIP.
- The chosen format is applied to the generated archive.
- The file extension of the downloaded archive matches the chosen format.
