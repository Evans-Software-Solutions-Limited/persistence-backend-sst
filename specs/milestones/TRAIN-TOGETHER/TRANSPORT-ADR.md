# Together transport, authorization and recovery

21 September 2026. PR #462 implements the backend for PER-20, PER-21 and the
server portion of PER-22 (E1–3/server E7). Brad explicitly expanded the original
proof scope to include all Together backend work. Mobile integration, activation
and physical-device evidence remain separate gates. PR #459 did not implement
Together; PR #460 was already merged before this branch started.

## Decision

Use the existing authenticated HTTP API for commands, snapshots and replay.
AWS API Gateway WebSockets carry only `{ "type": "sync_required" }` invalidations.
Postgres is authoritative; a socket grants no permission and contains no athlete,
exercise, result, revision or session data. Clients fetch currently authorized
HTTP state after a wakeup and use foreground polling when sockets fail.

This refines D8's earlier broadcast wording. Permission checks linearize under
transaction locks. A response authorized before revocation may already be in
flight and cannot be recalled; all subsequent reads/writes recheck access.
Content-free hints already in flight cannot leak workout payloads.

| Candidate                           | Consequence                                                                                        | Decision                                     |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Existing HTTP + AWS WebSocket hints | Reuses verified JWT boundary; one-use connection tickets; durable recovery independent of delivery | Selected                                     |
| Supabase private Broadcast          | Cached channel policies still require explicit revocation/reconnect handling and durable recovery  | No direct partner payload broadcast          |
| HTTP polling                        | Same authorization and recovery contract; more reads and latency                                   | Required mobile fallback, latency unmeasured |

