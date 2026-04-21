# Epic: WATERMARK

---

## S-WM-1: Define a text watermark on a collection

**As a** logged-in user,
**I want to** configure a text watermark for a collection,
**so that** exported documents carry a visible attribution or confidentiality notice.

### Acceptance criteria

- User can enter arbitrary watermark text (e.g. `"For ACME Corp — 2026-04-18"`).
- Configuration options include (at minimum): watermark text. Additional styling options (opacity, position, font size) are TBD.
- The watermark configuration is saved as part of the collection metadata.
- A collection can have its watermark cleared (set back to no watermark).

---

## S-WM-2: Preview a watermark applied to a document

**As a** logged-in user,
**I want to** see a preview of what a watermark looks like on a document,
**so that** I can verify it looks correct before exporting.

### Acceptance criteria

- From the collection view or the export flow, user can open a watermark preview for any document in the collection.
- The preview renders the document with the configured (or overridden) watermark text applied.
- The preview is generated client-side or server-side (TBD based on implementation) and displayed in-browser.
- The preview is never written to the vault — it is ephemeral.

---

## S-WM-3: Override the watermark at export time

**As a** logged-in user,
**I want to** edit the watermark text just before exporting,
**so that** I can customize it per recipient or occasion without changing the collection's default.

### Acceptance criteria

- In the export flow, the collection's default watermark text is pre-filled (if one is set).
- User can edit the watermark text for this export only.
- User can remove the watermark for this export (export without watermark), even if the collection has a default.
- The collection's stored watermark configuration is not modified by this override.
