# Session-scoped PREV sharing

Backend implementation brief for AC16 / F2 / PER-22, following merged PR #477
(`7531d26e`). The selected-recipient, private-by-default and revocable product
scope was approved on 30 September and confirmed for implementation on 1 October.

## Behaviour and privacy boundary

An athlete selects up to three current participants who may read their previous
exercise values during this session. Friendship, joining and delegated logging
are separate permissions. New participants never inherit a grant. Access ends
when either athlete finishes/leaves, sharing closes, the session expires, a block
applies or collaboration eligibility is lost. Removing a friendship alone does
not cancel an explicitly selected in-session grant; blocking does.

Only effective, non-skipped exercises from the owner's current plan/execution
are eligible. A substitution exposes previous values for the replacement, not
both exercises. Return only exercise ID, set number, weight, reps and recorded
time from completed owned history before this Together session started. Never
return historical session IDs, titles, notes, private catalog fields, records or
unrelated exercises. Set numbers are bounded to 1–100. The owner can read their
own values after sharing ends, using their frozen plan.

## HTTP contract

All endpoints use existing authenticated Together middleware and remain behind
`TOGETHER_ENABLED`. No native build or feature activation is part of this slice.

`PUT /together/sessions/:id/previous-consent`, with UUID `Idempotency-Key`:

```json
{
  "expectedVersion": 0,
  "recipientIds": ["11111111-1111-4111-8111-111111111111"]
}
```

This replaces only the authenticated owner's recipient list. Empty recipients
revoke access, including after closure or entitlement expiry. A separate consent
version rejects stale changes with `VERSION_CONFLICT` (409); idempotent retries
validate the original request and report current consent, never restore an old
grant. Invalid recipients are rejected rather than silently removed.

The response is `{data:{sessionId,ownerId,version,recipientIds}}`. Only the owner
receives this list; after sharing ends the effective list is empty.

`GET /together/sessions/:id/previous/:ownerId` reads current authorized values.
Responses include session/owner identity, consent version, session revision,
plan version and owner execution revision so clients can reject stale responses.
Unauthorized recipients receive no historical content. Both responses use
`Cache-Control: no-store`.

The snapshot exposes each participant's `previousValuesAvailable` and the
caller's own effective `previousConsent` (`version`, `recipientIds`). Consent
mutations emit a durable `previous_consent_changed` invalidation with owner and
version only. Historical values and recipient lists never enter shared events
or mutation receipts. Existing socket frames remain content-free wakeups.

## Mobile and offline follow-up

The client must keep partner PREV outside its owner recent-sets cache. On consent
change, plan/substitution change or loss of active sharing, discard affected
partner values and reauthorize. Purge partner caches on leave, finish, account
change and logout. Reject in-flight responses whose identity/version/plan or
execution revision no longer matches current state. Already received values
cannot be made unseen; an authorized response in flight cannot be recalled.

On reconnect, load the current snapshot before displaying cached partner values.
An old `previous_consent_changed` event is only an invalidation, never proof of
permission. Re-fetch the dedicated PREV endpoint after checking current consent.

This PR implements cloud authorization and a wire contract, not native offline
sharing or UI cache purge. Local transport must bind consent to verified owner,
recipient, session and generation; cloud grants do not grant offline authority.
Until that protocol and mobile purge are implemented, offline partner PREV stays
unavailable. Fully offline nearby training remains required under PER-64.

## Migration and rollback

Apply the generated `together_previous_consent` migration before the new backend.
Existing participants default to an empty recipient list and version zero. The
participant table retains server-only access, RLS and client-role revocations.
No backfill of historical values or implicit consent is performed.

For a pre-rollout rollback, restore the earlier backend first, then run the paired
rollback SQL. It removes consent columns (and therefore discards grants), leaving
workout plans, executions and results intact. Both directions are rerunnable.

## Evidence required

Real PGlite coverage for default privacy, selected recipients, new members,
cross-session reads, stale retries/revocations, lifecycle and block/expiry denial,
projection and substitution, plus migration reapply/rollback and client-role
isolation. HTTP tests cover auth, schema, identity and no-store. PGlite is not
proof of live PostgreSQL contention or physical-device cache behavior.
