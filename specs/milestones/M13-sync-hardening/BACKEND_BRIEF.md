# M13 Backend Brief — session-write idempotency

## Problem

`SessionRepository.recordSession` (called by `POST /sessions/record`, the mobile "Finish workout"
flush path) is a plain multi-row `INSERT ... RETURNING` inside a transaction. Its own docstring
already admits: retrying the same logical request creates a second, duplicate completed session
with duplicate nested exercises/sets. Nothing dedupes on retry.

This matters because the mobile sync queue (`packages/mobile/src/application/commands/sync.command.ts`)
retries failed mutations up to `max_retries` (3) times, and "the server actually applied the write
but the client never saw the ack" (timeout, connection drop mid-response, app killed before the
200 is processed) is a real failure mode for a background flush — not hypothetical.

## Fix

Add an idempotency key to the session-record write path:

1. **Client-generated identifier.** The mobile session already has a locally-generated id (the
   `active_sessions` row's local id) before it's ever sent to the server. Have the client include
   that local id in the `/sessions/record` payload as e.g. `clientSessionId`.
2. **Server-side dedup.** Add a unique constraint on `(userId, clientSessionId)` — either a new
   nullable column on the `sessions` table (`packages/db/src/schema.ts`) or a small separate
   idempotency-key table, whichever is less invasive to the existing schema. On insert, if the
   constraint is violated, return the existing session (idempotent success — same shape response
   as a fresh create) rather than erroring or duplicating.
3. **Pattern to follow.** There's already an idempotency pattern in this codebase for Stripe flows
   (`microservices/core/src/application/subscriptions/stripeIdempotency.ts` —
   `deriveSubscriptionBaseKey`, `opKey`). Don't necessarily reuse that module directly (it's
   Stripe-shaped), but follow the same "derive a stable key, check-before-insert or
   upsert-on-conflict" shape.
4. **Migration.** Standard Drizzle migration under `packages/db/migrations/`, idempotent per repo
   convention (CLAUDE.md migration rules — must apply forward and backward without data loss, and
   be safe to re-run).

## Explicitly not required

- Don't add general-purpose row-level versioning/optimistic-concurrency columns across the schema
  — that's solving a conflict-resolution problem (concurrent edits to the same row from two
  devices) that doesn't exist for this write path. This fix is scoped to retry-dedup only.
- Don't touch the piecemeal editing endpoints (`POST /sessions/:id/exercises`,
  `PATCH .../sets/:setId`, etc.) — those are for post-completion edits (trainer feedback, M4
  progress edits) and are a different, lower-risk write pattern (single-row PATCH, not
  amplify-into-N-rows creates).

## Tests

- Submit `/sessions/record` twice with the same `clientSessionId` and identical payload → assert
  exactly one session row, one set of exercise rows, one set of set rows in the DB, and both HTTP
  responses return 200/201 with the same session id.
- Submit with a _different_ `clientSessionId` → assert a genuinely new session is created (guard
  against over-eager dedup).
- Existing `recordSession` tests must still pass; extend
  `microservices/core/src/application/sessions/repositories/__tests__/` (or wherever the existing
  suite lives) rather than creating a parallel test file.
- 90% coverage on changed files per repo standard.

## Out of scope for this PR

Everything in BRIEF.md's "explicitly out of scope" section, plus: no changes to goals/workouts
write paths (they're conventional single-row CRUD, not part of this audit's findings).
