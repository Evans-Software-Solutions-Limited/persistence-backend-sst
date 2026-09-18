# Programme/workout/voice import — agent brief

## Authority and deliverable

Read spec 22 [requirements](../../22-program-import-and-adaptation/requirements.md), [design](../../22-program-import-and-adaptation/design.md) and [tasks](../../22-program-import-and-adaptation/tasks.md), especially the September amendment MI-1–8/§10. It supersedes old clamp/nontransaction/public-cache instructions. Deliver a faithful source-backed editable draft, not automatic programming.

## Tracks and ownership

- Evaluation owner: authorized corpus, field/resolution labels, held-out modality scores, correction-time/cost report and explicit enable/disable recommendation. No unapproved paid calls or recruitment; build the harness/protocol independently.
- Backend owner: import handlers, private sources and drafts, real jobs registry/worker, catalogue resolver integration, capability/metering and atomic idempotent acceptance; share types before frontend coding. Database changes must follow repo migration conventions. No model or network call inside the accept transaction.
- Web/mobile owners: source capture, transcript/preview, questions/mapping, draft recovery and acceptance receipt. Use capabilities, not client-only tier checks. New audio/document adapters require Brad's native runtime build; browser support can proceed independently.

Accept can create a standalone workout. A finite periodised programme additionally depends on spec 36 scheduling/prescription compatibility; never silently turn week-specific work into a repeating cycle. Import saves to library; schedule/assign remains a separate confirmed user action. All paid coach tiers are explicitly included, with existing unrelated feature gates unchanged.

## Verification

Map evidence to MI criteria: corrupt/oversized/scanned/handwritten input; inaccessible URLs and redirects; ambiguous exercise/units; voice corrections; unresolved unsupported fields; tenant isolation; disabled/downgraded capability; duplicate worker/cancel/accept races; rollback and retry after lost response; source deletion/expiry; old-client handling and real logged workout. Measure whole correction time and model cost per modality. A successful API response alone is not proof of programme fidelity.

Return contracts, changed files, scored evaluation and limitations, test output, screenshots, native/runtime requirements and unchecked tasks. Do not claim a source type or real pilot is ready without measured evidence. This brief's current assignment is scope/evaluation preparation until an implementation phase is dispatched.
