# Epic: TAGGING

---

## S-TAG-1: Apply tags to a document on upload

**As a** logged-in user,
**I want to** assign tags to a document while uploading it,
**so that** it is immediately discoverable without a separate step.

### Acceptance criteria
- During the upload flow, user can type or select tags to apply.
- Tags are free-form text labels (case-insensitive matching recommended).
- Existing tags are suggested via autocomplete as the user types.
- New tags can be created inline without leaving the upload flow.
- Multiple tags can be applied to a single document.

---

## S-TAG-2: Add or remove tags on an existing document

**As a** logged-in user,
**I want to** update the tags on an existing document,
**so that** I can correct or evolve my organization scheme over time.

### Acceptance criteria
- User can open a tag editor for any document (from the list or detail view).
- Tags can be added (with autocomplete from existing tags) and removed individually.
- Changes are saved immediately on confirmation.
- Removing the last document from a tag does not automatically delete the tag (tags are retained for reuse — or deletion via tag management, TBD).

---

## S-TAG-3: Browse documents by tag

**As a** logged-in user,
**I want to** click on a tag and see all documents that carry it,
**so that** I can find related documents quickly.

### Acceptance criteria
- A tag index view lists all tags with their document counts.
- Clicking a tag shows a filtered document list containing only documents with that tag.
- The filtered list supports the same sorting and quick-actions as the main document list (S-DOC-5).

---

## S-TAG-4: Search and filter documents by multiple tags

**As a** logged-in user,
**I want to** filter documents by combining multiple tags,
**so that** I can narrow down results when I have many documents.

### Acceptance criteria
- User can select multiple tags simultaneously as filter criteria.
- The filter returns documents that match **all** selected tags (AND semantics).
- Active tag filters are shown clearly and can be removed individually.
- The filtered result set can be further narrowed by the name search from S-DOC-5.
