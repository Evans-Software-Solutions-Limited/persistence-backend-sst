# Together backend — executable evidence and release gates

PR #462 covers PER-20, PER-21 and backend PER-22 under Brad's expanded backend
instruction. This record supersedes the original proof-only evidence. The
original `recoveryProof.ts` remains an isolated contract projection; production
code uses separate repositories, authenticated routes and real recording services.

## Executable coverage

| Boundary            | Local executable evidence                                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private admission   | Hashed expiring invites; consent/host approval; two-seat and one-unfinished-session constraints; revocation before cached receipts                                  |
| Concurrent actions  | Independent athlete versions, stale same-target rejection, delegation generations, plan identity tombstones and first-set interleavings                             |
| Durable recovery    | Atomic command receipts/outbox, disconnect/send failures, duplicate/out-of-order retries, bounded ordered replay, persisted projection restart                      |
| Real finalization   | Actual SessionRepository, PR, streak and volume adapters; transaction rollback at completion mapping; durable post-record effect retry without duplicate histories  |
| Socket delivery     | One-use tickets, connection bounds, current authorization, revoked/expired/Gone cleanup, content-free hints, retryable batch errors and cron fallback               |
| Social safety       | Opt-in search, legacy and new blocks, actor-bound signed pagination, soft-deleted account exclusion, private reports/admin queue and pair-scoped friend removal     |
| Places              | Geoapify search/nearby/resolve adapter contract tests, explicit unavailable errors, manual fallback, ephemeral coordinates and Sentry credential/location redaction |
| Template privacy    | Mutually authorized exercises, sanitized plans, atomic independent copies, duplicate receipts and revoked-access rejection                                          |
| Existing app safety | Default-off Hono feature isolation, legacy solo promotion conflict mapping, effective paid gate, existing solo recording regressions                                |
| Migration           | Actual forward migration applied twice locally; all 18 tables have RLS/no direct app-role grants; rollback preserves legacy tables                                  |

Tests use real PostgreSQL semantics through Drizzle/PGlite for persistence and
controlled seams for AWS/Geoapify delivery. They do not connect to production or
assert that mocked provider responses establish deployed behavior.

Validation commands (run from repository root):

```sh
bun run typecheck
bun run lint
bun run build --filter='!@persistence/mobile'
bun run test:unit --concurrency=1
```

Focused tests live under `application/together/__tests__`,
`application/social/__tests__`, existing `shared/__tests__` and the original
`application/together/recoveryProof.test.ts`. Provider/boundary tests assert real
outcomes, not snapshots of implementation text. Final results: full tests **21/21 tasks**, including **5,241 core tests in 387
files**; typecheck **9/9**, lint **6/6** (existing warnings), non-mobile build
**12/12**, changed-file formatting and deploy workflow actionlint pass. Core
coverage is **97.81% statements/lines, 93.91% branches, 97.62% functions**.
Changed-infrastructure TypeScript check passes; an optional full SST-config check
still encounters the pre-existing `infra/web.ts:208` Pulumi Input typing error.
Exact reviewed commit is recorded in the PR body.

## Independent local review

The expanded backend passed a fresh local Inspector re-sweep over the full branch
diff after all 11 findings were fixed. Fixes include pair-scoped invitation revocation, deleted-profile/exercise
privacy, durable custom-exercise recovery, storage-safe set bounds, substitution
metadata, canonical replay targets, host admission wakeups, pagination and legacy
promotion conflict responses. The final privacy-only delta also received a clean
follow-up. The CI Inspector bot was not triggered.

## Remaining gates

| Gate                         | Required evidence                                                                                                                                                 | Status                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Real PostgreSQL contention   | Independent connections racing admission, block/delegation, first sets, promotion versus solo save, finish and multiple workers; inspect lock/constraint outcomes | Not run; PGlite serializes a connection                          |
| Deployed AWS transport       | Approved stage/region, IAM, ticket socket handshake, queue/cron recovery, alarms/SNS, quota and latency                                                           | IaC prepared; not provisioned                                    |
| Place provider               | Approved Geoapify account/license/attribution/budget/quotas; real search/nearby/resolve and failure checks                                                        | Adapter tested locally; no provider activated                    |
| Entitlement event timing     | Staging cancellation/grace/downgrade/renewal transitions; prove revocation observation during offline periods                                                     | Request-time policy tested; webhook-to-session timing unverified |
| Mobile implementation        | SQLite promotion/command journal, UI, adapter integration, cache purge, explicit conflict recovery, permission/manual-place UX                                    | PER-22 remains open                                              |
| Compatible binary            | Brad-owned build with required native permission/runtime dependencies                                                                                             | No native/EAS build initiated                                    |
| Two physical phones          | SMOKE_TEST with dropped responses, airplane mode, restart, block/expiry, independent finish and actual history inspection                                         | Not run                                                          |
| Foreground latency           | ≥100 accepted commands; record platforms/network/sample count; p95 ≤2 seconds and zero acknowledged loss                                                          | Not measured                                                     |
| Moderation and product pilot | Named report triage owner, operations process and authorized pair research                                                                                        | Open before discovery/public release                             |

Backend code alone needs no native build or App Store release. Shipping the
complete Together experience requires mobile work and Brad's release decision.
All new infrastructure and endpoints remain default-off; no deploy, merge or
paid-provider activation was performed. Screenshots stay out of the PR.
