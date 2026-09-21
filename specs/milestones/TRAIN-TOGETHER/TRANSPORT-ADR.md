# PER-20 — authorized transport and recovery

21 September 2026. Decision for the E1 spike; no deployed Together service.
Authority: spec34 AC1–4/12–14 and D8–10, narrowed by the PER-20 execution cut.
PR #459 contained no Together implementation. Base: `ca4ca9c1`, after PR #460.

## Decision

Use the existing authenticated HTTP API for all commands, snapshots and replay;
select AWS API Gateway WebSockets for **content-free invalidations only**.
Postgres is authoritative. A socket is an accelerator, never a record of work or
an authorization grant. Socket frames are `{type:"sync_required"}` with no
athlete, exercise, result, revision or session payload. The connection is already
bound to one session. Clients fetch authorized HTTP changes after a wakeup.
Production infrastructure is a follow-up gate, not created by this proof.

This is a deliberate D8 framing refinement: its durable event stays in the outbox
and authorized replay response; it is not broadcast directly to sockets. It
avoids leaking a partner's exercise payload when revocation races a network send.
Authorization linearizes at the database transaction: reads committed before a
revocation may already be in flight and cannot be recalled. Revocation guarantees
that later reads/commands cannot obtain partner data; clients purge partner cache.
Metadata-free wakeups already in flight may arrive after revocation.

| Candidate                             | Authorization/recovery consequence                                                                                                                                                          | Decision                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Existing HTTP + AWS WebSocket wakeups | Reuses verified JWT API boundary; ticket at connect plus current access checks for replay. Durable recovery is independent of socket delivery.                                              | Selected                                              |
| Supabase private Broadcast            | Channel access policies are cached until subscribe/token refresh, so changing membership alone is insufficient proof of immediate revocation. Still needs server checks and durable replay. | No direct partner payload broadcast                   |
| HTTP polling only                     | Same authorization/recovery model; more reads and latency as polling backs off.                                                                                                             | Failure fallback; foreground polling must be measured |

