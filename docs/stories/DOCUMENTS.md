# Epic: DOCUMENTS — Core Document Management

---

## S-DOC-1: Upload a document

**As a** logged-in user,
**I want to** upload a file from my device,
**so that** it is securely stored in my vault.

### Acceptance criteria
- Supported formats: PDF, JPG, PNG. Other formats are rejected with a clear error message.
- Client encrypts the file with the session DEK before upload.
- User can provide a name for the document (defaults to the original filename if not provided).
- User can optionally apply tags during upload.
- User can optionally add the document to one or more existing collections during upload.
- Upload progress is visible for larger files.
- On success, the document appears immediately in the document list.

---

## S-DOC-2: View / preview a document

**As a** logged-in user,
**I want to** open and preview a document,
**so that** I can verify its contents without downloading it.

### Acceptance criteria
- Client fetches the encrypted document from the server.
- Client decrypts it with the session DEK in memory.
- The decrypted content is rendered in-browser (PDF viewer, or image display).
- The plaintext file is never written to disk by the browser (best-effort, using in-memory Blob/Object URLs).
- PDFs display page navigation controls.
- Images display at a readable size with zoom capability.

---

## S-DOC-3: Rename a document

**As a** logged-in user,
**I want to** rename a document,
**so that** I can keep my vault organized without re-uploading.

### Acceptance criteria
- User can edit the display name of any document.
- The new name is validated (non-empty, reasonable length).
- The rename is reflected immediately in all views (list, collections, tags).
- Renaming does not affect the encrypted file content.

---

## S-DOC-4: Delete a document

**As a** logged-in user,
**I want to** delete a document,
**so that** it is permanently removed from my vault.

### Acceptance criteria
- User is prompted to confirm deletion before proceeding.
- Deletion removes the encrypted file and all associated metadata (tags, collection memberships) from the server.
- The document no longer appears in any list, tag view, or collection.
- Deletion is permanent and cannot be undone (no soft-delete / recycle bin in v1).

---

## S-DOC-5: List and browse all documents

**As a** logged-in user,
**I want to** see a list of all my documents,
**so that** I can find and access them quickly.

### Acceptance criteria
- The document list shows: name, format/type indicator, upload date, and assigned tags.
- Documents can be sorted by name or upload date (ascending/descending).
- A search/filter bar allows filtering by name substring.
- Pagination or infinite scroll is used if the document count is large.
- Each document entry has quick-access actions: preview, rename, delete, add to collection.
