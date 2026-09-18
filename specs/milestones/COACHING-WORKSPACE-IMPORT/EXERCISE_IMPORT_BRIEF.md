# Exercise-library migration — agent brief

Authority: spec 37 [requirements](../../37-exercise-library-import/requirements.md), [design](../../37-exercise-library-import/design.md), [tasks](../../37-exercise-library-import/tasks.md). Reuse spec 22 source/jobs infrastructure and current exercise ownership boundaries.

Own safe CSV/XLSX parsing, column mapping, owner-scoped source identities/aliases, duplicate decisions and resumable row receipts. Web owns the mapping table and error recovery; mobile uses the agreed file adapter. Do not widen system exercise write access, current custom-exercise capacity or client visibility implicitly.

Deliver a preview before mutation and explicit per-row create/keep/merge choices. Retain safe video links; owned-video hosting and optional AI autofill are separately evaluated follow-ons. A filename or fuzzy name is insufficient to overwrite an exercise. Successful rows remain visible when another row fails; retry is idempotent. Never execute spreadsheet formulae, macros or external references.

Evidence: duplicate export/retry, source ID collision across owners, stale user edit, partial batch cancellation, hostile/compressed workbook, invalid media link, tier/capacity boundary, alias use in programme import and an assigned client reading only permitted exercises. Report exact row totals and errors, correction time and genuine sample limitations. No extraction of another platform's proprietary library or third-party video downloading is authorized.