AWS authorizers only run at `$connect`, not for each later message. Supabase
documents cached channel policies. These constraints, rather than brand
preference, drive the HTTP boundary. Sources checked 21 September:
[AWS authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api-lambda-auth.html),
[Supabase authorization](https://supabase.com/docs/guides/realtime/authorization).
The Supabase changelog index was checked; no Supabase SDK or live project change
is included in this spike.

## Existing components and reuse

- `packages/api-utils/src/auth/supabaseAuth.ts`: verified JWT → actor. HTTP body
  athlete IDs select targets, never actor identity. The local proof receives a
  trusted actor argument; it does not prove JWT verification or exposed routes.
- `infra/api.ts`: existing SST HTTP API/Lambda. Its CORS allowlist currently lacks
  `Idempotency-Key`; add that explicitly when mounting the production routes.
- `packages/db/src/client.ts`: singleton Drizzle/postgres.js connection with
  `prepare:false`. Retain transaction pooler configuration and short transactions.
- `application/entitlement/assertEntitlement.ts` and subscription catalog: reuse
  effective grants, scheduled-tier resolution and grace semantics. Existing
  `gym_buddy` access is permissive; it is **not** an acceptable Together gate.
  Subscription display flags alone do not establish effective eligibility.
- `application/repositories/sessionRepository.ts`: per-user client ID uniqueness,
  transactionally recorded exercises/sets and PR hooks. Its `afterRecord` option
  is a possible completion-mapping seam. It owns its transaction; wrapping a
  separate caller transaction does not make both atomic.
- `application/sessions/record/sessionsRecordHandler.ts`: streak/volume and
  analytics currently run after commit and skip replay. Together must durably
  enqueue/retry these effects; calling the route and assuming replay repairs
  every effect is insufficient.
- Existing queue/worker and reconciliation patterns can supply dispatch/retry
  infrastructure. A queue send after a DB write is not itself a transactional
  outbox. Store the outbox/job in the same transaction first, then dispatch.
- Existing Vitest + PGlite + Drizzle integration testing is reused. No new
  provider account, dependency or deployed schema is required for local proof.

Paths beginning `application/` above are under `microservices/core/src/`.

## Authorization and transaction contract

Every mutation carries an actor-scoped, route-scoped UUID idempotency key with a
canonical request hash; retain receipts for the feature data lifetime. Validate
current membership/target permission before returning a receipt. Changed body
under the same key is `409 IDEMPOTENCY_MISMATCH`. A revoked partner command must
return a permission error even if it once succeeded. Recovering one's own work
remains possible after paid eligibility expires or collaboration ends.

Private invitations store a high-entropy token hash, expire after 15 minutes and
grant only permission to request admission. Consent `together-v1` and host approval
are separate actions. Approval rechecks both effective entitlements, block state,
invite validity, current capacity and the one-unfinished-session invariant in one
transaction. It consumes the invite. A token alone never authorizes snapshot,
replay or a realtime ticket. Host finish cancels pending admission.

Serialize session membership/revocation and plan identity changes with commands.
Each athlete has an independent target version, execution and completion job.
Global revisions order replay, not optimistic concurrency: unrelated athlete
writes should both succeed. Same-target stale edits return `409 VERSION_CONFLICT`.
Delegation is off by default; every change increments its generation. Recheck
generation before deduplication. Revocation cannot be blocked by a stale expected
version. Block/leave/expiry remove cross-user access; only own recovery continues.

Never infer exercise identity from the mutable plan at finalization. D8's
ever-acknowledged identity tombstones survive removal of all sets. Substitutions
and plan replacement serialize against first-set recording. These full editing
operations and real exercise validation remain PER-22 integration requirements
unless explicitly listed as executed in the proof evidence.

## Durability and recovery

1. Mobile persists the command ID, key, body, target version and status before
   optimistic display. A promotion marker prevents solo completion from racing
   Together completion. This spike supplies the server contract, not mobile wiring.
2. One transaction checks authorization, receipt and target version; writes the
   execution, new revision, command receipt and outbox event; then commits.
   Disconnect before commit leaves no partial work. Lost acknowledgement retries
   the unchanged key/body and returns the original authorized result.
3. Dispatch is at least once. Failed send retains the outbox item; crash after send
   before marking delivered produces a harmless duplicate wakeup. Workers claim
   bounded batches with recoverable leases; production multi-worker locking and
   lease timing require real Postgres integration evidence.
4. Reconnect starts with an authorized snapshot at revision R, reconciles durable
   local command IDs and fetches events after R. Replay is ascending, bounded to
   500 events, with a 24-hour window. An expired cursor yields 410 and a fresh
   snapshot; never silently return a truncated history. Duplicate wakeups are
   harmless. Missing/out-of-order revisions trigger replay rather than application
   of a speculative event. No automatic rebasing of completed sets.
5. Explicitly reconcile stale pending commands before finish. Finish compares own
   revision and freezes execution in the same transaction that creates the unique
   `(session,athlete)` job. Retries of that finish return its completion state;
   another athlete can continue. Empty work yields `finished_empty`, no history.
6. A persisted stable recording client ID and immutable payload survive worker
   crashes. Recording, completion mapping and required effects must be atomic or
   durably idempotent stages. Retry after record commit must find the same history
   and still recover outstanding effects. Never reopen finalizing execution.

Worker completion also advances the session revision and inserts a completion
event/outbox row in its mapping transaction. A client that saw `pending` can thus
learn `saved` through replay without depending on another athlete's command.
Repeated worker execution emits no duplicate completion event. Finish/leave HTTP
retries preserve effect identity and request-hash checks but project current own
completion status/history, rather than returning an obsolete pending receipt.
Dispatch supplies a session ID to the server provider adapter for routing; that
identifier is not added to the content-free client frame.

The executable spike's recording sink uses persisted history/effect markers to
prove these failure boundaries. It is not a second production PR/statistics
implementation. Production reuse of the recording pipeline and mobile SQLite
journal remain explicit gates, not claims established by fixture tests.

## Provider operation and cost

Production needs an approved stage/region, WebSocket routes, connection registry,
one-use ticket storage (hash only, ≤60-second TTL), disconnect/revocation cleanup,
least-privilege ManageConnections IAM, outbox/finalizer workers, scheduled recovery,
DLQ/alarms, rate limits, retention policy and a disabled-by-default rollout flag.
Ticket consumption and membership validation must be atomic at connect. Redact
tokens/query strings and exercise payloads from logs. Client data messages are
rejected; commands always use HTTP. Clean up stale connections on Gone/410.

If WebSockets are unavailable, preserve HTTP command/recovery and use bounded
foreground polling with jitter/backoff; show stale/pending state honestly. Neither
provider failure nor host disappearance may prevent personal finish. A five-minute
cron cannot satisfy the two-second foreground target: dispatch needs a prompt
wakeup path with periodic recovery as a backstop.

Illustrative monthly load: 10,000 pair sessions × 60 minutes × 2 connections =
1.2 million connection minutes. At 200 commands/pair with two wakeups/command,
that is 4 million outbound messages, plus reconnect/control traffic. AWS's public
US-East example rates ($1/million messages and $0.25/million minutes) give about
**$4.30/month for those two WebSocket meters only**. This excludes HTTP (commands
and replay), Lambda, Postgres, queue, logging, storage, transfer, retries and tax;
it is not an EU-region quote or a total service estimate. Verify the selected
region and expected polling load before activation.
[AWS pricing](https://aws.amazon.com/api-gateway/pricing/).

## Places decision (PER-21 gate)

Keep a server-side provider adapter and manual venue/locality search as the
baseline. Do not use the public Nominatim endpoint as a production autocomplete
backend: its policy prohibits client autocomplete and imposes a one-request/second
maximum. Select an approved hosted OSM-compatible provider or self-hosted service
after confirming venue coverage, caching/licensing, attribution, privacy, regional
pricing and quotas. No paid provider is activated or chosen on invented pricing.
Until that gate is resolved, use synthetic place fixtures only; PER-20 private
sessions have no dependency on location. Optional GPS and permission copy need
Brad's compatible binary and explicit device checks.
[Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/).

## Evidence boundary and remaining gates

See [wire examples](./WIRE-EXAMPLES.json) and [recovery evidence](./RECOVERY-PROOF.md).
Static examples for PER-21/PER-22 routes are contracts, not implemented endpoints.
Local PGlite proves real SQL constraints, transaction rollback and persisted
restart, but its single-process scheduling does not prove multi-connection
Postgres lock behaviour, Lambda concurrency, JWT middleware, provider delivery,
physical-device storage or network latency.

Before PER-22 integration/release: production transactional adapter and recording
effects, current effective entitlement adapter, per-actor rate limits, ticket and
revocation integration, two independent Postgres connections racing writes,
mobile promotion/journal integration, real provider failure/disconnect recovery,
and two phones using owner-supplied compatible builds. Execute the existing
[smoke protocol](./SMOKE_TEST.md), capture at least 100 foreground propagation
samples and p95 ≤2 seconds, plus acknowledged-loss count (target zero). Record
platform/runtime/commit, network, trial counts and failures. No physical-phone
result, user pilot or released-app success is claimed by this PR. Moderation,
social/place provider approval and research remain their own release gates.
