# Persistence Together — backend agent

## Expanded PR #462 scope — 21 September 2026

Brad explicitly requested all remaining Together backend implementation in this
PR, bundling the backend portions of PER-20, PER-21 and PER-22. This supersedes the
proof-only execution cut below. Implement D8/D9 production persistence, authenticated
routes, paid gates, social/place/safety and sanitized sharing, durable recording
and effects, realtime ticket/dispatch/recovery infrastructure, migrations and
tests. Preserve the proof as evidence and update its historical scope labels.
Mobile UI/journal/native changes, provider activation, deployment and merging
remain outside this authorization. Provider credentials, physical-device checks,
moderation ownership and pilot evidence must remain explicit release gates.

Concurrency implementation: acquire actor guard rows in stable UUID order before
mutating shared membership, commands, finalization or pair safety state. Session
rows serialize revisions; per-athlete target versions avoid false conflicts.
All production access must use the same database-backed policy and mutation
receipts, not the fixture actor/paid inputs. Private and recovery APIs remain
available when discovery rollout is disabled. Route mounting is controlled by a
default-off Together rollout flag until migrations/setup are deliberately enabled.

## Historical PER-20 execution cut — superseded by expanded scope

Brad authorized E1's transport decision, executable private-pair recovery proof,
wire fixtures and evidence. The broader E2/E3 implementation below remains gated
for PER-21/PER-22. PR #459 did not implement Together. PR #460 merged before this
work; the proof starts from main `ca4ca9c1`.

Build an isolated, unmounted proof under `application/together/`, using existing
Vitest/PGlite tooling for real transactional persistence, rollback and restart
tests. Exercise private invitations/consent/approval, current authorization and
revocation, independent executions, command deduplication and target versions,
durable outbox/replay, and independent idempotent completion jobs. Record the
production recording adapter boundary honestly: a fixture sink proves recovery
mechanics, not deployed history/statistics/PR integration. No production tables,
routes, mobile UI, provider resources or social/discovery features ship here.

The ADR must specify production adapters, provider/setup gates, revocation races,
cost assumptions and the two-phone latency/fault checks still unverified. Keep
E1's physical-device gate open until real evidence exists.

## Spec alignment

Implement [design](../../34-train-together/design.md) D8–10, satisfy [requirements](../../34-train-together/requirements.md) AC1–8,11–14 and close [tasks](../../34-train-together/tasks.md) E1–3/server E7. Read all parent files and repository instructions first. Do not implement draft single-logger assumptions superseded by D8.

## Ownership and execution

Own new `microservices/core/src/application/together/`, social/place handler modules beside it, mounting in `microservices/core/src/api.ts`, `packages/db/src/schema.ts` and migrations, central entitlement/catalog edits and realtime infrastructure. Coordinate shared files with coach backend; this track supplies D9 place/block/report contracts. Frontend owns mobile files. Do not overwrite parallel work.

1. Capture protocol/transport/provider ADR: authenticated revocable subscriptions, durable event dispatch, cost estimate, p95 target, reconnection, provider failure and no paid-service activation. Publish exact wire schema/fixtures for all D8/D9 routes, including errors and snapshots; frontend consumes them.
2. Inspect D10 recording and entitlement anchors. Add migrations with uniqueness/foreign keys and transactional capacity, target-version, delegation-generation and idempotency enforcement. Do not merely broadcast client writes.
3. Implement endpoints exactly as D8/D9; no client-selected identity or permissive `gym_buddy` path. Rate-limit invite/search/report actions. Validate audience, block and both effective entitlements before admission; repeat authorization on commands and event delivery.
4. Reuse recording service with durable per-athlete completion mappings/outbox. Demonstrate retry after each crash boundary without duplicate history, statistics or PR effects. Recover independently of host presence. Promotion cannot race solo completion into duplicate recording.
5. Provide social search/request/accept/remove/block, coarse place resolver, nearby expiry, report moderation storage and sanitized template copies. Update coach agent on available contract fixtures. Report handling needs an operations owner before discovery rollout.

## Evidence

Test concurrent approvals, self/partner authorization, stale writes, key/body mismatches, replay after revocation/block, disconnected sockets, expiry recovery, host loss, plan deletion or exerciseId replacement under a recorded planExerciseId (including concurrent first-set recording by either participant), substitution changes/reset-to-null before and after the first acknowledged set (including first-set races and removal of all prior sets), duplicate promotion, finalization crash/retry and template privacy. Include real persistence integration tests for transaction/uniqueness behavior; pure mocks cannot establish it. Use existing co-located test patterns.

Run repository formatting, typecheck, lint and relevant unit/integration tests; inspect CI workflow to identify remaining required checks. Report exact commands/results and unmet gates. No native/mobile build authorization. Provide migration rollout/rollback notes, endpoint examples, fixtures and E7 smoke support. Submit a scoped PR with local Inspector Brad evidence; do not activate paid services or publish the feature from this brief.