AWS authorizers run at connect rather than on every later message; Supabase
caches channel policies. See [AWS authorization](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-lambda-auth.html)
and [Supabase authorization](https://supabase.com/docs/guides/realtime/authorization).

## Reused infrastructure

- Existing Supabase JWT verification establishes the actor. Body IDs only select
  an authorized target. Effective paid access uses the shared subscription
  catalog, paid-through cancellation and scheduled-tier resolution. `gym_buddy`
  now fails closed for ineligible users; role/display flags do not grant access.
- Existing Drizzle/postgres.js pooler connection (`prepare:false`) and short
  transactions. Sorted per-user guard rows precede session row locks, so social
  revocation and session mutation share an ordering boundary.
- Existing `SessionRepository.recordSession` records each athlete under a stable
  client ID. An optional transaction seam makes histories, sets, PRs, participant
  mapping and completion outbox atomic. Solo recording rejects promoted drafts
  while Together is enabled. Existing solo callers retain their behavior.
- Existing streak reconciliation and volume recomputation run from a durable
  completion job. A failure leaves `effectsDone=false`; retry recomputes from
  durable history instead of duplicating history or trusting a swallowed error.
- Existing friendships, workout/exercise tables and duration estimation supply
  social relationships and independent template copies. Legacy blocks remain
  enforced. New social opt-in, block/report and receipt tables cover missing data.
- Existing SST/SQS/Lambda/CloudWatch patterns supply dispatch and recovery. The
  queue carries wakeups only; committed database jobs/events are the authority.

## Authorization and durability

All mutations use a UUID `Idempotency-Key`, scoped to actor and route, plus a
canonical body hash. Current authorization precedes receipt lookup. Reusing a
key with different content returns `409 IDEMPOTENCY_MISMATCH`. Command IDs have
separate durable deduplication. Receipts and identity tombstones survive retries
and set removal; no automatic rebase can overwrite acknowledged work.

Private invitation tokens are HMAC-derived and hash-checked; only identifiers
and hashes persist. Tokens expire after 15 minutes and allow requesting admission,
not reading a session. Explicit `together-v1` consent and host approval recheck
both paid grants, audience, block state, invitation and exactly-two capacity.
A partial unique index enforces one unfinished session per athlete.

Athletes have independent versions, sets, substitutions, skips, rest and finish.
Host plan edits cannot delete or change ever-acknowledged exercise identities.
Partner logging is opt-in with a revocable generation checked before deduplication.
Block, leave and observed eligibility loss end collaboration; own recovery remains.
An observed revocation commits even when the attempted operation is denied.
Historical entitlement transitions never observed by this service require staging
validation against subscription-webhook timing; local tests do not prove that
an offline lapse is observed before a later renewal.

Finish freezes one athlete's exact execution and enqueues one stable completion
job. Duplicate/out-of-order requests cannot reopen it. Empty finish creates no
history. A saved completion increments the session revision and inserts its
outbox event in the same recording transaction. Retried finish returns current
own status/history, not an obsolete pending receipt. The other athlete can
continue and finish independently.

HTTP replay is ascending, bounded to 500 events and a 24-hour window. An expired
cursor returns `410 CURSOR_EXPIRED`; clients must fetch a fresh snapshot. Socket
frames never replace replay. Jobs, receipts and acknowledged identity history are
retained for the feature data lifetime; account deletion cascades personal rows.
Deleting a host sets `hostId:null` without deleting the surviving athlete's work.
That survivor retains own recovery; host administration and invitations end.
Accepted exercise definitions are retained per athlete. Selected exercises must
be visible under the existing catalog/assignment policy to every receiving athlete.
Foreign custom exercises are recorded as stable private athlete-owned copies;
missing originals recover from the accepted minimal definition. This prevents a
creator purge from deleting someone else's saved history. Recovery copies retain
name/category/muscle identity, not the creator's private notes/instructions, and
may appear in the recipient's custom catalog. Template copies use the same
independent ownership rule. No third-party exercise UUID grants read access.

## Dispatch and setup

`infra/together.ts` is disabled unless deployment receives `TOGETHER_ENABLED=true`.
It defines WebSocket routes, SQS wakeup queue/DLQ, bounded recovery worker and a
one-minute recovery sweep. Post-commit queue failure does not discard work. Batch
failures throw for retry; send-before-ack crashes may repeat harmless hints.
Workers serialize durable finalization via database locks; hints are at least once.
Current authorization is checked before dispatch. Expired/revoked sockets are
closed; Gone/410 sockets are removed. Tickets are one use, expire in 60 seconds,
and connections expire in two hours. Five active sockets per athlete/session
limits fanout; excess connections return `409 CONNECTION_LIMIT` before ticket use.

Stage setup (not performed):

1. Apply `supabase/migrations/20260921211637_together_backend.sql` using the normal
   reviewed migration process. Its 18 tables enable RLS and revoke direct
   `anon`/`authenticated` grants. Only the server database role accesses them.
2. Set GitHub environment secret `TOGETHER_TOKEN_SECRET` to a stable random value
   of at least 32 characters. Deploy workflows sync it to SST `TogetherTokenSecret`.
   Rotation invalidates invitations/cursors; plan and communicate it deliberately.
3. For place search, supply `GEOAPIFY_API_KEY` (SST `GeoapifyApiKey`). Approve
   provider terms, attribution, budget and quota before enabling discovery.
4. Set environment variable `TOGETHER_ENABLED=true` only in an approved stage.
   Keep `TOGETHER_DISCOVERY_ENABLED` false until moderation ownership and privacy
   checks pass. Both default off; no resources were provisioned by this PR.
5. Confirm ManageConnections permissions, queue delivery, cron recovery, DLQ/age/
   worker alarms and the existing SNS subscription. An unconfirmed SNS subscription
   does not deliver alerts. Exercise failures against real independent connections.
6. Run the two-phone smoke with Brad's compatible build before public rollout.

Rollback before data creation may use the paired rollback SQL. After use, retain
schema/data and roll back to a compatible recovery-capable release. Turning off
Together disables its routes and infrastructure; drain/recover active work before
that action. Do not drop tables or disable recovery underneath active athletes.

## Places, privacy and moderation

Geoapify supplies stable place IDs and coarse venue centers; exact input GPS
coordinates are ephemeral and not persisted. Manual text search requires no GPS
permission but still requires provider availability. Missing keys/failures return
an explicit unavailable response, never fake nearby results. Manual geocoding
pages through the provider's bounded top 50 results; nearby uses provider offsets.
Pagination cursors are HMAC-signed, actor/query-bound and expiring. HTTP errors,
Sentry breadcrumbs and query strings redact coordinates and provider credentials.
See [Geoapify geocoding](https://apidocs.geoapify.com/docs/geocoding/) and
[Geoapify places](https://apidocs.geoapify.com/docs/places/).

Friends/search opt-in, either-direction blocks, consent and report storage are
server enforced. Reports are private, with an admin-only moderation list; a named
human triage owner and response process remain discovery rollout gates. Templates
copy only plan fields into an independent workout, never partner results or notes.
Revocation prevents future access while already accepted copies remain independent.

## Cost and evidence limits

Illustrative load: 10,000 pair sessions × 60 minutes × two connections = 1.2m
connection minutes; 200 commands/pair × two hints = 4m messages. AWS's US-East
example rates ($1/million messages, $0.25/million minutes) give about $4.30 for
those WebSocket meters only, not a London quote or total service estimate.
HTTP, Lambda, database, queue, cron, logs, transfer, provider fees and tax are
additional. Verify selected-region prices and polling load before activation.
[AWS pricing](https://aws.amazon.com/api-gateway/pricing/).

Local execution uses PostgreSQL semantics in PGlite, which serializes its connection.
It cannot establish real multi-process lock contention, AWS latency, deployed IAM,
phone SQLite recovery or two-phone p95 ≤2 seconds. See [evidence and remaining
gates](./RECOVERY-PROOF.md) and [smoke protocol](./SMOKE_TEST.md). No native build,
App Store release, deploy, merge or CI Inspector trigger is part of this backend PR.
