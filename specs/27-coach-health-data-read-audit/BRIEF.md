# 27 — Coach Health-Data Read-Audit (GO-LIVE BLOCKER)

**Status:** Brief for implementer · **Author:** Claude (Opus) · **Date:** 2026-07-20
**Related:** spec 25 (offboarding), spec 26 (consent). Independent of both — can ship in parallel.

> **Implementer:** self-contained brief; expand to a Kiro triplet first if you
> prefer. Ground every change in the cited files before editing.

## Problem & legal basis

The backend audits coach **writes** (`trainer_actions_audit`) but never coach
**reads**. There is no record of which client's health data a coach viewed, or
when. Under **UK GDPR** the **accountability (Art 5(2))** and **security
(Art 32)** principles favour being able to demonstrate access to special-category
data, and it's what lets us answer a client's **right-of-access request** ("who
has seen my data?"). Brad has classified this a go-live blocker (2026-07-20).

> ⚖️ NOT legal advice. Retention period + exact data categories should be
> confirmed with Brad's DPO. This brief implements the logging mechanism.

## Approach

Log every coach **read of client health data** to a new append-only table, via a
best-effort helper called from each coach read handler AFTER the authorization
guard passes. Best-effort = never block or fail the read, never add user-visible
latency.

### Data model

New append-only table `client_data_access_log`:
```
id            uuid pk default gen_random_uuid()
trainer_id    uuid not null references profiles(id) on delete cascade
client_id     uuid not null references profiles(id) on delete cascade
data_category text not null   -- 'measurements' | 'body_trend' | 'sessions'
                              -- | 'goals' | 'habits' | 'nutrition'
                              -- | 'client_detail_aggregate' | 'ai_summary'
                              -- | 'active_programme'
route         text not null   -- the request path, for traceability
created_at    timestamptz not null default now()
index (client_id, created_at desc)   -- DSAR "who viewed my data" query
index (trainer_id, client_id, created_at desc)
```

### Helper

`auditClientDataRead({ trainerId, clientId, dataCategory, route })` in
`application/relationships/` — a single INSERT, wrapped in try/catch and
**awaited-but-swallowed** (or fire-and-forget) so a logging failure never fails
the read. Same best-effort posture as `notifyRelationshipEnded` (spec 25).

### Call sites (coach health-data READ handlers)

Insert the helper call after the guard passes, before/after returning data:
- `trainers/measurements/trainersMeListClientMeasurementsHandler.ts` → `measurements`
- `trainers/measurements/trainersClientBodyTrendHandler.ts` → `body_trend`
- `trainers/sessions/trainersMeListClientSessionsHandler.ts` → `sessions`
- `trainers/goals/trainersMeListClientGoalsHandler.ts` → `goals`
- `trainers/habits/trainersMeListClientHabitCompletionsHandler.ts` → `habits`
- `trainers/habits/trainersMeGetClientHabitConfigHandler.ts` → `habits`
- `trainers/clients/trainersClientDetailGetHandler.ts` → `client_detail_aggregate`
- `trainers/clients/trainersMeGenerateClientAiSummaryHandler.ts` → `ai_summary`
- `trainers/programs/trainersClientActiveProgrammeGetHandler.ts` → `active_programme`

> Do NOT hook this inside `assertTrainerCanActForClient` — that guard also runs on
> WRITES (already audited via `trainer_actions_audit`), so hooking there would
> double-log and mis-categorise. Add the call explicitly per read handler.

### ⚠️ Volume / performance (tuning decision — flag to Brad/DPO)

`client_detail_aggregate` loads on nearly every coach screen open → the table
will grow fast. Options, pick per the DPO's retention appetite:
- **Coarse + de-dupe:** skip writing if the same `(trainer_id, client_id,
  data_category)` was logged within the last N minutes (e.g. 15) — collapses
  repeated opens into one row per session-ish window. Recommended default.
- **Every read:** simplest, highest volume. Only if legal wants full fidelity.
Implement the de-dupe behind a small config constant so it's tunable. `log()` /
document whatever coarsening is applied (don't silently drop).

### Retention

Access logs should NOT be kept forever. Add the table to whatever
retention/pruning mechanism the repo already uses (there's a health-data
retention migration precedent: `20260117235501_health_data_retention_policies.sql`
— mirror that pattern). Default suggestion: prune > 12 months; **DPO confirms.**

### DSAR support

Document the query that answers "which coaches viewed client X's data, and when":
`SELECT trainer_id, data_category, created_at FROM client_data_access_log WHERE
client_id = $1 ORDER BY created_at DESC`. No user-facing UI required for v1 (ops
query is enough) — note if Brad wants a client-facing "who's seen my data" screen
as a later slice.

## Tasks (DoD)

- [ ] **Migration + schema:** `client_data_access_log` table (idempotent) +
  Drizzle schema.ts. DoD: typecheck + idempotent.
- [ ] **Helper:** `auditClientDataRead` — best-effort, never throws. Test: a
  thrown INSERT does not reject the caller.
- [ ] **Wire all 9 read handlers** with the correct `data_category`. Tests: each
  handler writes an access-log row with the right category on a successful read,
  and the read still succeeds if the audit write throws.
- [ ] **De-dupe/coarsening** for `client_detail_aggregate` (and optionally all),
  config-tunable. Test the de-dupe window.
- [ ] **Retention** hook + a note in STATE.md for the prune cadence.
- [ ] Gates green (prettier/typecheck/lint/build/test ≥90%), local inspector-brad
  clean, note in PR. Migration → MANUAL prod apply.

## Hand to legal
Confirm: (1) the data categories to log; (2) retention period; (3) whether a
client-facing "who viewed my data" surface is needed for launch or is a
fast-follow.
