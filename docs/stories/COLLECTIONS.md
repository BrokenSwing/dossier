# Epic: COLLECTIONS — Folder Management

---

## S-COL-1: Create a named collection

**As a** logged-in user,
**I want to** create a named collection (folder), optionally nested inside an existing one,
**so that** I have a place to group related documents for a specific purpose (e.g. a client dossier).

### Acceptance criteria
- User provides a name for the collection (non-empty, reasonable length).
- User can optionally select a parent collection; if none is selected, the collection is created at the root level.
- Collection names must be unique within their parent (siblings cannot share a name; same name is allowed in different parents).
- The new collection appears immediately in the appropriate level of the collection tree, empty.

---

## S-COL-2: Add a document to a collection

**As a** logged-in user,
**I want to** add an existing document to a collection,
**so that** it is included in that collection's views and exports.

### Acceptance criteria
- A document can belong to multiple collections simultaneously.
- User can add a document from the document list, the document detail view, or from within the collection view.
- The collection member count is updated immediately.

---

## S-COL-3: Remove a document from a collection

**As a** logged-in user,
**I want to** remove a document from a collection,
**so that** it no longer appears in that collection without deleting it from my vault.

### Acceptance criteria
- Removing a document from a collection does not delete the document.
- The document remains in other collections it belongs to.
- The document continues to appear in the main document list and tag views.
- User is not prompted for confirmation (low-stakes, easily reversible by re-adding).

---

## S-COL-4: View all documents in a collection

**As a** logged-in user,
**I want to** open a collection and browse its contents,
**so that** I can review, manage, or prepare an export of that group.

### Acceptance criteria
- The collection view shows sub-collections and direct member documents.
- Sub-collections are displayed before documents.
- A breadcrumb trail shows the current position in the hierarchy (e.g. `House Project / Contracts / 2024`).
- Documents show: name, format, upload date, and tags.
- Supports the same sorting options as the main document list.
- Quick-actions available per document: preview, remove from collection, delete.
- The collection's watermark configuration (if set) is displayed.

---

## S-COL-5: Delete a collection

**As a** logged-in user,
**I want to** delete a collection I no longer need,
**so that** my collection tree stays clean.

### Acceptance criteria
- User is prompted to confirm deletion.
- Deleting a collection removes the collection, its sub-collections (recursively), and all membership records.
- **Documents are not deleted.** They remain in the vault and in any other collections they belong to.
- A clear warning is shown before confirmation, listing how many sub-collections will also be removed.

## S-COL-7: Move a collection

**As a** logged-in user,
**I want to** move a collection to a different parent (or to the root),
**so that** I can reorganize my folder hierarchy without recreating it.

### Acceptance criteria
- User can select a new parent collection for any existing collection, or move it to the root.
- A collection cannot be moved into one of its own descendants (circular nesting is rejected).
- The breadcrumb and navigation update immediately to reflect the new position.
- All sub-collections and documents within the moved collection are unaffected.

---

## S-COL-6: Set a default watermark on a collection

**As a** logged-in user,
**I want to** configure a default watermark for a collection,
**so that** exports from that collection are automatically watermarked without manual configuration each time.

### Acceptance criteria
- From the collection settings, user can define a text watermark (see S-WM-1 for watermark definition details).
- The watermark configuration is stored as metadata on the collection (not embedded in the documents).
- A collection may have no watermark (default: no watermark).
- The configured watermark is pre-filled at export time and can be overridden (see S-WM-3).
