# PER-20 recovery proof and remaining gates

Scope: E1's local protocol proof, not the shipped Together feature. Base main
`ca4ca9c1` includes PR #460; PR #459 did not implement Together. The normal checkout
was clean before the fast-forward and creation of
`codex/per-20-together-recovery-proof`.

## Executable boundary

Code lives under
`microservices/core/src/application/together/`. It is deliberately unmounted:
no HTTP route, mobile UI, deployed table, provider resource or production
entitlement behaviour changes. It reuses existing Drizzle/Vitest/PGlite tooling.
The actor and effective policy inputs are trusted fixture boundaries, not a
substitute for production JWT/catalog authorization.

The immutable-plan projection exercises private admission and separate athlete
sets. Full plan replacement, substitutions, rest/skip/removal, social features,
place lookup, promotion and the mobile journal are not silently implemented.
The broader [wire examples](./WIRE-EXAMPLES.json) specify D8/D9-shaped requests and
responses for follow-up adapters; their labels distinguish examples from executed
behaviour. An example is not proof that its route exists.

The database-backed fixture recording sink stores independent history/effect
markers. It demonstrates idempotent retry and crash recovery, not production
statistics calculations. Production must reuse `SessionRepository.recordSession`
and existing PR/statistics services, with durable handling of post-commit effects.
The [ADR](./TRANSPORT-ADR.md) records the concrete reuse seams and constraints.

## Reproduction and results

From the repository root:

```sh
bun run --cwd microservices/core test:unit src/application/together/recoveryProof.test.ts --coverage.include='src/application/together/recoveryProof.ts'
bun run prettier:check
bun run typecheck
bun run lint
bun run build --filter='!@persistence/mobile'
bun run test:unit --concurrency=1
```

Final focused run (21 September): **17/17 tests, 1/1 files**, 11.33 seconds.
V8 reports **100% statements, branches, functions and lines** for
`recoveryProof.ts`, with real non-empty counters; no coverage exclusion added.
This is coverage of the bounded projection, not exhaustive production validation.

| Executed scenario                      | Observed assertion                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invitation/consent/privacy             | Only host approval admits; token alone cannot read; plaintext secret absent from tables/receipts/events                                                 |
| Competing approvals                    | Exactly two seats; stale approvals, expired/revoked invitations and unpaid applicants rejected                                                          |
| Independent concurrent sets            | Both athlete writes survive; versions/results remain separate; stale same-target request rejected                                                       |
| Lost acknowledgement/duplicate command | Same key or command ID produces one effect; changed body fails; a new retry key is also bound to its hash                                               |
| Delegation, block and expiry           | Current authorization precedes cached receipts; old generations fail; restored paid grants do not silently restore severed access; own recovery remains |
| Transaction failure                    | Injected pre-commit failure leaves execution, receipt and outbox unchanged; retry commits once                                                          |
| Disconnect/replay                      | Failed wakeup remains pending; authorized replay is ordered and bounded; expired cursor rejected                                                        |
| Separate finalization                  | Own revision frozen; partner can continue; record/mapping fault rolls back; retry yields one history/effect marker; empty work yields no history        |
| Process restart                        | Close/reopen on-disk PGlite preserves pending outbox, receipt deduplication and frozen completion jobs                                                  |
| Completion notification                | Completion revision/event/outbox are atomic; duplicate worker calls do not emit again; revoked replay is denied                                         |
| Two-session dispatch                   | Server routes each wakeup to its session; failed delivery remains retryable and is not consumed for another session                                     |

Repository validation: typecheck **9/9**, lint **6/6** (existing warnings),
non-mobile build **12/12**, formatting pass, full suite **21/21 tasks** including
379 core test files, 75 web files and 535 mobile suites. Turbo reused unchanged
workspace caches. The final Inspector fixes passed both the 17-test focused run
and the repeated full suite (**5,160 core tests**, 1,483 web tests, 6,968 mobile
unit tests), plus the final non-mobile build. Mobile tests are unit tests, not a
native build or phone check.

Local Inspector initially reproduced missing completion replay and missing
session dispatch routing. Both were fixed with regression tests; the re-sweep
returned `INSPECTOR_VERDICT: CLEAN`, no outstanding findings. No CI review bot was
triggered.

## Evidence still required

| Gate                                     | Owner / required proof                                                                                                                                                        | Status                             |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Production PostgreSQL transactions       | PER-22 backend: independent connections race admission, revocation, same-target writes, first-set identity locks and finish; assert constraints after failures                | Unverified                         |
| Real recording/effects adapter           | PER-22 backend: stable per-user client ID, atomic completion mapping/PRs, durably retried streak/volume stages, no duplicate history/effects after each crash boundary        | Unverified                         |
| Authentication and effective paid access | PER-22 backend: verified JWT only; grants, scheduled downgrades, cancellation grace, blocks, rate limits and active-session uniqueness                                        | Unverified outside fixture policy  |
| WebSocket deployment                     | Backend + Brad: approved region/stage, one-use tickets, connection registry, current authorization, disconnect cleanup, IAM, recovery workers, alarms and quota/cost approval | Not provisioned                    |
| Mobile durable journal/promotion         | PER-22 mobile: SQLite restart and acknowledgement reconciliation; no duplicate solo completion; preserve/reveal local-only unsent work on logout/device change                | Unverified                         |
| Two physical phones                      | Brad supplies compatible builds; run SMOKE_TEST with dropped responses, airplane mode, app restart, expiry/block, independent finish and real history inspection              | Not run; no native build initiated |
| Foreground latency                       | ≥100 accepted commands; record platform/runtime/network, sample count, p95 ≤2 seconds and zero acknowledged loss                                                              | Not measured                       |
| Place provider and social safety         | PER-21: approved provider/license/quotas, manual fallback, optional foreground permission checks and named moderation owner                                                   | Open; no paid activation           |
| Integrated product/pilot                 | PER-21/PER-22/E7: full editing contract, invitation UX, reuse/privacy, solo regression and actual research/pair evidence                                                      | Open                               |

PGlite executes actual PostgreSQL semantics locally but serializes one connection;
Promise races establish application ordering here, not deployed contention or
multi-process worker behaviour. Disk reopen tests establish persisted local
recovery, not a phone's SQLite lifecycle. Provider and device gates do not prevent
reviewing this bounded proof; E1/E7 remain open for their external evidence.

## Review hygiene

The PR contains no screenshots. Do not deploy, merge, trigger the CI Inspector,
or initiate native/EAS/mobile builds as part of this slice. Local Inspector and
repository validation evidence belong in the final PR body and this record.
