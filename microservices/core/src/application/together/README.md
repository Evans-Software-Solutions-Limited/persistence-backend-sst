# PER-20 recovery proof (unmounted)

`recoveryProof.ts` is an executable contract projection, not a production service.
Nothing imports it into `api.ts`, creates production tables, activates a provider
or changes existing solo recording. Run from the repository root:

```sh
bun run --cwd microservices/core test:unit src/application/together/recoveryProof.test.ts --coverage.include='src/application/together/recoveryProof.ts'
```

The fixture uses real PGlite PostgreSQL transactions through Drizzle, including
row locks and unique constraints. All mutations lock the session aggregate;
athlete versions are independent even though transaction execution serializes.
PGlite serializes connections: these tests exercise interleavings submitted with
`Promise.all`, not production multi-connection Postgres contention/deadlock load.

## Projection and evidence

- `seed` and `policy` are trusted fixture setup; actor IDs passed to `execute`,
  `snapshot` and `replay` must come from a verified authentication adapter. UUIDs,
  version integers, consent, delegation and set values are validated locally.
- `invite`, `request`, `approve`, `revokeInvite` prove hashed opaque invitation
  tokens, explicit consent, host approval and two-seat admission. Tokens alone
  never permit snapshot/replay. Invitation plaintext never enters the database:
  an adapter reconstructs the token from `tokenId` with a stable server HMAC key.
- `set` projects D8 `upsertSet` for one fixed, immutable fixture exercise. Each
  athlete starts with empty sets and owns a separate version and result. There
  are no plan edits, substitutions, removals or rest operations in this proof;
  therefore it does not establish the D8 identity-lock/tombstone contract.
- Every executed mutation stores a per-session/actor/operation/key receipt and
  canonical request hash atomically with its state and ordered outbox event.
  Execution command IDs are deduplicated separately from HTTP idempotency keys.
  Current membership/policy/delegation checks run before receipt delivery.
  Newer versions reject stale commands; retries cannot silently overwrite sets.
- `dispatch` emits only `{type:"sync_required"}` and marks delivery after sending.
  The callback receives session ID separately as server-side routing metadata; it
  must acknowledge only after dispatch to that session's subscribers. A failed
  send leaves that event undelivered and may duplicate the hint on retry.
  Replay reads durable ordered events under
  current authorization, bounded to 500 and a 24-hour cursor age. This models a
  subscriber-specific provider adapter, not connection lookup/fanout itself.
- Sticky expiry/block/leave revocation prevents partner replay/snapshots/writes.
  Policy updates take the same session row lock as commands/replay. Revocation
  is persisted in the aggregate and cannot be undone by restoring paid grants.
  Own snapshots, pending sets and finish remain available without host presence.
  Revoking delegation advances its generation without a stale-version barrier.
- Finish/leave freeze one athlete and enqueue one unique durable job containing
  that athlete's exact revision and sets. The job UUID is the stable future
  recording client/history ID. Concurrent/reordered finish and edit, duplicate
  finish, rollback at record/mapping boundaries and disk reopen are exercised.
  Empty completion is `finished_empty`, with no history. Other athletes continue.
  Completing a job advances the session revision and emits a durable completion
  event in the recording/mapping transaction; worker retries do not emit twice.
  Finish/leave retry receipts refresh the current own completion status/history.
  Internal `finalizing` corresponds to HTTP `pending`; the fixture exports the
  internal state rather than pretending to be a mounted HTTP DTO.
- `complete` is a recording **fixture sink**. The recording row and one effect
  marker prove transactional recovery/idempotency, not actual statistics or PRs.

## Production adapter gates

Do not mount this class. It is intentionally a compact fixture projection rather
than D8 HTTP DTOs: the aggregate has no full plan, session closure state, profile,
exercise catalog, single-active-session index or promotion identity. Full route
schema rejection, errors/status codes, rate limits, authenticated JWT boundary,
central paid/grace/coach catalog integration, persistent per-pair block policy,
one-active-session enforcement, invite request bounds, promotion/solo suppression,
server outbox scheduling/retention and provider tickets remain integration work.
The proof does not implement PER-21 discovery/social/sharing or PER-22 mobile
commands, local durable queues, reconciliation UI, cache purge or two-phone UX.

Actual recording must reuse `application/repositories/sessionRepository.ts`
`recordSession`, including its `afterRecord` transaction hook. Its current
post-commit statistics behavior is best-effort; production adapters must close
that durable effect gap before claiming exactly-once history/statistics/PRs.
Do not copy the fixture effect marker into a second production statistics path.
Provider setup, subscription authorization/disconnect, one-use ticket expiry,
network latency/p95, native compatibility and two-phone faults remain unverified.
See the milestone ADR and contract fixtures for full framing and remaining gates.
