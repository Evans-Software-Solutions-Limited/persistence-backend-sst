# 37 — Exercise-library import: design

## D1 Reuse and separation

Reuse `exerciseRepository.ts` search/visibility and `application/exercises/create/exercisesCreateHandler.ts` ownership/idempotency rules. Search score alone is not a confidence policy. Import parser/resolver are a new domain service and async job kind sharing spec 22's private-source, admission and receipt infrastructure. No separate AI provider or upload stack. Backend owns shared imports infrastructure; programme and catalogue target contracts remain distinct.

Use `catalogue_import` entitlement explicitly, with Premium Plus and all paid coach tiers; never rely on an unrecognized feature's catch-all. Keep existing custom-exercise limits intact unless a deliberate subscription change is agreed. Preflight requested creation count against current limits and show the resulting capacity before commit. Tier expiry prevents new commits; already imported private exercises remain governed by ordinary ownership.

## D2 Contract and mapping

Candidate routes `POST /exercise-imports/drafts` with `{sourceId,sheet?,columnMapping?}`, `GET/PATCH /exercise-imports/drafts/:id`, and `POST /exercise-imports/drafts/:id/accept` with expected revision/idempotency key; reuse spec 22 error semantics. Expose cancel/delete and source expiry consistently. Return raw rows, normalized candidates, mapping issues, per-row choice and existing target revision; no source formula evaluation. Unknown columns remain available in preview, not silently assigned to the wrong domain field.

Store private import batch, draft revision and row receipts. Source identity is `(owner,importSourceNamespace,sourceRowId)` when provided; fallback normalized-row fingerprint only deduplicates within that import and proposes across-import matches for review. Do not let a matching external ID from another account update an exercise. Preserve aliases in an owner-scoped lookup that programme import can consult. System exercise selection can link existing identity; changing its metadata requires a private overlay/copy rather than editing system data. Schema for overlay/alias is a backend contract deliverable before implementation.

## D3 Commit and lifecycle

Catalogue batches differ from a programme: accept explicitly permits independently committed reviewed rows. Use bounded chunks; each row's upsert and receipt are atomic, locked against existing target revision. Return progress and exact created/updated/skipped/failed counts. Cancellation stops uncommitted rows and retains clearly reported committed changes; it never rolls back someone else's subsequent edits. Retrying only unresolved rows cannot reapply old updates. Undo, if added, must preview safe eligible imported creations; never cascade-delete used exercise history.

Validate media URLs by scheme/provider and render safe embeds/links; no arbitrary server fetching. Spreadsheet parsing runs with compressed-size/expanded-size/sheet/row/cell bounds, no macro/formula execution, and errors for encrypted/corrupt files. Escape formula-leading values if a CSV error/export report is downloaded. Raw source/drafts expire after seven days or earlier user deletion, accepted row identity/receipt follows data-retention policy; record cleanup work. Do not log source content.

## D4 UI and second-stage video

Web Workspace → Library → Exercises → Import: upload → sheet/column mapping → duplicates and row decisions → confirm → receipt/error list. Mobile can select an export file and review smaller batches; desktop is recommended for large migrations, not required for ordinary exercise creation. Newly created exercises appear in the same library and programme resolver.

Bulk owned-video upload requires a separate storage/transcode delivery design and measured cost before activation. Reuse private upload authentication, validate formats, scan/process safely, generate short-lived delivery URLs for authorized viewers and define retention after exercise deletion. Filename matching is a suggestion until accepted. Thumbnail/metadata workers cannot publish content or expand sharing by themselves.

Test with real authorized catalogue exports and synthetic malicious/duplicate cases. Measure migration completion rate, correction count/time, repeat import behaviour and whether imported exercises are usable in a logged assigned workout. No Relay account export or copying of its proprietary library is assumed.
