# Reviewed completion and recovery

Implements the approved PER-22/PER-64 completion decisions, after PRs 474–476.
The feature remains off pending mobile/native transport and release evidence.

- Host close requires current session and own revisions and an explicit mode:
  `finish_all` freezes acknowledged state and queues independent nonempty results;
  `save_own` saves the host while preserving other athletes' private active executions.
  Both permanently close sharing, admission and delegated logging. Legacy host
  finish/leave also closes sharing using save-own semantics.
- Closing does not prove disconnected devices have uploaded all sets. Clients
  retain their journals, show pending recovery honestly, and use owner review.
  Empty acknowledged execution creates no history; later reviewed work can save.
- `POST /together/sessions/:id/review` accepts the owner's full reviewed execution
  and expected own revision after finalization. A stale revision conflicts rather
  than overwriting newer data. The frozen plan and authorized definitions bound
  the exercise identities. The host cannot submit another athlete's recovery.
- `POST /together/offline/recovery/:executionId/complete` explicitly accepts a
  stored candidate by its expected revision and completion timestamp. Upload
  remains storage-for-review only. Subsequent candidates amend the same result;
  the initial completion timestamp remains stable. Pure offline and cloud
  identities remain separate until the native authority-transition slice.
- History root identity remains stable. Authoritative reviewed edits replace the
  owned result's sets atomically with personal-record reconstruction. Removing all
  work cancels an existing result; an initially empty result creates no history.
- Durable revisioned effects reconcile workout streaks and affected historical
  volume windows. Recovery workers serialize effects with Together actor locks;
  an older worker cannot acknowledge a newer pending revision.
- Generic history endpoints allow metadata edits but reject lifecycle, time,
  set/exercise edits and deletion for Together-owned results with HTTP 409
  `TOGETHER_REVIEW_REQUIRED`. Use the owner review endpoint for result changes,
  including an empty reviewed execution to cancel a saved result. This keeps
  the journal, history identity and derived statistics consistent.
- All mutations require authentication and idempotency keys. Own recovery does
  not require renewed paid sharing entitlement. Database tables stay server-only.

Tests cover independent/empty outcomes, private solo continuation, revoked sharing,
stale and repeated requests, owner isolation, same-history amendments, downward
records/removal, transactional failures, durable effect retries and date boundaries.
No mobile UI, native build, feature activation or deployment is included.
